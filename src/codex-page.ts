import {createDocsNav} from './docs-shell';
import {CodexTerminalPage} from './codex/CodexTerminalPage';
import './codex/codexTerminal.css';

export type CodexPageHandle = {
  destroy: () => void;
};

export function startCodexPage(root: HTMLElement): CodexPageHandle {
  document.title = 'Linker Codex';
  document.body.classList.add('docs-route', 'codex-route');
  root.classList.add('codex-page-root');

  const page = new CodexTerminalPage(root as HTMLDivElement);
  page.render();

  const pageShell = root.querySelector('.codex-page-shell');
  if (pageShell instanceof HTMLElement) {
    pageShell.prepend(createDocsNav('codex'));
  }

  return {
    destroy: () => {
      page.dispose();
      document.body.classList.remove('docs-route', 'codex-route');
      root.classList.remove('codex-page-root');
      root.replaceChildren();
    },
  };
}
