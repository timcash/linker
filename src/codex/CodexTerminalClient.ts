import type {
  CodexBridgeHealth,
  CodexBridgePublicConfig,
  CodexBridgeServerMessage,
  TerminalSize,
} from '../../shared/codex/CodexBridgeTypes';
import {DEFAULT_REMOTE_AUTH_ORIGIN} from '../remote-config';

export type CodexTerminalClientLifecycle = 'connecting' | 'connected' | 'disconnected' | 'error';

interface CodexTerminalClientOptions {
  sessionId: string;
  onMessage: (message: CodexBridgeServerMessage) => void;
  onLifecycleChange: (phase: CodexTerminalClientLifecycle, detail: string) => void;
  onAccessRequired: (detail: string) => void;
}

const DEFAULT_REMOTE_ORIGIN = DEFAULT_REMOTE_AUTH_ORIGIN;
const PUBLIC_CONFIG_PATH = '/api/codex/public-config';
const HEALTH_PATH = '/api/codex/health';
const TERMINAL_SOCKET_PATH = '/codex-bridge';

export class CodexTerminalClient {
  private socket: WebSocket | null = null;
  private readonly textDecoder = new TextDecoder();
  private readonly sessionId: string;
  private readonly onMessage: (message: CodexBridgeServerMessage) => void;
  private readonly onLifecycleChange: (phase: CodexTerminalClientLifecycle, detail: string) => void;
  private readonly onAccessRequired: (detail: string) => void;

  constructor(options: CodexTerminalClientOptions) {
    this.sessionId = options.sessionId;
    this.onMessage = options.onMessage;
    this.onLifecycleChange = options.onLifecycleChange;
    this.onAccessRequired = options.onAccessRequired;
  }

  public getBridgeOrigin() {
    return this.getBaseUrl().origin;
  }

  public getAuthorizeUrl() {
    const url = this.getBaseUrl();
    url.pathname = '/codex/';
    url.search = '';
    return url.toString();
  }

  public async fetchPublicConfig() {
    return this.fetchJson<CodexBridgePublicConfig>(PUBLIC_CONFIG_PATH, {
      method: 'GET',
    });
  }

  public async fetchHealth() {
    return this.fetchJson<CodexBridgeHealth>(HEALTH_PATH, {
      method: 'GET',
    });
  }

  public connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.onLifecycleChange('connecting', 'Connecting to the Codex bridge...');

    const socket = new WebSocket(this.buildWebSocketUrl());
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.onLifecycleChange('connected', 'Bridge connected. Starting Codex...');
    });

    socket.addEventListener('message', (event) => {
      void this.handleSocketMessage(event.data);
    });

    socket.addEventListener('close', (event) => {
      if (this.socket === socket) {
        this.socket = null;
      }

      if (event.code === 4401 || event.code === 4403) {
        this.onAccessRequired(event.reason || 'Cloudflare Access is required.');
        return;
      }

      this.onLifecycleChange('disconnected', event.reason || 'The Codex bridge connection closed.');
    });

    socket.addEventListener('error', () => {
      this.onLifecycleChange('error', 'Unable to reach the Codex bridge.');
    });
  }

  public disconnect() {
    this.socket?.close(1000, 'Client disconnected');
    this.socket = null;
  }

  public sendInput(data: string) {
    this.send({
      type: 'input',
      data,
    });
  }

  public resize(size: TerminalSize) {
    this.send({
      type: 'resize',
      cols: size.cols,
      rows: size.rows,
    });
  }

  public restart(size: TerminalSize) {
    this.send({
      type: 'restart',
      cols: size.cols,
      rows: size.rows,
    });
  }

  public interrupt() {
    this.send({
      type: 'interrupt',
    });
  }

  private send(message: { type: 'input'; data: string } | { type: 'resize' | 'restart'; cols: number; rows: number } | { type: 'interrupt' }) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }

  private async handleSocketMessage(payload: unknown) {
    const parsedMessage = await this.parseMessage(payload);
    if (!parsedMessage) {
      return;
    }

    this.onMessage(parsedMessage);
  }

  private async parseMessage(payload: unknown) {
    const payloadText = await this.readMessageText(payload);
    if (!payloadText) {
      return null;
    }

    try {
      return parseJson<CodexBridgeServerMessage>(payloadText);
    } catch {
      this.onLifecycleChange('error', 'The Codex bridge returned malformed JSON.');
      return null;
    }
  }

  private async readMessageText(payload: unknown) {
    if (typeof payload === 'string') {
      return payload;
    }

    if (payload instanceof ArrayBuffer) {
      return this.textDecoder.decode(payload);
    }

    if (payload instanceof Blob) {
      return payload.text();
    }

    if (ArrayBuffer.isView(payload)) {
      return this.textDecoder.decode(payload);
    }

    return null;
  }

  private async fetchJson<T>(pathname: string, init: RequestInit) {
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');

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
      throw new Error(errorPayload ?? `Codex bridge request failed with status ${response.status}.`);
    }

    return parseJson<T>(await response.text());
  }

  private buildHttpUrl(pathname: string) {
    const url = this.getBaseUrl();
    url.pathname = pathname;
    url.search = '';
    return url.toString();
  }

  private buildWebSocketUrl() {
    const socketUrl = this.getBaseUrl();
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    socketUrl.pathname = TERMINAL_SOCKET_PATH;
    socketUrl.search = '';
    socketUrl.searchParams.set('sessionId', this.sessionId);
    return socketUrl.toString();
  }

  private getBaseUrl() {
    return new URL(
      resolveCodexBaseOrigin({
        configuredOrigin: import.meta.env.VITE_CODEX_BRIDGE_URL as string | undefined,
        hostname: window.location.hostname,
        locationOrigin: window.location.origin,
      }),
    );
  }
}

export class CodexAccessError extends Error {}

async function parseErrorPayload(response: Response) {
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

export function resolveCodexBaseOrigin(input: {
  configuredOrigin?: string;
  hostname: string;
  locationOrigin: string;
}) {
  if (input.configuredOrigin) {
    return input.configuredOrigin;
  }

  if (input.hostname.endsWith('github.io')) {
    return DEFAULT_REMOTE_ORIGIN;
  }

  return input.locationOrigin;
}

function parseJson<T>(text: string): T {
  const parsed: unknown = JSON.parse(text);
  return parsed as T;
}
