import {type StageSystemState} from './plane-stack';
import {
  createStageHistoryViewState,
  getStageHistorySnapshot,
  type StageHistoryState,
  type StageHistorySnapshot,
} from './stage-history';
import type {
  StageHistoryWorkerRequest,
  StageHistoryWorkerResponse,
} from './stage-history-protocol';

type PendingResponse = {
  reject: (error: Error) => void;
  resolve: (response: StageHistoryWorkerResponse) => void;
};

export class StageHistoryController {
  private flushHandle: number | null = null;
  private nextRequestId = 1;
  private readonly pendingResponses = new Map<number, PendingResponse>();
  private readonly queuedRequests: StageHistoryWorkerRequest[] = [];
  private readonly worker: Worker;

  constructor(
    initialHistory: StageHistoryState,
    private readonly onSnapshot: (snapshot: StageHistorySnapshot) => void,
  ) {
    this.worker = new Worker(new URL('./stage-history-worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener('message', this.handleWorkerMessage);
    this.onSnapshot(getStageHistorySnapshot(initialHistory));
    this.postNow({
      history: initialHistory,
      requestId: this.allocateRequestId(),
      type: 'initialize',
    });
  }

  destroy(): void {
    this.clearScheduledFlush();
    this.worker.removeEventListener('message', this.handleWorkerMessage);
    this.worker.terminate();

    for (const pending of this.pendingResponses.values()) {
      pending.reject(new Error('Stage history controller was destroyed.'));
    }

    this.pendingResponses.clear();
    this.queuedRequests.length = 0;
  }

  recordCheckpoint(summary: string, state: StageSystemState): void {
    this.enqueue({
      requestId: this.allocateRequestId(),
      state,
      summary,
      type: 'record-checkpoint',
    });
  }

  recordView(summary: string, state: StageSystemState): void {
    this.enqueue({
      requestId: this.allocateRequestId(),
      summary,
      type: 'record-view',
      view: createStageHistoryViewState(state),
    });
  }

  async moveCursor(stepDelta: number): Promise<StageSystemState | null> {
    this.flushQueuedRequests();
    const response = await this.request({
      requestId: this.allocateRequestId(),
      stepDelta,
      type: 'move-cursor',
    });

    if (response.type !== 'replay') {
      throw new Error(`Expected a replay response, received ${response.type}.`);
    }

    return response.state;
  }

  async exportHistory(): Promise<StageHistoryState> {
    this.flushQueuedRequests();
    const response = await this.request({
      requestId: this.allocateRequestId(),
      type: 'export',
    });

    if (response.type !== 'exported') {
      throw new Error(`Expected an exported response, received ${response.type}.`);
    }

    return response.history;
  }

  private allocateRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }

  private request(request: StageHistoryWorkerRequest): Promise<StageHistoryWorkerResponse> {
    return new Promise<StageHistoryWorkerResponse>((resolve, reject) => {
      this.pendingResponses.set(request.requestId, {reject, resolve});
      this.postNow(request);
    });
  }

  private enqueue(request: StageHistoryWorkerRequest): void {
    this.queuedRequests.push(request);

    if (this.flushHandle !== null) {
      return;
    }

    if (typeof window.requestIdleCallback === 'function') {
      this.flushHandle = window.requestIdleCallback(() => {
        this.flushHandle = null;
        this.flushQueuedRequests();
      });
      return;
    }

    this.flushHandle = window.setTimeout(() => {
      this.flushHandle = null;
      this.flushQueuedRequests();
    }, 0);
  }

  private flushQueuedRequests(): void {
    this.clearScheduledFlush();

    while (this.queuedRequests.length > 0) {
      const request = this.queuedRequests.shift();

      if (request) {
        this.postNow(request);
      }
    }
  }

  private clearScheduledFlush(): void {
    if (this.flushHandle === null) {
      return;
    }

    if (typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(this.flushHandle);
    } else {
      window.clearTimeout(this.flushHandle);
    }

    this.flushHandle = null;
  }

  private postNow(request: StageHistoryWorkerRequest): void {
    this.worker.postMessage(request);
  }

  private handleWorkerMessage = (
    event: MessageEvent<StageHistoryWorkerResponse>,
  ): void => {
    const response = event.data;

    if (response.type === 'ack' || response.type === 'replay') {
      this.onSnapshot(response.snapshot);
    }

    const pending = this.pendingResponses.get(response.requestId);

    if (!pending) {
      return;
    }

    this.pendingResponses.delete(response.requestId);

    if (response.type === 'error') {
      pending.reject(new Error(response.message));
      return;
    }

    pending.resolve(response);
  };
}
