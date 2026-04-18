import {readStoredAppSettings} from './site-settings';

export const DEFAULT_REMOTE_AUTH_ORIGIN = 'https://auth.example.com';
export const DEFAULT_REMOTE_MAIL_ORIGIN = 'https://mail.example.com';
export const DEFAULT_LOCAL_MAIL_ORIGIN = 'http://127.0.0.1:4192';
export const DEFAULT_REPO_URL = 'https://github.com/your-org/linker';
export const DEFAULT_LIVE_SITE_URL = 'https://your-user.github.io/linker/';

type ResolveOriginInput = {
  configuredOrigin?: string;
  hostname: string;
  locationOrigin: string;
  storedOrigin?: string;
};

export function resolveConfiguredRepoUrl(input: {
  configuredUrl?: string;
  storedUrl?: string;
}): string {
  return (
    normalizeAbsoluteHttpUrl(input.storedUrl) ||
    normalizeAbsoluteHttpUrl(input.configuredUrl) ||
    DEFAULT_REPO_URL
  );
}

export function resolveConfiguredAuthOrigin(input: ResolveOriginInput): string {
  const configuredOrigin =
    normalizeAbsoluteHttpUrl(input.storedOrigin) ||
    normalizeAbsoluteHttpUrl(input.configuredOrigin) ||
    DEFAULT_REMOTE_AUTH_ORIGIN;

  return configuredOrigin || input.locationOrigin;
}

export function resolveConfiguredMailOrigin(input: ResolveOriginInput): string {
  const configuredOrigin =
    normalizeAbsoluteHttpUrl(input.storedOrigin) ||
    normalizeAbsoluteHttpUrl(input.configuredOrigin);

  if (configuredOrigin) {
    return configuredOrigin;
  }

  if (input.hostname.endsWith('github.io')) {
    return DEFAULT_REMOTE_MAIL_ORIGIN;
  }

  if (input.hostname === '127.0.0.1' || input.hostname === 'localhost') {
    return DEFAULT_LOCAL_MAIL_ORIGIN;
  }

  return input.locationOrigin;
}

export function readConfiguredRepoUrl(configuredUrl?: string): string {
  return resolveConfiguredRepoUrl({
    configuredUrl,
    storedUrl: readStoredAppSettings().repoUrl,
  });
}

export function readConfiguredAuthOrigin(input: {
  configuredOrigin?: string;
  hostname: string;
  locationOrigin: string;
}): string {
  return resolveConfiguredAuthOrigin({
    ...input,
    storedOrigin: readStoredAppSettings().authOrigin,
  });
}

export function readConfiguredMailOrigin(input: {
  configuredOrigin?: string;
  hostname: string;
  locationOrigin: string;
}): string {
  return resolveConfiguredMailOrigin({
    ...input,
    storedOrigin: readStoredAppSettings().mailOrigin,
  });
}

export function normalizeAbsoluteHttpUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return '';
  }
}
