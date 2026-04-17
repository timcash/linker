import type {
  CodexMailMessage,
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
  onMarkRead: () => void;
  onToggleCompose: () => void;
  onSendReply: (input: {body: string; messageId: string | null}) => void;
  onSendCompose: (input: {to: string; subject: string; body: string}) => void;
}

const VIEW_BUTTON_IDS: CodexMailViewId[] = ['inbox', 'needs-reply', 'waiting', 'queued', 'working', 'done'];

export class CodexMailboardView {
  private readonly root: HTMLDivElement;
  private readonly callbacks: CodexMailboardViewCallbacks;
  private shell: HTMLDivElement | null = null;
  private lockOverlay: HTMLDivElement | null = null;
  private unlockButton: HTMLButtonElement | null = null;
  private statusValue: HTMLParagraphElement | null = null;
  private mailboxValue: HTMLParagraphElement | null = null;
  private healthValue: HTMLParagraphElement | null = null;
  private authValue: HTMLParagraphElement | null = null;
  private currentViewValue: HTMLParagraphElement | null = null;
  private threadList: HTMLDivElement | null = null;
  private threadPanel: HTMLDivElement | null = null;
  private replyTextarea: HTMLTextAreaElement | null = null;
  private replyButton: HTMLButtonElement | null = null;
  private composePanel: HTMLDivElement | null = null;
  private composeToInput: HTMLInputElement | null = null;
  private composeSubjectInput: HTMLInputElement | null = null;
  private composeBodyTextarea: HTMLTextAreaElement | null = null;
  private composeSendButton: HTMLButtonElement | null = null;
  private actionButtons = new Map<string, HTMLButtonElement>();
  private viewButtons = new Map<CodexMailViewId, HTMLButtonElement>();
  private selectedThreadId: string | null = null;
  private composeOpen = false;
  private locked = true;

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
          <a class="codex-mail-back-link" href="../">Linker</a>
          <div class="codex-mail-topbar-copy">
            <p class="codex-mail-eyebrow">Codex Mailboard</p>
            <h1 class="codex-mail-title">One shared mailbox, one shared daemon.</h1>
            <p class="codex-mail-lede">Unlock with <code>Cloudflare Access</code>, then browse the shared gmail-agent inbox, reply in-thread, and draft new mail without leaving the page.</p>
          </div>
        </header>

        <section class="codex-mail-meta-grid">
          <div class="codex-mail-meta-card">
            <span class="codex-mail-meta-label">Status</span>
            <p class="codex-mail-meta-value" data-codex-status>Waiting for Cloudflare Access.</p>
          </div>
          <div class="codex-mail-meta-card">
            <span class="codex-mail-meta-label">Mailbox</span>
            <p class="codex-mail-meta-value" data-codex-mailbox>Shared daemon mailbox unavailable.</p>
          </div>
          <div class="codex-mail-meta-card">
            <span class="codex-mail-meta-label">View</span>
            <p class="codex-mail-meta-value" data-codex-view>Inbox</p>
          </div>
          <div class="codex-mail-meta-card codex-mail-meta-card--wide">
            <span class="codex-mail-meta-label">Health</span>
            <p class="codex-mail-meta-value" data-codex-health>Health appears after Access is active.</p>
          </div>
          <div class="codex-mail-meta-card codex-mail-meta-card--wide">
            <span class="codex-mail-meta-label">Access</span>
            <p class="codex-mail-meta-value" data-codex-auth>Cloudflare Access required.</p>
          </div>
        </section>

        <section class="codex-mail-main">
          <div class="codex-thread-list-shell">
            <div class="codex-thread-list-header">
              <p class="codex-section-label">Threads</p>
              <p class="codex-thread-list-note">A compact view of the shared mailbox state.</p>
            </div>
            <div class="codex-thread-list" data-codex-thread-list>
              <p class="codex-thread-empty">Unlock the mailboard to load the mailbox list.</p>
            </div>
          </div>

          <div class="codex-thread-panel" data-codex-thread-panel>
            <div class="codex-thread-empty-state">
              <p class="codex-section-label">Conversation</p>
              <p>Select a thread to inspect the email text, task history, and reply tools.</p>
            </div>
          </div>

          <div class="codex-mail-lock-overlay" data-codex-lock>
            <div class="codex-mail-lock-card">
              <p class="codex-mail-lock-eyebrow">Cloudflare Access</p>
              <h2 class="codex-mail-lock-title">Unlock the shared gmail-agent mailbox.</h2>
              <p class="codex-mail-lock-copy">The page does not carry its own password anymore. The same Access session unlocks the browser view and the remote mail API.</p>
              <button class="codex-mail-primary-button" type="button" data-codex-unlock-button>Unlock With Cloudflare Access</button>
              <p class="codex-mail-lock-message" data-codex-unlock-message>Waiting for Cloudflare Access.</p>
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
    this.statusValue = this.root.querySelector('[data-codex-status]');
    this.mailboxValue = this.root.querySelector('[data-codex-mailbox]');
    this.healthValue = this.root.querySelector('[data-codex-health]');
    this.authValue = this.root.querySelector('[data-codex-auth]');
    this.currentViewValue = this.root.querySelector('[data-codex-view]');
    this.threadList = this.root.querySelector('[data-codex-thread-list]');
    this.threadPanel = this.root.querySelector('[data-codex-thread-panel]');
    this.composePanel = null;
    this.composeToInput = null;
    this.composeSubjectInput = null;
    this.composeBodyTextarea = null;
    this.composeSendButton = null;
    this.replyTextarea = null;
    this.replyButton = null;
    this.actionButtons.clear();
    this.viewButtons.clear();

    this.unlockButton?.addEventListener('click', this.callbacks.onUnlock);
    this.threadList?.addEventListener('click', this.handleThreadListClick);

    for (const viewId of VIEW_BUTTON_IDS) {
      const button = this.root.querySelector<HTMLButtonElement>(`[data-codex-view-button="${viewId}"]`);
      if (button) {
        this.viewButtons.set(viewId, button);
        button.addEventListener('click', () => {
          this.callbacks.onSelectView(viewId);
        });
      }
    }

    for (const actionId of ['refresh', 'compose', 'mark-read']) {
      const button = this.root.querySelector<HTMLButtonElement>(`[data-codex-action-button="${actionId}"]`);
      if (button) {
        this.actionButtons.set(actionId, button);
      }
    }

    this.actionButtons.get('refresh')?.addEventListener('click', this.callbacks.onRefresh);
    this.actionButtons.get('compose')?.addEventListener('click', this.callbacks.onToggleCompose);
    this.actionButtons.get('mark-read')?.addEventListener('click', this.callbacks.onMarkRead);

    this.setComposeOpen(false);
    this.setThreadActionAvailability(false);
    this.setLockState(true, 'Waiting for Cloudflare Access.');
  }

  public dispose(): void {
    document.body.classList.remove('codex-route');
    this.root.classList.remove('codex-route-root');
    this.root.replaceChildren();
  }

  public focusUnlock(): void {
    this.unlockButton?.focus();
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

    for (const [actionId, button] of this.actionButtons.entries()) {
      if (actionId === 'refresh' || actionId === 'compose') {
        button.disabled = locked;
      }
    }

    this.setThreadActionAvailability(!locked && Boolean(this.selectedThreadId));
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
      button.innerHTML = `<span>${escapeHtml(view.label)}</span><strong>${view.count}</strong>`;
    }
  }

  public setThreads(threads: CodexMailThreadSummary[], selectedThreadId: string | null): void {
    this.selectedThreadId = selectedThreadId;
    if (!this.threadList) {
      return;
    }

    if (threads.length === 0) {
      this.threadList.innerHTML = `<p class="codex-thread-empty">No threads match the current view.</p>`;
      this.setThreadActionAvailability(false);
      return;
    }

    this.threadList.innerHTML = threads
      .map((thread) => {
        const isActive = thread.threadId === selectedThreadId;
        return `
          <button
            type="button"
            class="codex-thread-row${isActive ? ' codex-thread-row--active' : ''}"
            data-codex-thread-id="${escapeHtml(thread.threadId)}"
          >
            <span class="codex-thread-row-subject">${escapeHtml(thread.subject)}</span>
            <span class="codex-thread-row-meta">${escapeHtml(thread.badges.join(' · ') || 'thread')}</span>
            <span class="codex-thread-row-excerpt">${escapeHtml(thread.excerpt)}</span>
          </button>
        `;
      })
      .join('');

    this.setThreadActionAvailability(!this.locked && Boolean(selectedThreadId));
  }

  public setThreadDetail(detail: CodexMailThreadDetail | null): void {
    if (!this.threadPanel) {
      return;
    }

    if (!detail) {
      this.threadPanel.innerHTML = `
        <div class="codex-thread-empty-state">
          <p class="codex-section-label">Conversation</p>
          <p>Select a thread to inspect the email text, task history, and reply tools.</p>
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

    this.threadPanel.innerHTML = `
      <div class="codex-thread-detail">
        <header class="codex-thread-detail-header">
          <p class="codex-section-label">Conversation</p>
          <h2 class="codex-thread-detail-title">${escapeHtml(detail.summary.subject)}</h2>
          <p class="codex-thread-detail-meta">${escapeHtml(detail.summary.badges.join(' · ') || 'mail thread')}</p>
          <p class="codex-thread-detail-excerpt">${escapeHtml(detail.summary.excerpt)}</p>
          ${detail.loadError ? `<p class="codex-thread-detail-warning">${escapeHtml(detail.loadError)}</p>` : ''}
        </header>

        <section class="codex-thread-task-list">
          <p class="codex-section-label">Task History</p>
          ${renderTaskHistory(detail)}
        </section>

        <section class="codex-thread-message-list">
          <p class="codex-section-label">Email Text</p>
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

    this.setThreadActionAvailability(!this.locked && Boolean(this.selectedThreadId));
    this.setComposeOpen(this.composeOpen);
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
      this.replyButton.textContent = isPending ? 'Sending Reply…' : 'Send Reply';
    }
  }

  public setComposePending(isPending: boolean): void {
    if (this.composeSendButton) {
      this.composeSendButton.disabled = isPending;
      this.composeSendButton.textContent = isPending ? 'Sending…' : 'Send New Mail';
    }
  }

  public setComposeOpen(isOpen: boolean): void {
    this.composeOpen = isOpen;
    this.composePanel?.classList.toggle('codex-compose-panel--open', isOpen);
    const composeButton = this.actionButtons.get('compose');
    if (composeButton) {
      composeButton.classList.toggle('codex-mail-pad-button--active', isOpen);
      composeButton.querySelector('span')!.textContent = isOpen ? 'Close' : 'Compose';
    }
  }

  private setThreadActionAvailability(canAct: boolean): void {
    const markReadButton = this.actionButtons.get('mark-read');
    if (markReadButton) {
      markReadButton.disabled = !canAct;
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
}

function renderPadButtons(): string {
  const buttons = [
    {kind: 'view', id: 'inbox', label: 'Inbox'},
    {kind: 'view', id: 'needs-reply', label: 'Needs Reply'},
    {kind: 'view', id: 'waiting', label: 'Waiting'},
    {kind: 'view', id: 'queued', label: 'Queued'},
    {kind: 'view', id: 'working', label: 'Working'},
    {kind: 'view', id: 'done', label: 'Done'},
    {kind: 'action', id: 'refresh', label: 'Refresh'},
    {kind: 'action', id: 'compose', label: 'Compose'},
    {kind: 'action', id: 'mark-read', label: 'Mark Read'},
  ] as const;

  return buttons
    .map((button) => {
      if (button.kind === 'view') {
        return `<button type="button" class="codex-mail-pad-button" data-codex-view-button="${button.id}"><span>${escapeHtml(button.label)}</span><strong>0</strong></button>`;
      }

      return `<button type="button" class="codex-mail-pad-button" data-codex-action-button="${button.id}"><span>${escapeHtml(button.label)}</span><strong>•</strong></button>`;
    })
    .join('');
}

function renderTaskHistory(detail: CodexMailThreadDetail): string {
  if (detail.tasks.length === 0) {
    return `<p class="codex-thread-empty">This thread has not started codex work yet.</p>`;
  }

  return detail.tasks
    .map((task) => {
      const meta = [task.status, task.workflowStage, task.requestedAt].filter(Boolean).join(' · ');
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
      const meta = [message.from || 'unknown sender', message.sentAt].filter(Boolean).join(' · ');
      return `
        <article class="codex-message-row">
          <p class="codex-message-row-meta">${escapeHtml(meta)}</p>
          <pre>${escapeHtml(message.bodyText || message.snippet || '(empty message)')}</pre>
        </article>
      `;
    })
    .join('');
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
