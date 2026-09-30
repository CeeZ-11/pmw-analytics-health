/* Hash router. GitHub Pages serves static files only, so a path like
 * /sites/harbor-lane would 404 on reload; #/sites/harbor-lane always loads
 * index.html and resolves client-side, at any base path. */

export type Route =
  | { name: 'dashboard'; params: URLSearchParams }
  | { name: 'site'; id: string; params: URLSearchParams }
  | { name: 'integration'; params: URLSearchParams }
  | { name: 'not-found'; params: URLSearchParams };

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const params = new URLSearchParams(queryPart);
  const segs = pathPart
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  if (segs.length === 0) return { name: 'dashboard', params };
  if (segs[0] === 'sites' && segs.length === 2 && segs[1])
    return { name: 'site', id: segs[1], params };
  if (segs[0] === 'integration' && segs.length === 1) return { name: 'integration', params };
  return { name: 'not-found', params };
}

export const href = {
  dashboard: (params?: URLSearchParams) => `#/${params && [...params].length ? `?${params}` : ''}`,
  site: (id: string, params?: URLSearchParams) =>
    `#/sites/${encodeURIComponent(id)}${params && [...params].length ? `?${params}` : ''}`,
  integration: () => '#/integration',
};

/** Update the hash without adding a history entry (filters, tabs). */
export function replaceHash(h: string): void {
  history.replaceState(history.state, '', `${location.pathname}${location.search}${h}`);
}
