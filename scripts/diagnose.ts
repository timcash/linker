import {spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {DEFAULT_LIVE_SITE_URL} from '../src/remote-config';

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

type MailPublicConfig = {
  ok: true;
  authRequired: boolean;
  publicOrigin: string;
};

type MailThreadsResponse = {
  ok: true;
  view: string;
  searchQuery: string;
  threads: Array<{
    threadId: string;
    subject: string;
    badges: string[];
    updatedAt: string | null;
  }>;
};

type CheckResult =
  | {
      kind: 'auth';
      ok: boolean;
      detail: string;
      snapshot: AuthDoctorSnapshot | null;
    }
  | {
      kind: 'mail-daemon';
      ok: boolean;
      detail: string;
      pid: number | null;
    }
  | {
      kind: 'mail-public-config';
      ok: boolean;
      detail: string;
      durationMs: number;
      config: MailPublicConfig | null;
    }
  | {
      kind: 'mail-health';
      ok: boolean;
      detail: string;
      durationMs: number;
      health: MailHealth | null;
    }
  | {
      kind: 'mail-threads';
      ok: boolean;
      detail: string;
      durationMs: number;
      previewSubjects: string[];
    }
  | {
      kind: 'route';
      label: string;
      url: string;
      ok: boolean;
      statusCode: number | null;
      durationMs: number;
      detail: string;
    }
  | {
      kind: 'live-url';
      ok: true;
      detail: string;
      url: string;
    };

type DiagnoseReport = {
  checkedAt: string;
  linkerRoot: string;
  gmailAgentRoot: string;
  mailApi: string;
  liveUrl: string;
  results: CheckResult[];
  summary: {
    ok: number;
    warn: number;
    fail: number;
  };
};

const LINKER_ROOT = process.cwd();
const GMAIL_AGENT_ROOT = path.resolve(LINKER_ROOT, '..', 'gmail-agent');
const ARTIFACT_DIR = path.resolve(LINKER_ROOT, 'artifacts');
const REPORT_PATH = path.join(ARTIFACT_DIR, 'system-diagnose.json');
const MAIL_HOST = '127.0.0.1';
const MAIL_PORT = 4192;
const MAIL_BASE_URL = `http://${MAIL_HOST}:${MAIL_PORT}`;
const REQUEST_TIMEOUT_MS = 30_000;
const MAIL_THREADS_TIMEOUT_MS = 60_000;
const LIVE_ROUTE_PATHS = [
  ['', 'App'],
  ['auth/', 'Auth'],
  ['codex/', 'Codex'],
  ['logs/', 'Logs'],
  ['new-user/', 'New User'],
  ['readme/', 'README'],
] as const;

await main();

async function main(): Promise<void> {
  const liveUrl = await resolveLiveUrl();
  const results: CheckResult[] = [];

  results.push({
    kind: 'live-url',
    ok: true,
    detail: `Using live base URL ${liveUrl}`,
    url: liveUrl,
  });
  results.push(await diagnoseAuthDoctor());
  results.push(await diagnoseDaemonProcess());
  results.push(await diagnoseMailPublicConfig());
  results.push(await diagnoseMailHealth());
  results.push(await diagnoseMailThreads());

  for (const [pathname, label] of LIVE_ROUTE_PATHS) {
    results.push(await diagnoseLiveRoute(new URL(pathname, liveUrl).toString(), label));
  }

  const report: DiagnoseReport = {
    checkedAt: new Date().toISOString(),
    gmailAgentRoot: GMAIL_AGENT_ROOT,
    linkerRoot: LINKER_ROOT,
    liveUrl,
    mailApi: MAIL_BASE_URL,
    results,
    summary: summarizeResults(results),
  };

  await mkdir(ARTIFACT_DIR, {recursive: true});
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  printHumanSummary(report);
}

async function diagnoseAuthDoctor(): Promise<CheckResult> {
  try {
    const output = await runNodeCommand(['src/gmail-agent.js', 'auth:doctor'], GMAIL_AGENT_ROOT);
    const snapshot = parseJsonFromText<AuthDoctorSnapshot>(output);
    const ok = snapshot.hasStoredCredentials && snapshot.hasRequiredDaemonScopes;

    return {
      kind: 'auth',
      ok,
      detail: ok
        ? `gmail-agent auth ready for ${snapshot.gcloudAccount ?? '(unknown account)'}`
        : [
            `gmail-agent auth incomplete for ${snapshot.gcloudAccount ?? '(unknown account)'}`,
            snapshot.hasStoredCredentials ? 'stored creds: yes' : 'stored creds: no',
            snapshot.hasRequiredDaemonScopes
              ? 'daemon scopes: ready'
              : `missing scopes: ${snapshot.missingDaemonScopes.join(', ') || 'unknown'}`,
          ].join(' | '),
      snapshot,
    };
  } catch (error) {
    return {
      kind: 'auth',
      ok: false,
      detail: readErrorMessage(error),
      snapshot: null,
    };
  }
}

async function diagnoseDaemonProcess(): Promise<CheckResult> {
  try {
    const output = await runPowerShellCommand(
      "Get-NetTCPConnection -LocalPort 4192 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 OwningProcess | ConvertTo-Json -Compress",
    );
    const trimmed = output.trim();

    if (!trimmed) {
      return {
        kind: 'mail-daemon',
        ok: false,
        detail: `Nothing is listening on ${MAIL_PORT}.`,
        pid: null,
      };
    }

    const parsed = JSON.parse(trimmed) as {OwningProcess?: number} | null;
    const pid = typeof parsed?.OwningProcess === 'number' ? parsed.OwningProcess : null;
    return {
      kind: 'mail-daemon',
      ok: pid !== null,
      detail: pid !== null
        ? `A local listener is running on ${MAIL_PORT} with PID ${pid}.`
        : `Nothing is listening on ${MAIL_PORT}.`,
      pid,
    };
  } catch (error) {
    return {
      kind: 'mail-daemon',
      ok: false,
      detail: readErrorMessage(error),
      pid: null,
    };
  }
}

async function diagnoseMailPublicConfig(): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    const config = await fetchJson<MailPublicConfig>('/api/mail/public-config');
    return {
      kind: 'mail-public-config',
      ok: config.ok === true,
      detail: `public origin ${config.publicOrigin} | auth required: ${config.authRequired ? 'yes' : 'no'}`,
      durationMs: Date.now() - startedAt,
      config,
    };
  } catch (error) {
    return {
      kind: 'mail-public-config',
      ok: false,
      detail: readErrorMessage(error),
      durationMs: Date.now() - startedAt,
      config: null,
    };
  }
}

async function diagnoseMailHealth(): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    const health = await fetchJson<MailHealth>('/api/mail/health');
    return {
      kind: 'mail-health',
      ok: health.ok === true && health.mailbox !== null,
      detail: health.mailbox
        ? `${formatMailbox(health.mailbox)} | ${health.counts.threads} threads | ${health.counts.tasks} tasks | queue ${health.counts.queueDepth}`
        : 'Mail API responded but no mailbox is attached.',
      durationMs: Date.now() - startedAt,
      health,
    };
  } catch (error) {
    return {
      kind: 'mail-health',
      ok: false,
      detail: readErrorMessage(error),
      durationMs: Date.now() - startedAt,
      health: null,
    };
  }
}

async function diagnoseMailThreads(): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    const codexThreads = await fetchJson<MailThreadsResponse>('/api/mail/threads?view=codex', MAIL_THREADS_TIMEOUT_MS);
    return {
      kind: 'mail-threads',
      ok: codexThreads.ok === true,
      detail: `Loaded ${codexThreads.threads.length} codex threads.`,
      durationMs: Date.now() - startedAt,
      previewSubjects: codexThreads.threads.slice(0, 3).map((thread) => thread.subject),
    };
  } catch (error) {
    return {
      kind: 'mail-threads',
      ok: false,
      detail: readErrorMessage(error),
      durationMs: Date.now() - startedAt,
      previewSubjects: [],
    };
  }
}

async function diagnoseLiveRoute(url: string, label: string): Promise<CheckResult> {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(url, {redirect: 'follow'});
    return {
      kind: 'route',
      label,
      url,
      ok: response.ok,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      detail: `${response.ok ? 'reachable' : 'unexpected status'} (${response.status})`,
    };
  } catch (error) {
    return {
      kind: 'route',
      label,
      url,
      ok: false,
      statusCode: null,
      durationMs: Date.now() - startedAt,
      detail: readErrorMessage(error),
    };
  }
}

async function fetchJson<T>(pathname: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const response = await fetchWithTimeout(`${MAIL_BASE_URL}${pathname}`, undefined, timeoutMs);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Mail API request failed: ${response.status} ${response.statusText}\n${text}`);
  }

  return JSON.parse(text) as T;
}

async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function resolveLiveUrl(): Promise<string> {
  const cliUrl = readCliOption('url');
  if (cliUrl) {
    return normalizeBaseUrl(cliUrl);
  }

  if (process.env.LINKER_LIVE_URL) {
    return normalizeBaseUrl(process.env.LINKER_LIVE_URL);
  }

  const remoteUrl = await readGitRemoteUrl().catch(() => '');
  const derivedUrl = deriveGitHubPagesUrl(remoteUrl);
  if (derivedUrl) {
    return derivedUrl;
  }

  return normalizeBaseUrl(DEFAULT_LIVE_SITE_URL);
}

function readCliOption(name: string): string {
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (!argument?.startsWith('--')) {
      continue;
    }

    if (argument.startsWith(`--${name}=`)) {
      return argument.slice(name.length + 3);
    }

    if (argument === `--${name}`) {
      const nextValue = process.argv[index + 1];
      if (nextValue && !nextValue.startsWith('--')) {
        return nextValue;
      }
    }
  }

  return '';
}

async function readGitRemoteUrl(): Promise<string> {
  return (await runPowerShellCommand('(git remote get-url origin).Trim()')).trim();
}

function deriveGitHubPagesUrl(remoteUrl: string): string {
  const sshMatch = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i);
  const httpsMatch = remoteUrl.match(/github\.com\/(.+?)\/(.+?)(?:\.git)?$/i);
  const match = sshMatch ?? httpsMatch;

  if (!match) {
    return '';
  }

  const owner = match[1];
  const repo = match[2];

  if (!owner || !repo) {
    return '';
  }

  return `https://${owner}.github.io/${repo}/`;
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/?$/u, '/');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
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

async function runPowerShellCommand(command: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-Command', command], {
      cwd: LINKER_ROOT,
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

      reject(new Error(`PowerShell command failed with exit code ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function parseJsonFromText<T>(text: string): T {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error(`Unable to find JSON in command output:\n${text}`);
  }

  return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
}

function summarizeResults(results: CheckResult[]): DiagnoseReport['summary'] {
  let ok = 0;
  let warn = 0;
  let fail = 0;

  for (const result of results) {
    if (result.ok) {
      ok += 1;
      continue;
    }

    if (result.kind === 'mail-daemon' || result.kind === 'mail-threads') {
      warn += 1;
      continue;
    }

    fail += 1;
  }

  return {ok, warn, fail};
}

function printHumanSummary(report: DiagnoseReport): void {
  console.log('Linker diagnose report');
  console.log(`Checked: ${report.checkedAt}`);
  console.log(`Linker: ${report.linkerRoot}`);
  console.log(`gmail-agent: ${report.gmailAgentRoot}`);
  console.log(`Mail API: ${report.mailApi}`);
  console.log(`Live URL: ${report.liveUrl}`);
  console.log('');

  for (const result of report.results) {
    const status = result.ok ? 'OK  ' : result.kind === 'mail-daemon' || result.kind === 'mail-threads' ? 'WARN' : 'FAIL';

    switch (result.kind) {
      case 'live-url':
        console.log(`[${status}] live-url      ${result.detail}`);
        break;
      case 'auth':
        console.log(`[${status}] gmail-auth    ${result.detail}`);
        break;
      case 'mail-daemon':
        console.log(`[${status}] mail-daemon   ${result.detail}`);
        break;
      case 'mail-public-config':
        console.log(`[${status}] public-config ${result.detail} (${result.durationMs}ms)`);
        break;
      case 'mail-health':
        console.log(`[${status}] mail-health   ${result.detail} (${result.durationMs}ms)`);
        break;
      case 'mail-threads':
        console.log(`[${status}] mail-threads  ${result.detail} (${result.durationMs}ms)`);
        for (const subject of result.previewSubjects) {
          console.log(`      preview: ${subject}`);
        }
        break;
      case 'route':
        console.log(`[${status}] route:${result.label.padEnd(8, ' ')} ${result.detail} (${result.durationMs}ms)`);
        break;
    }
  }

  console.log('');
  console.log(`Summary: ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.fail} fail`);
  console.log(`Artifact: ${REPORT_PATH}`);
  console.log('');
  console.log('Note: hosted /codex/ should use the shared codex.dialtone.earth tunnel. Local 127.0.0.1 is now dev-only.');
}

function formatMailbox(mailbox: MailHealth['mailbox']): string {
  if (!mailbox) {
    return '(no mailbox)';
  }

  return mailbox.displayName
    ? `${mailbox.displayName} <${mailbox.emailAddress}>`
    : mailbox.emailAddress;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
