import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';

import './style.css';

const root = document.createElement('div');
root.id = 'app';
document.body.append(root);

const route = resolveRoute(window.location.pathname);
const app =
  route === 'auth'
    ? await import('./auth-page').then(({startAuthPage}) => startAuthPage(root))
    : route === 'codex'
    ? await import('./codex-page').then(({startCodexPage}) => startCodexPage(root))
    : route === 'tasks'
    ? await import('./tasks-page').then(({startTasksPage}) => startTasksPage(root))
    : route === 'readme'
      ? await import('./readme-page').then(({startReadmePage}) => startReadmePage(root))
      : await import('./app').then(({startApp}) => startApp(root));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.destroy();
  });
}

function resolveRoute(pathname: string): 'app' | 'auth' | 'codex' | 'readme' | 'tasks' {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const lastSegment = segments[segments.length - 1];

  if (lastSegment === 'auth') {
    return 'auth';
  }

  if (lastSegment === 'codex') {
    return 'codex';
  }

  if (lastSegment === 'tasks') {
    return 'tasks';
  }

  if (lastSegment === 'readme') {
    return 'readme';
  }

  return 'app';
}
