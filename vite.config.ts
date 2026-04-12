import path from 'node:path';

import {defineConfig} from 'vite';

export default defineConfig({
  base: process.env.VITE_SITE_BASE_PATH || '/',
  build: {
    rollupOptions: {
      input: {
        auth: path.resolve(__dirname, 'auth/index.html'),
        main: path.resolve(__dirname, 'index.html'),
        readme: path.resolve(__dirname, 'readme/index.html'),
        tasks: path.resolve(__dirname, 'tasks/index.html'),
      },
    },
  },
});
