/// <reference lib="webworker" />

import {
  areStageHistoryViewsEqual,
  getStageHistorySnapshot,
  moveStageHistoryCursor,
  replayStageHistoryToStep,
  type StageHistoryEntry,
  type StageHistoryState,
} from './stage-history';
import type {
  StageHistoryWorkerRequest,
  StageHistoryWorkerResponse,
} from './stage-history-protocol';

declare const self: DedicatedWorkerGlobalScope;

let history: StageHistoryState | null = null;

self.addEventListener('message', (event: MessageEvent<StageHistoryWorkerRequest>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'initialize':
        history = message.history;
        postResponse({
          requestId: message.requestId,
          snapshot: getStageHistorySnapshot(history),
          type: 'initialized',
        });
        return;
      case 'record-checkpoint':
        history = appendHistoryEntry(requireHistory(message.type), {
          kind: 'checkpoint',
          state: message.state,
          summary: message.summary,
        });
        postResponse({
          requestId: message.requestId,
          snapshot: getStageHistorySnapshot(history),
          type: 'ack',
        });
        return;
      case 'record-view':
        history = appendHistoryView(requireHistory(message.type), message.view, message.summary);
        postResponse({
          requestId: message.requestId,
          snapshot: getStageHistorySnapshot(history),
          type: 'ack',
        });
        return;
      case 'move-cursor': {
        const currentHistory = requireHistory(message.type);
        const currentCursorStep = currentHistory.cursorStep;
        const nextHistory = moveStageHistoryCursor(
          currentHistory,
          currentCursorStep + message.stepDelta,
        );
        const didMove = nextHistory.cursorStep !== currentCursorStep;

        history = nextHistory;
        postResponse({
          requestId: message.requestId,
          snapshot: getStageHistorySnapshot(history),
          state: didMove ? replayStageHistoryToStep(history, history.cursorStep) : null,
          type: 'replay',
        });
        return;
      }
      default:
        return;
    }
  } catch (error) {
    postResponse({
      message: error instanceof Error ? error.message : String(error),
      requestId: message.requestId,
      type: 'error',
    });
  }
});

function requireHistory(source: StageHistoryWorkerRequest['type']): StageHistoryState {
  if (!history) {
    throw new Error(`Stage history worker received ${source} before initialization.`);
  }

  return history;
}

function postResponse(response: StageHistoryWorkerResponse): void {
  self.postMessage(response);
}

function appendHistoryView(
  currentHistory: StageHistoryState,
  view: Extract<StageHistoryWorkerRequest, {type: 'record-view'}>['view'],
  summary: string,
): StageHistoryState {
  const lastEntry = currentHistory.entries[currentHistory.cursorStep];

  if (lastEntry?.kind === 'view' && areStageHistoryViewsEqual(lastEntry.view, view)) {
    return currentHistory;
  }

  return appendHistoryEntry(currentHistory, {
    kind: 'view',
    summary,
    view,
  });
}

function appendHistoryEntry(
  currentHistory: StageHistoryState,
  entry: StageHistoryEntry,
): StageHistoryState {
  if (currentHistory.cursorStep < currentHistory.headStep) {
    currentHistory.entries.length = currentHistory.cursorStep + 1;
  }

  currentHistory.entries.push(entry);
  currentHistory.cursorStep = currentHistory.entries.length - 1;
  currentHistory.headStep = currentHistory.cursorStep;
  return currentHistory;
}
