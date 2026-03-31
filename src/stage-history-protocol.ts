import type {StageSystemState} from './plane-stack';
import type {
  StageHistorySnapshot,
  StageHistoryViewState,
} from './stage-history';

export type StageHistoryWorkerRequest =
  | {
      requestId: number;
      state: StageSystemState;
      summary: string;
      type: 'initialize';
    }
  | {
      requestId: number;
      state: StageSystemState;
      summary: string;
      type: 'record-checkpoint';
    }
  | {
      requestId: number;
      summary: string;
      type: 'record-view';
      view: StageHistoryViewState;
    }
  | {
      requestId: number;
      stepDelta: number;
      type: 'move-cursor';
    };

export type StageHistoryWorkerResponse =
  | {
      requestId: number;
      snapshot: StageHistorySnapshot;
      type: 'ack';
    }
  | {
      message: string;
      requestId: number;
      type: 'error';
    }
  | {
      requestId: number;
      snapshot: StageHistorySnapshot;
      state: StageSystemState | null;
      type: 'replay';
    };
