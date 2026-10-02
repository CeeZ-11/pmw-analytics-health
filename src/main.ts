import './styles/app.css';
import { analyticsHealth } from './services/analyticsHealth';
import { $, $$, ICONS } from './lib/dom';
import { parseHash, type Route } from './lib/router';
import { hideTip } from './lib/chart';
import { renderDashboard } from './views/dashboard';
import { renderSiteDetail } from './views/siteDetail';
import { renderIntegration } from './views/integration';
import { notFound } from './components/ui';
import { setAccessKey } from './services/accessKey';

/** Each render gets a token; a slow response for a page the user already
 *  left is dropped instead of overwriting the page they're on now. */
let navToken = 0;

function renderChrome(route: Route) {
  const rail = { dashboard: ICONS.dashboard, integration: ICONS.plug } as const;
  $$<HTMLAnchorElement>('.rail-btn[data-nav]').forEach((a) => {
    const key = a.dataset.nav as keyof typeof rail;
    if (!a.innerHTML) a.innerHTML = rail[key];
    const active =
      key === 'integration' ? route.name === 'integration' : route.name !== 'integration';
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const pill = $('#source-pill');
  if (pill && !pill.innerHTML) {
    pill.innerHTML =
      analyticsHealth.source === 'mock'
        ? '<span class="pill warn" title="Bundled sample data — not real monitoring results">Sample data</span>'
        : '<span class="pill good" title="Results from the n8n monitoring automation">Live · n8n</span>';
  }
}

async function route() {
  const token = ++navToken;
  const r = parseHash(location.hash);
  const main = $('#main')!;
  hideTip();
  renderChrome(r);
  const ctx = { main, isCurrent: () => token === navToken };
  switch (r.name) {
    case 'dashboard':
      document.title = 'PMW Analytics Health';
      return renderDashboard(ctx, r.params);
    case 'site':
      return renderSiteDetail(ctx, r.id, r.params);
    case 'integration':
      document.title = 'Data source · PMW Analytics Health';
      return renderIntegration(ctx);
    default:
      main.innerHTML = notFound('That page doesn’t exist.');
  }
}

// The access-key form (components/ui.ts accessForm) can appear on any page.
document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id !== 'access-form') return;
  e.preventDefault();
  const value = ($<HTMLInputElement>('#access-key', form)?.value || '').trim();
  if (!value) return;
  setAccessKey(value);
  location.reload();
});

let lastPath = '';
window.addEventListener('hashchange', () => {
  // Only scroll to top when the page itself changes, not a filter.
  const path = location.hash.split('?')[0] ?? '';
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
  void route();
});
lastPath = location.hash.split('?')[0] ?? '';
void route();
