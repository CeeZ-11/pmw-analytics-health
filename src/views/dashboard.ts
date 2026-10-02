/* Dashboard — "which PMW sites are healthy, which have tracking/data issues,
 * and which need attention?" Summary tiles, a status distribution bar, and
 * a searchable / filterable site health table. */

import type { HealthSummary, SiteSummary } from '../types/health';
import { analyticsHealth } from '../services/analyticsHealth';
import { $, esc, ICONS } from '../lib/dom';
import { fmtDateTime, fmtRelative } from '../lib/format';
import {
  applyQuery,
  ISSUE_FILTERS,
  issueFilterCounts,
  parseQuery,
  queryToParams,
  STATUS_FILTERS,
  type SiteQuery,
} from '../lib/filters';
import { href, replaceHash } from '../lib/router';
import { checkIcon, STATUS_META, statusBadge } from '../lib/status';
import { errorState, initials, loading, pageHead, sampleNotice } from '../components/ui';
import { setLastRun, setSamplePill, type ViewContext } from './context';

interface DashData {
  summary: HealthSummary;
  sites: SiteSummary[];
}

let cache: DashData | null = null;
/** Remembered so "Back to all sites" returns to the same filtered view. */
let lastParams = new URLSearchParams();
export const dashboardHref = () => href.dashboard(lastParams);

async function load(force = false): Promise<DashData> {
  if (cache && !force) return cache;
  const [summary, sites] = await Promise.all([
    analyticsHealth.getHealthSummary(),
    analyticsHealth.getSites(),
  ]);
  cache = { summary, sites };
  return cache;
}

export async function renderDashboard(ctx: ViewContext, params: URLSearchParams): Promise<void> {
  const { main } = ctx;
  if (!cache) main.innerHTML = loading([40, 96, 420]);
  let data: DashData;
  try {
    data = await load();
  } catch (err) {
    if (!ctx.isCurrent()) return;
    main.innerHTML = errorState(err);
    $('#retry', main)?.addEventListener('click', () => renderDashboard(ctx, params));
    return;
  }
  if (!ctx.isCurrent()) return;
  setLastRun(data.summary.lastRunAt);
  setSamplePill(!!data.summary.isSample);
  const query = parseQuery(params);
  paint(ctx, data, query);
}

function paint(ctx: ViewContext, data: DashData, query: SiteQuery) {
  const { main } = ctx;
  const { summary } = data;
  main.innerHTML = `<div class="view" id="view">
    ${pageHead(
      'Analytics Health',
      'Which PMW sites are healthy, which have tracking or data issues, and which need attention.',
      `<button class="btn btn-ghost" id="refresh" title="Reload results from ${analyticsHealth.source === 'mock' ? 'sample data' : 'n8n'}">${ICONS.refresh}Refresh</button>`,
    )}
    ${sampleNotice(analyticsHealth.source, !!summary.isSample)}
    <div class="stats" id="stats"></div>
    ${distribution(summary)}
    <section class="card">
      <div class="card-h"><h2 class="card-t" style="margin:0">${ICONS.pulse}Sites</h2>
        <span class="card-tools note">Checked ${esc(fmtDateTime(summary.lastRunAt))}</span></div>
      <div class="toolbar">
        <label class="search">${ICONS.search}<input id="q" class="input" type="search" placeholder="Search site name or domain…" autocomplete="off" aria-label="Search sites by name or domain" value="${esc(query.q)}" /></label>
        <div class="chips" id="status-chips" role="group" aria-label="Filter by health"></div>
        <div class="chips" id="issue-chips" role="group" aria-label="Filter by issue type"></div>
        <label class="small c-muted" style="display:flex;gap:6px;align-items:center">Sort
          <select id="sort" class="input" aria-label="Sort sites">
            <option value="health">Needs attention first</option>
            <option value="name">Name A–Z</option>
            <option value="checked">Oldest check first</option>
          </select></label>
        <span class="count" id="count" aria-live="polite"></span>
      </div>
      <div class="tbl-wrap"><table class="tbl" id="site-table">
        <thead><tr>
          <th class="sticky-col" scope="col">Site</th>
          <th class="c" scope="col">GA4</th>
          <th class="c" scope="col">GTM</th>
          <th class="c" scope="col">Data</th>
          <th class="c" scope="col">Events</th>
          <th class="c" scope="col">Conversions</th>
          <th scope="col">Issues</th>
          <th scope="col">Last checked</th>
          <th scope="col">Health</th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </section></div>`;
  const view = $('#view', main)!;

  const state: SiteQuery = { ...query };
  const update = () => {
    lastParams = queryToParams(state);
    replaceHash(href.dashboard(lastParams));
    renderStats(data, state);
    renderChips(data, state);
    renderRows(data, state);
  };

  ($('#sort', main) as HTMLSelectElement).value = state.sort;
  $('#q', main)!.addEventListener('input', (e) => {
    state.q = (e.target as HTMLInputElement).value;
    update();
  });
  $('#sort', main)!.addEventListener('change', (e) => {
    state.sort = (e.target as HTMLSelectElement).value as SiteQuery['sort'];
    update();
  });
  view.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const f = t.closest<HTMLElement>('[data-status]');
    if (f) {
      const v = f.dataset.status as SiteQuery['status'];
      state.status = state.status === v && v !== 'all' ? 'all' : v;
      return update();
    }
    const i = t.closest<HTMLElement>('[data-issue]');
    if (i) {
      const v = i.dataset.issue as SiteQuery['issue'];
      state.issue = state.issue === v ? 'any' : v;
      return update();
    }
    const row = t.closest<HTMLElement>('tr[data-id]');
    if (row && !t.closest('a')) location.hash = href.site(row.dataset.id!);
  });
  $('#refresh', main)!.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      const fresh = await load(true);
      if (!ctx.isCurrent()) return;
      setLastRun(fresh.summary.lastRunAt);
      paint(ctx, fresh, state);
    } catch (err) {
      if (!ctx.isCurrent()) return;
      main.innerHTML = errorState(err);
      $('#retry', main)?.addEventListener('click', () =>
        renderDashboard(ctx, queryToParams(state)),
      );
    }
  });
  update();
}

function renderStats({ summary }: DashData, state: SiteQuery) {
  const tile = (
    key: SiteQuery['status'],
    label: string,
    value: number,
    tone: string,
    sub: string,
  ) =>
    `<button class="stat ${tone}${state.status === key ? ' is-active' : ''}" data-status="${key}" aria-pressed="${state.status === key}">
      <span class="stat-k">${label}</span><span class="stat-v">${value}</span><span class="stat-sub">${sub}</span></button>`;
  const pct = (n: number) =>
    summary.total ? `${Math.round((n / summary.total) * 100)}% of sites` : '—';
  $('#stats')!.innerHTML = [
    tile('all', 'Sites monitored', summary.total, 'info', 'All monitored sites'),
    tile(
      'healthy',
      `<span class="sdot sdot--good"></span>Healthy`,
      summary.healthy,
      'good',
      pct(summary.healthy),
    ),
    tile(
      'warning',
      `<span class="sdot sdot--warn"></span>Warning`,
      summary.warning,
      'warn',
      pct(summary.warning),
    ),
    tile(
      'critical',
      `<span class="sdot sdot--poor"></span>Critical`,
      summary.critical,
      'poor',
      pct(summary.critical),
    ),
  ].join('');
}

function distribution(s: HealthSummary): string {
  if (!s.total) return '';
  const seg = (n: number, tone: string, label: string) =>
    n ? `<i class="${tone}" style="flex:${n}" title="${esc(`${n} ${label}`)}"></i>` : '';
  return `<section class="card pad" style="padding-top:12px" aria-label="Health status distribution">
    <div class="dist">${seg(s.healthy, 'good', 'healthy')}${seg(s.warning, 'warn', 'warning')}${seg(s.critical, 'poor', 'critical')}</div>
    <div class="dist-legend">
      <span><i class="sdot sdot--good"></i>${s.healthy} healthy</span>
      <span><i class="sdot sdot--warn"></i>${s.warning} warning</span>
      <span><i class="sdot sdot--poor"></i>${s.critical} critical</span>
    </div></section>`;
}

function renderChips({ sites }: DashData, state: SiteQuery) {
  const counts = issueFilterCounts(sites);
  const byStatus = (k: string) =>
    k === 'all' ? sites.length : sites.filter((s) => s.status === k).length;
  $('#status-chips')!.innerHTML = STATUS_FILTERS.map(
    ([k, label]) =>
      `<button class="chip${state.status === k ? ' is-active' : ''}" data-status="${k}" aria-pressed="${state.status === k}">${k === 'all' ? '' : `<span class="sdot sdot--${STATUS_META[k].tone}"></span>`}${esc(label)}<span class="n">${byStatus(k)}</span></button>`,
  ).join('');
  $('#issue-chips')!.innerHTML = ISSUE_FILTERS.filter(([k]) => k !== 'any')
    .map(
      ([k, label]) =>
        `<button class="chip${state.issue === k ? ' is-active' : ''}" data-issue="${k}" aria-pressed="${state.issue === k}">${esc(label)}<span class="n">${counts[k]}</span></button>`,
    )
    .join('');
}

function issuePills(s: SiteSummary): string {
  const critical = Number(s.issueCounts.critical) || 0;
  const warning = Number(s.issueCounts.warning) || 0;
  if (!critical && !warning) return '<span class="c-muted">—</span>';
  return `<span class="issue-pills">${critical ? `<span class="pill poor">${critical} critical</span>` : ''}${warning ? `<span class="pill warn">${warning} warning</span>` : ''}</span>`;
}

function renderRows({ sites }: DashData, state: SiteQuery) {
  const rows = applyQuery(sites, state);
  $('#count')!.textContent =
    `${rows.length} of ${sites.length} site${sites.length === 1 ? '' : 's'}`;
  const tbody = $('#rows')!;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty">No sites match these filters.${state.q ? ` Nothing matches “${esc(state.q)}”.` : ''}</div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      (s) => `<tr class="is-link" data-id="${esc(s.id)}">
        <td class="sticky-col"><div class="site-cell"><span class="site-ini" aria-hidden="true">${initials(s.name)}</span>
          <div><a class="site-name" href="${href.site(s.id)}">${esc(s.name)}</a><div class="site-domain">${esc(s.domain)}</div></div></div></td>
        <td class="c">${checkIcon(s.checks.ga4, 'GA4')}</td>
        <td class="c">${checkIcon(s.checks.gtm, 'GTM')}</td>
        <td class="c">${checkIcon(s.checks.data, 'Data')}</td>
        <td class="c">${checkIcon(s.checks.events, 'Events')}</td>
        <td class="c">${checkIcon(s.checks.conversions, 'Conversions')}</td>
        <td>${issuePills(s)}</td>
        <td class="dim" title="${esc(fmtDateTime(s.lastChecked))}">${esc(fmtRelative(s.lastChecked))}</td>
        <td>${statusBadge(s.status)}</td>
      </tr>`,
    )
    .join('');
}
