import {DEFAULT_LINE_STRATEGY, LINE_STRATEGIES, type LineStrategy} from './line/types';
import {DEFAULT_STAGE_MODE, isStageMode, type StageMode} from './plane-stack';
import {DEFAULT_TEXT_STRATEGY, TEXT_STRATEGIES, type TextStrategy} from './text/types';

export type AppUiLayout = 'compact' | 'wide';
export type AppMotionPreference = 'reduced' | 'smooth';
export type AppOnboardingPreference = 'auto' | 'skip';

export type StoredAppSettings = {
  lineStrategy: LineStrategy;
  motionPreference: AppMotionPreference;
  onboardingPreference: AppOnboardingPreference;
  preferredStageMode: StageMode;
  textStrategy: TextStrategy;
  uiLayout: AppUiLayout;
};

export type StoredAppSettingsOverrides = Partial<StoredAppSettings>;

export const STORED_APP_SETTINGS_KEY = 'linker.app.settings.v1';
export const DEFAULT_APP_UI_LAYOUT: AppUiLayout = 'compact';
export const DEFAULT_APP_MOTION_PREFERENCE: AppMotionPreference = 'smooth';
export const DEFAULT_APP_ONBOARDING_PREFERENCE: AppOnboardingPreference = 'auto';
export const APP_UI_LAYOUT_OPTIONS = [
  {mode: 'compact', label: 'Compact'},
  {mode: 'wide', label: 'Wide'},
] as const satisfies ReadonlyArray<{label: string; mode: AppUiLayout}>;
export const APP_MOTION_PREFERENCE_OPTIONS = [
  {mode: 'smooth', label: 'Smooth'},
  {mode: 'reduced', label: 'Reduced'},
] as const satisfies ReadonlyArray<{label: string; mode: AppMotionPreference}>;
export const APP_ONBOARDING_PREFERENCE_OPTIONS = [
  {mode: 'auto', label: 'Auto'},
  {mode: 'skip', label: 'Skip'},
] as const satisfies ReadonlyArray<{label: string; mode: AppOnboardingPreference}>;
export const APP_STAGE_MODE_OPTIONS = [
  {mode: '2d-mode', label: '2D'},
  {mode: '3d-mode', label: '3D'},
] as const satisfies ReadonlyArray<{label: string; mode: StageMode}>;

export function readStoredAppSettings(): StoredAppSettings {
  return normalizeStoredAppSettings(readStoredAppSettingsOverrides());
}

export function readStoredAppSettingsOverrides(): StoredAppSettingsOverrides {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORED_APP_SETTINGS_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as StoredAppSettingsOverrides;
    return normalizeStoredAppSettingsOverrides(parsed);
  } catch {
    return {};
  }
}

export function writeStoredAppSettings(
  nextSettings: Partial<StoredAppSettings>,
): StoredAppSettings {
  const currentOverrides = readStoredAppSettingsOverrides();
  const mergedOverrides = normalizeStoredAppSettingsOverrides({
    ...currentOverrides,
    ...nextSettings,
  });
  const mergedSettings = normalizeStoredAppSettings(mergedOverrides);

  if (typeof window === 'undefined') {
    return mergedSettings;
  }

  try {
    window.localStorage.setItem(STORED_APP_SETTINGS_KEY, JSON.stringify(mergedOverrides));
  } catch {
    // Best effort only.
  }

  window.dispatchEvent(
    new CustomEvent<StoredAppSettings>('linker:app-settings-changed', {
      detail: mergedSettings,
    }),
  );

  return mergedSettings;
}

export function subscribeStoredAppSettings(
  listener: (settings: StoredAppSettings) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleSettingsChanged = (event: Event): void => {
    const customEvent = event as CustomEvent<StoredAppSettings>;
    listener(customEvent.detail ?? readStoredAppSettings());
  };

  window.addEventListener('linker:app-settings-changed', handleSettingsChanged as EventListener);
  return () => {
    window.removeEventListener(
      'linker:app-settings-changed',
      handleSettingsChanged as EventListener,
    );
  };
}

function normalizeStoredAppSettings(
  input: Partial<StoredAppSettings>,
): StoredAppSettings {
  return {
    lineStrategy: isLineStrategy(input.lineStrategy) ? input.lineStrategy : DEFAULT_LINE_STRATEGY,
    motionPreference: isAppMotionPreference(input.motionPreference)
      ? input.motionPreference
      : DEFAULT_APP_MOTION_PREFERENCE,
    onboardingPreference: isAppOnboardingPreference(input.onboardingPreference)
      ? input.onboardingPreference
      : DEFAULT_APP_ONBOARDING_PREFERENCE,
    preferredStageMode: isStageMode(input.preferredStageMode)
      ? input.preferredStageMode
      : DEFAULT_STAGE_MODE,
    textStrategy: isTextStrategy(input.textStrategy) ? input.textStrategy : DEFAULT_TEXT_STRATEGY,
    uiLayout: isAppUiLayout(input.uiLayout) ? input.uiLayout : DEFAULT_APP_UI_LAYOUT,
  };
}

function normalizeStoredAppSettingsOverrides(
  input: Partial<StoredAppSettings>,
): StoredAppSettingsOverrides {
  const nextOverrides: StoredAppSettingsOverrides = {};

  if (isLineStrategy(input.lineStrategy)) {
    nextOverrides.lineStrategy = input.lineStrategy;
  }

  if (isAppMotionPreference(input.motionPreference)) {
    nextOverrides.motionPreference = input.motionPreference;
  }

  if (isAppOnboardingPreference(input.onboardingPreference)) {
    nextOverrides.onboardingPreference = input.onboardingPreference;
  }

  if (isStageMode(input.preferredStageMode)) {
    nextOverrides.preferredStageMode = input.preferredStageMode;
  }

  if (isTextStrategy(input.textStrategy)) {
    nextOverrides.textStrategy = input.textStrategy;
  }

  if (isAppUiLayout(input.uiLayout)) {
    nextOverrides.uiLayout = input.uiLayout;
  }

  return nextOverrides;
}

function isLineStrategy(value: unknown): value is LineStrategy {
  return typeof value === 'string' && LINE_STRATEGIES.includes(value as LineStrategy);
}

function isTextStrategy(value: unknown): value is TextStrategy {
  return typeof value === 'string' && TEXT_STRATEGIES.includes(value as TextStrategy);
}

function isAppUiLayout(value: unknown): value is AppUiLayout {
  return value === 'compact' || value === 'wide';
}

function isAppMotionPreference(value: unknown): value is AppMotionPreference {
  return value === 'smooth' || value === 'reduced';
}

function isAppOnboardingPreference(value: unknown): value is AppOnboardingPreference {
  return value === 'auto' || value === 'skip';
}
