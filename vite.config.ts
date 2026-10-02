import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';

/** Adds a Content-Security-Policy to the production build: scripts only from
 *  this site, network requests only to this site and the configured n8n
 *  origin, no plugins/frames/forms. Limits what an injected script could do
 *  (e.g. read the saved access key and send it elsewhere). Build-only — Vite's
 *  dev server needs inline scripts and websockets for hot reload. */
function contentSecurityPolicy(apiBaseUrl: string): Plugin {
  let apiOrigin = '';
  try {
    apiOrigin = apiBaseUrl ? new URL(apiBaseUrl).origin : '';
  } catch {
    apiOrigin = '';
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'pmw-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="utf-8" />',
        `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="no-referrer" />`,
      ),
  };
}

// `base: './'` makes every built asset URL relative, so the same build works
// at a GitHub Pages project path (https://<org>.github.io/pmw-analytics-health/),
// a custom domain root, or a local `vite preview` — no rebuild per host.
// Routing is hash-based (#/sites/:id), so Pages never has to resolve a deep
// link on the server and no 404.html redirect hack is needed.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  return {
    base: './',
    plugins: [contentSecurityPolicy(env.VITE_API_BASE_URL || '')],
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.ts'],
    },
  };
});
