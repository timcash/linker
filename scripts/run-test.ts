import {appendFile, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {INTENTIONAL_ERROR_MARKER} from './test/types';

const logPath = path.resolve(process.cwd(), 'test.log');
const errorLogPath = path.resolve(process.cwd(), 'error.log');
let logWriteQueue = Promise.resolve();
let errorWriteQueue = Promise.resolve();

await writeFile(logPath, '', 'utf8');
await writeFile(errorLogPath, '', 'utf8');

let testFailed = false;

try {
  await runCommand(['npm', 'run', 'lint']);
  await runCommand(['npm', 'run', 'test:browser']);

  if (await hasUnexpectedErrorLogEntries()) {
    testFailed = true;
    const message = 'error.log contains unexpected entries. See error.log for details.';
    await appendLogLine(`[runner.error] ${message}`);
    process.exitCode = 1;
  }
} catch (error) {
  testFailed = true;
  const message = error instanceof Error ? error.message : String(error);
  await appendLogLine(`[runner.error] ${message}`);
  await appendErrorLine(`[runner.error] ${message}`);
  process.exitCode = 1;
} finally {
  const summaryLine = testFailed
    ? 'Tests failed. See test.log and error.log for more details.'
    : 'Tests passed. See test.log for more details.';

  console.log(summaryLine);
  await appendLogLine(summaryLine);
}

async function runCommand(command: string[]): Promise<void> {
  const [rawBin, ...args] = command;
  const [bin, spawnArgs] =
    process.platform === 'win32' && rawBin === 'npm'
      ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args]]
      : [rawBin, args];

  if (!bin) {
    throw new Error('Missing command binary.');
  }

  await appendLogLine(`[runner] ${command.join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    let commandOutput = '';
    const child = spawn(bin, spawnArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LINKER_APPEND_ERROR_LOG: '1',
        LINKER_APPEND_TEST_LOG: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      commandOutput += text;
      process.stdout.write(text);
      enqueueLogWrite(text);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      commandOutput += text;
      process.stderr.write(text);
      enqueueLogWrite(text);
    });

    child.on('error', (error) => {
      enqueueErrorWrite(
        `${formatErrorLogLine(`[runner.error] Failed to start ${command.join(' ')}: ${error.message}`)}\n`,
      );
      reject(error);
    });

    child.on('close', (code) => {
      void logWriteQueue.then(() => {
        if (code === 0) {
          resolve();
          return;
        }

        enqueueErrorWrite(`${formatErrorLogLine(
          `[command.error] ${command.join(' ')} exited with code ${code}\n${commandOutput}`,
        )}\n`);
        reject(new Error(`Command failed with exit code ${code}: ${command.join(' ')}`));
      }, reject);
    });
  });
}

async function appendLogLine(line: string): Promise<void> {
  enqueueLogWrite(`${line}\n`);
  await logWriteQueue;
}

async function appendErrorLine(line: string): Promise<void> {
  enqueueErrorWrite(`${formatErrorLogLine(line)}\n`);
  await errorWriteQueue;
}

function enqueueLogWrite(text: string): void {
  logWriteQueue = logWriteQueue.then(() => appendFile(logPath, text, 'utf8'));
}

function enqueueErrorWrite(text: string): void {
  errorWriteQueue = errorWriteQueue.then(() => appendFile(errorLogPath, text, 'utf8'));
}

async function hasUnexpectedErrorLogEntries(): Promise<boolean> {
  await errorWriteQueue;

  try {
    const contents = await readFile(errorLogPath, 'utf8');
    return getUnexpectedErrorLogLines(contents).length > 0;
  } catch {
    return false;
  }
}

function getUnexpectedErrorLogLines(contents: string): string[] {
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.includes(INTENTIONAL_ERROR_MARKER));
}

function formatErrorLogLine(message: string): string {
  return message.replace(/\r?\n/g, '\\n');
}
