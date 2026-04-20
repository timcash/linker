import type {
  CodexMailMessage,
  CodexMailThreadAction,
  CodexMailThreadDetail,
  CodexMailThreadSummary,
  CodexMailView,
  CodexMailViewId,
} from './CodexMailClient';

interface CodexMailboardViewCallbacks {
  onUnlock: () => void;
  onSelectView: (viewId: CodexMailViewId) => void;
  onSelectThread: (threadId: string) => void;
  onRefresh: () => void;
  onClearSearch: () => void;
  onSearchSubmit: (query: string) => void;
  onToggleCompose: () => void;
  onApplyThreadAction: (action: CodexMailThreadAction) => void;
  onSendReply: (input: {body: string; messageId: string | null}) => void;
  onSendCompose: (input: {to: string; subject: string; body: string}) => void;
}

const VIEW_BUTTON_IDS: CodexMailViewId[] = ['codex', 'queued', 'working', 'review', 'blocked', 'done'];
const DETAIL_ACTION_ORDER: CodexMailThreadAction[] = [
  'mark-read',
  'mark-unread',
  'star',
  'unstar',
  'archive',
  'move-to-inbox',
];

export class CodexMailboardView {
  private readonly root: HTMLDivElement;
  private readonly callbacks: CodexMailboardViewCallbacks;
  private shell: HTMLDivElement | null = null;
  private lockOverlay: HTMLDivElement | null = null;
  private unlockButton: HTMLButtonElement | null = null;
  private authorizeLink: HTMLAnchorElement | null = null;
  private statusValue: HTMLParagraphElement | null = null;
  private mailboxValue: HTMLParagraphElement | null = null;
  private healthValue: HTMLParagraphElement | null = null;
  private authValue: HTMLParagraphElement | null = null;
  private currentViewValue: HTMLParagraphElement | null = null;
  private threadList: HTMLDivElement | null = null;
  private threadPanel: HTMLDivElement | null = null;
  private searchForm: HTMLFormElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private clearSearchButton: HTMLButtonElement | null = null;
  private replyTextarea: HTMLTextAreaElement | null = null;
  private replyButton: HTMLButtonElement | null = null;
  private composePanel: HTMLDivElement | null = null;
  private composeToInput: HTMLInputElement | null = null;
  private composeSubjectInput: HTMLInputElement | null = null;
  private composeBodyTextarea: HTMLTextAreaElement | null = null;
  private composeSendButton: HTMLButtonElement | null = null;
  private actionButtons = new Map<string, HTMLButtonElement>();
  private viewButtons = new Map<CodexMailViewId, HTMLButtonElement>();
  private threadActionButtons = new Map<CodexMailThreadAction, HTMLButtonElement>();
  private composeOpen = false;
  private locked = true;
  private searchQuery = '';

  constructor(root: HTMLDivElement, callbacks: CodexMailboardViewCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  public render(): void {
    document.title = 'Codex Mailboard - Linker';
    document.body.classList.add('codex-route');
    this.root.classList.add('codex-route-root');
    this.root.innerHTML = `
      <div class="codex-mail-shell codex-mail-shell--locked">
        <header class="codex-mail-topbar">
          <section class="codex-mail-topbar-copy">
            <p class="codex-mail-eyebrow">Codex Mailboard</p>
            <h1 class="codex-mail-title">Codex task mailbox.</h1>
          </section>
        </header>

        <section class="codex-mail-meta-grid">
          <div class="codex-mail-meta-card">
            <span class="codex-mail-meta-label">Status</span>
            <p class="codex-mail-meta-value" data-codex-status>Checking this computer.</p>
          </div>
          <div class="codex-mail-meta-card">
            <span class="codex-mail-meta-label">Mailbox</span>
            <p class="codex-mail-meta-value" data-codex-mailbox>Codex mailbox unavailable.</p>
          </div>
          <div class="codex-mail-meta-card">
            <span class="codex-mail-meta-label">View</span>
            <p class="codex-mail-meta-value" data-codex-view>Codex</p>
          </div>
          <div class="codex-mail-meta-card codex-mail-meta-card--wide">
            <span class="codex-mail-meta-label">Health</span>
            <p class="codex-mail-meta-value" data-codex-health>Health appears after codex responds.</p>
          </div>
          <div class="codex-mail-meta-card codex-mail-meta-card--wide">
            <span class="codex-mail-meta-label">Target</span>
            <p class="codex-mail-meta-value" data-codex-auth>This page will use this computer first.</p>
          </div>
        </section>

        <section class="codex-mail-main">
          <div class="codex-thread-list-shell">
            <div class="codex-thread-list-header">
              <p class="codex-section-label">Codex Search</p>
              <form class="codex-mail-search-form" data-codex-search-form>
                <input
                  class="codex-form-input codex-mail-search-input"
                  type="search"
                  data-codex-search-input
                  placeholder="Search codex threads"
                />
                <button class="codex-mail-inline-button" type="submit" data-codex-search-submit>Search</button>
                <button class="codex-mail-inline-button" type="button" data-codex-clear-search>Clear</button>
              </form>
            </div>
            <div class="codex-thread-list" data-codex-thread-list>
              <p class="codex-thread-empty">Unlock the mailboard to load codex threads.</p>
            </div>
          </div>

          <div class="codex-thread-panel" data-codex-thread-panel>
            <div class="codex-thread-empty-state">
              <p class="codex-section-label">Thread</p>
              <p>Select a codex thread to inspect messages, tasks, and mail actions.</p>
            </div>
          </div>

          <div class="codex-mail-lock-overlay" data-codex-lock>
            <div class="codex-mail-lock-card">
              <p class="codex-mail-lock-eyebrow">Mailbox</p>
              <h2 class="codex-mail-lock-title">Connect the codex mailbox.</h2>
              <div class="codex-mail-lock-actions" data-codex-lock-actions>
                <button class="codex-mail-primary-button" type="button" data-codex-unlock-button>Use This Computer</button>
                <a class="codex-mail-secondary-link" data-codex-authorize-link href="https://mail.example.com/codex/" target="_blank" rel="noopener noreferrer">Use Custom Host</a>
              </div>
              <p class="codex-mail-lock-message" data-codex-unlock-message>Checking this computer.</p>
            </div>
          </div>
        </section>

        <div class="codex-mail-pad">
          ${renderPadButtons()}
        </div>
      </div>
    `;

    this.shell = this.root.querySelector('.codex-mail-shell');
    this.lockOverlay = this.root.querySelector('[data-codex-lock]');
    this.unlockButton = this.root.querySelector('[data-codex-unlock-button]');
    this.authorizeLink = this.root.querySelector('[data-codex-authorize-link]');
    this.statusValue = this.root.querySelector('[data-codex-status]');
    this.mailboxValue = this.root.querySelector('[data-codex-mailbox]');
    this.healthValue = this.root.querySelector('[data-codex-health]');
    this.authValue = this.root.querySelector('[data-codex-auth]');
    this.currentViewValue = this.root.querySelector('[data-codex-view]');
    this.threadList = this.root.querySelector('[data-codex-thread-list]');
    this.threadPanel = this.root.querySelector('[data-codex-thread-panel]');
    this.searchForm = this.root.querySelector('[data-codex-search-form]');
    this.searchInput = this.root.querySelector('[data-codex-search-input]');
    this.clearSearchButton = this.root.querySelector('[data-codex-clear-search]');
    this.composePanel = null;
    this.composeToInput = null;
    this.composeSubjectInput = null;
    this.composeBodyTextarea = null;
    this.composeSendButton = null;
    this.replyTextarea = null;
    this.replyButton = null;
    this.actionButtons.clear();
    this.viewButtons.clear();
    this.threadActionButtons.clear();

    this.unlockButton?.addEventListener('click', this.callbacks.onUnlock);
    this.threadList?.addEventListener('click', this.handleThreadListClick);
    this.searchForm?.addEventListener('submit', this.handleSearchSubmit);
    this.clearSearchButton?.addEventListener('click', this.callbacks.onClearSearch);

    for (const viewId of VIEW_BUTTON_IDS) {
      const button = this.root.querySelector<HTMLButtonElement>(`[data-codex-view-button="${viewId}"]`);
      if (button) {
        this.viewButtons.set(viewId, button);
        button.addEventListener('click', () => {
          this.callbacks.onSelectView(viewId);
        });
      }
    }

    for (const actionId of ['refresh', 'compose', 'clear-search']) {
      const button = this.root.querySelector<HTMLButtonElement>(`[data-codex-action-button="${actionId}"]`);
      if (button) {
        this.actionButtons.set(actionId, button);
      }
    }

    this.actionButtons.get('refresh')?.addEventListener('click', this.callbacks.onRefresh);
    this.actionButtons.get('compose')?.addEventListener('click', this.callbacks.onToggleCompose);
    this.actionButtons.get('clear-search')?.addEventListener('click', this.callbacks.onClearSearch);

    this.setComposeOpen(false);
    this.setThreadActionsPending(false);
    this.setSearchQuery('');
    this.setLockState(true, 'Checking this computer.');
  }

  public dispose(): void {
    document.body.classList.remove('codex-route');
    this.root.classList.remove('codex-route-root');
    this.root.replaceChildren();
  }

  public focusUnlock(): void {
    this.unlockButton?.focus();
  }

  public setAuthorizeLink(input: {
    href: string;
    label: string;
  }): void {
    if (!this.authorizeLink) {
      return;
    }

    this.authorizeLink.href = input.href;
    this.authorizeLink.textContent = input.label;
  }

  public setStatus(message: string): void {
    if (this.statusValue) {
      this.statusValue.textContent = message;
    }
  }

  public setMailboxSummary(message: string): void {
    if (this.mailboxValue) {
      this.mailboxValue.textContent = message;
    }
  }

  public setHealthSummary(message: string): void {
    if (this.healthValue) {
      this.healthValue.textContent = message;
    }
  }

  public setAuthSummary(message: string): void {
    if (this.authValue) {
      this.authValue.textContent = message;
    }
  }

  public setCurrentViewLabel(message: string): void {
    if (this.currentViewValue) {
      this.currentViewValue.textContent = message;
    }
  }

  public setSearchQuery(query: string): void {
    this.searchQuery = query;

    if (this.searchInput && this.searchInput.value !== query) {
      this.searchInput.value = query;
    }

    const clearSearchAction = this.actionButtons.get('clear-search');
    if (clearSearchAction) {
      clearSearchAction.disabled = this.locked || query.trim().length === 0;
    }

    if (this.clearSearchButton) {
      this.clearSearchButton.disabled = this.locked || query.trim().length === 0;
    }
  }

  public setUnlockPending(isPending: boolean, label: string): void {
    if (this.unlockButton) {
      this.unlockButton.disabled = isPending;
      this.unlockButton.textContent = label;
    }
  }

  public setLockState(locked: boolean, message: string): void {
    this.locked = locked;
    this.shell?.classList.toggle('codex-mail-shell--locked', locked);
    this.lockOverlay?.setAttribute('aria-hidden', locked ? 'false' : 'true');
    document.body.dataset.codexViewMode = locked ? 'locked' : 'mailboard';

    const messageNode = this.root.querySelector<HTMLElement>('[data-codex-unlock-message]');
    if (messageNode) {
      messageNode.textContent = message;
    }

    for (const button of this.viewButtons.values()) {
      button.disabled = locked;
    }

    for (const button of this.actionButtons.values()) {
      button.disabled = locked;
    }

    if (this.searchInput) {
      this.searchInput.disabled = locked;
    }

    const searchSubmit = this.root.querySelector<HTMLButtonElement>('[data-codex-search-submit]');
    if (searchSubmit) {
      searchSubmit.disabled = locked;
    }

    this.setSearchQuery(this.searchQuery);
    this.setThreadActionsPending(false);
  }

  public setViews(views: CodexMailView[], activeViewId: CodexMailViewId): void {
    const viewMap = new Map<CodexMailViewId, CodexMailView>(views.map((view) => [view.id, view]));

    for (const viewId of VIEW_BUTTON_IDS) {
      const button = this.viewButtons.get(viewId);
      const view = viewMap.get(viewId);
      if (!button || !view) {
        continue;
      }

      button.classList.toggle('codex-mail-pad-button--active', viewId === activeViewId);
      button.classList.toggle('codex-mail-pad-button--empty', view.count === 0);
      button.dataset.codexViewCount = String(view.count);
      button.setAttribute('aria-label', `${view.label} (${view.count})`);
      button.innerHTML = renderPadButtonContent(view.label, String(view.count));
    }
  }

  public setThreads(threads: CodexMailThreadSummary[], selectedThreadId: string | null): void {
    if (!this.threadList) {
      return;
    }

    if (threads.length === 0) {
      this.threadList.innerHTML = `<p class="codex-thread-empty">No codex threads match the current view.</p>`;
      this.setThreadActionsPending(false);
      return;
    }

    this.threadList.innerHTML = threads
      .map((thread) => {
        const isActive = thread.threadId === selectedThreadId;
        const meta = [thread.from || '(unknown sender)', formatDateLabel(thread.updatedAt)]
          .filter(Boolean)
          .join(' | ');
        const chips = buildThreadChips(thread);

        return `
          <button
            type="button"
            class="codex-thread-row${isActive ? ' codex-thread-row--active' : ''}"
            data-codex-thread-id="${escapeHtml(thread.threadId)}"
          >
            <span class="codex-thread-row-subject">${escapeHtml(thread.subject)}</span>
            <span class="codex-thread-row-meta">${escapeHtml(meta)}</span>
            ${chips ? `<span class="codex-thread-chip-row">${chips}</span>` : ''}
            <span class="codex-thread-row-excerpt">${escapeHtml(thread.excerpt)}</span>
          </button>
        `;
      })
      .join('');

    this.setThreadActionsPending(false);
  }

  public setThreadsLoading(message: string): void {
    if (!this.threadList) {
      return;
    }

    this.threadList.innerHTML = `<p class="codex-thread-empty">${escapeHtml(message)}</p>`;
    this.setThreadActionsPending(false);
  }

  public setThreadDetail(detail: CodexMailThreadDetail | null): void {
    if (!this.threadPanel) {
      return;
    }

    this.threadActionButtons.clear();

    if (!detail) {
      this.threadPanel.innerHTML = `
        <div class="codex-thread-empty-state">
          <p class="codex-section-label">Thread</p>
          <p>Select a codex thread to inspect messages, tasks, and mail actions.</p>
        </div>
      `;
      this.composePanel = null;
      this.composeToInput = null;
      this.composeSubjectInput = null;
      this.composeBodyTextarea = null;
      this.composeSendButton = null;
      this.replyTextarea = null;
      this.replyButton = null;
      return;
    }

    const summaryMeta = [detail.summary.from || '(unknown sender)', formatDateLabel(detail.summary.updatedAt)]
      .filter(Boolean)
      .join(' | ');
    const threadChips = buildThreadChips(detail.summary);
    const actionButtons = renderThreadActions(detail);

    this.threadPanel.innerHTML = `
      <div class="codex-thread-detail">
        <header class="codex-thread-detail-header">
          <p class="codex-section-label">Thread</p>
          <h2 class="codex-thread-detail-title">${escapeHtml(detail.summary.subject)}</h2>
          <p class="codex-thread-detail-meta">${escapeHtml(summaryMeta)}</p>
          ${threadChips ? `<div class="codex-thread-chip-row codex-thread-chip-row--detail">${threadChips}</div>` : ''}
          <p class="codex-thread-detail-excerpt">${escapeHtml(detail.summary.excerpt)}</p>
          ${detail.loadError ? `<p class="codex-thread-detail-warning">${escapeHtml(detail.loadError)}</p>` : ''}
        </header>

        <section class="codex-thread-action-panel">
          <p class="codex-section-label">Mail Actions</p>
          <div class="codex-thread-action-grid">
            ${actionButtons}
          </div>
        </section>

        <section class="codex-thread-task-list">
          <p class="codex-section-label">Codex Tasks</p>
          ${renderTaskHistory(detail)}
        </section>

        <section class="codex-thread-message-list">
          <p class="codex-section-label">Messages</p>
          ${renderMessages(detail.messages)}
        </section>

        <form class="codex-reply-form" data-codex-reply-form>
          <label class="codex-form-label" for="codex-reply-body">Reply In Thread</label>
          <textarea id="codex-reply-body" class="codex-form-textarea" data-codex-reply-body placeholder="Type the next reply here."></textarea>
          <button type="submit" class="codex-mail-primary-button" data-codex-reply-send>Send Reply</button>
        </form>

        <section class="codex-compose-panel${this.composeOpen ? ' codex-compose-panel--open' : ''}" data-codex-compose-panel>
          <p class="codex-section-label">New Mail</p>
          <label class="codex-form-label" for="codex-compose-to">To</label>
          <input id="codex-compose-to" class="codex-form-input" data-codex-compose-to type="email" placeholder="name@example.com" />
          <label class="codex-form-label" for="codex-compose-subject">Subject</label>
          <input id="codex-compose-subject" class="codex-form-input" data-codex-compose-subject type="text" placeholder="Follow-up" />
          <label class="codex-form-label" for="codex-compose-body">Body</label>
          <textarea id="codex-compose-body" class="codex-form-textarea" data-codex-compose-body placeholder="Draft a new outgoing email."></textarea>
          <button type="button" class="codex-mail-primary-button" data-codex-compose-send>Send New Mail</button>
        </section>
      </div>
    `;

    this.replyTextarea = this.threadPanel.querySelector('[data-codex-reply-body]');
    this.replyButton = this.threadPanel.querySelector('[data-codex-reply-send]');
    this.composePanel = this.threadPanel.querySelector('[data-codex-compose-panel]');
    this.composeToInput = this.threadPanel.querySelector('[data-codex-compose-to]');
    this.composeSubjectInput = this.threadPanel.querySelector('[data-codex-compose-subject]');
    this.composeBodyTextarea = this.threadPanel.querySelector('[data-codex-compose-body]');
    this.composeSendButton = this.threadPanel.querySelector('[data-codex-compose-send]');

    for (const action of DETAIL_ACTION_ORDER) {
      const button = this.threadPanel.querySelector<HTMLButtonElement>(`[data-codex-thread-action="${action}"]`);
      if (!button) {
        continue;
      }

      this.threadActionButtons.set(action, button);
      button.addEventListener('click', () => {
        this.callbacks.onApplyThreadAction(action);
      });
    }

    this.threadPanel.querySelector('[data-codex-reply-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.callbacks.onSendReply({
        body: this.replyTextarea?.value ?? '',
        messageId: detail.latestReplyToMessageId,
      });
    });
    this.composeSendButton?.addEventListener('click', () => {
      this.callbacks.onSendCompose({
        to: this.composeToInput?.value ?? '',
        subject: this.composeSubjectInput?.value ?? '',
        body: this.composeBodyTextarea?.value ?? '',
      });
    });

    this.setComposeOpen(this.composeOpen);
    this.setThreadActionsPending(false);
  }

  public clearReplyDraft(): void {
    if (this.replyTextarea) {
      this.replyTextarea.value = '';
    }
  }

  public clearComposeDraft(): void {
    if (this.composeToInput) {
      this.composeToInput.value = '';
    }

    if (this.composeSubjectInput) {
      this.composeSubjectInput.value = '';
    }

    if (this.composeBodyTextarea) {
      this.composeBodyTextarea.value = '';
    }
  }

  public setReplyPending(isPending: boolean): void {
    if (this.replyButton) {
      this.replyButton.disabled = isPending;
      this.replyButton.textContent = isPending ? 'Sending Reply...' : 'Send Reply';
    }
  }

  public setComposePending(isPending: boolean): void {
    if (this.composeSendButton) {
      this.composeSendButton.disabled = isPending;
      this.composeSendButton.textContent = isPending ? 'Sending...' : 'Send New Mail';
    }
  }

  public setComposeOpen(isOpen: boolean): void {
    this.composeOpen = isOpen;
    this.composePanel?.classList.toggle('codex-compose-panel--open', isOpen);
    const composeButton = this.actionButtons.get('compose');
    if (composeButton) {
      composeButton.classList.toggle('codex-mail-pad-button--active', isOpen);
      const label = composeButton.querySelector('span');
      if (label) {
        label.textContent = isOpen ? 'Close' : 'Compose';
      }
    }
  }

  public setThreadActionsPending(isPending: boolean): void {
    for (const button of this.threadActionButtons.values()) {
      button.disabled = isPending || this.locked;
    }
  }

  private readonly handleThreadListClick = (event: Event): void => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-codex-thread-id]') : null;
    if (!target) {
      return;
    }

    const threadId = target.dataset.codexThreadId;
    if (threadId) {
      this.callbacks.onSelectThread(threadId);
    }
  };

  private readonly handleSearchSubmit = (event: Event): void => {
    event.preventDefault();
    this.callbacks.onSearchSubmit(this.searchInput?.value ?? '');
  };
}

function renderPadButtons(): string {
  const buttons = [
    {kind: 'view', id: 'codex', label: 'Codex'},
    {kind: 'view', id: 'queued', label: 'Queued'},
    {kind: 'view', id: 'working', label: 'Working'},
    {kind: 'view', id: 'review', label: 'Review'},
    {kind: 'view', id: 'blocked', label: 'Blocked'},
    {kind: 'view', id: 'done', label: 'Done'},
    {kind: 'action', id: 'refresh', label: 'Refresh'},
    {kind: 'action', id: 'compose', label: 'Compose'},
    {kind: 'action', id: 'clear-search', label: 'Clear'},
  ] as const;

  return buttons
    .map((button) => {
      if (button.kind === 'view') {
        return `<button type="button" class="codex-mail-pad-button" data-codex-view-button="${button.id}" data-codex-view-count="0" aria-label="${escapeHtml(button.label)} (0)">${renderPadButtonContent(button.label, '0')}</button>`;
      }

      return `<button type="button" class="codex-mail-pad-button codex-mail-pad-button--action" data-codex-action-button="${button.id}">${renderPadButtonContent(button.label, resolveActionMeta(button.id))}</button>`;
    })
    .join('');
}

function renderPadButtonContent(label: string, meta: string): string {
  return `<span class="codex-mail-pad-label">${escapeHtml(label)}</span><span class="codex-mail-pad-meta">${escapeHtml(meta)}</span>`;
}

function resolveActionMeta(actionId: 'refresh' | 'compose' | 'clear-search'): string {
  switch (actionId) {
    case 'refresh':
      return 'Sync';
    case 'compose':
      return 'Draft';
    case 'clear-search':
      return 'Reset';
  }
}

function renderThreadActions(detail: CodexMailThreadDetail): string {
  const labels: Record<CodexMailThreadAction, string> = {
    'mark-read': 'Mark Read',
    'mark-unread': 'Mark Unread',
    star: 'Star',
    unstar: 'Unstar',
    archive: 'Archive',
    'move-to-inbox': 'Move To Inbox',
  };

  return DETAIL_ACTION_ORDER.map((action) => {
    const visible =
      (action === 'mark-read' && detail.actions.canMarkRead)
      || (action === 'mark-unread' && detail.actions.canMarkUnread)
      || (action === 'star' && detail.actions.canStar)
      || (action === 'unstar' && detail.actions.canUnstar)
      || (action === 'archive' && detail.actions.canArchive)
      || (action === 'move-to-inbox' && detail.actions.canMoveToInbox);

    if (!visible) {
      return '';
    }

    return `<button type="button" class="codex-thread-action-button" data-codex-thread-action="${action}">${escapeHtml(labels[action])}</button>`;
  }).join('');
}

function renderTaskHistory(detail: CodexMailThreadDetail): string {
  if (detail.tasks.length === 0) {
    return `<p class="codex-thread-empty">This thread has not started codex work yet.</p>`;
  }

  return detail.tasks
    .map((task) => {
      const meta = [task.status, task.workflowStage, formatDateLabel(task.requestedAt)].filter(Boolean).join(' | ');
      return `
        <article class="codex-task-row">
          <h3>${escapeHtml(task.id)}</h3>
          <p class="codex-task-row-meta">${escapeHtml(meta)}</p>
          <p>${escapeHtml(task.requestText || task.workerSummary || '(no request text)')}</p>
        </article>
      `;
    })
    .join('');
}

function renderMessages(messages: CodexMailMessage[]): string {
  if (messages.length === 0) {
    return `<p class="codex-thread-empty">The daemon did not return any Gmail thread messages yet.</p>`;
  }

  return messages
    .map((message) => {
      const meta = [message.from || 'unknown sender', formatDateLabel(message.sentAt)].filter(Boolean).join(' | ');
      const chips = message.labelNames.length
        ? `<div class="codex-thread-chip-row codex-thread-chip-row--detail">${message.labelNames.map((label) => `<span class="codex-thread-chip">${escapeHtml(label)}</span>`).join('')}</div>`
        : '';
      return `
        <article class="codex-message-row">
          <p class="codex-message-row-meta">${escapeHtml(meta)}</p>
          ${chips}
          <pre>${escapeHtml(message.bodyText || message.snippet || '(empty message)')}</pre>
        </article>
      `;
    })
    .join('');
}

function buildThreadChips(thread: CodexMailThreadSummary): string {
  const chips = new Set<string>();

  if (thread.unread) {
    chips.add('Unread');
  }

  if (thread.starred) {
    chips.add('Starred');
  }

  for (const labelName of thread.labelNames.slice(0, 4)) {
    chips.add(labelName);
  }

  for (const badge of thread.badges.slice(0, 4)) {
    chips.add(badge);
  }

  return Array.from(chips)
    .slice(0, 4)
    .map((label) => `<span class="codex-thread-chip">${escapeHtml(label)}</span>`)
    .join('');
}

function formatDateLabel(value: string | null): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

