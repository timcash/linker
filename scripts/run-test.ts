import {appendFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

const logPath = path.resolve(process.cwd(), 'test.log');
let logWriteQueue = Promise.resolve();

await writeFile(logPath, '', 'utf8');

let testFailed = false;

try {
  await runCommand(['npm', 'run', 'lint']);
  await runCommand(['npm', 'run', 'test:browser']);
} catch (error) {
  testFailed = true;
  const message = error instanceof Error ? error.message : String(error);
  await appendLogLine(`[runner.error] ${message}`);
  process.exitCode = 1;
} finally {
  const summaryLine = testFailed
    ? 'Tests failed. See test.log for more details.'
    : 'Tests passed. See test.log for more details.';

  console.log(summaryLine);
  await appendLogLine(summaryLine);
}

async function runCommand(command: string[]): Promise<void> {
  const [bin, ...args] = command;

  if (!bin) {
    throw new Error('Missing command binary.');
  }

  await appendLogLine(`[runner] ${command.join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LINKER_APPEND_TEST_LOG: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      process.stdout.write(text);
      enqueueLogWrite(text);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      process.stderr.write(text);
      enqueueLogWrite(text);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      void logWriteQueue.then(() => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`Command failed with exit code ${code}: ${command.join(' ')}`));
      }, reject);
    });
  });
}

async function appendLogLine(line: string): Promise<void> {
  enqueueLogWrite(`${line}\n`);
  await logWriteQueue;
}

function enqueueLogWrite(text: string): void {
  logWriteQueue = logWriteQueue.then(() => appendFile(logPath, text, 'utf8'));
}
