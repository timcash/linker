/// <reference lib="webworker" />

import {
  appendStageHistoryCheckpoint,
  appendStageHistoryViewState,
  createStageHistoryState,
  getStageHistorySnapshot,
  moveStageHistoryCursor,
  replayStageHistoryToStep,
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
        history = createStageHistoryState(message.state, message.summary);
        postResponse({
          requestId: message.requestId,
          snapshot: getStageHistorySnapshot(history),
          type: 'ack',
        });
        return;
      case 'record-checkpoint':
        history = appendStageHistoryCheckpoint(
          requireHistory(message.type),
          message.state,
          message.summary,
        );
        postResponse({
          requestId: message.requestId,
          snapshot: getStageHistorySnapshot(history),
          type: 'ack',
        });
        return;
      case 'record-view':
        history = appendStageHistoryViewState(
          requireHistory(message.type),
          message.view,
          message.summary,
        );
        postResponse({
          requestId: message.requestId,
          snapshot: getStageHistorySnapshot(history),
          type: 'ack',
        });
        return;
      case 'move-cursor': {
        const currentHistory = requireHistory(message.type);
        const nextHistory = moveStageHistoryCursor(
          currentHistory,
          currentHistory.cursorStep + message.stepDelta,
        );
        const didMove = nextHistory.cursorStep !== currentHistory.cursorStep;
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
