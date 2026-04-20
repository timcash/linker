import assert from 'node:assert/strict';
import {spawn, type ChildProcessByStdio} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Readable} from 'node:stream';

type AuthDoctorSnapshot = {
  hasStoredCredentials: boolean;
  hasRequiredDaemonScopes: boolean;
  missingDaemonScopes: string[];
  projectId: string | null;
  gcloudAccount: string | null;
  configuredClientSecretPath: string | null;
};

type MailHealth = {
  ok: true;
  mailbox: {
    displayName?: string;
    emailAddress: string;
  } | null;
  runtime: Record<string, unknown>;
  counts: {
    threads: number;
    tasks: number;
    queueDepth: number;
    activeTaskId: string | null;
    events: number;
  };
  views: Array<{
    id: string;
    label: string;
    count: number;
  }>;
};

type MailThreadsResponse = {
  ok: true;
  view: string;
  threads: Array<{
    threadId: string;
    subject: string;
    badges: string[];
    excerpt: string;
    updatedAt: string | null;
  }>;
};

const MAIL_HOST = '127.0.0.1';
const MAIL_PORT = 4192;
const MAIL_BASE_URL = `http://${MAIL_HOST}:${MAIL_PORT}`;
const LINKER_ROOT = process.cwd();
const GMAIL_AGENT_ROOT = path.resolve(LINKER_ROOT, '..', 'gmail-agent');
const ARTIFACT_DIR = path.resolve(LINKER_ROOT, 'artifacts');
const PROOF_PATH = path.join(ARTIFACT_DIR, 'codex-mail-sync-proof.json');

async function main(): Promise<void> {
  const auth = await readAuthDoctor();

  if (!auth.hasStoredCredentials || !auth.hasRequiredDaemonScopes) {
    const missingScopes = auth.missingDaemonScopes.map((scope) => `- ${scope}`).join('\n');
    throw new Error(
      [
        'gmail-agent daemon auth is not ready on this machine.',
        '',
        `Google account: ${auth.gcloudAccount ?? '(unknown)'}`,
        `Google project: ${auth.projectId ?? '(unknown)'}`,
        `Client secret: ${auth.configuredClientSecretPath ?? '(unknown)'}`,
        '',
        'Missing daemon scopes:',
        missingScopes || '- unknown',
        '',
        `Run this once in a normal PowerShell window and finish the Google consent flow in your browser:`,
        `cd ${GMAIL_AGENT_ROOT}`,
        'npm run auth:reset:daemon',
        '',
        'Then rerun: npm run test:codex:mail-sync',
      ].join('\n'),
    );
  }

  let daemon: DaemonProcess | null = null;
  let startedDaemon = false;

  try {
    const alreadyHealthy = await tryFetchHealth();

    if (!alreadyHealthy) {
      daemon = startDaemon();
      startedDaemon = true;
      await waitForHealth(daemon);
    }

    const health = await fetchJson<MailHealth>('/api/mail/health');
    assert.equal(health.ok, true, 'The shared mail API should report ok.');
    assert.notEqual(health.mailbox, null, 'The shared mail API should report a mailbox.');

    const codexThreads = await fetchJson<MailThreadsResponse>('/api/mail/threads?view=codex');
    assert.equal(codexThreads.ok, true, 'The codex thread list should report ok.');

    const proof = {
      checkedAt: new Date().toISOString(),
      fromRepo: LINKER_ROOT,
      mailApi: MAIL_BASE_URL,
      mailbox: health.mailbox,
      counts: health.counts,
      views: health.views,
      codexPreview: codexThreads.threads.slice(0, 5).map((thread) => ({
        threadId: thread.threadId,
        subject: thread.subject,
        badges: thread.badges,
        updatedAt: thread.updatedAt,
        excerpt: thread.excerpt,
      })),
    };

    await mkdir(ARTIFACT_DIR, {recursive: true});
    await writeFile(PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');

    console.log('Live codex mail sync is healthy.');
    console.log(`Mailbox: ${formatMailbox(health.mailbox)}`);
    console.log(`Mail API: ${MAIL_BASE_URL}`);
    console.log(`Threads: ${health.counts.threads} total, queue ${health.counts.queueDepth}, active task ${health.counts.activeTaskId ?? 'none'}`);
    if (codexThreads.threads.length > 0) {
      console.log('Codex preview:');
      for (const thread of codexThreads.threads.slice(0, 3)) {
        console.log(`- ${thread.subject}`);
      }
    } else {
      console.log('Codex preview: no synced codex threads were returned.');
    }
    console.log(`Proof artifact: ${PROOF_PATH}`);

    if (startedDaemon) {
      console.log('A local gmail-agent daemon was started for this check and will now be stopped.');
    }
  } finally {
    if (daemon) {
      daemon.kill('SIGTERM');
      await waitForChildExit(daemon).catch(() => undefined);
    }
  }
}

type DaemonProcess = ChildProcessByStdio<null, Readable, Readable>;

function startDaemon(): DaemonProcess {
  const daemon = spawn(process.execPath, ['src/codex-daemon.js', '--http-port', String(MAIL_PORT)], {
    cwd: GMAIL_AGENT_ROOT,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderrBuffer = '';
  let stdoutBuffer = '';

  daemon.stdout.on('data', (chunk: Buffer | string) => {
    stdoutBuffer += chunk.toString();
  });
  daemon.stderr.on('data', (chunk: Buffer | string) => {
    stderrBuffer += chunk.toString();
  });
  daemon.on('exit', (code) => {
    if (code !== 0) {
      process.stderr.write(
        [
          'gmail-agent daemon exited while the live sync test was waiting for the mail API.',
          stdoutBuffer.trim(),
          stderrBuffer.trim(),
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  });

  return daemon;
}

async function readAuthDoctor(): Promise<AuthDoctorSnapshot> {
  const output = await runNodeCommand(['src/gmail-agent.js', 'auth:doctor'], GMAIL_AGENT_ROOT);
  return parseJsonFromText<AuthDoctorSnapshot>(output);
}

async function tryFetchHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${MAIL_BASE_URL}/api/mail/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(daemon: DaemonProcess): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (daemon.exitCode !== null) {
      throw new Error(`gmail-agent daemon exited early with code ${daemon.exitCode}.`);
    }

    if (await tryFetchHealth()) {
      return;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for the shared mail API at ${MAIL_BASE_URL}.`);
}

async function fetchJson<T>(pathname: string): Promise<T> {
  const response = await fetch(`${MAIL_BASE_URL}${pathname}`);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Mail API request failed: ${response.status} ${response.statusText}\n${text}`);
  }

  return JSON.parse(text) as T;
}

async function runNodeCommand(args: string[], cwd: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`Command failed with exit code ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function parseJsonFromText<T>(text: string): T {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error(`Expected JSON output but received:\n${text}`);
  }

  return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
}

function formatMailbox(mailbox: MailHealth['mailbox']): string {
  if (!mailbox) {
    return '(unknown mailbox)';
  }

  return mailbox.displayName
    ? `${mailbox.displayName} <${mailbox.emailAddress}>`
    : mailbox.emailAddress;
}

async function waitForChildExit(child: DaemonProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    if (child.exitCode !== null) {
      resolve();
    }
  });
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
