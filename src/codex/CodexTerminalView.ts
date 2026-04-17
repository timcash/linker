import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalSize } from '../../shared/codex/CodexBridgeTypes';

export type CodexTerminalViewPhase = 'starting' | 'connecting' | 'connected' | 'locked' | 'disconnected' | 'error' | 'exited';

interface CodexTerminalViewCallbacks {
  onUnlock: () => void;
  onLock: () => void;
  onConnect: () => void;
  onRestart: () => void;
  onInterrupt: () => void;
  onClearTerminal: () => void;
  onTerminalInput: (data: string) => void;
  onTerminalResize: (size: TerminalSize) => void;
}

export class CodexTerminalView {
  private readonly root: HTMLDivElement;
  private readonly callbacks: CodexTerminalViewCallbacks;
  private shell: HTMLDivElement | null = null;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private terminalHost: HTMLDivElement | null = null;
  private statusPill: HTMLSpanElement | null = null;
  private statusText: HTMLParagraphElement | null = null;
  private bridgeValue: HTMLParagraphElement | null = null;
  private sessionValue: HTMLParagraphElement | null = null;
  private healthValue: HTMLParagraphElement | null = null;
  private authValue: HTMLParagraphElement | null = null;
  private unlockButton: HTMLButtonElement | null = null;
  private unlockMessage: HTMLParagraphElement | null = null;
  private lockOverlay: HTMLDivElement | null = null;
  private connectButton: HTMLButtonElement | null = null;
  private restartButton: HTMLButtonElement | null = null;
  private interruptButton: HTMLButtonElement | null = null;
  private clearButton: HTMLButtonElement | null = null;
  private lockButton: HTMLButtonElement | null = null;

  constructor(root: HTMLDivElement, callbacks: CodexTerminalViewCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  public render() {
    document.title = 'Codex Terminal - Linker';
    document.body.classList.add('codex-route');

    this.root.classList.add('codex-route-root');
    this.root.innerHTML = `
      <div class="codex-page-shell codex-page-shell--locked">
        <header class="codex-topbar">
          <a class="codex-back-link" href="../">Linker</a>
          <div class="codex-topbar-copy">
            <p class="codex-eyebrow">Codex Terminal</p>
            <h1 class="codex-title">Cloudflare unlock, then fullscreen terminal.</h1>
            <p class="codex-lede">Unlock once with <code>Cloudflare Access</code>. On mobile the locked view stays on one screen, and the live shell expands into a fullscreen xterm terminal.</p>
          </div>
        </header>

        <section class="codex-meta-grid">
          <div class="codex-meta-card codex-meta-card--compact">
            <span class="codex-meta-label">Status</span>
            <span class="codex-status-pill codex-status-pill--starting">Starting</span>
            <p class="codex-meta-value" data-codex-status>Preparing the terminal route.</p>
          </div>
          <div class="codex-meta-card codex-meta-card--compact">
            <span class="codex-meta-label">Access</span>
            <p class="codex-meta-value" data-codex-auth>Cloudflare Access required.</p>
          </div>
          <div class="codex-meta-card codex-meta-card--compact">
            <span class="codex-meta-label">Bridge</span>
            <p class="codex-meta-value" data-codex-bridge>Detecting bridge origin.</p>
          </div>
          <div class="codex-meta-card codex-meta-card--optional">
            <span class="codex-meta-label">Session</span>
            <p class="codex-meta-value" data-codex-session>Waiting for session id.</p>
          </div>
          <div class="codex-meta-card codex-meta-card--wide codex-meta-card--optional">
            <span class="codex-meta-label">Health</span>
            <p class="codex-meta-value" data-codex-health>Bridge health will appear after Cloudflare Access unlock.</p>
          </div>
        </section>

        <section class="codex-terminal-frame">
          <div class="codex-terminal-surface" data-codex-terminal></div>

          <div class="codex-lock-overlay" data-codex-lock>
            <div class="codex-lock-card">
              <p class="codex-lock-eyebrow">Cloudflare Access</p>
              <h2 class="codex-lock-title">Unlock the hosted Codex bridge.</h2>
              <p class="codex-lock-copy">No second password lives here anymore. The same Cloudflare Access session unlocks the terminal.</p>
              <button class="codex-primary-button" data-codex-unlock-button type="button">Unlock With Cloudflare Access</button>
              <p class="codex-lock-message" data-codex-unlock-message>Waiting for Cloudflare Access.</p>
            </div>
          </div>
        </section>

        <div class="codex-actions">
          <button type="button" class="codex-action-btn" data-codex-connect>Connect</button>
          <button type="button" class="codex-action-btn" data-codex-restart>Restart</button>
          <button type="button" class="codex-action-btn" data-codex-interrupt>Ctrl+C</button>
          <button type="button" class="codex-action-btn" data-codex-clear>Clear</button>
          <button type="button" class="codex-action-btn" data-codex-lock>Lock</button>
        </div>
      </div>
    `;

    this.shell = this.root.querySelector<HTMLDivElement>('.codex-page-shell');
    this.statusPill = this.root.querySelector<HTMLSpanElement>('.codex-status-pill');
    this.statusText = this.root.querySelector<HTMLParagraphElement>('[data-codex-status]');
    this.bridgeValue = this.root.querySelector<HTMLParagraphElement>('[data-codex-bridge]');
    this.sessionValue = this.root.querySelector<HTMLParagraphElement>('[data-codex-session]');
    this.healthValue = this.root.querySelector<HTMLParagraphElement>('[data-codex-health]');
    this.authValue = this.root.querySelector<HTMLParagraphElement>('[data-codex-auth]');
    this.unlockButton = this.root.querySelector<HTMLButtonElement>('[data-codex-unlock-button]');
    this.unlockMessage = this.root.querySelector<HTMLParagraphElement>('[data-codex-unlock-message]');
    this.lockOverlay = this.root.querySelector<HTMLDivElement>('[data-codex-lock]');
    this.connectButton = this.root.querySelector<HTMLButtonElement>('[data-codex-connect]');
    this.restartButton = this.root.querySelector<HTMLButtonElement>('[data-codex-restart]');
    this.interruptButton = this.root.querySelector<HTMLButtonElement>('[data-codex-interrupt]');
    this.clearButton = this.root.querySelector<HTMLButtonElement>('[data-codex-clear]');
    this.lockButton = this.root.querySelector<HTMLButtonElement>('[data-codex-lock]');
    this.terminalHost = this.root.querySelector<HTMLDivElement>('[data-codex-terminal]');

    this.unlockButton?.addEventListener('click', this.callbacks.onUnlock);
    this.connectButton?.addEventListener('click', this.callbacks.onConnect);
    this.restartButton?.addEventListener('click', this.callbacks.onRestart);
    this.interruptButton?.addEventListener('click', this.callbacks.onInterrupt);
    this.clearButton?.addEventListener('click', this.callbacks.onClearTerminal);
    this.lockButton?.addEventListener('click', this.callbacks.onLock);

    this.mountTerminal();
  }

  public dispose() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.fitAddon = null;
    this.terminal?.dispose();
    this.terminal = null;
    document.body.removeAttribute('data-codex-view-mode');
    document.body.classList.remove('codex-route');
  }

  public clearTerminal() {
    this.terminal?.clear();
  }

  public focusTerminal() {
    this.terminal?.focus();
  }

  public focusUnlock() {
    this.unlockButton?.focus();
  }

  public resizeTerminal() {
    this.fitTerminal();
  }

  public write(data: string) {
    this.terminal?.write(data);
  }

  public writeln(data: string) {
    this.terminal?.writeln(data);
  }

  public getTerminalSize(): TerminalSize {
    return {
      cols: this.terminal?.cols ?? 120,
      rows: this.terminal?.rows ?? 34,
    };
  }

  public setConnectionState(phase: CodexTerminalViewPhase, detail: string) {
    if (this.statusPill) {
      this.statusPill.textContent = phaseLabelMap[phase];
      this.statusPill.className = `codex-status-pill codex-status-pill--${phase}`;
    }

    if (this.statusText) {
      this.statusText.textContent = detail;
    }

    if (this.connectButton) {
      this.connectButton.textContent = phase === 'connected' ? 'Reconnect' : 'Connect';
    }
  }

  public setBridgeOrigin(origin: string) {
    if (this.bridgeValue) {
      this.bridgeValue.textContent = origin;
    }
  }

  public setSessionId(sessionId: string) {
    if (this.sessionValue) {
      this.sessionValue.textContent = sessionId;
    }
  }

  public setHealthSummary(summary: string) {
    if (this.healthValue) {
      this.healthValue.textContent = summary;
    }
  }

  public setAuthSummary(summary: string) {
    if (this.authValue) {
      this.authValue.textContent = summary;
    }
  }

  public setLockState(isLocked: boolean, message: string) {
    this.shell?.classList.toggle('codex-page-shell--locked', isLocked);
    this.shell?.classList.toggle('codex-page-shell--terminal', !isLocked);
    this.lockOverlay?.setAttribute('aria-hidden', isLocked ? 'false' : 'true');
    document.body.dataset.codexViewMode = isLocked ? 'locked' : 'terminal';
    if (this.unlockMessage) {
      this.unlockMessage.textContent = message;
    }
    requestAnimationFrame(() => {
      this.fitTerminal();
    });
  }

  public setUnlockPending(isPending: boolean, label: string) {
    if (this.unlockButton) {
      this.unlockButton.disabled = isPending;
      this.unlockButton.textContent = label;
    }
  }

  public setTerminalInputEnabled(isEnabled: boolean) {
    if (this.terminal) {
      this.terminal.options.disableStdin = !isEnabled;
    }
  }

  public setActionAvailability(options: {
    canConnect: boolean;
    canRestart: boolean;
    canInterrupt: boolean;
    canClear: boolean;
    canLock: boolean;
  }) {
    if (this.connectButton) {
      this.connectButton.disabled = !options.canConnect;
    }

    if (this.restartButton) {
      this.restartButton.disabled = !options.canRestart;
    }

    if (this.interruptButton) {
      this.interruptButton.disabled = !options.canInterrupt;
    }

    if (this.clearButton) {
      this.clearButton.disabled = !options.canClear;
    }

    if (this.lockButton) {
      this.lockButton.disabled = !options.canLock;
    }
  }

  private mountTerminal() {
    if (!this.terminalHost) {
      return;
    }

    this.fitAddon = new FitAddon();
    const isMobileViewport = window.innerWidth <= 480;
    this.terminal = new Terminal({
      fontFamily: '"Space Mono", "Cascadia Code", Consolas, monospace',
      fontSize: isMobileViewport ? 12 : 14,
      lineHeight: 1.15,
      cursorBlink: true,
      allowTransparency: true,
      convertEol: true,
      disableStdin: true,
      theme: {
        background: '#000000',
        foreground: '#cccccc',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(255, 255, 255, 0.18)',
        black: '#000000',
        brightBlack: '#555555',
        green: '#bfbfbf',
        brightGreen: '#ffffff',
        yellow: '#c8c8c8',
        brightYellow: '#ffffff',
        red: '#b0b0b0',
        brightRed: '#ffffff',
        cyan: '#d0d0d0',
        brightCyan: '#ffffff',
        white: '#d9d9d9',
        brightWhite: '#ffffff',
      },
    });

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.terminalHost);
    this.terminal.onData(this.callbacks.onTerminalInput);

    this.resizeObserver = new ResizeObserver(() => {
      this.fitTerminal();
    });
    this.resizeObserver.observe(this.terminalHost);

    requestAnimationFrame(() => {
      this.fitTerminal();
    });
  }

  private fitTerminal() {
    if (!this.terminal || !this.fitAddon) {
      return;
    }

    this.fitAddon.fit();
    this.callbacks.onTerminalResize(this.getTerminalSize());
  }
}

const phaseLabelMap: Record<CodexTerminalViewPhase, string> = {
  starting: 'Starting',
  connecting: 'Connecting',
  connected: 'Connected',
  locked: 'Locked',
  disconnected: 'Offline',
  error: 'Error',
  exited: 'Exited',
};
