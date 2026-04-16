export type DocsRoute = 'app' | 'auth' | 'codex' | 'logs' | 'readme' | 'tasks';

const GITHUB_REPO_URL = 'https://github.com/timcash/linker';

export function createDocsNav(activeRoute: DocsRoute): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'site-nav';

  for (const entry of [
    {href: resolveSiteHref('./'), label: 'App', route: 'app' as const},
    {href: resolveSiteHref('auth/'), label: 'Auth', route: 'auth' as const},
    {href: resolveSiteHref('codex/'), label: 'Codex', route: 'codex' as const},
    {href: resolveSiteHref('logs/'), label: 'Logs', route: 'logs' as const},
    {href: resolveSiteHref('tasks/'), label: 'Tasks', route: 'tasks' as const},
    {href: resolveSiteHref('readme/'), label: 'README', route: 'readme' as const},
    {href: GITHUB_REPO_URL, label: 'GitHub', route: null},
  ]) {
    const link = document.createElement('a');
    link.href = entry.href;
    link.textContent = entry.label;

    if (entry.route === activeRoute) {
      link.setAttribute('aria-current', 'page');
    }

    if (entry.route === null) {
      link.target = '_blank';
      link.rel = 'noreferrer';
    }

    nav.append(link);
  }

  return nav;
}

export function resolveSiteHref(relativePath: string): string {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(relativePath, baseUrl).toString();
}

export function resolveRepoMarkdownUrl(relativePath: string): string {
  const normalized = relativePath.replace(/^\.?\//u, '');
  return `${GITHUB_REPO_URL}/blob/main/${normalized}`;
}
