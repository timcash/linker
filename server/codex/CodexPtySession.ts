import * as nodePty from 'node-pty';
import type { CodexBridgeServerMessage, TerminalSize } from '../../shared/codex/CodexBridgeTypes';
import type { CodexExecutableResolver } from './CodexExecutableResolver';

const DEFAULT_TERMINAL_SIZE: TerminalSize = {
  cols: 120,
  rows: 34
};

const MAX_BACKLOG_CHARS = 200_000;

type SessionListener = (message: CodexBridgeServerMessage) => void;

interface CodexPtySessionOptions {
  sessionId: string;
  cwd: string;
  executableResolver: CodexExecutableResolver;
}

export class CodexPtySession {
  public readonly sessionId: string;
  private readonly cwd: string;
  private readonly executableResolver: CodexExecutableResolver;
  private readonly listeners = new Set<SessionListener>();

  private ptyProcess: nodePty.IPty | null = null;
  private currentSize: TerminalSize = DEFAULT_TERMINAL_SIZE;
  private commandLabel = 'codex';
  private backlog = '';

  constructor(options: CodexPtySessionOptions) {
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.executableResolver = options.executableResolver;
  }

  public subscribe(listener: SessionListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public ensureStarted(size: TerminalSize = DEFAULT_TERMINAL_SIZE) {
    this.currentSize = normalizeTerminalSize(size);
    if (this.ptyProcess) {
      return;
    }

    this.start(false);
  }

  public restart(size: TerminalSize = DEFAULT_TERMINAL_SIZE) {
    this.currentSize = normalizeTerminalSize(size);
    this.ptyProcess?.kill();
    this.ptyProcess = null;
    this.start(true);
  }

  public write(data: string) {
    this.ptyProcess?.write(data);
  }

  public resize(size: TerminalSize) {
    this.currentSize = normalizeTerminalSize(size);
    this.ptyProcess?.resize(this.currentSize.cols, this.currentSize.rows);
  }

  public interrupt() {
    this.ptyProcess?.write('\u0003');
  }

  public snapshot(isNewSession: boolean): CodexBridgeServerMessage {
    return {
      type: 'ready',
      sessionId: this.sessionId,
      cwd: this.cwd,
      commandLabel: this.commandLabel,
      backlog: this.backlog,
      isNewSession,
      isRunning: this.ptyProcess !== null
    };
  }

  public dispose() {
    this.ptyProcess?.kill();
    this.ptyProcess = null;
  }

  private start(isRestart: boolean) {
    const actionLabel = isRestart ? 'Restarting' : 'Starting';
    this.emit({
      type: 'status',
      phase: 'starting',
      detail: `${actionLabel} Codex CLI in ${this.cwd}...`
    });

    try {
      const launchCommand = this.executableResolver.resolve();
      this.commandLabel = launchCommand.commandLabel;
      this.backlog = '';

      const ptyProcess = nodePty.spawn(launchCommand.executablePath, launchCommand.args, {
        name: 'xterm-256color',
        cols: this.currentSize.cols,
        rows: this.currentSize.rows,
        cwd: this.cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color'
        }
      });

      this.ptyProcess = ptyProcess;
      ptyProcess.onData((data) => {
        this.appendBacklog(data);
        this.emit({
          type: 'output',
          data
        });
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        this.ptyProcess = null;
        this.emit({
          type: 'exit',
          exitCode,
          signal: signal ?? null
        });
        this.emit({
          type: 'status',
          phase: 'exited',
          detail: `Codex exited with code ${exitCode ?? 'null'}.`
        });
      });

      this.emit({
        type: 'status',
        phase: isRestart ? 'reconnected' : 'connected',
        detail: isRestart ? 'Codex session restarted.' : 'Codex session connected.'
      });
    } catch (error) {
      this.ptyProcess = null;
      const message = error instanceof Error ? error.message : 'Unable to start the Codex CLI process.';
      this.emit({
        type: 'error',
        message
      });
      this.emit({
        type: 'status',
        phase: 'exited',
        detail: message
      });
    }
  }

  private appendBacklog(data: string) {
    const nextBacklog = this.backlog + data;
    this.backlog =
      nextBacklog.length > MAX_BACKLOG_CHARS ? nextBacklog.slice(nextBacklog.length - MAX_BACKLOG_CHARS) : nextBacklog;
  }

  private emit(message: CodexBridgeServerMessage) {
    this.listeners.forEach((listener) => {
      listener(message);
    });
  }
}

function normalizeTerminalSize(size: TerminalSize): TerminalSize {
  return {
    cols: Math.max(40, Math.floor(size.cols)),
    rows: Math.max(12, Math.floor(size.rows))
  };
}
