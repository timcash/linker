import { CodexExecutableResolver } from './CodexExecutableResolver';
import { CodexPtySession } from './CodexPtySession';

interface CodexSessionRegistryOptions {
  cwd: string;
}

export class CodexSessionRegistry {
  private readonly cwd: string;
  private readonly sessions = new Map<string, CodexPtySession>();

  constructor(options: CodexSessionRegistryOptions) {
    this.cwd = options.cwd;
  }

  public getOrCreate(sessionId: string) {
    const existingSession = this.sessions.get(sessionId);
    if (existingSession) {
      return {
        session: existingSession,
        isNewSession: false
      };
    }

    const session = new CodexPtySession({
      sessionId,
      cwd: this.cwd,
      executableResolver: new CodexExecutableResolver(this.cwd)
    });

    this.sessions.set(sessionId, session);

    return {
      session,
      isNewSession: true
    };
  }

  public disposeAll() {
    this.sessions.forEach((session) => {
      session.dispose();
    });
    this.sessions.clear();
  }
}
