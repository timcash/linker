import {spawn} from 'node:child_process';
import {
  appendLogChunk,
  appendLogEvent,
  getUnexpectedStructuredErrorLines,
  initializeUnifiedLog,
  readUnifiedLog,
  resolveUnifiedLogPath,
} from './logging';

await initializeUnifiedLog({
  append: false,
  cwd: process.cwd(),
  sessionLabel: 'Starting full repo test runner.',
});

let testFailed = false;

try {
  await runCommand(['npm', 'run', 'lint']);
  await runCommand(['npm', 'run', 'test:browser']);
  await runCommand(['npm', 'run', 'test:preview']);

  if (await hasUnexpectedErrorLogEntries()) {
    testFailed = true;
    const message = `test.log contains unexpected structured error entries. See ${resolveUnifiedLogPath()} for details.`;
    await appendLogEvent('runner.error', message);
    process.exitCode = 1;
  }
} catch (error) {
  testFailed = true;
  const message = error instanceof Error ? error.message : String(error);
  await appendLogEvent('runner.error', message);
  process.exitCode = 1;
} finally {
  const summaryLine = testFailed
    ? `Tests failed. See ${resolveUnifiedLogPath()} for more details.`
    : 'Tests passed. See test.log for more details.';

  console.log(summaryLine);
  await appendLogEvent('runner.summary', summaryLine);
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

  await appendLogEvent('runner.command', command.join(' '));

  await new Promise<void>((resolve, reject) => {
    let commandOutput = '';
    const child = spawn(bin, spawnArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LINKER_APPEND_TEST_LOG: '1',
        LINKER_APPEND_UNIFIED_LOG: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      commandOutput += text;
      process.stdout.write(text);
      void appendLogChunk('runner.stdout', text);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      commandOutput += text;
      process.stderr.write(text);
      void appendLogChunk('runner.stderr', text);
    });

    child.on('error', (error) => {
      void appendLogEvent(
        'runner.error',
        `Failed to start ${command.join(' ')}: ${error.message}`,
      );
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      void appendLogEvent(
        'command.error',
        `${command.join(' ')} exited with code ${code}\n${commandOutput}`,
      );
      reject(new Error(`Command failed with exit code ${code}: ${command.join(' ')}`));
    });
  });
}

async function hasUnexpectedErrorLogEntries(): Promise<boolean> {
  const contents = await readUnifiedLog(resolveUnifiedLogPath());
  return getUnexpectedStructuredErrorLines(contents).length > 0;
}
