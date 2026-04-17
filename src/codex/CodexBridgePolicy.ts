export function buildDeferredBridgeHealthSummary(origin: string): string {
  return `Cloudflare Access unlock will verify the Codex bridge at ${origin} before the terminal connects.`;
}

export function buildLockedBridgeStatus(): string {
  return 'Use Cloudflare Access to unlock the Codex terminal.';
}
