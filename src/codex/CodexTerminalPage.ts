import type { CodexBridgeMode, CodexBridgeServerMessage, TerminalSize } from '../../shared/codex/CodexBridgeTypes';
import { CodexAuthStore, type StoredCodexAuth } from './CodexAuthStore';
import { buildDeferredBridgeHealthSummary, buildLockedBridgeStatus, shouldProbeCodexBridge } from './CodexBridgePolicy';
import { CodexAuthError, CodexTerminalClient, type CodexTerminalClientLifecycle } from './CodexTerminalClient';
import { CodexTerminalView } from './CodexTerminalView';

export class CodexTerminalPage {
  private readonly authStore = new CodexAuthStore();
  private readonly sessionId = this.authStore.getSessionId();
  private readonly client: CodexTerminalClient;
  private readonly view: CodexTerminalView;
  private bridgeMode: CodexBridgeMode;
  private auth: StoredCodexAuth | null = null;
  private expiryTimer: number | null = null;

  constructor(root: HTMLDivElement) {
    this.bridgeMode = resolveInitialBridgeMode(this.authStore.getBridgeMode());
    this.client = new CodexTerminalClient({
      sessionId: this.sessionId,
      onMessage: this.handleBridgeMessage,
      onLifecycleChange: (phase, detail) => {
        void this.handleLifecycleChange(phase, detail);
      },
      onAuthExpired: this.handleAuthExpired
    });
    this.client.setBridgeMode(this.bridgeMode);
    this.view = new CodexTerminalView(root, {
      onUnlock: (password) => {
        void this.handleUnlock(password);
      },
      onLock: () => {
        void this.handleManualLock();
      },
      onModeChange: (mode) => {
        void this.handleModeChange(mode);
      },
      onConnect: () => {
        void this.handleConnect();
      },
      onRestart: () => {
        void this.handleRestart();
      },
      onInterrupt: this.handleInterrupt,
      onClearTerminal: this.handleClearTerminal,
      onTerminalInput: this.handleTerminalInput,
      onTerminalResize: this.handleTerminalResize
    });
  }

  public async render() {
    this.view.render();
    this.syncBridgeUi();
    this.view.setSessionId(this.sessionId);
    this.view.setConnectionState('starting', `Preparing ${bridgeModeLabelMap[this.bridgeMode]}.`);
    this.view.setAuthSummary('Locked.');
    this.view.setLockState(true, 'Enter the password to unlock this browser session.');
    this.view.setActionAvailability({
      canConnect: false,
      canRestart: false,
      canInterrupt: false,
      canClear: true,
      canLock: false
    });

    window.addEventListener('beforeunload', this.handleBeforeUnload);

    const storedAuth = this.authStore.getAuth();
    if (!shouldProbeCodexBridge(storedAuth)) {
      this.view.setHealthSummary(buildDeferredBridgeHealthSummary(this.bridgeMode, this.client.getBridgeOrigin()));
      this.view.setConnectionState('locked', buildLockedBridgeStatus(this.bridgeMode));
      this.view.focusPassword();
      return;
    }

    await this.refreshBridgeConfig();
    await this.adoptAuth(storedAuth, 'Restoring the last short-lived unlock token.');
  }

  public dispose() {
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    this.clearAuthState();
    this.view.dispose();
  }

  private readonly handleBridgeMessage = (message: CodexBridgeServerMessage) => {
    switch (message.type) {
      case 'ready':
        this.view.setSessionId(message.sessionId);
        if (message.backlog.length > 0) {
          this.view.write(message.backlog);
        }
        this.view.setConnectionState(
          message.isRunning ? 'connected' : 'exited',
          message.isRunning ? `Codex session ready in ${message.cwd}.` : 'Codex session is available but not currently running.'
        );
        this.view.focusTerminal();
        break;

      case 'output':
        this.view.write(message.data);
        break;

      case 'status':
        this.view.setConnectionState(mapBridgeStatusToViewPhase(message.phase), message.detail);
        break;

      case 'exit':
        this.view.setConnectionState(
          'exited',
          `Codex exited with code ${message.exitCode ?? 'null'}${message.signal ? ` and signal ${message.signal}` : ''}.`
        );
        this.view.writeln('');
        this.view.writeln(`[bridge] Codex exited with code ${message.exitCode ?? 'null'}.`);
        break;

      case 'error':
        this.view.setConnectionState('error', message.message);
        this.view.writeln('');
        this.view.writeln(`[bridge] ${message.message}`);
        break;
    }
  };

  private readonly handleLifecycleChange = async (phase: CodexTerminalClientLifecycle, detail: string) => {
    this.view.setConnectionState(lifecycleToViewPhase[phase], detail);

    if (phase === 'connected') {
      this.view.focusTerminal();
      this.view.resizeTerminal();
      return;
    }

    if ((phase === 'error' || phase === 'disconnected') && this.auth?.authToken) {
      try {
        const health = await this.client.fetchHealth(this.auth.authToken);
        this.view.setHealthSummary(formatHealthSummary(health));
      } catch (error) {
        if (error instanceof CodexAuthError) {
          this.handleAuthExpired(error.message);
          return;
        }

        this.view.setHealthSummary(readErrorMessage(error, 'The bridge is currently offline.'));
      }
    }
  };

  private readonly handleUnlock = async (password: string) => {
    if (password.trim().length === 0) {
      this.view.setLockState(true, 'Enter the password before trying to unlock.');
      this.view.focusPassword();
      return;
    }

    this.view.setUnlockPending(true, 'Unlocking...');

    try {
      const login = await this.client.login(password);
      await this.adoptAuth(
        {
          authToken: login.authToken,
          expiresAt: login.expiresAt
        },
        'Unlocked. This browser can use the terminal for 10 minutes.'
      );
      this.view.clearPassword();
    } catch (error) {
      this.view.setLockState(true, readErrorMessage(error, 'Unlock failed.'));
      this.view.setConnectionState('locked', 'Password check failed.');
      this.view.focusPassword();
    } finally {
      this.view.setUnlockPending(false, 'Unlock');
    }
  };

  private readonly handleManualLock = async () => {
    const currentToken = this.auth?.authToken;
    this.clearAuthState();
    this.view.setHealthSummary(buildDeferredBridgeHealthSummary(this.bridgeMode, this.client.getBridgeOrigin()));
    this.view.setLockState(true, 'Locked. Enter the password to unlock this browser again.');
    this.view.setConnectionState('locked', 'Browser session locked.');
    this.view.focusPassword();

    if (!currentToken) {
      return;
    }

    try {
      await this.client.logout(currentToken);
    } catch {
      // Best effort only.
    }
  };

  private readonly handleModeChange = async (mode: CodexBridgeMode) => {
    if (mode === this.bridgeMode) {
      return;
    }

    const previousToken = this.auth?.authToken;
    if (previousToken) {
      try {
        await this.client.logout(previousToken);
      } catch {
        // Best effort only.
      }
    }

    this.clearAuthState();
    this.bridgeMode = mode;
    this.authStore.setBridgeMode(mode);
    this.client.setBridgeMode(mode);
    this.syncBridgeUi();
    this.view.clearPassword();
    this.view.setTerminalInputEnabled(false);
    this.view.setActionAvailability({
      canConnect: false,
      canRestart: false,
      canInterrupt: false,
      canClear: true,
      canLock: false
    });
    this.view.setLockState(true, `Switched to ${bridgeModeLabelMap[mode]}. Unlock again to open the terminal.`);
    this.view.setHealthSummary(buildDeferredBridgeHealthSummary(this.bridgeMode, this.client.getBridgeOrigin()));
    this.view.setConnectionState('locked', `${bridgeModeLabelMap[mode]} is selected. Unlock to connect.`);
    this.view.focusPassword();
  };

  private readonly handleConnect = () => {
    if (!this.auth?.authToken) {
      this.view.setLockState(true, 'Unlock the terminal before connecting.');
      this.view.focusPassword();
      return;
    }

    this.client.connect(this.auth.authToken);
    this.view.focusTerminal();
  };

  private readonly handleRestart = () => {
    if (!this.auth?.authToken) {
      return;
    }

    this.view.setConnectionState('starting', 'Restarting the Codex CLI session...');
    this.client.restart(this.view.getTerminalSize());
    this.view.focusTerminal();
  };

  private readonly handleInterrupt = () => {
    if (!this.auth?.authToken) {
      return;
    }

    this.client.interrupt();
    this.view.writeln('');
    this.view.writeln('[bridge] Sent Ctrl+C.');
    this.view.focusTerminal();
  };

  private readonly handleClearTerminal = () => {
    this.view.clearTerminal();
    if (this.auth?.authToken) {
      this.view.focusTerminal();
    }
  };

  private readonly handleTerminalInput = (data: string) => {
    this.client.sendInput(data);
  };

  private readonly handleTerminalResize = (size: TerminalSize) => {
    this.client.resize(size);
  };

  private readonly handleBeforeUnload = () => {
    this.client.disconnect();
    this.view.dispose();
    this.stopExpiryTimer();
  };

  private readonly handleAuthExpired = (detail: string) => {
    this.clearAuthState();
    this.view.setHealthSummary(buildDeferredBridgeHealthSummary(this.bridgeMode, this.client.getBridgeOrigin()));
    this.view.setTerminalInputEnabled(false);
    this.view.setActionAvailability({
      canConnect: false,
      canRestart: false,
      canInterrupt: false,
      canClear: true,
      canLock: false
    });
    this.view.setLockState(true, detail || 'This browser session expired. Enter the password again.');
    this.view.setConnectionState('locked', 'Unlock expired.');
    this.view.focusPassword();
  };

  private async adoptAuth(auth: StoredCodexAuth, successMessage: string) {
    this.auth = auth;
    this.authStore.setAuth(auth);
    this.client.disconnect();
    this.armExpiryTimer();
    this.view.setLockState(false, successMessage);
    this.view.setTerminalInputEnabled(true);
    this.view.setActionAvailability({
      canConnect: true,
      canRestart: true,
      canInterrupt: true,
      canClear: true,
      canLock: true
    });
    this.view.setAuthSummary(buildUnlockSummary(auth.expiresAt));

    try {
      const health = await this.client.fetchHealth(auth.authToken);
      this.view.setHealthSummary(formatHealthSummary(health));
    } catch (error) {
      if (error instanceof CodexAuthError) {
        this.handleAuthExpired(error.message);
        return;
      }

      this.view.setHealthSummary(readErrorMessage(error, 'The bridge is currently offline.'));
    }

    this.client.connect(auth.authToken);
  }

  private armExpiryTimer() {
    this.stopExpiryTimer();
    this.updateExpirySummary();

    this.expiryTimer = window.setInterval(() => {
      this.updateExpirySummary();
    }, 1000);
  }

  private updateExpirySummary() {
    if (!this.auth) {
      this.view.setAuthSummary('Locked.');
      return;
    }

    const remainingMs = this.auth.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.handleAuthExpired('This 10-minute unlock window expired.');
      return;
    }

    this.view.setAuthSummary(buildUnlockSummary(this.auth.expiresAt));
  }

  private stopExpiryTimer() {
    if (this.expiryTimer !== null) {
      window.clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private clearAuthState() {
    this.stopExpiryTimer();
    this.client.disconnect();
    this.auth = null;
    this.authStore.clearAuth();
    this.view.setAuthSummary('Locked.');
  }

  private syncBridgeUi() {
    this.view.setBridgeMode(this.bridgeMode);
    this.view.setBridgeOrigin(this.client.getBridgeOrigin());
  }

  private async refreshBridgeConfig() {
    try {
      const publicConfig = await this.client.fetchPublicConfig();
      this.view.setHealthSummary(
        `Reachable in ${bridgeModeLabelMap[this.bridgeMode]}. Tokens last ${Math.round(publicConfig.sessionTtlSeconds / 60)} minutes and target ${publicConfig.publicOrigin}.`
      );
    } catch (error) {
      this.view.setHealthSummary(readErrorMessage(error, `The ${bridgeModeLabelMap[this.bridgeMode]} route is currently offline.`));
    }
  }
}

const lifecycleToViewPhase = {
  connecting: 'connecting',
  connected: 'connecting',
  disconnected: 'disconnected',
  error: 'error'
} as const;

function mapBridgeStatusToViewPhase(phase: 'starting' | 'connected' | 'reconnected' | 'exited') {
  switch (phase) {
    case 'starting':
      return 'starting';
    case 'connected':
    case 'reconnected':
      return 'connected';
    case 'exited':
      return 'exited';
  }
}

function buildUnlockSummary(expiresAt: number) {
  const remainingMs = Math.max(0, expiresAt - Date.now());
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Unlocked for ${minutes}:${String(seconds).padStart(2, '0')}.`;
}

function formatHealthSummary(health: { executablePath: string | null; commandLabel: string | null; platform: string; cwd: string }) {
  return `${health.commandLabel ?? health.executablePath ?? 'codex'} on ${health.platform} in ${health.cwd}`;
}

function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function resolveInitialBridgeMode(storedMode: CodexBridgeMode): CodexBridgeMode {
  const requestedMode = new URLSearchParams(window.location.search).get('mode');
  if (requestedMode === 'auto' || requestedMode === 'dev' || requestedMode === 'bridge') {
    return requestedMode;
  }

  return storedMode;
}

const bridgeModeLabelMap: Record<CodexBridgeMode, string> = {
  auto: 'auto mode',
  dev: 'dev mode',
  bridge: 'bridge mode'
};
