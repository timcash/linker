import {defineConfig} from 'vite';

export default defineConfig({
  base: process.env.VITE_SITE_BASE_PATH || '/',
});
