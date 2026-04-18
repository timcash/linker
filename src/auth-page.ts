import {createSiteMenu, resolveSiteHref, type SiteMenuHandle} from './docs-shell';
import {
  hasExplicitConfiguredOrigin,
  isLoopbackOrigin,
  normalizeAbsoluteHttpUrl,
  readConfiguredAuthOrigin,
} from './remote-config';
import {readLocalNetworkAccessState, withLocalNetworkAccess} from './local-network-access';
import {readStoredAppSettings} from './site-settings';

type AuthMode = 'auto' | 'auth' | 'dev';
type AuthPhase = 'authorized' | 'checking' | 'error' | 'idle' | 'signed-out';
type AuthSurface = 'auth' | 'mail';

type PublicAuthConfigResponse = {
  loginPath: string;
  logoutPath: string;
  ok: boolean;
  providerLabel: string;
  publicOrigin: string;
  sessionLabel: string;
  sessionPath: string;
};

type AuthSessionResponse = {
  authenticated: boolean;
  expiresAt?: string;
  ok: boolean;
  sessionLabel?: string;
  subject?: string;
};

type MailPublicConfigResponse = {
  authRequired: boolean;
  ok: boolean;
  publicOrigin: string;
};

type MailHealthResponse = {
  counts?: {
    threads?: number;
  };
  mailbox?: {
    displayName?: string;
    emailAddress: string;
  } | null;
  ok: boolean;
};

type AccessConfigResponse = PublicAuthConfigResponse & {
  surface: AuthSurface;
};

type AuthPageElements = {
  authorizeButton: HTMLButtonElement;
  checkSessionButton: HTMLButtonElement;
  healthValue: HTMLParagraphElement;
  logHost: HTMLDivElement;
  modeButtons: HTMLButtonElement[];
  modeValue: HTMLParagraphElement;
  originValue: HTMLParagraphElement;
  signOutButton: HTMLButtonElement;
  stateValue: HTMLParagraphElement;
};

const MODE_STORAGE_KEY = 'linker.auth.mode';
const AUTH_CONFIG_PATH = '/api/auth/public-config';
const AUTH_SESSION_PATH = '/api/auth/session';
const MAIL_CONFIG_PATH = '/api/mail/public-config';
const MAIL_HEALTH_PATH = '/api/mail/health';
const DEFAULT_LOGIN_PATH = '/codex/';
const CLOUDFLARE_LOGOUT_PATH = '/cdn-cgi/access/logout';
const CONFIG_TIMEOUT_MS = 4000;

export type AuthPageHandle = {
  destroy: () => void;
};

export async function startAuthPage(root: HTMLElement): Promise<AuthPageHandle> {
  document.title = 'Linker Auth';
  document.body.classList.add('docs-route', 'auth-route');
  root.classList.add('auth-page-root');

  const page = new AuthPage(root);
  await page.render();

  return {
    destroy: () => {
      page.destroy();
      document.body.classList.remove('docs-route', 'auth-route');
      root.classList.remove('auth-page-root');
      root.replaceChildren();
    },
  };
}

class AuthPage {
  private readonly root: HTMLElement;
  private mode: AuthMode = 'auto';
  private activeConfig: AccessConfigResponse | null = null;
  private elements: AuthPageElements | null = null;
  private siteMenu: SiteMenuHandle | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.mode = this.resolveInitialMode();
  }

  public async render(): Promise<void> {
    this.siteMenu = createSiteMenu('auth');
    const shell = document.createElement('main');
    shell.className = 'page-shell docs-page auth-page auth-shell';
    shell.dataset.testid = 'auth-page';

    shell.innerHTML = `
      <header class="docs-hero auth-hero">
        <p class="eyebrow">Auth</p>
        <h1>Connect Linker to this computer.</h1>
        <p class="lede">
          Use This Computer for the shared local daemon. Save a custom host only if you want a different Linker server.
        </p>
      </header>

      <section class="auth-stack">
        <article class="auth-card">
          <span class="auth-label">Mode</span>
          <p class="auth-value" data-auth-mode-summary></p>
          <nav class="auth-mode-toggle" role="group" aria-label="Linker auth mode">
            <button type="button" class="auth-mode-btn" data-auth-mode-button="auto">This Computer</button>
            <button type="button" class="auth-mode-btn" data-auth-mode-button="auth">Saved Host</button>
            <button type="button" class="auth-mode-btn" data-auth-mode-button="dev">This Tab</button>
          </nav>
        </article>

        <article class="auth-card">
          <section class="auth-summary" aria-label="Auth status">
            <article class="auth-summary-item">
              <span class="auth-label">State</span>
              <p class="auth-value" data-auth-status>Idle.</p>
            </article>
            <article class="auth-summary-item">
              <span class="auth-label">Target</span>
              <p class="auth-value" data-auth-origin>Resolving...</p>
            </article>
            <article class="auth-summary-item">
              <span class="auth-label">Health</span>
              <p class="auth-value" data-auth-health>Checking config route...</p>
            </article>
          </section>
        </article>

        <nav class="auth-toolbar" aria-label="Auth actions">
          <button type="button" class="auth-action auth-action--primary" data-auth-authorize>Open Codex</button>
          <button type="button" class="auth-action" data-auth-check-session>Check Connection</button>
          <button type="button" class="auth-action" data-auth-sign-out>Sign Out</button>
        </nav>

        <article class="auth-card auth-card--log">
          <span class="auth-label">Recent</span>
          <div class="auth-log" data-auth-log></div>
        </article>
      </section>
    `;

    shell.append(this.siteMenu.element);
    this.root.replaceChildren(shell);

    this.elements = {
      authorizeButton: this.root.querySelector('[data-auth-authorize]') as HTMLButtonElement,
      checkSessionButton: this.root.querySelector('[data-auth-check-session]') as HTMLButtonElement,
      healthValue: this.root.querySelector('[data-auth-health]') as HTMLParagraphElement,
      logHost: this.root.querySelector('[data-auth-log]') as HTMLDivElement,
      modeButtons: Array.from(this.root.querySelectorAll('[data-auth-mode-button]')),
      modeValue: this.root.querySelector('[data-auth-mode-summary]') as HTMLParagraphElement,
      originValue: this.root.querySelector('[data-auth-origin]') as HTMLParagraphElement,
      signOutButton: this.root.querySelector('[data-auth-sign-out]') as HTMLButtonElement,
      stateValue: this.root.querySelector('[data-auth-status]') as HTMLParagraphElement,
    };

    this.elements.modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.authModeButton;
        if (nextMode === 'auto' || nextMode === 'dev' || nextMode === 'auth') {
          void this.setMode(nextMode);
        }
      });
    });

    this.elements.authorizeButton.addEventListener('click', () => {
      this.openAccessLogin();
    });

    this.elements.checkSessionButton.addEventListener('click', () => {
      void this.checkSession();
    });

    this.elements.signOutButton.addEventListener('click', () => {
      this.openSignOut();
    });

    this.syncModeUi();
    await this.refreshConfig();
    this.setAuthPhase('idle', 'Ready. Open Codex or check the connection.');
    this.appendLog('system', 'Auth page loaded.');
  }

  public destroy(): void {
    this.siteMenu?.destroy();
    this.siteMenu = null;
    this.elements = null;
  }

  private async setMode(mode: AuthMode): Promise<void> {
    if (mode === this.mode) {
      return;
    }

    this.mode = mode;
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    this.activeConfig = null;
    this.syncModeUi();
    await this.refreshConfig();
    this.setAuthPhase('idle', `Switched to ${modeLabelMap[mode]}.`);
    this.appendLog('system', `Mode switched to ${modeLabelMap[mode]}.`);
  }

  private async refreshConfig(): Promise<void> {
    const origin = this.resolveHttpOrigin();
    const localTarget = isLoopbackOrigin(origin);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);

    this.activeConfig = null;
    this.syncActionButtons(origin);

    if (this.requiresHostedSetup(origin)) {
      this.setOriginText('No saved custom host is configured yet.');
      this.setHealthText('Open New User only if you want a custom host instead of This Computer.');
      this.appendLog('system', 'Saved-host setup is empty. This Computer mode is still available.');
      window.clearTimeout(timeout);
      return;
    }

    if (this.requiresLocalNetworkPermission(origin)) {
      const permissionState = await readLocalNetworkAccessState(origin);
      this.setOriginText(`${origin} -> this computer`);
      this.setHealthText(formatLocalPermissionHint(permissionState));
      this.syncActionButtons(origin);
      return;
    }

    this.setOriginText(localTarget ? `${origin} -> local mail daemon` : `${origin} -> checking access`);
    this.setHealthText(localTarget ? 'Checking this computer...' : 'Checking saved host...');

    try {
      const config = await this.fetchAccessConfig(origin, controller.signal);
      this.activeConfig = config;
      this.setOriginText(localTarget ? `${origin} -> ${config.sessionPath}` : `${config.publicOrigin} -> ${config.sessionPath}`);
      this.setHealthText(
        localTarget
          ? 'This computer is reachable.'
          : `Reachable. ${config.sessionLabel} via ${config.providerLabel}.`,
      );
      this.appendLog(
        'system',
        localTarget
          ? `Connected to this computer at ${origin}.`
          : `Config route is reachable at ${config.publicOrigin}${config.sessionPath}.`,
      );
      this.syncActionButtons(origin);
    } catch (error) {
      if (localTarget) {
        this.setHealthText('This computer is not reachable yet. Start gmail-agent here, then check again.');
        this.appendLog('system', 'The local mail daemon is not reachable yet.');
      } else
      if (this.requiresRemoteAccessLogin(origin)) {
        this.setHealthText(
          'Sign in to the saved host, then return here and check the connection again.',
        );
        this.appendLog('system', 'Saved-host access is likely required before the config route can be reached.');
      } else {
        this.setHealthText(readErrorMessage(error, 'The target origin is not reachable yet.'));
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private async checkSession(openCodexOnSuccess = false): Promise<void> {
    const origin = this.resolveHttpOrigin();
    const localTarget = isLoopbackOrigin(origin);
    this.setAuthPhase('checking', 'Checking the session route...');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);

    try {
      if (localTarget && !this.activeConfig) {
        const config = await this.fetchAccessConfig(origin, controller.signal);
        this.activeConfig = config;
        this.setOriginText(`${origin} -> ${config.sessionPath}`);
        this.setHealthText('This computer is reachable.');
        this.syncActionButtons(origin);
      }

      const sessionUrl = this.resolveHttpUrl(
        this.activeConfig?.sessionPath ?? AUTH_SESSION_PATH,
        origin,
      );
        const response = await fetch(sessionUrl, {
          headers: {
            Accept: 'application/json',
          },
          ...(this.requiresLocalNetworkPermission(origin) ? withLocalNetworkAccess({}, origin) : {}),
          mode: 'cors',
          signal: controller.signal,
        });

      if (!response.ok) {
        throw new Error(`Session request failed with status ${response.status}.`);
      }

      if (this.activeConfig?.surface === 'mail') {
        const health = (await response.json()) as MailHealthResponse;
        if (!health.ok) {
          throw new Error('Hosted mail health did not report ok.');
        }

        const detail = [
          localTarget ? 'This computer is connected.' : 'Saved host authorized.',
          health.mailbox?.emailAddress ? `Mailbox ${health.mailbox.emailAddress}.` : '',
          typeof health.counts?.threads === 'number' ? `${health.counts.threads} tracked threads.` : '',
        ]
          .filter((value) => value.length > 0)
          .join(' ');

        this.setAuthPhase('authorized', detail);
        this.appendLog('remote', detail);

        if (openCodexOnSuccess) {
          window.location.assign(resolveSiteHref('codex/'));
          return;
        }
      } else {
        const session = (await response.json()) as AuthSessionResponse;

        if (session.authenticated) {
          const detail = [
            session.sessionLabel ?? 'Authorized.',
            session.subject ? `User ${session.subject}.` : '',
            session.expiresAt ? `Expires ${session.expiresAt}.` : '',
          ]
            .filter((value) => value.length > 0)
            .join(' ');

          this.setAuthPhase('authorized', detail);
          this.appendLog('remote', detail);
        } else {
          this.setAuthPhase('signed-out', 'No active session was reported.');
          this.appendLog('system', 'Session check reported no active login.');
        }
      }
    } catch (error) {
      this.setAuthPhase('error', readErrorMessage(error, 'Unable to check the session route.'));
      this.appendLog('system', readErrorMessage(error, 'Unable to check the session route.'));
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private syncModeUi(): void {
    if (!this.elements) {
      return;
    }

    this.elements.modeValue.textContent = modeCopyMap[this.mode];
    this.syncActionButtons();

    this.elements.modeButtons.forEach((button) => {
      const isActive = button.dataset.authModeButton === this.mode;
      button.classList.toggle('auth-mode-btn--active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  private setAuthPhase(phase: AuthPhase, detail: string): void {
    if (!this.elements) {
      return;
    }

    this.elements.stateValue.textContent = `${phaseLabelMap[phase]} ${detail}`;
    this.elements.checkSessionButton.disabled = phase === 'checking';
  }

  private setOriginText(summary: string): void {
    if (this.elements) {
      this.elements.originValue.textContent = summary;
    }
  }

  private setHealthText(summary: string): void {
    if (this.elements) {
      this.elements.healthValue.textContent = summary;
    }
  }

  private openAccessLogin(): void {
    const origin = this.resolveHttpOrigin();
    const localTarget = isLoopbackOrigin(origin);

    if (localTarget) {
      if (this.activeConfig) {
        const codexUrl = resolveSiteHref('codex/');
        window.location.assign(codexUrl);
        this.appendLog('system', `Opened ${codexUrl}.`);
      } else {
        void this.checkSession(true);
      }
      return;
    }

    if (this.requiresHostedSetup()) {
      const setupUrl = resolveSiteHref('new-user/');
      window.location.assign(setupUrl);
      this.appendLog('system', `Opened ${setupUrl} so you can save a custom host first.`);
      return;
    }

    const accessUrl = this.resolveHttpUrl(
      this.activeConfig?.loginPath ?? DEFAULT_LOGIN_PATH,
      this.resolveHttpOrigin(),
    );
    window.open(accessUrl, '_blank', 'noopener,noreferrer');
    this.appendLog('system', `Opened ${accessUrl}. Finish the access flow there, then return here and check the session.`);
  }

  private openSignOut(): void {
    if (isLoopbackOrigin(this.resolveHttpOrigin()) || this.requiresHostedSetup()) {
      return;
    }

    const logoutUrl = this.resolveHttpUrl(
      this.activeConfig?.logoutPath ?? CLOUDFLARE_LOGOUT_PATH,
      this.resolveHttpOrigin(),
    );
    window.open(logoutUrl, '_blank', 'noopener,noreferrer');
    this.appendLog('system', `Opened ${logoutUrl}. Finish sign-out there, then return here and check the session again.`);
  }

  private appendLog(kind: 'remote' | 'system', text: string): void {
    if (!this.elements) {
      return;
    }

    const entry = document.createElement('div');
    entry.className = `auth-log-entry auth-log-entry--${kind}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    this.elements.logHost.append(entry);

    while (this.elements.logHost.childElementCount > 4) {
      this.elements.logHost.firstElementChild?.remove();
    }

    this.elements.logHost.scrollTop = this.elements.logHost.scrollHeight;
  }

  private resolveInitialMode(): AuthMode {
    const requestedMode = new URLSearchParams(window.location.search).get('mode');

    if (requestedMode === 'auto' || requestedMode === 'dev' || requestedMode === 'auth') {
      return requestedMode;
    }

    const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);

    if (storedMode === 'auto' || storedMode === 'dev' || storedMode === 'auth') {
      return storedMode;
    }

    return 'auto';
  }

  private resolveHttpOrigin(): string {
    const configuredOrigin = this.resolveRemoteAccessOrigin();

    switch (this.mode) {
      case 'dev':
        return window.location.origin;
      case 'auth':
        return configuredOrigin;
      case 'auto':
      default:
        return window.location.hostname.endsWith('github.io') ? configuredOrigin : window.location.origin;
    }
  }

  private resolveHttpUrl(pathname: string, origin = this.resolveHttpOrigin()): string {
    try {
      return new URL(pathname).toString();
    } catch (error) {
      void error;
    }

    const url = new URL(origin);
    url.pathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
    url.search = '';
    return url.toString();
  }

  private requiresRemoteAccessLogin(origin = this.resolveHttpOrigin()): boolean {
    return origin !== window.location.origin;
  }

  private requiresHostedSetup(origin = this.resolveHttpOrigin()): boolean {
    if (!window.location.hostname.endsWith('github.io')) {
      return false;
    }

    if (isLoopbackOrigin(origin)) {
      return false;
    }

    if (!this.requiresRemoteAccessLogin(origin)) {
      return false;
    }

    return !hasExplicitConfiguredOrigin({
      configuredOrigin:
        (import.meta.env.VITE_LINKER_AUTH_ORIGIN as string | undefined) ||
        (import.meta.env.VITE_CODEX_MAIL_URL as string | undefined),
      storedOrigin: readStoredAppSettings().authOrigin || readStoredAppSettings().mailOrigin,
    });
  }

  private syncActionButtons(origin = this.resolveHttpOrigin()): void {
    if (!this.elements) {
      return;
    }

    const localTarget = isLoopbackOrigin(origin);
    const needsRemoteLogin = this.requiresRemoteAccessLogin(origin);
    const needsHostedSetup = this.requiresHostedSetup(origin);

    this.elements.authorizeButton.hidden = false;
    this.elements.authorizeButton.textContent = localTarget
      ? this.activeConfig
        ? 'Open Codex'
        : 'Connect This Computer'
      : needsHostedSetup
        ? 'Open New User'
        : 'Sign In';
    this.elements.checkSessionButton.textContent = localTarget ? 'Check This Computer' : 'Check Connection';
    this.elements.signOutButton.hidden = localTarget || !needsRemoteLogin || needsHostedSetup;
  }

  private resolveRemoteAccessOrigin(): string {
    const storedSettings = readStoredAppSettings();
    const explicitOrigin =
      normalizeAbsoluteHttpUrl(storedSettings.authOrigin) ||
      normalizeAbsoluteHttpUrl(storedSettings.mailOrigin) ||
      normalizeAbsoluteHttpUrl(import.meta.env.VITE_LINKER_AUTH_ORIGIN as string | undefined) ||
      normalizeAbsoluteHttpUrl(import.meta.env.VITE_CODEX_MAIL_URL as string | undefined);

    return readConfiguredAuthOrigin({
      configuredOrigin: explicitOrigin,
      hostname: window.location.hostname,
      locationOrigin: window.location.origin,
    });
  }

  private async fetchAccessConfig(origin: string, signal: AbortSignal): Promise<AccessConfigResponse> {
    try {
      const response = await fetch(this.resolveHttpUrl(AUTH_CONFIG_PATH, origin), {
        headers: {
          Accept: 'application/json',
        },
        ...(this.requiresLocalNetworkPermission(origin) ? withLocalNetworkAccess({}, origin) : {}),
        mode: 'cors',
        signal,
      });

      if (!response.ok) {
        throw new Error(`Auth config request failed with status ${response.status}.`);
      }

      const config = (await response.json()) as PublicAuthConfigResponse;
      return {
        ...config,
        surface: 'auth',
      };
    } catch (authError) {
      const response = await fetch(this.resolveHttpUrl(MAIL_CONFIG_PATH, origin), {
        headers: {
          Accept: 'application/json',
        },
        ...(this.requiresLocalNetworkPermission(origin) ? withLocalNetworkAccess({}, origin) : {}),
        mode: 'cors',
        signal,
      });

      if (!response.ok) {
        throw authError;
      }

      const config = (await response.json()) as MailPublicConfigResponse;
      const publicOrigin = config.publicOrigin || origin;
      return {
        loginPath: DEFAULT_LOGIN_PATH,
        logoutPath: CLOUDFLARE_LOGOUT_PATH,
        ok: true,
        providerLabel: 'Cloudflare Access',
        publicOrigin,
        sessionLabel: 'Hosted mail API reachable.',
        sessionPath: MAIL_HEALTH_PATH,
        surface: 'mail',
      };
    }
  }

  private requiresLocalNetworkPermission(origin = this.resolveHttpOrigin()): boolean {
    return window.location.hostname.endsWith('github.io') && isLoopbackOrigin(origin);
  }
}

const modeCopyMap: Record<AuthMode, string> = {
  auto: 'This Computer uses the local shared daemon.',
  auth: 'Saved Host uses the Auth or Mail origin from New User.',
  dev: 'This Tab stays on the page you opened.',
};

const modeLabelMap: Record<AuthMode, string> = {
  auto: 'auto mode',
  auth: 'auth mode',
  dev: 'dev mode',
};

const phaseLabelMap: Record<AuthPhase, string> = {
  authorized: 'Authorized.',
  checking: 'Checking.',
  error: 'Error.',
  idle: 'Idle.',
  'signed-out': 'Signed out.',
};

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function formatLocalPermissionHint(permissionState: PermissionState | 'unsupported'): string {
  switch (permissionState) {
    case 'granted':
      return 'This computer is ready to check.';
    case 'denied':
      return 'Chrome denied local network access. Press Connect This Computer after allowing this site to talk to local devices.';
    case 'prompt':
      return 'Press Connect This Computer, then allow local network access in Chrome.';
    case 'unsupported':
    default:
      return 'Press Connect This Computer to check the local daemon on this machine.';
  }
}
