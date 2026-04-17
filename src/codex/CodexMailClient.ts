export type CodexMailViewId = 'inbox' | 'needs-reply' | 'waiting' | 'queued' | 'working' | 'done';

export interface CodexMailPublicConfig {
  ok: true;
  authRequired: boolean;
  publicOrigin: string;
}

export interface CodexMailView {
  id: CodexMailViewId;
  label: string;
  description: string;
  kind: 'mail' | 'triage' | 'status';
  count: number;
}

export interface CodexMailThreadSummary {
  threadId: string;
  subject: string;
  updatedAt: string | null;
  workspaceKey: string | null;
  workspacePath: string | null;
  status: string | null;
  triage: string | null;
  taskCount: number;
  latestTaskId: string | null;
  excerpt: string;
  badges: string[];
}

export interface CodexMailTask {
  id: string;
  status: string;
  requestedAt: string | null;
  completedAt: string | null;
  workflowStage: string | null;
  requestText: string;
  workerSummary: string | null;
}

export interface CodexMailMessage {
  id: string | null;
  from: string;
  to: string[];
  sentAt: string | null;
  snippet: string;
  bodyText: string;
  labelIds: string[];
}

export interface CodexMailThreadDetail {
  summary: CodexMailThreadSummary;
  latestReplyToMessageId: string | null;
  loadError: string | null;
  tasks: CodexMailTask[];
  messages: CodexMailMessage[];
}

export interface CodexMailHealth {
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
  views: CodexMailView[];
}

const DEFAULT_REMOTE_ORIGIN = 'https://codex.dialtone.earth';
const DEFAULT_LOCAL_ORIGIN = 'http://127.0.0.1:4192';
const PUBLIC_CONFIG_PATH = '/api/mail/public-config';
const HEALTH_PATH = '/api/mail/health';
const VIEWS_PATH = '/api/mail/views';
const THREADS_PATH = '/api/mail/threads';

export class CodexMailClient {
  public getMailOrigin(): string {
    return this.getBaseUrl().origin;
  }

  public getAuthorizeUrl(): string {
    const url = this.getBaseUrl();
    url.pathname = '/codex/';
    url.search = '';
    return url.toString();
  }

  public async fetchPublicConfig(): Promise<CodexMailPublicConfig> {
    return this.fetchJson<CodexMailPublicConfig>(PUBLIC_CONFIG_PATH, {
      method: 'GET',
    });
  }

  public async fetchHealth(): Promise<CodexMailHealth> {
    return this.fetchJson<CodexMailHealth>(HEALTH_PATH, {
      method: 'GET',
    });
  }

  public async fetchViews(): Promise<CodexMailView[]> {
    const response = await this.fetchJson<{ok: true; views: CodexMailView[]}>(VIEWS_PATH, {
      method: 'GET',
    });
    return response.views;
  }

  public async fetchThreads(view: CodexMailViewId): Promise<CodexMailThreadSummary[]> {
    const response = await this.fetchJson<{ok: true; view: string; threads: CodexMailThreadSummary[]}>(
      `${THREADS_PATH}?view=${encodeURIComponent(view)}`,
      {
        method: 'GET',
      },
    );
    return response.threads;
  }

  public async fetchThread(threadId: string): Promise<CodexMailThreadDetail> {
    const response = await this.fetchJson<{ok: true; thread: CodexMailThreadDetail}>(
      `/api/mail/thread/${encodeURIComponent(threadId)}`,
      {
        method: 'GET',
      },
    );
    return response.thread;
  }

  public async markThreadRead(threadId: string): Promise<void> {
    await this.fetchJson<{ok: true}>(`/api/mail/thread/${encodeURIComponent(threadId)}/read`, {
      method: 'POST',
    });
  }

  public async replyToThread(threadId: string, input: {body: string; messageId?: string | null}): Promise<void> {
    await this.fetchJson<{ok: true}>(`/api/mail/thread/${encodeURIComponent(threadId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({
        body: input.body,
        messageId: input.messageId ?? null,
      }),
    });
  }

  public async composeEmail(input: {to: string; subject: string; body: string}): Promise<void> {
    await this.fetchJson<{ok: true}>(`/api/mail/compose`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  private async fetchJson<T>(pathname: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');

    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(this.buildHttpUrl(pathname), {
      ...init,
      credentials: 'include',
      headers,
      mode: 'cors',
    });

    if (response.status === 401 || response.status === 403) {
      const errorPayload = await parseErrorPayload(response);
      throw new CodexAccessError(errorPayload ?? 'Cloudflare Access is required.');
    }

    if (!response.ok) {
      const errorPayload = await parseErrorPayload(response);
      throw new Error(errorPayload ?? `Mail API request failed with status ${response.status}.`);
    }

    return parseJson<T>(await response.text());
  }

  private buildHttpUrl(pathname: string): string {
    return new URL(pathname, this.getBaseUrl()).toString();
  }

  private getBaseUrl(): URL {
    return new URL(
      resolveCodexMailOrigin({
        configuredOrigin: import.meta.env.VITE_CODEX_MAIL_URL as string | undefined,
        hostname: window.location.hostname,
        locationOrigin: window.location.origin,
      }),
    );
  }
}

export class CodexAccessError extends Error {}

async function parseErrorPayload(response: Response): Promise<string | null> {
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const error = 'error' in parsed ? parsed.error : undefined;
    return typeof error === 'string' ? error : null;
  } catch {
    return null;
  }
}

export function resolveCodexMailOrigin(input: {
  configuredOrigin?: string;
  hostname: string;
  locationOrigin: string;
}): string {
  if (input.configuredOrigin) {
    return input.configuredOrigin;
  }

  if (input.hostname.endsWith('github.io')) {
    return DEFAULT_REMOTE_ORIGIN;
  }

  if (input.hostname === '127.0.0.1' || input.hostname === 'localhost') {
    return DEFAULT_LOCAL_ORIGIN;
  }

  return input.locationOrigin;
}

function parseJson<T>(text: string): T {
  const parsed: unknown = JSON.parse(text);
  return parsed as T;
}
