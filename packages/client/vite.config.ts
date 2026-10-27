import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages (served from /<repo>/)
// and inside a desktop wrapper (served from file:// or a custom protocol).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
