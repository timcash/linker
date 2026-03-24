import './style.css';
import { startApp } from './app';

const root = document.createElement('div');
root.id = 'app';
document.body.append(root);

const app = await startApp(root);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.destroy();
  });
}
