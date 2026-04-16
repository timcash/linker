export type BrowserLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type BrowserLogEntry = {
  id: string;
  level: BrowserLogLevel;
  message: string;
  route: string;
  sessionId: string;
  source: string;
  timestamp: number;
};

export type BrowserLogFilters = {
  level: BrowserLogLevel | 'all';
  query: string;
  sinceMinutes: number | null;
  source: string;
};

export type LogsCommand =
  | {kind: 'clear'}
  | {kind: 'filters'}
  | {kind: 'follow'; enabled: boolean}
  | {kind: 'grep'; query: string}
  | {kind: 'help'}
  | {kind: 'history'; count: number}
  | {kind: 'level'; level: BrowserLogFilters['level']}
  | {kind: 'reset'}
  | {kind: 'show'; count: number}
  | {kind: 'since'; minutes: number | null}
  | {kind: 'source'; source: string}
  | {kind: 'tail'; count: number};

export const DEFAULT_LOGS_FILTERS: BrowserLogFilters = {
  level: 'all',
  query: '',
  sinceMinutes: null,
  source: '',
};

export const DEFAULT_LOGS_TAIL_COUNT = 20;
export const MAX_BROWSER_LOG_ENTRIES = 500;
export const BROWSER_LOG_STORAGE_KEY = 'linker.logs.entries.v1';

const STACK_FRAME_SKIP_PATTERNS = [
  '/src/logs/',
  '/assets/logs-',
  'log-model.ts',
  'log-store.ts',
  'LogsTerminalPage.ts',
  'LogsTerminalView.ts',
];

export function filterBrowserLogs(
  entries: readonly BrowserLogEntry[],
  filters: BrowserLogFilters,
  nowMs = Date.now(),
): BrowserLogEntry[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const normalizedSource = filters.source.trim().toLowerCase();
  const minTimestamp =
    typeof filters.sinceMinutes === 'number'
      ? nowMs - filters.sinceMinutes * 60_000
      : null;

  return entries.filter((entry) => {
    if (filters.level !== 'all' && entry.level !== filters.level) {
      return false;
    }

    if (minTimestamp !== null && entry.timestamp < minTimestamp) {
      return false;
    }

    if (
      normalizedQuery.length > 0 &&
      !`${entry.message}\n${entry.source}\n${entry.route}`
        .toLowerCase()
        .includes(normalizedQuery)
    ) {
      return false;
    }

    if (
      normalizedSource.length > 0 &&
      !entry.source.toLowerCase().includes(normalizedSource)
    ) {
      return false;
    }

    return true;
  });
}

export function formatBrowserLogEntry(entry: BrowserLogEntry): string {
  return `${formatTimestamp(entry.timestamp)} | ${entry.level.toUpperCase().padEnd(5, ' ')} | ${entry.source} | ${entry.message}`;
}

export function formatLogsFilterSummary(filters: BrowserLogFilters): string {
  const parts = [
    `level=${filters.level}`,
    `grep=${filters.query.trim().length > 0 ? filters.query : 'all'}`,
    `source=${filters.source.trim().length > 0 ? filters.source : 'all'}`,
    `since=${filters.sinceMinutes === null ? 'all' : `${filters.sinceMinutes}m`}`,
  ];

  return parts.join(' | ');
}

export function formatLogsHelpLines(): string[] {
  return [
    'Commands:',
    '  help                 Show this command list.',
    `  show [count]         Print the newest filtered log rows. Default ${DEFAULT_LOGS_TAIL_COUNT}.`,
    `  tail [count]         Alias for show. Default ${DEFAULT_LOGS_TAIL_COUNT}.`,
    '  level all|debug|info|warn|error',
    '                       Filter by log level.',
    '  grep <text>          Filter by message text.',
    '  source <text>        Filter by file or source substring.',
    '  since <minutes|all>  Filter by recent time window.',
    '  filters              Print the active filters.',
    '  reset                Clear all active filters.',
    '  follow on|off        Toggle auto-print for new matching logs.',
    '  history [count]      Show recent CLI commands.',
    '  clear                Clear the terminal screen.',
    'Arrow up/down recalls prior commands.',
  ];
}

export function parseLogsCommand(input: string): LogsCommand | {error: string} {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return {kind: 'show', count: DEFAULT_LOGS_TAIL_COUNT};
  }

  const [rawCommand, ...restParts] = trimmed.split(/\s+/u);
  const command = rawCommand?.toLowerCase() ?? '';
  const rest = restParts.join(' ').trim();

  switch (command) {
    case 'help':
      return {kind: 'help'};
    case 'show':
    case 'tail':
      return parseCountCommand(command, rest);
    case 'level':
      if (
        rest === 'all' ||
        rest === 'debug' ||
        rest === 'info' ||
        rest === 'warn' ||
        rest === 'error'
      ) {
        return {kind: 'level', level: rest};
      }
      return {error: 'Use `level all|debug|info|warn|error`.'};
    case 'grep':
      return {kind: 'grep', query: rest};
    case 'source':
      return {kind: 'source', source: rest};
    case 'since':
      if (rest === 'all' || rest.length === 0) {
        return {kind: 'since', minutes: null};
      }
      return parseSinceCommand(rest);
    case 'filters':
      return {kind: 'filters'};
    case 'reset':
      return {kind: 'reset'};
    case 'follow':
      if (rest === 'on' || rest === 'off') {
        return {kind: 'follow', enabled: rest === 'on'};
      }
      return {error: 'Use `follow on` or `follow off`.'};
    case 'history':
      return parseHistoryCommand(rest);
    case 'clear':
      return {kind: 'clear'};
    default:
      return {error: `Unknown command \`${command}\`. Try \`help\`.`};
  }
}

export function resolveBrowserLogMessage(args: unknown[]): string {
  if (args.length === 0) {
    return '';
  }

  return args.map((value) => formatLogArgument(value)).join(' ');
}

export function resolveBrowserLogSource(stack: string | undefined): string {
  if (!stack) {
    return 'unknown';
  }

  const frames = stack.split('\n').map((line) => line.trim());

  for (const frame of frames) {
    if (frame.length === 0 || frame === 'Error') {
      continue;
    }

    if (STACK_FRAME_SKIP_PATTERNS.some((pattern) => frame.includes(pattern))) {
      continue;
    }

    const parsed = parseStackFrame(frame);

    if (parsed) {
      return parsed;
    }
  }

  return 'unknown';
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatLogArgument(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  if (value === null || value === undefined) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function parseCountCommand(
  command: 'show' | 'tail',
  rawCount: string,
): LogsCommand | {error: string} {
  const count = parsePositiveInteger(rawCount, DEFAULT_LOGS_TAIL_COUNT);

  if (count === null) {
    return {error: `Use \`${command} 20\` with a positive integer count.`};
  }

  return {kind: command, count};
}

function parseHistoryCommand(rawCount: string): LogsCommand | {error: string} {
  const count = parsePositiveInteger(rawCount, 10);

  if (count === null) {
    return {error: 'Use `history 10` with a positive integer count.'};
  }

  return {kind: 'history', count};
}

function parseSinceCommand(rawMinutes: string): LogsCommand | {error: string} {
  const minutes = parsePositiveInteger(rawMinutes, null);

  if (minutes === null) {
    return {error: 'Use `since 15` or `since all`.'};
  }

  return {kind: 'since', minutes};
}

function parsePositiveInteger(
  rawValue: string,
  fallback: number | null,
): number | null {
  if (rawValue.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseStackFrame(frame: string): string | null {
  const normalizedFrame = frame.replace(/^at\s+/u, '').trim();
  const locationMatch = normalizedFrame.match(/\((.*)\)$/u);
  const rawFrameLocation = locationMatch?.[1] ?? normalizedFrame;
  const match = rawFrameLocation.match(/(.*?):(\d+):(\d+)$/u);

  if (!match) {
    return null;
  }

  const rawLocation = match[1] ?? '';
  const line = match[2] ?? '0';
  const column = match[3] ?? '0';
  const normalizedLocation = normalizeSourceLocation(rawLocation);

  if (!normalizedLocation) {
    return null;
  }

  return `${normalizedLocation}:${line}:${column}`;
}

function normalizeSourceLocation(rawLocation: string): string | null {
  if (rawLocation.length === 0) {
    return null;
  }

  try {
    if (rawLocation.startsWith('http://') || rawLocation.startsWith('https://')) {
      const url = new URL(rawLocation);
      return url.pathname || url.hostname;
    }
  } catch {
    // Fall through to the raw location below.
  }

  const sanitizedLocation = rawLocation
    .replace(/\?[^:]+$/u, '')
    .replace(/^file:\/\//u, '')
    .replace(/\\/gu, '/');

  if (sanitizedLocation.length === 0) {
    return null;
  }

  return sanitizedLocation;
}
