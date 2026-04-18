import assert from 'node:assert/strict';
import {spawn, type ChildProcessByStdio} from 'node:child_process';
import type {Readable} from 'node:stream';
import type {Page} from 'puppeteer';

import {createBrowserTestContext, destroyBrowserTestContext} from './test/setup';

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

type DaemonProcess = ChildProcessByStdio<null, Readable, Readable>;

const LINKER_ROOT = process.cwd();
const GMAIL_AGENT_ROOT = `${LINKER_ROOT}\\..\\gmail-agent`;
const MAIL_BASE_URL = 'http://127.0.0.1:4192';

async function main(): Promise<void> {
  const auth = await readAuthDoctor();

  if (!auth.hasStoredCredentials || !auth.hasRequiredDaemonScopes) {
    throw new Error(formatMissingAuthMessage(auth));
  }

  let daemon: DaemonProcess | null = null;
  let context: Awaited<ReturnType<typeof createBrowserTestContext>> | null = null;

  try {
    if (!(await tryFetchHealth())) {
      daemon = startDaemon();
      await waitForHealth(daemon);
    }

    const health = await fetchJson<MailHealth>('/api/mail/health');
    assert.equal(health.ok, true, 'The shared mail API should report ok before the UI test starts.');
    assert.notEqual(health.mailbox, null, 'The shared mail API should expose a mailbox before the UI test starts.');

    context = await createBrowserTestContext();
    const codexUrl = new URL('codex/', context.url).toString();
    const {page, pageErrors} = context;

    await page.goto(codexUrl, {waitUntil: 'load'});
    await page.waitForSelector('.codex-mail-shell');
    await page.waitForFunction(() => (document.body.dataset.codexViewMode ?? '') === 'mailboard');
    const mailboxEmail = health.mailbox?.emailAddress ?? '';
    await page.waitForFunction(
      (expectedMailboxEmail) => {
        const mailboxText = document.querySelector('[data-codex-mailbox]')?.textContent ?? '';
        const statusText = document.querySelector('[data-codex-status]')?.textContent ?? '';
        return (
          mailboxText.includes(expectedMailboxEmail) ||
          /Loaded \d+ thread/i.test(statusText) ||
          /mailbox view is empty/i.test(statusText)
        );
      },
      {},
      mailboxEmail,
    );

    assert.deepEqual(
      pageErrors,
      [],
      `Live codex UI should not capture unexpected browser errors: ${pageErrors.join('\n\n')}`,
    );

    const mailboxState = {
      authText: await getTextContent(page, '[data-codex-auth]'),
      currentView: await getTextContent(page, '[data-codex-view]'),
      mailboxText: await getTextContent(page, '[data-codex-mailbox]'),
      statusText: await getTextContent(page, '[data-codex-status]'),
      threadCount: await getElementCount(page, '.codex-thread-row'),
      emptyText: await getTextContent(page, '.codex-thread-empty'),
    };

    assert.match(
      mailboxState.mailboxText,
      new RegExp(escapeRegExp(mailboxEmail), 'i'),
      'The live codex UI should show the real synced Gmail mailbox address.',
    );
    assert.match(mailboxState.authText, /connected to this computer/i, 'The live codex UI should connect to the local daemon on this computer.');
    assert.equal(mailboxState.currentView, 'Inbox', 'The live codex UI should land on the Inbox view after unlock.');

    if (health.counts.threads > 0 && mailboxState.threadCount > 0) {
      await page.click('.codex-thread-row');
      await page.waitForSelector('.codex-thread-detail-title');

      const detailTitle = await getTextContent(page, '.codex-thread-detail-title');

      assert.ok(detailTitle.length > 0, 'The live codex UI should load a thread detail title when mailbox threads exist.');
    } else {
      assert.ok(
        mailboxState.emptyText.length > 0 || /loaded|mailbox/i.test(mailboxState.statusText),
        'The live codex UI should still explain the synced mailbox state when no local thread ledger rows exist.',
      );
    }

    context.interactionScreenshotCounter += 1;
    await page.screenshot({
      path: `${context.interactionScreenshotDir}\\${String(context.interactionScreenshotCounter).padStart(2, '0')}-codex-mailboard-live.png`,
    });

    console.log('Live codex mailboard UI test passed.');
    console.log(`Mailbox: ${mailboxState.mailboxText}`);
    console.log(`Mail API: ${MAIL_BASE_URL}`);
  } finally {
    if (context) {
      await destroyBrowserTestContext(context);
    }

    if (daemon) {
      daemon.kill('SIGTERM');
      await waitForChildExit(daemon).catch(() => undefined);
    }
  }
}

function startDaemon(): DaemonProcess {
  return spawn(process.execPath, ['src/codex-daemon.js', '--http-port', '4192'], {
    cwd: GMAIL_AGENT_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

async function readAuthDoctor(): Promise<AuthDoctorSnapshot> {
  const output = await runNodeCommand(['src/gmail-agent.js', 'auth:doctor'], GMAIL_AGENT_ROOT);
  return parseJsonFromText<AuthDoctorSnapshot>(output);
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

async function getTextContent(page: Page, selector: string): Promise<string> {
  const element = await page.$(selector);

  if (!element) {
    return '';
  }

  const property = await element.getProperty('textContent');
  const textContent = await property.jsonValue();

  return typeof textContent === 'string' ? textContent.trim() : '';
}

async function getElementCount(page: Page, selector: string): Promise<number> {
  const elements = await page.$$(selector);
  return elements.length;
}

function parseJsonFromText<T>(text: string): T {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error(`Expected JSON output but received:\n${text}`);
  }

  return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
}

function formatMissingAuthMessage(auth: AuthDoctorSnapshot): string {
  const missingScopes = auth.missingDaemonScopes.map((scope) => `- ${scope}`).join('\n');

  return [
    'gmail-agent daemon auth is not ready on this machine, so the live Puppeteer codex UI test cannot reach Gmail yet.',
    '',
    `Google account: ${auth.gcloudAccount ?? '(unknown)'}`,
    `Google project: ${auth.projectId ?? '(unknown)'}`,
    `Client secret: ${auth.configuredClientSecretPath ?? '(unknown)'}`,
    '',
    'Missing daemon scopes:',
    missingScopes || '- unknown',
    '',
    'Run this once in a normal PowerShell window and finish the Google consent flow in your browser:',
    `cd ${GMAIL_AGENT_ROOT}`,
    'npm run auth:reset:daemon',
    '',
    'Then rerun:',
    'npm run test:codex:mail-sync',
    'npm run test:browser:codex:live',
  ].join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
