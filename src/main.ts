import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';

import './style.css';
import { startApp } from './app';
import { startAuthPage } from './auth-page';
import { startReadmePage } from './readme-page';
import { startTasksPage } from './tasks-page';

const root = document.createElement('div');
root.id = 'app';
document.body.append(root);

const route = resolveRoute(window.location.pathname);
const app =
  route === 'auth'
    ? await startAuthPage(root)
    : route === 'tasks'
    ? await startTasksPage(root)
    : route === 'readme'
      ? await startReadmePage(root)
      : await startApp(root);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.destroy();
  });
}

function resolveRoute(pathname: string): 'app' | 'auth' | 'readme' | 'tasks' {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const lastSegment = segments[segments.length - 1];

  if (lastSegment === 'auth') {
    return 'auth';
  }

  if (lastSegment === 'tasks') {
    return 'tasks';
  }

  if (lastSegment === 'readme') {
    return 'readme';
  }

  return 'app';
}
