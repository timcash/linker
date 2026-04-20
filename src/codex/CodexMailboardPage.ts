import {
  CodexAccessError,
  CodexMailClient,
  type CodexMailHealth,
  type CodexMailThreadAction,
  type CodexMailThreadDetail,
  type CodexMailThreadSummary,
  type CodexMailView,
  type CodexMailViewId,
} from './CodexMailClient';
import {CodexMailboardView} from './CodexMailboardView';
import {resolveSiteHref} from '../docs-shell';
import {readLocalNetworkAccessState, type LocalNetworkAccessState} from '../local-network-access';

const ACCESS_POLL_INTERVAL_MS = 1500;
const ACCESS_POLL_TIMEOUT_MS = 60_000;

export class CodexMailboardPage {
  private readonly client = new CodexMailClient();
  private readonly view: CodexMailboardView;
  private activeView: CodexMailViewId = 'inbox';
  private availableViews: CodexMailView[] = [];
  private visibleThreads: CodexMailThreadSummary[] = [];
  private selectedThreadId: string | null = null;
  private selectedThreadDetail: CodexMailThreadDetail | null = null;
  private searchQuery = '';
  private unlockPending = false;
  private unlocked = false;
  private composeOpen = false;
  private mailboxLoadVersion = 0;

  constructor(root: HTMLDivElement) {
    this.view = new CodexMailboardView(root, {
      onUnlock: () => {
        void this.handleUnlock();
      },
      onSelectView: (viewId) => {
        void this.handleSelectView(viewId);
      },
      onSelectThread: (threadId) => {
        void this.handleSelectThread(threadId);
      },
      onRefresh: () => {
        void this.reloadMailbox();
      },
      onClearSearch: () => {
        void this.handleClearSearch();
      },
      onSearchSubmit: (query) => {
        void this.handleSearchSubmit(query);
      },
      onToggleCompose: () => {
        this.composeOpen = !this.composeOpen;
        this.view.setComposeOpen(this.composeOpen);
      },
      onApplyThreadAction: (action) => {
        void this.handleThreadAction(action);
      },
      onSendReply: (input) => {
        void this.handleSendReply(input);
      },
      onSendCompose: (input) => {
        void this.handleSendCompose(input);
      },
    });
  }

  public render(): void {
    this.view.render();
    const localDaemon = this.client.usesLocalDaemon();
    if (this.client.needsHostedSetup()) {
      const setupUrl = resolveSiteHref('new-user/');
      this.view.setAuthorizeLink({
        href: setupUrl,
        label: 'Open New User Setup',
      });
      this.view.setUnlockPending(false, 'Open New User Setup');
      this.view.setStatus('Save your hosted Mail Origin on New User before unlocking the shared mailbox.');
      this.view.setMailboxSummary('No hosted mailbox origin is configured for this site yet.');
      this.view.setHealthSummary('Open New User and save a private Mail Origin first.');
      this.view.setAuthSummary('Private-host setup required before Cloudflare Access can begin.');
      this.view.setLockState(true, 'No hosted Mail Origin configured yet. Open New User to continue.');
      this.view.setCurrentViewLabel('Inbox');
      this.view.setSearchQuery('');
      this.view.focusUnlock();
      return;
    }

    this.view.setAuthorizeLink(localDaemon
      ? {
          href: resolveSiteHref('new-user/'),
          label: 'Use Custom Host',
        }
      : {
          href: this.client.getAuthorizeUrl(),
          label: resolveAuthorizeLabel(this.client.getMailOrigin()),
        });
    this.view.setUnlockPending(false, localDaemon ? 'Use This Computer' : 'Unlock With Cloudflare Access');
    this.view.setStatus(localDaemon ? 'Checking this computer...' : 'Waiting for Cloudflare Access.');
    this.view.setMailboxSummary(localDaemon ? 'Shared mailbox appears after this computer responds.' : 'Your hosted mailbox will appear after unlock.');
    this.view.setHealthSummary(`Browser mail origin: ${this.client.getMailOrigin()}`);
    this.view.setAuthSummary(
      localDaemon
        ? 'This page will use the local gmail-agent daemon on this computer.'
        : 'Cloudflare Access required.',
    );
    this.view.setCurrentViewLabel('Inbox');
    this.view.setSearchQuery('');
    this.view.focusUnlock();

    if (localDaemon) {
      void this.prepareLocalMailbox();
    }
  }

  public dispose(): void {
    this.view.dispose();
  }

  private async handleUnlock(): Promise<void> {
    if (this.client.usesLocalDaemon()) {
      await this.connectLocalMailbox();
      return;
    }

    if (this.client.needsHostedSetup()) {
      window.location.assign(resolveSiteHref('new-user/'));
      return;
    }

    if (this.unlockPending) {
      return;
    }

    this.unlockPending = true;
    this.view.setUnlockPending(true, 'Checking Access...');
    this.view.setStatus('Checking Cloudflare Access for your hosted mailbox...');

    try {
      const existingAccess = await this.tryFetchPublicConfig();
      if (existingAccess) {
        await this.adoptUnlockedState(existingAccess.publicOrigin);
        return;
      }

      this.openAuthorizeWindow();
      this.view.setStatus('Finish the Cloudflare Access flow in the opened tab, then return here.');
      this.view.setAuthSummary('Cloudflare Access window opened.');
      this.view.setLockState(true, 'Complete Cloudflare Access in the opened tab, then return here.');

      const publicOrigin = await this.waitForCloudflareAccess();
      await this.adoptUnlockedState(publicOrigin);
    } catch (error) {
      this.unlocked = false;
      this.view.setStatus(readErrorMessage(error, 'Unable to unlock the shared mailbox.'));
      this.view.setAuthSummary('Cloudflare Access is still required.');
      this.view.setLockState(true, readErrorMessage(error, 'Unlock failed.'));
      this.view.focusUnlock();
    } finally {
      this.unlockPending = false;
      this.view.setUnlockPending(false, 'Unlock With Cloudflare Access');
    }
  }

  private async adoptUnlockedState(publicOrigin: string): Promise<void> {
    const localDaemon = this.client.usesLocalDaemon();
    this.unlocked = true;
    this.view.setAuthSummary(
      localDaemon
        ? `Connected to this computer at ${publicOrigin}.`
        : `Cloudflare Access ready for ${publicOrigin}.`,
    );
    this.view.setLockState(false, localDaemon ? 'This computer is connected.' : 'Cloudflare Access active.');
    this.view.setStatus(localDaemon ? 'Loading the shared mailbox from this computer...' : 'Loading your hosted mailbox...');
    await this.reloadMailbox();
  }

  private async reloadMailbox(): Promise<void> {
    if (!this.unlocked) {
      return;
    }

    const mailboxLoadVersion = ++this.mailboxLoadVersion;
    const localDaemon = this.client.usesLocalDaemon();
    let activeViewLabel = resolveViewLabel(this.availableViews, this.activeView);

    this.view.setCurrentViewLabel(activeViewLabel);
    this.view.setSearchQuery(this.searchQuery);
    this.view.setMailboxSummary(
      localDaemon
        ? 'Loading mailbox summary from this computer...'
        : 'Loading hosted mailbox summary...',
    );
    this.view.setHealthSummary(
      `Checking mailbox health at ${this.client.getMailOrigin()}`,
    );
    this.view.setThreadsLoading(
      this.searchQuery
        ? `Searching ${activeViewLabel}...`
        : localDaemon
          ? `Loading ${activeViewLabel} threads from this computer...`
          : `Loading ${activeViewLabel} threads from the shared tunnel...`,
    );

    try {
      const health = await this.client.fetchHealth();
      if (mailboxLoadVersion !== this.mailboxLoadVersion) {
        return;
      }

      this.view.setMailboxSummary(formatMailboxSummary(health));
      this.view.setHealthSummary(formatHealthSummary(health));
      this.view.setSearchQuery(this.searchQuery);
      this.availableViews = health.views;
      activeViewLabel = resolveViewLabel(health.views, this.activeView);
      this.view.setViews(health.views, this.activeView);
      this.view.setCurrentViewLabel(activeViewLabel);

      this.view.setStatus(
        this.searchQuery
          ? `Searching ${activeViewLabel}...`
          : localDaemon
            ? `Connected to this computer. Loading ${activeViewLabel}...`
            : `Cloudflare Access ready. Loading ${activeViewLabel}...`,
      );
      this.view.setThreadsLoading(
        this.searchQuery
          ? `Searching ${activeViewLabel}...`
          : localDaemon
            ? `Loading ${activeViewLabel} threads from this computer...`
            : `Loading ${activeViewLabel} threads from the shared tunnel...`,
      );

      const threads = await this.client.fetchThreads(this.activeView, this.searchQuery);
      if (mailboxLoadVersion !== this.mailboxLoadVersion) {
        return;
      }

      this.visibleThreads = threads;

      this.selectedThreadId = pickSelectedThreadId(threads, this.selectedThreadId);
      this.view.setThreads(threads, this.selectedThreadId);

      if (!this.selectedThreadId) {
        this.selectedThreadDetail = null;
        this.view.setThreadDetail(null);
        this.view.setStatus(
          this.searchQuery
            ? 'No threads matched the current search.'
            : 'This mailbox view is empty right now.',
        );
        return;
      }

      await this.loadThreadDetail(this.selectedThreadId);
      if (mailboxLoadVersion !== this.mailboxLoadVersion) {
        return;
      }

      this.view.setStatus(
        this.searchQuery
          ? `Loaded ${threads.length} matching thread${threads.length === 1 ? '' : 's'} from ${activeViewLabel}.`
          : `Loaded ${threads.length} thread${threads.length === 1 ? '' : 's'} from ${activeViewLabel}.`,
      );
    } catch (error) {
      const message = readErrorMessage(
        error,
        this.client.usesLocalDaemon()
          ? 'Unable to load the shared mailbox from this computer.'
          : 'Unable to load your hosted mailbox.',
      );
      if (mailboxLoadVersion !== this.mailboxLoadVersion) {
        return;
      }

      this.view.setStatus(message);
      this.view.setHealthSummary(message);
      this.view.setThreadsLoading(message);
    }
  }

  private async loadThreadDetail(threadId: string): Promise<void> {
    this.selectedThreadDetail = await this.client.fetchThread(threadId);
    this.view.setThreadDetail(this.selectedThreadDetail);
    this.view.setComposeOpen(this.composeOpen);
  }

  private async handleSelectView(viewId: CodexMailViewId): Promise<void> {
    if (!this.unlocked || this.activeView === viewId) {
      return;
    }

    this.activeView = viewId;
    this.selectedThreadId = null;
    this.selectedThreadDetail = null;
    this.view.setThreadDetail(null);
    this.view.setStatus(`Loading ${resolveViewLabel(this.availableViews, viewId)}...`);
    await this.reloadMailbox();
  }

  private async handleSelectThread(threadId: string): Promise<void> {
    if (!this.unlocked || this.selectedThreadId === threadId) {
      return;
    }

    this.selectedThreadId = threadId;
    this.view.setThreads(this.visibleThreads, this.selectedThreadId);
    this.view.setStatus('Loading thread detail...');

    try {
      await this.loadThreadDetail(threadId);
      this.view.setStatus(`Loaded ${this.selectedThreadDetail?.summary.subject ?? 'thread detail'}.`);
    } catch (error) {
      this.view.setStatus(readErrorMessage(error, 'Unable to load the selected thread.'));
    }
  }

  private async handleSearchSubmit(query: string): Promise<void> {
    if (!this.unlocked) {
      return;
    }

    this.searchQuery = query.trim();
    this.selectedThreadId = null;
    this.selectedThreadDetail = null;
    this.view.setThreadDetail(null);
    this.view.setSearchQuery(this.searchQuery);
    this.view.setStatus(
      this.searchQuery
        ? `Searching ${resolveViewLabel(this.availableViews, this.activeView)}...`
        : `Loading ${resolveViewLabel(this.availableViews, this.activeView)}...`,
    );
    await this.reloadMailbox();
  }

  private async handleClearSearch(): Promise<void> {
    if (!this.unlocked || !this.searchQuery) {
      return;
    }

    this.searchQuery = '';
    this.selectedThreadId = null;
    this.selectedThreadDetail = null;
    this.view.setThreadDetail(null);
    this.view.setSearchQuery('');
    this.view.setStatus(`Loading ${resolveViewLabel(this.availableViews, this.activeView)}...`);
    await this.reloadMailbox();
  }

  private async handleThreadAction(action: CodexMailThreadAction): Promise<void> {
    if (!this.unlocked || !this.selectedThreadId) {
      return;
    }

    this.view.setThreadActionsPending(true);
    this.view.setStatus(`${formatActionLabel(action)}...`);

    try {
      await this.client.applyThreadAction(this.selectedThreadId, action);
      this.view.setStatus(`${formatActionCompleteLabel(action)}.`);
      await this.reloadMailbox();
    } catch (error) {
      this.view.setStatus(readErrorMessage(error, `Unable to ${formatActionLabel(action).toLowerCase()}.`));
    } finally {
      this.view.setThreadActionsPending(false);
    }
  }

  private async handleSendReply(input: {body: string; messageId: string | null}): Promise<void> {
    if (!this.unlocked || !this.selectedThreadId) {
      return;
    }

    const body = input.body.trim();
    if (!body) {
      this.view.setStatus('Type a reply before sending it.');
      return;
    }

    this.view.setReplyPending(true);
    this.view.setStatus('Sending the in-thread reply...');

    try {
      await this.client.replyToThread(this.selectedThreadId, {
        body,
        messageId: input.messageId,
      });
      this.view.clearReplyDraft();
      this.view.setStatus(
        this.client.usesLocalDaemon()
          ? 'Reply sent through this computer.'
          : 'Reply sent through your hosted mailbox service.',
      );
      await this.reloadMailbox();
    } catch (error) {
      this.view.setStatus(readErrorMessage(error, 'Unable to send the reply.'));
    } finally {
      this.view.setReplyPending(false);
    }
  }

  private async handleSendCompose(input: {to: string; subject: string; body: string}): Promise<void> {
    if (!this.unlocked) {
      return;
    }

    const to = input.to.trim();
    const subject = input.subject.trim();
    const body = input.body.trim();

    if (!to || !body) {
      this.view.setStatus('New mail needs a recipient and a body.');
      return;
    }

    this.view.setComposePending(true);
    this.view.setStatus('Sending the new email...');

    try {
      await this.client.composeEmail({to, subject, body});
      this.composeOpen = false;
      this.view.clearComposeDraft();
      this.view.setComposeOpen(false);
      this.view.setStatus(
        this.client.usesLocalDaemon()
          ? 'New email sent through this computer.'
          : 'New email sent through your hosted mailbox service.',
      );
      await this.reloadMailbox();
    } catch (error) {
      this.view.setStatus(readErrorMessage(error, 'Unable to send the new email.'));
    } finally {
      this.view.setComposePending(false);
    }
  }

  private async tryFetchPublicConfig(): Promise<{publicOrigin: string} | null> {
    try {
      const publicConfig = await this.client.fetchPublicConfig();
      return {publicOrigin: publicConfig.publicOrigin};
    } catch (error) {
      if (error instanceof CodexAccessError) {
        return null;
      }

      throw error;
    }
  }

  private async waitForCloudflareAccess(): Promise<string> {
    const deadline = Date.now() + ACCESS_POLL_TIMEOUT_MS;
    let lastErrorMessage = '';

    while (Date.now() < deadline) {
      try {
        const publicConfig = await this.client.fetchPublicConfig();
        return publicConfig.publicOrigin;
      } catch (error) {
        lastErrorMessage = readErrorMessage(error, 'Cloudflare Access is still pending.');
      }

      await delay(ACCESS_POLL_INTERVAL_MS);
    }

    throw new Error(lastErrorMessage || 'Cloudflare Access unlock timed out.');
  }

  private openAuthorizeWindow(): void {
    if (this.client.getMailOrigin() === window.location.origin) {
      return;
    }

    window.open(this.client.getAuthorizeUrl(), '_blank', 'noopener,noreferrer');
  }

  private async connectLocalMailbox(): Promise<void> {
    if (this.unlockPending) {
      return;
    }

    this.unlockPending = true;
    this.view.setUnlockPending(true, 'Checking This Computer...');
    this.view.setStatus('Checking this computer...');
    this.view.setHealthSummary(`Browser mail origin: ${this.client.getMailOrigin()}`);

    try {
      await this.client.fetchPublicConfig();
      await this.adoptUnlockedState(this.client.getMailOrigin());
    } catch (error) {
      this.unlocked = false;
      this.view.setStatus(readErrorMessage(error, 'This computer is not reachable yet.'));
      this.view.setMailboxSummary('Local gmail-agent daemon unavailable.');
      this.view.setHealthSummary(formatLocalMailboxHint(await this.readLocalPermissionState(), this.client.getMailOrigin()));
      this.view.setAuthSummary('Press Use This Computer, or save a custom host on New User.');
      this.view.setLockState(true, formatLocalMailboxHint(await this.readLocalPermissionState(), this.client.getMailOrigin()));
      this.view.focusUnlock();
    } finally {
      this.unlockPending = false;
      this.view.setUnlockPending(false, this.unlocked ? 'Connected' : 'Retry This Computer');
    }
  }

  private async prepareLocalMailbox(): Promise<void> {
    if (!this.requiresLocalNetworkPermission()) {
      await this.connectLocalMailbox();
      return;
    }

    const permissionState = await this.readLocalPermissionState();
    const hint = formatLocalMailboxHint(permissionState, this.client.getMailOrigin());

    this.view.setStatus(hint);
    this.view.setMailboxSummary('Shared mailbox appears after this computer allows local access.');
    this.view.setHealthSummary(hint);
    this.view.setAuthSummary(
      permissionState === 'granted'
        ? 'Local network access is already granted for this site.'
        : 'Press Use This Computer to let Chrome request access to the local daemon.',
    );
    this.view.setLockState(true, hint);

    if (permissionState === 'granted') {
      await this.connectLocalMailbox();
    }
  }

  private requiresLocalNetworkPermission(): boolean {
    return window.location.hostname.endsWith('github.io') && this.client.usesLocalDaemon();
  }

  private async readLocalPermissionState(): Promise<LocalNetworkAccessState> {
    return await readLocalNetworkAccessState(this.client.getMailOrigin());
  }
}

function formatMailboxSummary(health: CodexMailHealth): string {
  const mailbox = health.mailbox;
  if (!mailbox) {
    return 'Shared daemon mailbox unavailable.';
  }

  return mailbox.displayName
    ? `${mailbox.displayName} <${mailbox.emailAddress}>`
    : mailbox.emailAddress;
}

function formatHealthSummary(health: CodexMailHealth): string {
  const queueDepth = health.counts.queueDepth;
  const runtimeOrigin = typeof health.runtime.publicOrigin === 'string' ? health.runtime.publicOrigin : 'local';
  return `${health.counts.threads} mailbox threads | ${health.counts.tasks} codex tasks | queue ${queueDepth} | origin ${runtimeOrigin}`;
}

function resolveViewLabel(views: CodexMailView[], activeView: CodexMailViewId): string {
  return views.find((view) => view.id === activeView)?.label ?? DEFAULT_VIEW_LABELS[activeView];
}

const DEFAULT_VIEW_LABELS: Record<CodexMailViewId, string> = {
  'all-mail': 'All Mail',
  codex: 'Codex',
  inbox: 'Inbox',
  sent: 'Sent',
  starred: 'Starred',
  unread: 'Unread',
};

function pickSelectedThreadId(
  threads: CodexMailThreadSummary[],
  previousThreadId: string | null,
): string | null {
  if (threads.length === 0) {
    return null;
  }

  if (previousThreadId && threads.some((thread) => thread.threadId === previousThreadId)) {
    return previousThreadId;
  }

  return threads[0]?.threadId ?? null;
}

function formatActionLabel(action: CodexMailThreadAction): string {
  switch (action) {
    case 'mark-read':
      return 'Marking the thread as read';
    case 'mark-unread':
      return 'Marking the thread as unread';
    case 'star':
      return 'Starring the thread';
    case 'unstar':
      return 'Removing the thread star';
    case 'archive':
      return 'Archiving the thread';
    case 'move-to-inbox':
      return 'Moving the thread back to Inbox';
  }
}

function formatActionCompleteLabel(action: CodexMailThreadAction): string {
  switch (action) {
    case 'mark-read':
      return 'Marked the thread as read';
    case 'mark-unread':
      return 'Marked the thread as unread';
    case 'star':
      return 'Starred the thread';
    case 'unstar':
      return 'Removed the thread star';
    case 'archive':
      return 'Archived the thread';
    case 'move-to-inbox':
      return 'Moved the thread back to Inbox';
  }
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function resolveAuthorizeLabel(origin: string): string {
  const hostname = new URL(origin).hostname;
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return 'Open Shared Mail Origin';
  }

  return 'Sign In With Cloudflare';
}

function formatLocalMailboxHint(
  permissionState: LocalNetworkAccessState,
  origin: string,
): string {
  switch (permissionState) {
    case 'granted':
      return `This site can reach ${origin}.`;
    case 'denied':
      return 'Chrome denied local network access. Press Use This Computer after allowing this site to talk to local devices.';
    case 'prompt':
      return 'Press Use This Computer, then allow local network access in Chrome.';
    case 'unsupported':
    default:
      return `Press Use This Computer to check ${origin}.`;
  }
}
