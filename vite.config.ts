import path from 'node:path';

import {defineConfig} from 'vite';

export default defineConfig({
  base: process.env.VITE_SITE_BASE_PATH || '/',
  build: {
    rollupOptions: {
      input: {
        auth: path.resolve(__dirname, 'auth/index.html'),
        codex: path.resolve(__dirname, 'codex/index.html'),
        logs: path.resolve(__dirname, 'logs/index.html'),
        main: path.resolve(__dirname, 'index.html'),
        readme: path.resolve(__dirname, 'readme/index.html'),
        tasks: path.resolve(__dirname, 'tasks/index.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api/codex': {
        target: 'http://127.0.0.1:4186',
        changeOrigin: false,
      },
      '/codex-bridge': {
        target: 'ws://127.0.0.1:4186',
        ws: true,
      },
    },
  },
});
