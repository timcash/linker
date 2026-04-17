import type { CodexBridgeServerMessage, TerminalSize } from '../../shared/codex/CodexBridgeTypes';
import { CodexAuthStore } from './CodexAuthStore';
import {
  buildDeferredBridgeHealthSummary,
  buildLockedBridgeStatus,
  shouldFallbackToCloudflareAuthorizeWindow,
} from './CodexBridgePolicy';
import { CodexAccessError, CodexTerminalClient, type CodexTerminalClientLifecycle } from './CodexTerminalClient';
import { CodexTerminalView } from './CodexTerminalView';

const ACCESS_POLL_INTERVAL_MS = 1500;
const ACCESS_POLL_TIMEOUT_MS = 60_000;

export class CodexTerminalPage {
  private readonly sessionId = new CodexAuthStore().getSessionId();
  private readonly client: CodexTerminalClient;
  private readonly view: CodexTerminalView;
  private isUnlocked = false;
  private unlockPending = false;

  constructor(root: HTMLDivElement) {
    this.client = new CodexTerminalClient({
      sessionId: this.sessionId,
      onMessage: this.handleBridgeMessage,
      onLifecycleChange: (phase, detail) => {
        void this.handleLifecycleChange(phase, detail);
      },
      onAccessRequired: this.handleAccessRequired,
    });
    this.view = new CodexTerminalView(root, {
      onUnlock: () => {
        void this.handleUnlock();
      },
      onLock: () => {
        this.handleManualLock();
      },
      onConnect: () => {
        void this.handleConnect();
      },
      onRestart: () => {
        this.handleRestart();
      },
      onInterrupt: this.handleInterrupt,
      onClearTerminal: this.handleClearTerminal,
      onTerminalInput: this.handleTerminalInput,
      onTerminalResize: this.handleTerminalResize,
    });
  }

  public render() {
    this.view.render();
    this.view.setSessionId(this.sessionId);
    this.view.setBridgeOrigin(this.client.getBridgeOrigin());
    this.view.setConnectionState('locked', buildLockedBridgeStatus());
    this.view.setAuthSummary('Cloudflare Access required.');
    this.view.setHealthSummary(buildDeferredBridgeHealthSummary(this.client.getBridgeOrigin()));
    this.view.setLockState(true, 'Tap unlock to start the Cloudflare Access flow.');
    this.view.setActionAvailability({
      canConnect: false,
      canRestart: false,
      canInterrupt: false,
      canClear: true,
      canLock: false,
    });

    window.addEventListener('beforeunload', this.handleBeforeUnload);
    this.view.focusUnlock();
  }

  public dispose() {
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    this.client.disconnect();
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
          message.isRunning ? `Codex session ready in ${message.cwd}.` : 'Codex session is available but not currently running.',
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
          `Codex exited with code ${message.exitCode ?? 'null'}${message.signal ? ` and signal ${message.signal}` : ''}.`,
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

    if ((phase === 'error' || phase === 'disconnected') && this.isUnlocked) {
      try {
        const health = await this.client.fetchHealth();
        this.view.setHealthSummary(formatHealthSummary(health));
      } catch (error) {
        if (error instanceof CodexAccessError) {
          this.handleAccessRequired(error.message);
          return;
        }

        this.view.setHealthSummary(readErrorMessage(error, 'The bridge is currently offline.'));
      }
    }
  };

  private readonly handleUnlock = async () => {
    if (this.unlockPending) {
      return;
    }

    this.unlockPending = true;
    this.view.setUnlockPending(true, 'Checking Access...');
    this.view.setLockState(true, 'Checking whether Cloudflare Access is already active.');

    try {
      const existingAccess = await this.tryFetchPublicConfig();
      if (existingAccess) {
        await this.adoptUnlockedState(existingAccess, 'Cloudflare Access is ready. Connecting now.');
        return;
      }

      this.openAuthorizeWindow();
      this.view.setLockState(
        true,
        'Complete the Cloudflare Access flow in the opened tab, then return here. This page will connect automatically.',
      );

      const unlockedAccess = await this.waitForCloudflareAccess();
      if (!unlockedAccess) {
        this.view.setLockState(
          true,
          'Cloudflare Access is still pending. Finish the Access flow, then tap unlock again.',
        );
        this.view.setConnectionState('locked', buildLockedBridgeStatus());
        this.view.focusUnlock();
        return;
      }

      await this.adoptUnlockedState(unlockedAccess, 'Cloudflare Access confirmed. Connecting now.');
    } catch (error) {
      this.handleAccessRequired(readErrorMessage(error, 'Cloudflare Access unlock failed.'));
    } finally {
      this.unlockPending = false;
      this.view.setUnlockPending(false, 'Unlock With Cloudflare Access');
    }
  };

  private readonly handleManualLock = () => {
    this.client.disconnect();
    this.isUnlocked = false;
    this.view.setAuthSummary('Cloudflare Access required.');
    this.view.setHealthSummary(buildDeferredBridgeHealthSummary(this.client.getBridgeOrigin()));
    this.view.setTerminalInputEnabled(false);
    this.view.setActionAvailability({
      canConnect: false,
      canRestart: false,
      canInterrupt: false,
      canClear: true,
      canLock: false,
    });
    this.view.setLockState(true, 'Locked. Tap unlock to verify Cloudflare Access again.');
    this.view.setConnectionState('locked', buildLockedBridgeStatus());
    this.view.focusUnlock();
  };

  private readonly handleConnect = async () => {
    if (!this.isUnlocked) {
      await this.handleUnlock();
      return;
    }

    this.client.connect();
    this.view.focusTerminal();
  };

  private readonly handleRestart = () => {
    if (!this.isUnlocked) {
      return;
    }

    this.view.setConnectionState('starting', 'Restarting the Codex CLI session...');
    this.client.restart(this.view.getTerminalSize());
    this.view.focusTerminal();
  };

  private readonly handleInterrupt = () => {
    if (!this.isUnlocked) {
      return;
    }

    this.client.interrupt();
    this.view.writeln('');
    this.view.writeln('[bridge] Sent Ctrl+C.');
    this.view.focusTerminal();
  };

  private readonly handleClearTerminal = () => {
    this.view.clearTerminal();
    if (this.isUnlocked) {
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
  };

  private readonly handleAccessRequired = (detail: string) => {
    this.client.disconnect();
    this.isUnlocked = false;
    this.view.setAuthSummary('Cloudflare Access required.');
    this.view.setHealthSummary(buildDeferredBridgeHealthSummary(this.client.getBridgeOrigin()));
    this.view.setTerminalInputEnabled(false);
    this.view.setActionAvailability({
      canConnect: false,
      canRestart: false,
      canInterrupt: false,
      canClear: true,
      canLock: false,
    });
    this.view.setLockState(true, detail || 'Cloudflare Access is required to use the terminal.');
    this.view.setConnectionState('locked', buildLockedBridgeStatus());
    this.view.focusUnlock();
  };

  private async adoptUnlockedState(
    publicConfig: { publicOrigin: string },
    successMessage: string,
  ) {
    this.isUnlocked = true;
    this.client.disconnect();
    this.view.setLockState(false, successMessage);
    this.view.setTerminalInputEnabled(true);
    this.view.setActionAvailability({
      canConnect: true,
      canRestart: true,
      canInterrupt: true,
      canClear: true,
      canLock: true,
    });
    this.view.setAuthSummary(`Cloudflare Access ready for ${publicConfig.publicOrigin}.`);

    try {
      const health = await this.client.fetchHealth();
      this.view.setHealthSummary(formatHealthSummary(health));
    } catch (error) {
      if (error instanceof CodexAccessError) {
        this.handleAccessRequired(error.message);
        return;
      }

      this.view.setHealthSummary(readErrorMessage(error, 'The bridge is currently offline.'));
    }

    this.client.connect();
  }

  private async tryFetchPublicConfig() {
    try {
      return await this.client.fetchPublicConfig();
    } catch (error) {
      if (
        error instanceof CodexAccessError ||
        shouldFallbackToCloudflareAuthorizeWindow({
          bridgeOrigin: this.client.getBridgeOrigin(),
          error,
          locationOrigin: window.location.origin,
        })
      ) {
        return null;
      }

      throw error;
    }
  }

  private async waitForCloudflareAccess() {
    const deadline = Date.now() + ACCESS_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const publicConfig = await this.tryFetchPublicConfig();
      if (publicConfig) {
        return publicConfig;
      }

      await delay(ACCESS_POLL_INTERVAL_MS);
    }

    return null;
  }

  private openAuthorizeWindow() {
    if (this.client.getBridgeOrigin() === window.location.origin) {
      return;
    }

    const openedWindow = window.open(this.client.getAuthorizeUrl(), '_blank', 'noopener,noreferrer');
    if (!openedWindow) {
      this.view.setLockState(
        true,
        'Cloudflare Access needs a new tab. Allow popups for this site, then tap unlock again.',
      );
    }
  }
}

const lifecycleToViewPhase = {
  connecting: 'connecting',
  connected: 'connecting',
  disconnected: 'disconnected',
  error: 'error',
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

function formatHealthSummary(health: { executablePath: string | null; commandLabel: string | null; platform: string; cwd: string }) {
  return `${health.commandLabel ?? health.executablePath ?? 'codex'} on ${health.platform} in ${health.cwd}`;
}

function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
