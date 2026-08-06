/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { version } from './package.json';

// base './' keeps the build servable from any static path (GitHub Pages subpath, Netlify, file://).
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
