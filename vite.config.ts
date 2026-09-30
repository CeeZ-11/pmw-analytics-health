import { defineConfig } from 'vitest/config';

// `base: './'` makes every built asset URL relative, so the same build works
// at a GitHub Pages project path (https://<org>.github.io/pmw-analytics-health/),
// a custom domain root, or a local `vite preview` — no rebuild per host.
// Routing is hash-based (#/sites/:id), so Pages never has to resolve a deep
// link on the server and no 404.html redirect hack is needed.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
