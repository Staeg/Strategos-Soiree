import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Stamped into saves and bug reports, so a report says which build it came from.
const build = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'unknown'; }
})();

// Relative base so the same build works on GitHub Pages (served from /<repo>/)
// and inside a desktop wrapper (served from file:// or a custom protocol).
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
