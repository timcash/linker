export type TasksDashboardTask = {
  allowedFiles: string[];
  contextFiles: string[];
  decision: string | null;
  doneWhen: string[];
  expectedResult: 'fail' | 'pass';
  id: string;
  intent: string;
  lastRunId: string | null;
  notes: string[];
  role: string;
  slice: number;
  status: 'accepted' | 'current' | 'needs-revision' | 'pending';
  title: string;
  verifyCommand: string;
  workerStatus: string | null;
};

export type TasksDashboardLoopSummary = {
  currentSlice: number;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  generatedAt: string;
  iteration: number;
  lastDecision: string | null;
  lastRunId: string | null;
  status: string;
  workerWorkspaceMode: string;
};

export type TasksDashboardRun = {
  changedFiles: string[];
  commandStatuses: string[];
  createdAt: string;
  decision: string | null;
  docsPresent: string[];
  liveStatus: 'fail' | 'not-run' | 'pass';
  localBrowserStatus: 'fail' | 'not-run' | 'pass';
  monitorSummary: string | null;
  promotionStatus: string | null;
  reviewReady: boolean;
  runId: string;
  scopeStatus: 'fail' | 'pass';
  slice: number | null;
  taskId: string | null;
  taskTitle: string | null;
  taskScopeStatus: 'fail' | 'pass';
  workerStatus: string | null;
  workerSummary: string | null;
};

export type TasksDashboardReviewStep = {
  evidence: string;
  runId: string;
  status: 'fail' | 'not-applicable' | 'pass';
  stepId: string;
  taskId: string | null;
  title: string;
};

export type TasksDashboardData = {
  currentTask: TasksDashboardTask | null;
  loopSummary: TasksDashboardLoopSummary;
  nextTaskIdeas: TasksDashboardTask[];
  reviewSteps: TasksDashboardReviewStep[];
  runs: TasksDashboardRun[];
  tasks: TasksDashboardTask[];
};
