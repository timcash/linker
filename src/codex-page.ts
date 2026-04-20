import {createSiteMenu} from './docs-shell';
import {CodexMailboardPage} from './codex/CodexMailboardPage';
import './codex/codexMailboard.css';

export type CodexPageHandle = {
  destroy: () => void;
};

export function startCodexPage(root: HTMLElement): CodexPageHandle {
  document.title = 'Linker Codex';
  document.body.classList.add('docs-route', 'codex-route');
  root.classList.add('codex-page-root');
  const siteMenu = createSiteMenu('codex');
  const diagnosticsHost = document.createElement('section');
  const settingsPage = siteMenu.element.querySelector<HTMLElement>('[data-site-menu-page="settings"]');
  const settingsSections = siteMenu.element.querySelector<HTMLElement>('.site-menu-settings-sections');
  settingsPage?.insertBefore(diagnosticsHost, settingsSections ?? null);

  const page = new CodexMailboardPage(root as HTMLDivElement, diagnosticsHost);
  page.render();

  const pageShell = root.querySelector('.codex-mail-shell');
  if (pageShell instanceof HTMLElement) {
    pageShell.append(siteMenu.element);
  }

  return {
    destroy: () => {
      siteMenu.destroy();
      page.dispose();
      document.body.classList.remove('docs-route', 'codex-route');
      root.classList.remove('codex-page-root');
      root.replaceChildren();
    },
  };
}
