import type { CodexBridgeMode } from '../../shared/codex/CodexBridgeTypes';
import type { StoredCodexAuth } from './CodexAuthStore';

export function shouldProbeCodexBridge(storedAuth: StoredCodexAuth | null): storedAuth is StoredCodexAuth {
  return storedAuth !== null;
}

export function buildDeferredBridgeHealthSummary(mode: CodexBridgeMode, origin: string): string {
  return `Health checks start after unlock. ${bridgeModeCopy[mode]} Current target: ${origin}.`;
}

export function buildLockedBridgeStatus(mode: CodexBridgeMode): string {
  return `Enter the password to unlock ${bridgeModeLabelMap[mode]}.`;
}

const bridgeModeCopy: Record<CodexBridgeMode, string> = {
  auto: 'Auto mode will pick the best bridge route for this page.',
  bridge: 'Bridge mode will use the direct bridge endpoint.',
  dev: 'Dev mode will use the current page origin and local proxy.',
};

const bridgeModeLabelMap: Record<CodexBridgeMode, string> = {
  auto: 'auto mode',
  bridge: 'bridge mode',
  dev: 'dev mode',
};
