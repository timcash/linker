export function buildDeferredBridgeHealthSummary(origin: string): string {
  return `Cloudflare Access unlock will verify the Codex bridge at ${origin} before the terminal connects.`;
}

export function buildLockedBridgeStatus(): string {
  return 'Use Cloudflare Access to unlock the Codex terminal.';
}

export function shouldFallbackToCloudflareAuthorizeWindow(input: {
  bridgeOrigin: string;
  error: unknown;
  locationOrigin: string;
}): boolean {
  if (input.bridgeOrigin === input.locationOrigin) {
    return false;
  }

  const message = readErrorMessage(input.error).toLowerCase();
  if (message.length === 0) {
    return false;
  }

  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed')
  );
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message ?? '';
  }

  return typeof error === 'string' ? error : '';
}
