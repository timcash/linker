import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { CodexBridgeMode, TerminalSize } from '../../shared/codex/CodexBridgeTypes';

export type CodexTerminalViewPhase = 'starting' | 'connecting' | 'connected' | 'locked' | 'disconnected' | 'error' | 'exited';

interface CodexTerminalViewCallbacks {
  onUnlock: (password: string) => void;
  onLock: () => void;
  onModeChange: (mode: CodexBridgeMode) => void;
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
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private terminalHost: HTMLDivElement | null = null;
  private statusPill: HTMLSpanElement | null = null;
  private statusText: HTMLParagraphElement | null = null;
  private bridgeModeValue: HTMLParagraphElement | null = null;
  private bridgeValue: HTMLParagraphElement | null = null;
  private sessionValue: HTMLParagraphElement | null = null;
  private healthValue: HTMLParagraphElement | null = null;
  private authValue: HTMLParagraphElement | null = null;
  private unlockForm: HTMLFormElement | null = null;
  private passwordInput: HTMLInputElement | null = null;
  private unlockButton: HTMLButtonElement | null = null;
  private unlockMessage: HTMLParagraphElement | null = null;
  private lockOverlay: HTMLDivElement | null = null;
  private connectButton: HTMLButtonElement | null = null;
  private restartButton: HTMLButtonElement | null = null;
  private interruptButton: HTMLButtonElement | null = null;
  private clearButton: HTMLButtonElement | null = null;
  private lockButton: HTMLButtonElement | null = null;
  private modeButtons: HTMLButtonElement[] = [];

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
            <h1 class="codex-title">Local Codex CLI, unlocked for short browser sessions.</h1>
            <p class="codex-lede">This page is a thin xterm.js client for a local PTY-backed Codex daemon running on this machine or through the <code>linker.dialtone.earth</code> tunnel. If that tunnel is protected by Cloudflare Access, authorize on the <a href="../auth/">Auth</a> page first.</p>
          </div>
        </header>

        <section class="codex-meta-grid">
          <div class="codex-meta-card">
            <span class="codex-meta-label">Status</span>
            <span class="codex-status-pill codex-status-pill--starting">Starting</span>
            <p class="codex-meta-value" data-codex-status>Preparing the terminal route.</p>
          </div>
          <div class="codex-meta-card">
            <span class="codex-meta-label">Mode</span>
            <p class="codex-meta-value" data-codex-mode>Auto mode chooses the bridge target for this page.</p>
            <div class="codex-mode-toggle" role="group" aria-label="Codex bridge mode">
              <button type="button" class="codex-mode-btn" data-codex-mode-button="auto">Auto</button>
              <button type="button" class="codex-mode-btn" data-codex-mode-button="dev">Dev</button>
              <button type="button" class="codex-mode-btn" data-codex-mode-button="bridge">Bridge</button>
            </div>
          </div>
          <div class="codex-meta-card">
            <span class="codex-meta-label">Bridge</span>
            <p class="codex-meta-value" data-codex-bridge>Detecting bridge origin.</p>
          </div>
          <div class="codex-meta-card">
            <span class="codex-meta-label">Session</span>
            <p class="codex-meta-value" data-codex-session>Waiting for session id.</p>
          </div>
          <div class="codex-meta-card">
            <span class="codex-meta-label">Unlock</span>
            <p class="codex-meta-value" data-codex-auth>Locked.</p>
          </div>
          <div class="codex-meta-card codex-meta-card--wide">
            <span class="codex-meta-label">Health</span>
            <p class="codex-meta-value" data-codex-health>Bridge health will appear here after unlock.</p>
          </div>
        </section>

        <section class="codex-terminal-frame">
          <div class="codex-terminal-surface" data-codex-terminal></div>

          <div class="codex-lock-overlay" data-codex-lock>
            <div class="codex-lock-card">
              <p class="codex-lock-eyebrow">Protected</p>
              <h2 class="codex-lock-title">Enter the password to unlock this browser for 10 minutes.</h2>
              <p class="codex-lock-copy">The browser stores a short-lived unlock token in session storage. When it expires, the terminal locks again and the bridge rejects new input.</p>
              <form class="codex-lock-form" data-codex-unlock-form>
                <label class="codex-field">
                  <span class="codex-field-label codex-field-label--hidden">Username</span>
                  <input class="codex-hidden-input" type="text" autocomplete="username" value="codex" tabindex="-1" aria-hidden="true">
                </label>
                <label class="codex-field">
                  <span class="codex-field-label">Password</span>
                  <input class="codex-password-input" data-codex-password type="password" autocomplete="current-password" placeholder="Enter password">
                </label>
                <button class="codex-primary-button" data-codex-unlock-button type="submit">Unlock</button>
              </form>
              <p class="codex-lock-message" data-codex-unlock-message>Waiting for password.</p>
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

    this.statusPill = this.root.querySelector<HTMLSpanElement>('.codex-status-pill');
    this.statusText = this.root.querySelector<HTMLParagraphElement>('[data-codex-status]');
    this.bridgeModeValue = this.root.querySelector<HTMLParagraphElement>('[data-codex-mode]');
    this.bridgeValue = this.root.querySelector<HTMLParagraphElement>('[data-codex-bridge]');
    this.sessionValue = this.root.querySelector<HTMLParagraphElement>('[data-codex-session]');
    this.healthValue = this.root.querySelector<HTMLParagraphElement>('[data-codex-health]');
    this.authValue = this.root.querySelector<HTMLParagraphElement>('[data-codex-auth]');
    this.unlockForm = this.root.querySelector<HTMLFormElement>('[data-codex-unlock-form]');
    this.passwordInput = this.root.querySelector<HTMLInputElement>('[data-codex-password]');
    this.unlockButton = this.root.querySelector<HTMLButtonElement>('[data-codex-unlock-button]');
    this.unlockMessage = this.root.querySelector<HTMLParagraphElement>('[data-codex-unlock-message]');
    this.lockOverlay = this.root.querySelector<HTMLDivElement>('[data-codex-lock]');
    this.connectButton = this.root.querySelector<HTMLButtonElement>('[data-codex-connect]');
    this.restartButton = this.root.querySelector<HTMLButtonElement>('[data-codex-restart]');
    this.interruptButton = this.root.querySelector<HTMLButtonElement>('[data-codex-interrupt]');
    this.clearButton = this.root.querySelector<HTMLButtonElement>('[data-codex-clear]');
    this.lockButton = this.root.querySelector<HTMLButtonElement>('[data-codex-lock]');
    this.terminalHost = this.root.querySelector<HTMLDivElement>('[data-codex-terminal]');
    this.modeButtons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-codex-mode-button]'));

    this.unlockForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.callbacks.onUnlock(this.passwordInput?.value ?? '');
    });

    this.modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.codexModeButton;
        if (nextMode === 'auto' || nextMode === 'dev' || nextMode === 'bridge') {
          this.callbacks.onModeChange(nextMode);
        }
      });
    });

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
    document.body.classList.remove('codex-route');
  }

  public clearTerminal() {
    this.terminal?.clear();
  }

  public focusTerminal() {
    this.terminal?.focus();
  }

  public focusPassword() {
    this.passwordInput?.focus();
  }

  public clearPassword() {
    if (this.passwordInput) {
      this.passwordInput.value = '';
    }
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
      rows: this.terminal?.rows ?? 34
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

  public setBridgeMode(mode: CodexBridgeMode) {
    if (this.bridgeModeValue) {
      this.bridgeModeValue.textContent = bridgeModeCopy[mode];
    }

    this.modeButtons.forEach((button) => {
      const isActive = button.dataset.codexModeButton === mode;
      button.classList.toggle('codex-mode-btn--active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
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
    this.root.firstElementChild?.classList.toggle('codex-page-shell--locked', isLocked);
    this.lockOverlay?.setAttribute('aria-hidden', isLocked ? 'false' : 'true');
    if (this.unlockMessage) {
      this.unlockMessage.textContent = message;
    }
  }

  public setUnlockPending(isPending: boolean, label: string) {
    if (this.unlockButton) {
      this.unlockButton.disabled = isPending;
      this.unlockButton.textContent = label;
    }

    if (this.passwordInput) {
      this.passwordInput.disabled = isPending;
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
    this.terminal = new Terminal({
      fontFamily: '"Space Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 14,
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
        brightWhite: '#ffffff'
      }
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
  exited: 'Exited'
};

const bridgeModeCopy: Record<CodexBridgeMode, string> = {
  auto: 'Auto chooses the local dev server on localhost and the tunnel route on GitHub Pages.',
  dev: 'Dev uses the current page origin so localhost Vite can proxy the Codex bridge.',
  bridge: 'Bridge targets the direct bridge endpoint instead of the local dev proxy.'
};
