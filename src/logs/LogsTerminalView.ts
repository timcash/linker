import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

export type LogsTerminalViewCallbacks = {
  onClearScreen: () => void;
  onCommand: (command: string) => void;
  onHistoryNavigate: (direction: 'next' | 'previous') => string;
  onResetFilters: () => void;
  onShowHelp: () => void;
  onShowTail: () => void;
  onToggleFollow: () => void;
};

export class LogsTerminalView {
  private readonly callbacks: LogsTerminalViewCallbacks;
  private readonly root: HTMLDivElement;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private terminalHost: HTMLDivElement | null = null;
  private historyValue: HTMLParagraphElement | null = null;
  private visibleValue: HTMLParagraphElement | null = null;
  private filtersValue: HTMLParagraphElement | null = null;
  private followValue: HTMLParagraphElement | null = null;
  private helpButton: HTMLButtonElement | null = null;
  private tailButton: HTMLButtonElement | null = null;
  private followButton: HTMLButtonElement | null = null;
  private resetButton: HTMLButtonElement | null = null;
  private clearButton: HTMLButtonElement | null = null;
  private prompt = 'logs> ';
  private currentInput = '';

  constructor(root: HTMLDivElement, callbacks: LogsTerminalViewCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  public render(): void {
    document.title = 'Linker Logs';
    document.body.classList.add('docs-route', 'logs-route');
    this.root.classList.add('logs-route-root');

    this.root.innerHTML = `
      <div class="logs-page-shell" data-testid="logs-page">
        <header class="logs-topbar">
          <div class="logs-topbar-copy">
            <p class="logs-eyebrow">Browser Logs</p>
            <h1 class="logs-title">Timestamped Linker logs with source lines, filters, and local history.</h1>
            <p class="logs-lede">The log stream is stored in browser history on this machine, then rendered through an xterm.js console so we can inspect it with CLI-style filters. Use <code>help</code> in the terminal for commands, or the quick buttons below for the common views.</p>
          </div>
        </header>

        <section class="logs-meta-grid">
          <div class="logs-meta-card">
            <span class="logs-meta-label">History</span>
            <p class="logs-meta-value" data-logs-history>0 stored rows.</p>
          </div>
          <div class="logs-meta-card">
            <span class="logs-meta-label">Visible</span>
            <p class="logs-meta-value" data-logs-visible>0 matching rows.</p>
          </div>
          <div class="logs-meta-card logs-meta-card--wide">
            <span class="logs-meta-label">Filters</span>
            <p class="logs-meta-value" data-logs-filters>level=all | grep=all | source=all | since=all</p>
          </div>
          <div class="logs-meta-card logs-meta-card--wide">
            <span class="logs-meta-label">Follow</span>
            <p class="logs-meta-value" data-logs-follow>Follow is off.</p>
          </div>
        </section>

        <section class="logs-terminal-frame">
          <div class="logs-terminal-surface" data-testid="logs-terminal" data-logs-terminal></div>
        </section>

        <div class="logs-actions">
          <button type="button" class="logs-action-btn" data-logs-help>Help</button>
          <button type="button" class="logs-action-btn" data-logs-tail>Tail</button>
          <button type="button" class="logs-action-btn" data-logs-follow-toggle>Follow</button>
          <button type="button" class="logs-action-btn" data-logs-reset>Reset</button>
          <button type="button" class="logs-action-btn" data-logs-clear>Clear</button>
        </div>
      </div>
    `;

    this.historyValue = this.root.querySelector('[data-logs-history]');
    this.visibleValue = this.root.querySelector('[data-logs-visible]');
    this.filtersValue = this.root.querySelector('[data-logs-filters]');
    this.followValue = this.root.querySelector('[data-logs-follow]');
    this.terminalHost = this.root.querySelector('[data-logs-terminal]');
    this.helpButton = this.root.querySelector('[data-logs-help]');
    this.tailButton = this.root.querySelector('[data-logs-tail]');
    this.followButton = this.root.querySelector('[data-logs-follow-toggle]');
    this.resetButton = this.root.querySelector('[data-logs-reset]');
    this.clearButton = this.root.querySelector('[data-logs-clear]');

    this.helpButton?.addEventListener('click', this.callbacks.onShowHelp);
    this.tailButton?.addEventListener('click', this.callbacks.onShowTail);
    this.followButton?.addEventListener('click', this.callbacks.onToggleFollow);
    this.resetButton?.addEventListener('click', this.callbacks.onResetFilters);
    this.clearButton?.addEventListener('click', this.callbacks.onClearScreen);

    this.mountTerminal();
  }

  public dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.fitAddon = null;
    this.terminal?.dispose();
    this.terminal = null;
    document.body.classList.remove('docs-route', 'logs-route');
    this.root.classList.remove('logs-route-root');
  }

  public clearTerminal(): void {
    this.terminal?.clear();
  }

  public focusTerminal(): void {
    this.terminal?.focus();
  }

  public setFiltersSummary(summary: string): void {
    if (this.filtersValue) {
      this.filtersValue.textContent = summary;
    }
  }

  public setFollowEnabled(isEnabled: boolean): void {
    if (this.followValue) {
      this.followValue.textContent = isEnabled
        ? 'Follow is on. New matching rows stream into the terminal.'
        : 'Follow is off. Use `tail` or `show` to print rows manually.';
    }

    if (this.followButton) {
      this.followButton.textContent = isEnabled ? 'Following' : 'Follow';
      this.followButton.dataset.active = isEnabled ? 'true' : 'false';
      this.followButton.setAttribute('aria-pressed', isEnabled ? 'true' : 'false');
    }
  }

  public setHistorySummary(summary: string): void {
    if (this.historyValue) {
      this.historyValue.textContent = summary;
    }
  }

  public setVisibleSummary(summary: string): void {
    if (this.visibleValue) {
      this.visibleValue.textContent = summary;
    }
  }

  public showPrompt(): void {
    this.currentInput = '';
    this.write(this.prompt);
  }

  public replaceInput(nextInput: string): void {
    this.currentInput = nextInput;
    this.write('\r\x1b[2K');
    this.write(`${this.prompt}${this.currentInput}`);
  }

  public write(text: string): void {
    this.terminal?.write(text);
  }

  public writeln(text: string): void {
    this.terminal?.writeln(text);
  }

  private mountTerminal(): void {
    if (!this.terminalHost) {
      return;
    }

    this.fitAddon = new FitAddon();
    this.terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: '"Space Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.15,
      theme: {
        background: '#000000',
        black: '#000000',
        brightBlack: '#555555',
        brightCyan: '#ffffff',
        brightGreen: '#ffffff',
        brightRed: '#ffffff',
        brightWhite: '#ffffff',
        brightYellow: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        cyan: '#d0d0d0',
        foreground: '#cccccc',
        green: '#bfbfbf',
        red: '#b0b0b0',
        selectionBackground: 'rgba(255, 255, 255, 0.18)',
        white: '#d9d9d9',
        yellow: '#c8c8c8',
      },
    });

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.terminalHost);
    this.terminal.onData((data) => {
      this.handleTerminalData(data);
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.fitAddon?.fit();
    });
    this.resizeObserver.observe(this.terminalHost);

    requestAnimationFrame(() => {
      this.fitAddon?.fit();
      this.focusTerminal();
    });
  }

  private handleTerminalData(data: string): void {
    switch (data) {
      case '\r':
        this.writeln('');
        this.callbacks.onCommand(this.currentInput);
        return;
      case '\u007f':
        if (this.currentInput.length === 0) {
          return;
        }
        this.currentInput = this.currentInput.slice(0, -1);
        this.write('\b \b');
        return;
      case '\u000c':
        this.callbacks.onClearScreen();
        return;
      case '\u001b[A':
        this.replaceInput(this.callbacks.onHistoryNavigate('previous'));
        return;
      case '\u001b[B':
        this.replaceInput(this.callbacks.onHistoryNavigate('next'));
        return;
      default:
        if (!isPrintableTerminalInput(data)) {
          return;
        }
        this.currentInput += data;
        this.write(data);
    }
  }
}

function isPrintableTerminalInput(data: string): boolean {
  return data >= ' ' && data !== '\u007f' && !data.startsWith('\u001b');
}
