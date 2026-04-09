import {appendFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';

import {createLogger, type Logger} from 'vite';

const LOG_FILE_NAME = 'test.log';
const INTENTIONAL_ERROR_MARKER = '[intentional-error-ping]';
const UNEXPECTED_ERROR_KINDS = new Set([
  'browser.console.error',
  'browser.artifact.error',
  'browser.error',
  'browser.pageerror',
  'browser.requestfailed',
  'browser.response.error',
  'browser.test.failure',
  'command.error',
  'runner.error',
  'smoke.console.error',
  'smoke.error',
  'smoke.pageerror',
  'smoke.requestfailed',
  'smoke.response.error',
  'test.failure',
  'vite.build.error',
  'vite.dev-server.error',
  'vite.preview.error',
]);

const writeQueues = new Map<string, Promise<void>>();

export function resolveUnifiedLogPath(cwd = process.cwd()): string {
  const override = process.env.LINKER_LOG_PATH?.trim();
  return path.resolve(override && override.length > 0 ? override : path.join(cwd, LOG_FILE_NAME));
}

export function shouldAppendUnifiedLog(): boolean {
  return (
    process.env.LINKER_APPEND_TEST_LOG === '1' ||
    process.env.LINKER_APPEND_UNIFIED_LOG === '1'
  );
}

export async function initializeUnifiedLog(options?: {
  append?: boolean;
  cwd?: string;
  sessionLabel?: string;
}): Promise<string> {
  const logPath = resolveUnifiedLogPath(options?.cwd);
  const append = options?.append ?? shouldAppendUnifiedLog();

  await mkdir(path.dirname(logPath), {recursive: true});

  if (!append) {
    await writeFile(logPath, '', 'utf8');
  } else if (!existsSync(logPath)) {
    await writeFile(logPath, '', 'utf8');
  }

  process.env.LINKER_LOG_PATH = logPath;
  process.env.LINKER_APPEND_TEST_LOG = '1';
  process.env.LINKER_APPEND_UNIFIED_LOG = '1';

  if (options?.sessionLabel) {
    await appendLogEvent('log.session', options.sessionLabel, {logPath});
  }

  return logPath;
}

export async function appendLogEvent(
  kind: string,
  message: string,
  options?: {
    cwd?: string;
    logPath?: string;
  },
): Promise<void> {
  const logPath = options?.logPath ?? resolveUnifiedLogPath(options?.cwd);
  const normalizedLines = normalizeLogText(message)
    .split('\n')
    .filter((line) => line.length > 0);
  const payload =
    normalizedLines.length === 0
      ? `${formatLogLine(kind, '')}\n`
      : `${normalizedLines.map((line) => formatLogLine(kind, line)).join('\n')}\n`;

  await enqueueLogWrite(logPath, payload);
}

export async function appendLogChunk(
  kind: string,
  chunk: string,
  options?: {
    cwd?: string;
    logPath?: string;
  },
): Promise<void> {
  const normalized = normalizeLogText(chunk);
  if (normalized.length === 0) {
    return;
  }

  await appendLogEvent(kind, normalized, options);
}

export async function appendRawLogLines(
  text: string,
  options?: {
    cwd?: string;
    logPath?: string;
  },
): Promise<void> {
  const normalized = normalizeLogText(text);
  if (normalized.length === 0) {
    return;
  }

  const logPath = options?.logPath ?? resolveUnifiedLogPath(options?.cwd);
  await enqueueLogWrite(logPath, `${normalized}\n`);
}

export async function readUnifiedLog(pathOrCwd?: string): Promise<string> {
  const logPath = resolvePathOrLog(pathOrCwd);

  try {
    return await readFile(logPath, 'utf8');
  } catch {
    return '';
  }
}

export async function readUnifiedLogTail(
  pathOrCwd?: string,
  length = 8_000,
): Promise<string> {
  const contents = await readUnifiedLog(pathOrCwd);
  const normalized = contents.trim();
  return normalized.length === 0 ? '(empty)' : normalized.slice(-length);
}

export function getUnexpectedStructuredErrorLines(contents: string): string[] {
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.includes(INTENTIONAL_ERROR_MARKER))
    .filter((line) => {
      const kind = parseStructuredLogKind(line);
      if (!kind) {
        return false;
      }

      return [...UNEXPECTED_ERROR_KINDS].some((candidate) => kind === candidate || kind.startsWith(`${candidate}.`));
    });
}

export async function hasUnexpectedStructuredErrors(pathOrCwd?: string): Promise<boolean> {
  const contents = await readUnifiedLog(pathOrCwd);
  return getUnexpectedStructuredErrorLines(contents).length > 0;
}

export function createUnifiedViteLogger(scope: 'build' | 'dev-server' | 'preview'): Logger {
  const logger = createLogger('info', {allowClearScreen: false});

  logger.info = ((message) => {
    void appendLogEvent(`vite.${scope}.info`, formatLogPayload(message));
  }) as Logger['info'];

  logger.warn = ((message) => {
    void appendLogEvent(`vite.${scope}.warn`, formatLogPayload(message));
  }) as Logger['warn'];

  logger.warnOnce = ((message) => {
    void appendLogEvent(`vite.${scope}.warn`, `[once] ${formatLogPayload(message)}`);
  }) as Logger['warnOnce'];

  logger.error = ((message) => {
    void appendLogEvent(`vite.${scope}.error`, formatLogPayload(message));
  }) as Logger['error'];

  logger.clearScreen = (() => {}) as Logger['clearScreen'];

  return logger;
}

function resolvePathOrLog(pathOrCwd?: string): string {
  if (!pathOrCwd || pathOrCwd.length === 0) {
    return resolveUnifiedLogPath();
  }

  return path.extname(pathOrCwd) === '.log'
    ? path.resolve(pathOrCwd)
    : resolveUnifiedLogPath(pathOrCwd);
}

function normalizeLogText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

function formatLogLine(kind: string, message: string): string {
  return `[${new Date().toISOString()}] [${kind}] ${message}`;
}

function formatLogPayload(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  return String(value);
}

function parseStructuredLogKind(line: string): string | null {
  const match = /^\[[^\]]+\] \[([^\]]+)\]/u.exec(line);
  return match?.[1] ?? null;
}

async function enqueueLogWrite(logPath: string, payload: string): Promise<void> {
  const previous = writeQueues.get(logPath) ?? Promise.resolve();
  const next = previous.then(() => appendFile(logPath, payload, 'utf8'));
  writeQueues.set(logPath, next.catch(() => undefined));
  await next;
}
