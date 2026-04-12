import {createDocsNav} from './docs-shell';

type AuthMode = 'auto' | 'auth' | 'dev';
type AuthPhase = 'authorized' | 'checking' | 'error' | 'idle' | 'signed-out';

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
const REMOTE_ORIGIN = 'https://linker.dialtone.earth';
const CONFIG_PATH = '/api/auth/public-config';
const DEFAULT_SESSION_PATH = '/api/auth/session';
const DEFAULT_LOGOUT_PATH = '/api/auth/logout';
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
  private activeConfig: PublicAuthConfigResponse | null = null;
  private elements: AuthPageElements | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.mode = this.resolveInitialMode();
  }

  public async render(): Promise<void> {
    const shell = document.createElement('main');
    shell.className = 'page-shell docs-page auth-page auth-shell';

    shell.innerHTML = `
      <header class="docs-hero auth-hero">
        <p class="eyebrow">Cloudflare Access</p>
        <h1>Static login and auth checks for local or tunneled Linker services.</h1>
        <p class="lede">
          This page mirrors the Legion pattern from cad-pga: keep the route static, decide whether to target localhost
          or a public origin, then use a protected config route to trigger Cloudflare Access login before checking
          session state.
        </p>
        <p class="auth-note">
          In remote mode, press <strong>Authorize</strong>, complete the access flow on the target origin, then return
          here and press <strong>Check Session</strong>.
        </p>
      </header>

      <section class="auth-grid">
        <article class="auth-card auth-card--wide">
          <span class="auth-label">Mode</span>
          <p class="auth-value" data-auth-mode-summary></p>
          <div class="auth-mode-toggle" role="group" aria-label="Linker auth mode">
            <button type="button" class="auth-mode-btn" data-auth-mode-button="auto">Auto</button>
            <button type="button" class="auth-mode-btn" data-auth-mode-button="dev">Dev</button>
            <button type="button" class="auth-mode-btn" data-auth-mode-button="auth">Auth</button>
          </div>
        </article>

        <article class="auth-card">
          <span class="auth-label">Auth State</span>
          <p class="auth-value" data-auth-status>Idle.</p>
        </article>

        <article class="auth-card auth-card--wide">
          <span class="auth-label">Target Origin</span>
          <p class="auth-value" data-auth-origin>Resolving...</p>
        </article>

        <article class="auth-card auth-card--wide">
          <span class="auth-label">Health</span>
          <p class="auth-value" data-auth-health>Checking config route...</p>
        </article>
      </section>

      <section class="auth-toolbar">
        <button type="button" class="auth-action auth-action--primary" data-auth-authorize>Authorize</button>
        <button type="button" class="auth-action" data-auth-check-session>Check Session</button>
        <button type="button" class="auth-action" data-auth-sign-out>Sign Out</button>
      </section>

      <section class="auth-console">
        <div class="auth-log" data-auth-log></div>
      </section>
    `;

    shell.prepend(createDocsNav('auth'));
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
    this.setAuthPhase('idle', 'Ready. Choose a mode and check the session.');
    this.appendLog('system', 'Auth page loaded. Waiting for an authorization check.');
  }

  public destroy(): void {
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
    const configUrl = this.resolveHttpUrl(CONFIG_PATH);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);

    this.activeConfig = null;
    this.setOriginText(`${origin} -> ${CONFIG_PATH}`);
    this.setHealthText('Checking config route...');

    try {
      const response = await fetch(configUrl, {
        headers: {
          Accept: 'application/json',
        },
        mode: 'cors',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Config request failed with status ${response.status}.`);
      }

      const config = (await response.json()) as PublicAuthConfigResponse;
      this.activeConfig = config;
      this.setOriginText(`${config.publicOrigin} -> ${config.sessionPath}`);
      this.setHealthText(`Reachable. ${config.sessionLabel} via ${config.providerLabel}.`);
      this.appendLog('system', `Config route is reachable at ${config.publicOrigin}${config.sessionPath}.`);
    } catch (error) {
      if (this.requiresRemoteAccessLogin(origin)) {
        this.setHealthText(
          'Cloudflare Access login is probably required. Press Authorize, complete the remote flow, then return here and check the session again.',
        );
        this.appendLog('system', 'Remote access auth is likely required before the config route can be reached.');
      } else {
        this.setHealthText(readErrorMessage(error, 'The target origin is not reachable yet.'));
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private async checkSession(): Promise<void> {
    this.setAuthPhase('checking', 'Checking the session route...');

    const sessionUrl = this.resolveHttpUrl(this.activeConfig?.sessionPath ?? DEFAULT_SESSION_PATH);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);

    try {
      const response = await fetch(sessionUrl, {
        headers: {
          Accept: 'application/json',
        },
        mode: 'cors',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Session request failed with status ${response.status}.`);
      }

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
    this.elements.authorizeButton.hidden = !this.requiresRemoteAccessLogin();

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
    const accessUrl = this.resolveHttpUrl(this.activeConfig?.loginPath ?? CONFIG_PATH);
    window.open(accessUrl, '_blank', 'noopener,noreferrer');
    this.appendLog('system', `Opened ${accessUrl}. Finish the access flow there, then return here and check the session.`);
  }

  private openSignOut(): void {
    const logoutUrl = this.resolveHttpUrl(this.activeConfig?.logoutPath ?? DEFAULT_LOGOUT_PATH);
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
    const configuredOrigin = String(import.meta.env.VITE_LINKER_AUTH_ORIGIN ?? REMOTE_ORIGIN);

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

  private resolveHttpUrl(pathname: string): string {
    try {
      return new URL(pathname).toString();
    } catch (error) {
      void error;
    }

    const url = new URL(this.resolveHttpOrigin());
    url.pathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
    url.search = '';
    return url.toString();
  }

  private requiresRemoteAccessLogin(origin = this.resolveHttpOrigin()): boolean {
    return origin !== window.location.origin;
  }
}

const modeCopyMap: Record<AuthMode, string> = {
  auto: 'Auto mode uses localhost on local pages and switches to the remote auth origin on GitHub Pages.',
  auth: 'Auth mode always targets the public remote auth origin.',
  dev: 'Dev mode stays on the current page origin and expects a local auth service beside Vite.',
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
