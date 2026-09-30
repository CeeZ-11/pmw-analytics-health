/* Data source & n8n integration — which provider this build uses and the
 * exact endpoints it would call. Useful for whoever wires up the n8n side. */

import { config } from '../config';
import { analyticsHealth } from '../services/analyticsHealth';
import { ENDPOINTS } from '../services/apiProvider';
import { esc, ICONS } from '../lib/dom';
import { card, pageHead } from '../components/ui';
import type { ViewContext } from './context';

export function renderIntegration({ main }: ViewContext): void {
  const base = config.apiBaseUrl || '{VITE_API_BASE_URL}';
  const ep = (path: string, desc: string) =>
    `<div class="endpoint"><span class="m">GET</span><code>${esc(base)}${esc(decodeURIComponent(path))}</code><span class="d">${esc(desc)}</span></div>`;
  const mock = analyticsHealth.source === 'mock';

  main.innerHTML = `<div class="view">
    ${pageHead('Data source', 'Where this dashboard gets its results, and what the n8n automation needs to provide.')}
    ${card(
      'Current source',
      `<dl class="kv">
        <dt>Mode</dt><dd>${mock ? '<span class="pill warn">Sample data</span> bundled mock data — not real monitoring results' : '<span class="pill good">n8n API</span> live results from the monitoring automation'}</dd>
        <dt>API base URL</dt><dd>${config.apiBaseUrl ? `<code>${esc(config.apiBaseUrl)}</code>` : '<span class="c-muted">Not configured</span>'}</dd>
        <dt>Timeout</dt><dd>${Math.round(config.apiTimeoutMs / 1000)}s</dd>
      </dl>
      ${mock ? `<div class="prose"><p>To switch to n8n, build with <code>VITE_DATA_SOURCE=api</code> and <code>VITE_API_BASE_URL</code> set to the n8n webhook base (locally in <code>.env.local</code>; in GitHub Actions as repository <em>Variables</em>). See <code>docs/n8n-api-contract.md</code> for the response shapes.</p></div>` : ''}`,
      { icon: ICONS.plug },
    )}
    ${card(
      'Endpoints',
      `<div class="endpoints">
        ${ep(ENDPOINTS.healthSummary(), 'Counts for the summary tiles and the time of the last monitoring run.')}
        ${ep(ENDPOINTS.sites(), 'Every monitored site with its per-column check results and issue counts.')}
        ${ep(ENDPOINTS.site(':id'), 'One site: tracking + GA4 checks, last 24 h totals, expected events/conversions, open issues.')}
        ${ep(ENDPOINTS.siteHistory(':id', 0).replace(/=0$/, '=N'), 'Daily users/sessions/events/conversions for N days, plus n8n’s period comparisons.')}
      </div>`,
      { sub: 'All read-only. The dashboard never writes to n8n.' },
    )}
    ${card(
      'Architecture',
      `<pre class="flow">GitHub Pages (this dashboard — static, no secrets)
      │  GET JSON
      ▼
n8n  (scheduled monitoring · holds all credentials)
      │
      ├── GA4 Data API   (service account lives in n8n)
      ├── Website crawl  (GA4 / GTM / collect-request checks)
      └── PageSpeed      (future)
      │
      ▼
Health analysis ──► Slack alerts &amp; daily summary</pre>
      <div class="prose">
        <p><b>No credentials in the frontend.</b> GA4 service-account keys, n8n auth, Slack tokens and API keys stay in n8n. Anything in a <code>VITE_*</code> variable ships in the public JavaScript bundle, so it must never hold a secret.</p>
        <p>The browser never calls Google directly — it only receives the results n8n has already computed.</p>
      </div>`,
      { icon: ICONS.info },
    )}
  </div>`;
}
