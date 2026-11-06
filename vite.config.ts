import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'server/web', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' }
});
