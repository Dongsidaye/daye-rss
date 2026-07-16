import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { devModelProxy } from './dev-model-proxy';

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react(), devModelProxy()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, host: '0.0.0.0', proxy: { '/api': 'http://localhost:8787' } }
});
