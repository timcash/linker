import type {StageHistoryState, StageHistoryViewState, StageHistorySnapshot} from './stage-history';
import type {StageSystemState} from './plane-stack';

export type StageHistoryWorkerRequest =
  | {
      history: StageHistoryState;
      requestId: number;
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
    }
  | {
      requestId: number;
      snapshot: StageHistorySnapshot;
      type: 'initialized';
    };
