import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type {
  CodexAuthLoginRequest,
  CodexBridgeClientMessage,
  CodexBridgeServerMessage,
  TerminalSize
} from '../../shared/codex/CodexBridgeTypes';
import { appendCorsHeaders } from './Cors';
import { CodexAuthRegistry } from './CodexAuthRegistry';
import { CodexExecutableResolver } from './CodexExecutableResolver';
import type { CodexPtySession } from './CodexPtySession';
import { CodexSessionRegistry } from './CodexSessionRegistry';

const DEFAULT_TERMINAL_SIZE: TerminalSize = {
  cols: 120,
  rows: 34
};

interface CodexBridgeServerOptions {
  host: string;
  port: number;
  staticRoot: string;
  workspaceRoot: string;
  publicOrigin: string;
}

export class CodexBridgeServer {
  private readonly options: CodexBridgeServerOptions;
  private readonly executableResolver: CodexExecutableResolver;
  private readonly sessionRegistry: CodexSessionRegistry;
  private readonly authRegistry: CodexAuthRegistry;
  private readonly webSocketServer: WebSocketServer;
  private readonly httpServer;

  constructor(options: CodexBridgeServerOptions) {
    this.options = options;
    this.executableResolver = new CodexExecutableResolver(options.workspaceRoot);
    this.sessionRegistry = new CodexSessionRegistry({
      cwd: options.workspaceRoot
    });
    this.authRegistry = new CodexAuthRegistry();
    this.httpServer = createServer(this.handleRequest);
    this.webSocketServer = new WebSocketServer({
      server: this.httpServer,
      path: '/codex-bridge'
    });
    this.webSocketServer.on('connection', this.handleWebSocketConnection);
  }

  public async listen() {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.httpServer.once('error', rejectPromise);
      this.httpServer.listen(this.options.port, this.options.host, () => {
        this.httpServer.off('error', rejectPromise);
        resolvePromise();
      });
    });
  }

  public async close() {
    this.sessionRegistry.disposeAll();
    this.webSocketServer.clients.forEach((client: WebSocket) => client.close());

    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.httpServer.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }

        resolvePromise();
      });
    });
  }

  private readonly handleRequest = (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? this.options.host}`);
    const origin = request.headers.origin;

    if (request.method === 'OPTIONS') {
      this.writeEmpty(response, 204, origin);
      return;
    }

    if (requestUrl.pathname === '/api/codex/public-config') {
      this.writeJson(
        response,
        200,
        {
          ok: true,
          authRequired: true,
          publicOrigin: this.options.publicOrigin,
          sessionTtlSeconds: this.authRegistry.getSessionTtlSeconds()
        },
        origin
      );
      return;
    }

    if (requestUrl.pathname === '/api/codex/auth/login' && request.method === 'POST') {
      void this.handleLoginRequest(request, response, origin);
      return;
    }

    if (requestUrl.pathname === '/api/codex/auth/logout' && request.method === 'POST') {
      const token = readBearerToken(request.headers.authorization);
      this.authRegistry.revoke(token);
      this.writeJson(response, 200, { ok: true }, origin);
      return;
    }

    if (requestUrl.pathname === '/api/codex/health') {
      const token = readBearerToken(request.headers.authorization);
      if (!this.authRegistry.validate(token)) {
        this.writeJson(response, 401, { ok: false, error: 'Unlock required.' }, origin);
        return;
      }

      this.writeJson(
        response,
        200,
        this.executableResolver.buildHealth(this.options.publicOrigin, this.authRegistry.getSessionTtlSeconds()),
        origin
      );
      return;
    }

    if (requestUrl.pathname.startsWith('/api/codex') || requestUrl.pathname === '/codex-bridge') {
      this.writeJson(
        response,
        404,
        {
          ok: false,
          error: 'Unknown Codex bridge endpoint.'
        },
        origin
      );
      return;
    }

    this.serveStaticAsset(requestUrl.pathname, response, origin);
  };

  private readonly handleWebSocketConnection = (socket: WebSocket, request: IncomingMessage) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? this.options.host}`);
    const authToken = requestUrl.searchParams.get('authToken');
    if (!this.authRegistry.validate(authToken)) {
      socket.close(4401, 'Unlock expired.');
      return;
    }

    const sessionId = sanitizeSessionId(requestUrl.searchParams.get('sessionId')) ?? randomUUID();
    const { session, isNewSession } = this.sessionRegistry.getOrCreate(sessionId);
    const unsubscribe = session.subscribe((message) => {
      this.send(socket, message);
    });

    session.ensureStarted(DEFAULT_TERMINAL_SIZE);
    this.send(socket, session.snapshot(isNewSession));

    socket.on('message', (payload: RawData) => {
      if (!this.authRegistry.validate(authToken)) {
        this.send(socket, {
          type: 'error',
          message: 'Unlock expired.'
        });
        socket.close(4401, 'Unlock expired.');
        return;
      }

      this.handleWebSocketMessage(socket, session, payload);
    });

    socket.on('close', () => {
      unsubscribe();
    });

    socket.on('error', () => {
      unsubscribe();
    });
  }

  private handleWebSocketMessage(socket: WebSocket, session: CodexPtySession, payload: RawData) {
    const clientMessage = parseClientMessage(payload);
    if (!clientMessage) {
      this.send(socket, {
        type: 'error',
        message: 'The browser sent an invalid Codex bridge message.'
      });
      return;
    }

    switch (clientMessage.type) {
      case 'input':
        session.write(clientMessage.data);
        return;
      case 'resize':
        session.resize(clientMessage);
        return;
      case 'interrupt':
        session.interrupt();
        return;
      case 'restart':
        session.restart(clientMessage);
        this.send(socket, session.snapshot(false));
        return;
    }
  }

  private send(socket: WebSocket, message: CodexBridgeServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  }

  private serveStaticAsset(pathname: string, response: ServerResponse, origin: string | undefined) {
    const staticRoot = resolve(this.options.staticRoot);
    const hasStaticBuild = existsSync(join(staticRoot, 'index.html'));

    if (!hasStaticBuild) {
      this.writeText(
        response,
        503,
        'Static frontend build not found. Run `npm run build` before serving the Codex bridge.',
        origin
      );
      return;
    }

    const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const repoBase = basename(this.options.workspaceRoot);
    const normalizedRequestedPath = requestedPath.startsWith(`${repoBase}/`)
      ? requestedPath.slice(repoBase.length + 1)
      : requestedPath;
    const candidates = [
      normalize(resolve(staticRoot, normalizedRequestedPath)),
      normalize(resolve(staticRoot, normalizedRequestedPath, 'index.html'))
    ];

    const matchedPath = candidates.find((candidatePath) => {
      const withinStaticRoot = candidatePath.toLowerCase().startsWith(staticRoot.toLowerCase());
      return withinStaticRoot && existsSync(candidatePath) && statSync(candidatePath).isFile();
    });

    if (matchedPath) {
      response.writeHead(200, appendCorsHeaders({
        'Content-Type': mimeTypeForExtension(extname(matchedPath))
      }, origin));
      createReadStream(matchedPath).pipe(response);
      return;
    }

    const indexPath = join(staticRoot, 'index.html');
    response.writeHead(200, appendCorsHeaders({
      'Content-Type': 'text/html; charset=utf-8'
    }, origin));
    createReadStream(indexPath).pipe(response);
  }

  private async handleLoginRequest(request: IncomingMessage, response: ServerResponse, origin: string | undefined) {
    const body = await readJsonBody<CodexAuthLoginRequest>(request);
    const password = body?.password ?? '';
    const authSession = this.authRegistry.login(password);

    if (!authSession) {
      this.writeJson(response, 401, { ok: false, error: 'Password not accepted.' }, origin);
      return;
    }

    this.writeJson(
      response,
      200,
      {
        ok: true,
        authToken: authSession.token,
        expiresAt: authSession.expiresAt,
        sessionTtlSeconds: this.authRegistry.getSessionTtlSeconds()
      },
      origin
    );
  }

  private writeJson(response: ServerResponse, statusCode: number, payload: unknown, origin: string | undefined) {
    response.writeHead(statusCode, appendCorsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, origin));
    response.end(JSON.stringify(payload));
  }

  private writeText(response: ServerResponse, statusCode: number, payload: string, origin: string | undefined) {
    response.writeHead(statusCode, appendCorsHeaders({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }, origin));
    response.end(payload);
  }

  private writeEmpty(response: ServerResponse, statusCode: number, origin: string | undefined) {
    response.writeHead(statusCode, appendCorsHeaders({
      'Cache-Control': 'no-store'
    }, origin));
    response.end();
  }
}

function parseClientMessage(payload: RawData): CodexBridgeClientMessage | null {
  const payloadText = rawDataToText(payload);

  try {
    return JSON.parse(payloadText) as CodexBridgeClientMessage;
  } catch {
    return null;
  }
}

function sanitizeSessionId(sessionId: string | null) {
  if (!sessionId) {
    return null;
  }

  const trimmed = sessionId.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 120) || null;
}

function mimeTypeForExtension(extension: string) {
  switch (extension.toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function rawDataToText(payload: RawData) {
  if (typeof payload === 'string') {
    return payload;
  }

  if (payload instanceof Buffer) {
    return payload.toString('utf8');
  }

  if (isBufferArray(payload)) {
    return Buffer.concat(payload).toString('utf8');
  }

  if (payload instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(payload)).toString('utf8');
  }

  if (ArrayBuffer.isView(payload)) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString('utf8');
  }

  return '';
}

function readBearerToken(header: string | undefined) {
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

async function readJsonBody<T>(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk, 'utf8'));
      continue;
    }

    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }

    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    return null;
  }

  if (!chunks.length) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    return null;
  }
}

function isBufferArray(payload: RawData): payload is Buffer[] {
  return Array.isArray(payload) && payload.every((chunk) => chunk instanceof Buffer);
}
