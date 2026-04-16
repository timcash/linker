import {createDocsNav} from './docs-shell';
import {LogsTerminalPage} from './logs/LogsTerminalPage';
import './logs/logsTerminal.css';

export type LogsPageHandle = {
  destroy: () => void;
};

export function startLogsPage(root: HTMLElement): Promise<LogsPageHandle> {
  document.title = 'Linker Logs';
  document.body.classList.add('docs-route', 'logs-route');
  root.classList.add('logs-page-root');

  const page = new LogsTerminalPage(root as HTMLDivElement);
  page.render();

  const pageShell = root.querySelector('.logs-page-shell');
  if (pageShell instanceof HTMLElement) {
    pageShell.prepend(createDocsNav('logs'));
  }

  return Promise.resolve({
    destroy: () => {
      page.dispose();
      document.body.classList.remove('docs-route', 'logs-route');
      root.classList.remove('logs-page-root');
      root.replaceChildren();
    },
  });
}
