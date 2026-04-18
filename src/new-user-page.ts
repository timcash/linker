import {createSiteMenu, resolveSiteHref} from './docs-shell';
import {
  DEFAULT_REMOTE_AUTH_ORIGIN,
  DEFAULT_REMOTE_MAIL_ORIGIN,
  DEFAULT_REPO_URL,
  readConfiguredRepoUrl,
} from './remote-config';
import {
  readStoredAppSettings,
  subscribeStoredAppSettings,
  writeStoredAppSettings,
} from './site-settings';

export type NewUserPageHandle = {
  destroy: () => void;
};

export function startNewUserPage(root: HTMLElement): Promise<NewUserPageHandle> {
  document.title = 'Linker New User';
  document.body.classList.add('docs-route', 'new-user-route');
  root.classList.add('new-user-page-root');

  const page = new NewUserPage(root);
  page.render();

  return Promise.resolve({
    destroy: () => {
      page.destroy();
      document.body.classList.remove('docs-route', 'new-user-route');
      root.classList.remove('new-user-page-root');
      root.replaceChildren();
    },
  });
}

class NewUserPage {
  private readonly root: HTMLElement;
  private readonly siteMenu = createSiteMenu('new-user');
  private currentSettings = readStoredAppSettings();
  private cleanupSettingsSubscription: (() => void) | null = null;
  private repoInput: HTMLInputElement | null = null;
  private authInput: HTMLInputElement | null = null;
  private mailInput: HTMLInputElement | null = null;
  private statusMessage: HTMLParagraphElement | null = null;
  private effectiveRepoValue: HTMLParagraphElement | null = null;
  private effectiveAuthValue: HTMLParagraphElement | null = null;
  private effectiveMailValue: HTMLParagraphElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  public render(): void {
    const shell = document.createElement('main');
    shell.className = 'page-shell docs-page new-user-page';
    shell.dataset.testid = 'new-user-page';

    shell.innerHTML = `
      <header class="hero docs-hero new-user-hero">
        <p class="eyebrow">New User</p>
        <h1>Set a custom host.</h1>
        <p class="lede">
          Leave Auth and Mail blank to use This Computer. Save values here only if you want a different server.
        </p>
      </header>

      <section class="new-user-stack">
        <section class="new-user-card">
          <form class="new-user-config-form" data-new-user-config-form>
            <label class="new-user-field">
              <span class="new-user-field-label">Repository URL</span>
              <input class="new-user-input" type="url" data-new-user-repo-input placeholder="${DEFAULT_REPO_URL}" />
              <span class="new-user-field-help">Used for the GitHub link in the menu.</span>
            </label>
            <label class="new-user-field">
              <span class="new-user-field-label">Auth Origin</span>
              <input class="new-user-input" type="url" data-new-user-auth-input placeholder="${DEFAULT_REMOTE_AUTH_ORIGIN}" />
              <span class="new-user-field-help">Optional.</span>
            </label>
            <label class="new-user-field">
              <span class="new-user-field-label">Mail Origin</span>
              <input class="new-user-input" type="url" data-new-user-mail-input placeholder="${DEFAULT_REMOTE_MAIL_ORIGIN}" />
              <span class="new-user-field-help">Optional.</span>
            </label>
            <nav class="new-user-action-row" aria-label="New user configuration actions">
              <button class="new-user-button new-user-button--primary" type="submit">Save</button>
              <button class="new-user-button" type="button" data-new-user-reset>Reset</button>
            </nav>
            <p class="new-user-status" data-new-user-status>Ready.</p>
          </form>
        </section>

        <section class="new-user-card">
          <h2>Current</h2>
          <section class="new-user-summary" aria-label="Configured targets">
            <article class="new-user-summary-row">
              <span class="new-user-field-label">Repo</span>
              <p data-new-user-effective-repo></p>
            </article>
            <article class="new-user-summary-row">
              <span class="new-user-field-label">Auth</span>
              <p data-new-user-effective-auth></p>
            </article>
            <article class="new-user-summary-row">
              <span class="new-user-field-label">Mail</span>
              <p data-new-user-effective-mail></p>
            </article>
          </section>
        </section>

        <nav class="new-user-link-grid" aria-label="Verification routes">
          <a class="site-menu-link site-menu-link--action" href="${resolveSiteHref('./?onboarding=1')}">
            <span class="site-menu-link-label">Open App</span>
            <span class="site-menu-link-meta">Onboarding</span>
          </a>
          <a class="site-menu-link site-menu-link--action" href="${resolveSiteHref('auth/')}">
            <span class="site-menu-link-label">Open Auth</span>
            <span class="site-menu-link-meta">Check</span>
          </a>
          <a class="site-menu-link site-menu-link--action" href="${resolveSiteHref('codex/')}">
            <span class="site-menu-link-label">Open Codex</span>
            <span class="site-menu-link-meta">Mailboard</span>
          </a>
        </nav>
      </section>
    `;

    shell.append(this.siteMenu.element);
    this.root.replaceChildren(shell);

    this.repoInput = shell.querySelector('[data-new-user-repo-input]');
    this.authInput = shell.querySelector('[data-new-user-auth-input]');
    this.mailInput = shell.querySelector('[data-new-user-mail-input]');
    this.statusMessage = shell.querySelector('[data-new-user-status]');
    this.effectiveRepoValue = shell.querySelector('[data-new-user-effective-repo]');
    this.effectiveAuthValue = shell.querySelector('[data-new-user-effective-auth]');
    this.effectiveMailValue = shell.querySelector('[data-new-user-effective-mail]');

    shell
      .querySelector<HTMLFormElement>('[data-new-user-config-form]')
      ?.addEventListener('submit', this.handleSave);
    shell
      .querySelector<HTMLButtonElement>('[data-new-user-reset]')
      ?.addEventListener('click', this.handleReset);

    this.syncFields();
    this.cleanupSettingsSubscription = subscribeStoredAppSettings((settings) => {
      this.currentSettings = settings;
      this.syncFields();
    });
  }

  public destroy(): void {
    this.cleanupSettingsSubscription?.();
    this.cleanupSettingsSubscription = null;
    this.siteMenu.destroy();
  }

  private readonly handleSave = (event: Event): void => {
    event.preventDefault();
    this.currentSettings = writeStoredAppSettings({
      authOrigin: this.authInput?.value ?? '',
      mailOrigin: this.mailInput?.value ?? '',
      repoUrl: this.repoInput?.value ?? '',
    });
    this.setStatus('Saved custom host settings for this browser.');
    this.syncFields();
  };

  private readonly handleReset = (): void => {
    this.currentSettings = writeStoredAppSettings({
      authOrigin: '',
      mailOrigin: '',
      repoUrl: '',
    });
    this.setStatus('Cleared custom host settings. This Computer is active again.');
    this.syncFields();
  };

  private syncFields(): void {
    if (this.repoInput) {
      this.repoInput.value = this.currentSettings.repoUrl;
    }

    if (this.authInput) {
      this.authInput.value = this.currentSettings.authOrigin;
    }

    if (this.mailInput) {
      this.mailInput.value = this.currentSettings.mailOrigin;
    }

    if (this.effectiveRepoValue) {
      this.effectiveRepoValue.textContent = readConfiguredRepoUrl(
        import.meta.env.VITE_LINKER_REPO_URL as string | undefined,
      );
    }

    if (this.effectiveAuthValue) {
      this.effectiveAuthValue.textContent = this.currentSettings.authOrigin || 'This Computer';
    }

    if (this.effectiveMailValue) {
      this.effectiveMailValue.textContent = this.currentSettings.mailOrigin || 'This Computer';
    }
  }

  private setStatus(message: string): void {
    if (this.statusMessage) {
      this.statusMessage.textContent = message;
    }
  }
}
