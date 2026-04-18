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
        <h1>Bring your own private Linker host.</h1>
        <p class="lede">
          Keep the DAG onboarding visual and local, then point the sign-in routes at your own protected auth and mail origins.
          Nothing here needs a personal domain hardcoded into the repo.
        </p>
      </header>

      <section class="section docs-section">
        <p class="section-label">Onboarding Strategy</p>
        <h2>Make the first ten minutes obvious.</h2>
        <div class="new-user-grid">
          <section class="new-user-card">
            <h3>3D DAG first</h3>
            <p>
              Start in the root DAG, title a few workplanes immediately, and show the square-symbol, title-only, label-point,
              and full-workplane LOD bands before dropping into a single 2D edit.
            </p>
          </section>
          <section class="new-user-card">
            <h3>One sign-in path</h3>
            <p>
              Treat auth as one simple unlock story: set your auth origin once, verify it on <code>/auth/</code>, then let
              <code>/codex/</code> reuse the same protected host instead of asking for a second secret.
            </p>
          </section>
          <section class="new-user-card">
            <h3>Calculator controls</h3>
            <p>
              Keep the <code>3x3</code> menu, hotkeys, and title field visible while onboarding runs so users learn the real controls,
              not a separate tutorial-only UI.
            </p>
          </section>
        </div>
      </section>

      <section class="section docs-section">
        <p class="section-label">Private Host Setup</p>
        <h2>Store your own origins locally on this device.</h2>
        <p>
          These values live in local browser settings, not in the repo. Leave a field blank to fall back to the generic project defaults.
        </p>
        <form class="new-user-config-form" data-new-user-config-form>
          <label class="new-user-field">
            <span class="new-user-field-label">Repository URL</span>
            <input class="new-user-input" type="url" data-new-user-repo-input placeholder="${DEFAULT_REPO_URL}" />
            <span class="new-user-field-help">Used by the menu GitHub link and README markdown fallbacks.</span>
          </label>
          <label class="new-user-field">
            <span class="new-user-field-label">Auth Origin</span>
            <input class="new-user-input" type="url" data-new-user-auth-input placeholder="${DEFAULT_REMOTE_AUTH_ORIGIN}" />
            <span class="new-user-field-help">Cloudflare Access or any equivalent protected auth host for <code>/auth/</code>.</span>
          </label>
          <label class="new-user-field">
            <span class="new-user-field-label">Mail Origin</span>
            <input class="new-user-input" type="url" data-new-user-mail-input placeholder="${DEFAULT_REMOTE_MAIL_ORIGIN}" />
            <span class="new-user-field-help">Hosted mail API or Codex origin for the <code>/codex/</code> inbox client.</span>
          </label>
          <nav class="new-user-action-row" aria-label="New user configuration actions">
            <button class="new-user-button new-user-button--primary" type="submit">Save Local Settings</button>
            <button class="new-user-button" type="button" data-new-user-reset>Reset To Generic Defaults</button>
          </nav>
          <p class="new-user-status" data-new-user-status>Ready.</p>
        </form>
      </section>

      <section class="section docs-section">
        <p class="section-label">Configured Targets</p>
        <h2>Check the hosted values this browser will reuse.</h2>
        <div class="new-user-grid">
          <section class="new-user-card">
            <h3>Repo</h3>
            <p data-new-user-effective-repo></p>
          </section>
          <section class="new-user-card">
            <h3>Auth</h3>
            <p data-new-user-effective-auth></p>
          </section>
          <section class="new-user-card">
            <h3>Mail</h3>
            <p data-new-user-effective-mail></p>
          </section>
        </div>
        <nav class="new-user-link-grid" aria-label="Verification routes">
          <a class="site-menu-link site-menu-link--action" href="${resolveSiteHref('./?onboarding=1')}">
            <span class="site-menu-link-label">Replay DAG Onboarding</span>
            <span class="site-menu-link-meta">3D first</span>
          </a>
          <a class="site-menu-link site-menu-link--action" href="${resolveSiteHref('auth/')}">
            <span class="site-menu-link-label">Open Auth Check</span>
            <span class="site-menu-link-meta">Session verify</span>
          </a>
          <a class="site-menu-link site-menu-link--action" href="${resolveSiteHref('codex/')}">
            <span class="site-menu-link-label">Open Mailboard</span>
            <span class="site-menu-link-meta">Unlock + inbox</span>
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
    this.setStatus('Saved local private-host settings for this browser.');
    this.syncFields();
  };

  private readonly handleReset = (): void => {
    this.currentSettings = writeStoredAppSettings({
      authOrigin: '',
      mailOrigin: '',
      repoUrl: '',
    });
    this.setStatus('Cleared local overrides. Generic project defaults are active again.');
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
      this.effectiveAuthValue.textContent = this.currentSettings.authOrigin || DEFAULT_REMOTE_AUTH_ORIGIN;
    }

    if (this.effectiveMailValue) {
      this.effectiveMailValue.textContent = this.currentSettings.mailOrigin || DEFAULT_REMOTE_MAIL_ORIGIN;
    }
  }

  private setStatus(message: string): void {
    if (this.statusMessage) {
      this.statusMessage.textContent = message;
    }
  }
}
