import {
  DEFAULT_LOGS_FILTERS,
  DEFAULT_LOGS_TAIL_COUNT,
  filterBrowserLogs,
  formatBrowserLogEntry,
  formatLogsFilterSummary,
  formatLogsHelpLines,
  parseLogsCommand,
  type BrowserLogEntry,
  type BrowserLogFilters,
} from './log-model';
import {getBrowserLogStore, recordBrowserLog} from './log-store';
import {LogsTerminalView} from './LogsTerminalView';

export class LogsTerminalPage {
  private readonly store = getBrowserLogStore();
  private readonly view: LogsTerminalView;
  private commandHistory: string[] = [];
  private commandHistoryCursor = -1;
  private filters: BrowserLogFilters = {...DEFAULT_LOGS_FILTERS};
  private followEnabled = false;
  private lastPrintedEntryId = '';
  private unsubscribe: (() => void) | null = null;

  constructor(root: HTMLDivElement) {
    this.view = new LogsTerminalView(root, {
      onClearScreen: () => {
        this.clearTerminalScreen();
        this.view.showPrompt();
      },
      onCommand: (command) => {
        this.runCommand(command);
      },
      onHistoryNavigate: (direction) => this.navigateCommandHistory(direction),
      onResetFilters: () => {
        this.applyFilters({...DEFAULT_LOGS_FILTERS}, 'Filters reset.');
        this.view.showPrompt();
      },
      onShowHelp: () => {
        this.printHelp();
        this.view.showPrompt();
      },
      onShowTail: () => {
        this.printTail(DEFAULT_LOGS_TAIL_COUNT);
        this.view.showPrompt();
      },
      onToggleFollow: () => {
        this.setFollowEnabled(!this.followEnabled);
        this.view.showPrompt();
      },
    });
  }

  public render(): void {
    this.view.render();
    this.syncDatasets(this.store.getEntries());
    this.unsubscribe = this.store.subscribe((entries) => {
      this.handleEntriesChanged(entries);
    });
    recordBrowserLog('info', 'Opened the logs route.');
    this.printWelcome();
    this.printTail(DEFAULT_LOGS_TAIL_COUNT);
    this.view.showPrompt();
    this.view.focusTerminal();
  }

  public dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.view.dispose();
    delete document.body.dataset.logsCommandHistoryCount;
    delete document.body.dataset.logsEntryCount;
    delete document.body.dataset.logsFilterLevel;
    delete document.body.dataset.logsFilterQuery;
    delete document.body.dataset.logsFilterSource;
    delete document.body.dataset.logsFollowEnabled;
    delete document.body.dataset.logsLastCommand;
    delete document.body.dataset.logsReady;
    delete document.body.dataset.logsSinceMinutes;
    delete document.body.dataset.logsVisibleCount;
  }

  private handleEntriesChanged(entries: BrowserLogEntry[]): void {
    const visibleEntries = filterBrowserLogs(entries, this.filters);

    this.syncDatasets(entries);

    if (!this.followEnabled) {
      return;
    }

    const nextEntries = getEntriesAfterId(visibleEntries, this.lastPrintedEntryId);

    if (nextEntries.length === 0) {
      return;
    }

    this.writeEntries(nextEntries);
  }

  private runCommand(input: string): void {
    const trimmedInput = input.trim();
    const parsedCommand = parseLogsCommand(trimmedInput);

    if ('error' in parsedCommand) {
      this.view.writeln(`[error] ${parsedCommand.error}`);
      this.view.showPrompt();
      return;
    }

    document.body.dataset.logsLastCommand = trimmedInput;

    if (trimmedInput.length > 0) {
      this.commandHistory.push(trimmedInput);
      this.commandHistoryCursor = this.commandHistory.length;
    }

    switch (parsedCommand.kind) {
      case 'help':
        this.printHelp();
        break;
      case 'show':
      case 'tail':
        this.printTail(parsedCommand.count);
        break;
      case 'level':
        this.applyFilters(
          {
            ...this.filters,
            level: parsedCommand.level,
          },
          `Level filter set to ${parsedCommand.level}.`,
        );
        break;
      case 'grep':
        this.applyFilters(
          {
            ...this.filters,
            query: parsedCommand.query,
          },
          parsedCommand.query.length > 0
            ? `Search filter set to "${parsedCommand.query}".`
            : 'Search filter cleared.',
        );
        break;
      case 'source':
        this.applyFilters(
          {
            ...this.filters,
            source: parsedCommand.source,
          },
          parsedCommand.source.length > 0
            ? `Source filter set to "${parsedCommand.source}".`
            : 'Source filter cleared.',
        );
        break;
      case 'since':
        this.applyFilters(
          {
            ...this.filters,
            sinceMinutes: parsedCommand.minutes,
          },
          parsedCommand.minutes === null
            ? 'Time filter cleared.'
            : `Time filter set to the last ${parsedCommand.minutes} minute(s).`,
        );
        break;
      case 'filters':
        this.view.writeln(formatLogsFilterSummary(this.filters));
        break;
      case 'reset':
        this.applyFilters({...DEFAULT_LOGS_FILTERS}, 'Filters reset.');
        break;
      case 'follow':
        this.setFollowEnabled(parsedCommand.enabled);
        break;
      case 'history':
        this.printCommandHistory(parsedCommand.count);
        break;
      case 'clear':
        this.clearTerminalScreen();
        break;
    }

    this.view.showPrompt();
    this.view.focusTerminal();
  }

  private printCommandHistory(count: number): void {
    const visibleCommands = this.commandHistory.slice(-count);

    if (visibleCommands.length === 0) {
      this.view.writeln('[history] No commands yet.');
      return;
    }

    this.view.writeln(`[history] Showing ${visibleCommands.length} command(s).`);

    visibleCommands.forEach((command, index) => {
      this.view.writeln(`  ${index + 1}. ${command}`);
    });
  }

  private printHelp(): void {
    for (const line of formatLogsHelpLines()) {
      this.view.writeln(line);
    }
  }

  private printTail(count: number): void {
    const visibleEntries = filterBrowserLogs(this.store.getEntries(), this.filters);
    const slice = visibleEntries.slice(-count);

    this.view.writeln(
      `[logs] ${slice.length} row(s) shown from ${visibleEntries.length} matching row(s).`,
    );
    this.writeEntries(slice);
  }

  private applyFilters(nextFilters: BrowserLogFilters, statusLine: string): void {
    this.filters = nextFilters;
    this.view.writeln(`[filters] ${statusLine}`);
    this.syncDatasets(this.store.getEntries());
    this.printTail(DEFAULT_LOGS_TAIL_COUNT);
  }

  private clearTerminalScreen(): void {
    this.view.clearTerminal();
    this.lastPrintedEntryId = '';
    this.view.writeln('Linker Logs terminal cleared.');
  }

  private navigateCommandHistory(direction: 'next' | 'previous'): string {
    if (this.commandHistory.length === 0) {
      return '';
    }

    if (direction === 'previous') {
      this.commandHistoryCursor = Math.max(0, this.commandHistoryCursor - 1);
    } else {
      this.commandHistoryCursor = Math.min(
        this.commandHistory.length,
        this.commandHistoryCursor + 1,
      );
    }

    if (this.commandHistoryCursor >= this.commandHistory.length) {
      return '';
    }

    return this.commandHistory[this.commandHistoryCursor] ?? '';
  }

  private printWelcome(): void {
    this.view.writeln('Linker Logs ready.');
    this.view.writeln('Type `help` for commands. Stored browser history is shown below.');
  }

  private setFollowEnabled(isEnabled: boolean): void {
    this.followEnabled = isEnabled;
    this.view.setFollowEnabled(isEnabled);
    document.body.dataset.logsFollowEnabled = isEnabled ? 'true' : 'false';
    this.view.writeln(
      isEnabled
        ? '[follow] New matching rows will stream into the terminal.'
        : '[follow] Automatic streaming paused.',
    );

    if (isEnabled) {
      this.lastPrintedEntryId = getLastEntryId(
        filterBrowserLogs(this.store.getEntries(), this.filters),
      );
    }
  }

  private syncDatasets(entries: BrowserLogEntry[]): void {
    const visibleEntries = filterBrowserLogs(entries, this.filters);
    document.body.dataset.logsCommandHistoryCount = String(this.commandHistory.length);
    document.body.dataset.logsEntryCount = String(entries.length);
    document.body.dataset.logsFilterLevel = this.filters.level;
    document.body.dataset.logsFilterQuery = this.filters.query;
    document.body.dataset.logsFilterSource = this.filters.source;
    document.body.dataset.logsReady = 'true';
    document.body.dataset.logsSinceMinutes =
      this.filters.sinceMinutes === null ? 'all' : String(this.filters.sinceMinutes);
    document.body.dataset.logsVisibleCount = String(visibleEntries.length);

    this.view.setHistorySummary(`${entries.length} stored rows.`);
    this.view.setVisibleSummary(`${visibleEntries.length} matching rows.`);
    this.view.setFiltersSummary(formatLogsFilterSummary(this.filters));
    this.view.setFollowEnabled(this.followEnabled);
  }

  private writeEntries(entries: readonly BrowserLogEntry[]): void {
    if (entries.length === 0) {
      this.view.writeln('[logs] No matching rows.');
      return;
    }

    for (const entry of entries) {
      this.view.writeln(formatBrowserLogEntry(entry));
      this.lastPrintedEntryId = entry.id;
    }
  }
}

function getEntriesAfterId(
  entries: readonly BrowserLogEntry[],
  lastPrintedEntryId: string,
): BrowserLogEntry[] {
  if (lastPrintedEntryId.length === 0) {
    return [...entries];
  }

  const startIndex = entries.findIndex((entry) => entry.id === lastPrintedEntryId);

  if (startIndex < 0) {
    return [...entries];
  }

  return entries.slice(startIndex + 1);
}

function getLastEntryId(entries: readonly BrowserLogEntry[]): string {
  return entries[entries.length - 1]?.id ?? '';
}
