import { randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

interface AuthSession {
  token: string;
  expiresAt: number;
}

export class CodexAuthRegistry {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly password: string;
  private readonly ttlMs: number;

  constructor() {
    this.password = resolveRequiredPassword();
    this.ttlMs = Number(process.env.CODEX_SESSION_TTL_MS ?? DEFAULT_TTL_MS);
  }

  public getSessionTtlSeconds() {
    return Math.max(1, Math.round(this.ttlMs / 1000));
  }

  public login(password: string) {
    this.pruneExpired();

    if (!constantTimePasswordEqual(password, this.password)) {
      return null;
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.ttlMs;
    const session: AuthSession = {
      token,
      expiresAt
    };
    this.sessions.set(token, session);
    return session;
  }

  public revoke(token: string | null | undefined) {
    if (!token) {
      return;
    }

    this.sessions.delete(token);
  }

  public validate(token: string | null | undefined) {
    this.pruneExpired();

    if (!token) {
      return null;
    }

    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token);
      }
    }
  }
}

function constantTimePasswordEqual(input: string, expected: string) {
  const inputBuffer = Buffer.from(input, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(inputBuffer, expectedBuffer);
}

function resolveRequiredPassword() {
  const password = process.env.CODEX_BRIDGE_PASSWORD?.trim();
  if (password) {
    return password;
  }

  throw new Error(
    'CODEX_BRIDGE_PASSWORD is required. Set it in the local environment or an untracked .env.local file before starting the Codex bridge.'
  );
}
