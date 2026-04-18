type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'; platform: string}>;
};

export type PwaInstallability = 'available' | 'installed' | 'unavailable';
export type PwaDisplayMode = 'browser' | 'standalone';

export type PwaInstallState = {
  canInstall: boolean;
  displayMode: PwaDisplayMode;
  installability: PwaInstallability;
  statusLabel: string;
};

let beforeInstallPromptEvent: BeforeInstallPromptEvent | null = null;
let initialized = false;
let state: PwaInstallState = createPwaInstallState();
const listeners = new Set<(state: PwaInstallState) => void>();

export function initializePwaRuntime(): void {
  if (initialized || typeof window === 'undefined') {
    return;
  }

  initialized = true;
  syncPwaDatasets();

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
  window.addEventListener('appinstalled', handleAppInstalled);
  const displayModeMedia = window.matchMedia('(display-mode: standalone)');

  if (typeof displayModeMedia.addEventListener === 'function') {
    displayModeMedia.addEventListener('change', syncPwaState);
  } else if (typeof displayModeMedia.addListener === 'function') {
    displayModeMedia.addListener(syncPwaState);
  }

  if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
    const serviceWorkerUrl = new URL(
      'sw.js',
      new URL(import.meta.env.BASE_URL, window.location.origin),
    );
    void navigator.serviceWorker.register(serviceWorkerUrl);
  }

  notifyListeners();
}

export function getPwaInstallState(): PwaInstallState {
  return {...state};
}

export function subscribePwaInstallState(
  listener: (state: PwaInstallState) => void,
): () => void {
  listeners.add(listener);
  listener(getPwaInstallState());

  return () => {
    listeners.delete(listener);
  };
}

export async function promptForPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!beforeInstallPromptEvent) {
    syncPwaState();
    return 'unavailable';
  }

  const promptEvent = beforeInstallPromptEvent;
  beforeInstallPromptEvent = null;
  syncPwaState();

  await promptEvent.prompt();
  const choice = await promptEvent.userChoice.catch(() => ({
    outcome: 'dismissed' as const,
    platform: '',
  }));

  syncPwaState();
  return choice.outcome;
}

function handleBeforeInstallPrompt(event: Event): void {
  event.preventDefault();
  beforeInstallPromptEvent = event as BeforeInstallPromptEvent;
  syncPwaState();
}

function handleAppInstalled(): void {
  beforeInstallPromptEvent = null;
  syncPwaState();
}

function syncPwaState(): void {
  state = createPwaInstallState();
  syncPwaDatasets();
  notifyListeners();
}

function notifyListeners(): void {
  const snapshot = getPwaInstallState();

  for (const listener of listeners) {
    listener(snapshot);
  }
}

function syncPwaDatasets(): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.body.dataset.pwaDisplayMode = state.displayMode;
  document.body.dataset.pwaInstallability = state.installability;
}

function createPwaInstallState(): PwaInstallState {
  const displayMode = isStandaloneDisplayMode() ? 'standalone' : 'browser';
  const installability: PwaInstallability =
    displayMode === 'standalone'
      ? 'installed'
      : beforeInstallPromptEvent
      ? 'available'
      : 'unavailable';

  return {
    canInstall: installability === 'available',
    displayMode,
    installability,
    statusLabel:
      installability === 'installed'
        ? 'Installed and running fullscreen.'
        : installability === 'available'
        ? 'Install is available on this device.'
        : 'Install appears in supported secure browsers after the app is eligible.',
  };
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (window.navigator as Navigator & {standalone?: boolean}).standalone === true
  );
}
