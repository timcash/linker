import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';

import {installBrowserLogCapture, recordBrowserLog} from './logs/log-store';
import {initializePwaRuntime} from './pwa';
import './style.css';

const root = document.createElement('div');
root.id = 'app';
document.body.append(root);

initializePwaRuntime();

const route = resolveRoute(window.location.pathname);
installBrowserLogCapture(route);
recordBrowserLog('info', `Bootstrapping the ${route} route.`);
const app =
  route === 'auth'
    ? await import('./auth-page').then(({startAuthPage}) => startAuthPage(root))
    : route === 'new-user'
    ? await import('./new-user-page').then(({startNewUserPage}) => startNewUserPage(root))
    : route === 'codex'
    ? await import('./codex-page').then(({startCodexPage}) => startCodexPage(root))
    : route === 'logs'
    ? await import('./logs-page').then(({startLogsPage}) => startLogsPage(root))
    : route === 'readme'
      ? await import('./readme-page').then(({startReadmePage}) => startReadmePage(root))
      : await import('./app').then(({startApp}) => startApp(root));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.destroy();
  });
}

function resolveRoute(pathname: string): 'app' | 'auth' | 'codex' | 'logs' | 'new-user' | 'readme' {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const lastSegment = segments[segments.length - 1];

  if (lastSegment === 'auth') {
    return 'auth';
  }

  if (lastSegment === 'codex') {
    return 'codex';
  }

  if (lastSegment === 'new-user') {
    return 'new-user';
  }

  if (lastSegment === 'logs') {
    return 'logs';
  }

  if (lastSegment === 'readme') {
    return 'readme';
  }

  return 'app';
}
