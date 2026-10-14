/* Monthly page views — GA4 page views per site per month for the last 12 full
 * months plus the current month so far, with totals and a CSV download.
 * Numbers come from n8n (pageViewsByMonth on each site); nothing is computed
 * from raw GA4 data here. */

import type { SiteSummary } from '../types/health';
import { analyticsHealth } from '../services/analyticsHealth';
import { $, esc, ICONS } from '../lib/dom';
import { fmtDateTime, fmtInt } from '../lib/format';
import { groupLabel, groupTabs, inGroup, siteGroups } from '../lib/filters';
import { monthLabel, pageViewsCsv, pageViewTable, type PageViewTable } from '../lib/pageViews';
import { href, replaceHash } from '../lib/router';
import { errorState, loading, pageHead, sampleNotice } from '../components/ui';
import { setLastRun, setSamplePill, type ViewContext } from './context';

export async function renderPageViews(ctx: ViewContext, params: URLSearchParams): Promise<void> {
  const { main } = ctx;
  main.innerHTML = loading([40, 96, 420]);
  let sites: SiteSummary[];
  let lastRunAt: string | null = null;
  let isSample = false;
  try {
    const [summary, list] = await Promise.all([
      analyticsHealth.getHealthSummary(),
      analyticsHealth.getSites(),
    ]);
    sites = list;
    lastRunAt = summary.lastRunAt;
    isSample = !!summary.isSample;
  } catch (err) {
    if (!ctx.isCurrent()) return;
    main.innerHTML = errorState(err);
    $('#retry', main)?.addEventListener('click', () => renderPageViews(ctx, params));
    return;
  }
  if (!ctx.isCurrent()) return;
  setLastRun(lastRunAt);
  setSamplePill(isSample);

  const g = (params.get('group') || 'all').toLowerCase();
  let group = /^[a-z0-9-]{1,30}$/.test(g) ? g : 'all';

  main.innerHTML = `<div class="view" id="view">
    ${pageHead(
      'Monthly page views',
      'GA4 page views per site for the last 12 full months and this month so far, with totals across all monitored sites.',
      `<button class="btn btn-primary" id="csv" type="button">${ICONS.download}Download CSV</button>`,
    )}
    ${sampleNotice(analyticsHealth.source, isSample)}
    <div class="seg group-tabs" id="group-tabs" role="group" aria-label="Site group"></div>
    <div class="stats" id="pv-stats"></div>
    <section class="card">
      <div class="card-h"><h2 class="card-t" style="margin:0">${ICONS.chart}Page views by month</h2>
        <span class="card-tools note">Updated ${esc(fmtDateTime(lastRunAt))}</span></div>
      <div id="pv-body"></div>
    </section></div>`;

  let table: PageViewTable = pageViewTable(sites);
  const update = () => {
    replaceHash(href.pageViews(group === 'all' ? undefined : new URLSearchParams({ group })));
    const scoped = inGroup(sites, group);
    table = pageViewTable(scoped);
    const tabs: Array<[string, string, number]> = [
      ['all', 'All sites', sites.length],
      ...groupTabs(sites),
    ];
    $('#group-tabs', main)!.innerHTML = tabs
      .map(
        ([k, label, n]) =>
          `<button type="button" data-group="${esc(k)}" class="${group === k ? 'is-active' : ''}" aria-pressed="${group === k}">${esc(label)} <span class="n">${n}</span></button>`,
      )
      .join('');
    renderStats(table);
    renderTable(table);
    ($('#csv', main) as HTMLButtonElement).disabled = !table.rows.length;
  };

  function renderStats(t: PageViewTable) {
    const n = t.months.length;
    const lastFull = n >= 2 ? t.totals[n - 2]! : 0;
    const tile = (k: string, v: string, sub: string) =>
      `<div class="stat info"><span class="stat-k">${esc(k)}</span><span class="stat-v num">${v}</span><span class="stat-sub">${esc(sub)}</span></div>`;
    $('#pv-stats', main)!.innerHTML = n
      ? tile(
          `${monthLabel(t.months[n - 2] ?? t.months[0]!)}`,
          fmtInt(lastFull),
          'Page views, last full month',
        ) +
        tile(
          'Last 12 months',
          fmtInt(t.fullMonthsTotal),
          `${monthLabel(t.months[0]!)} – ${monthLabel(t.months[n - 2] ?? t.months[0]!)}`,
        ) +
        tile(
          `${monthLabel(t.months[n - 1]!)} so far`,
          fmtInt(t.totals[n - 1]!),
          'Current month to date',
        ) +
        tile(
          'Sites counted',
          String(t.rows.length),
          t.missing.length ? `${t.missing.length} without data yet` : 'All sites have data',
        )
      : '';
  }

  function renderTable(t: PageViewTable) {
    const body = $('#pv-body', main)!;
    if (!t.rows.length) {
      body.innerHTML = `<div class="empty">${
        sites.some((s) => s.pageViewsByMonth?.length)
          ? 'No sites in this group have page-view data yet.'
          : 'Monthly page views will appear after the next daily monitoring run (6:00 AM Pacific).'
      }</div>`;
      return;
    }
    const last = t.months.length - 1;
    const head = t.months
      .map(
        (m, i) =>
          `<th class="r" scope="col">${esc(monthLabel(m))}${i === last ? '<br><span class="c-muted small">to date</span>' : ''}</th>`,
      )
      .join('');
    const cells = (vals: Array<number | null>) =>
      vals
        .map(
          (v) =>
            `<td class="r num">${v == null ? '<span class="c-muted">—</span>' : fmtInt(v)}</td>`,
        )
        .join('');
    const rows = t.rows
      .map(
        (r) => `<tr class="is-link" data-id="${esc(r.site.id)}">
          <td class="sticky-col"><a class="site-name" href="${href.site(r.site.id)}">${esc(r.site.name)}</a><div class="site-domain">${esc(r.site.domain)}${
            group === 'all'
              ? siteGroups(r.site)
                  .map((x) => ` <span class="pill muted">${esc(groupLabel(x))}</span>`)
                  .join('')
              : ''
          }</div></td>
          ${cells(r.values)}
          <td class="r num"><b>${fmtInt(r.fullMonthsTotal)}</b></td></tr>`,
      )
      .join('');
    body.innerHTML = `<div class="tbl-wrap"><table class="tbl" id="pv-table">
      <thead><tr><th class="sticky-col" scope="col">Site</th>${head}<th class="r" scope="col">Last 12 full months</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th class="sticky-col" scope="row">Total · ${t.rows.length} sites</th>${t.totals.map((v) => `<th class="r num">${fmtInt(v)}</th>`).join('')}<th class="r num">${fmtInt(t.fullMonthsTotal)}</th></tr></tfoot>
    </table></div>
    <p class="note" style="padding:10px 14px;margin:0">Page views = GA4 “Views” (screenPageViews). The last column adds up the 12 full months; the current month is still filling in. A site in two groups (e.g. Elite + PMI) is counted once in “All sites”.${
      t.missing.length
        ? ` Not counted yet (no GA4 data): ${t.missing.map((s) => esc(s.name)).join(', ')}.`
        : ''
    }</p>`;
  }

  const view = $('#view', main)!;
  view.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>('[data-group]');
    if (tab) {
      group = tab.dataset.group!;
      return update();
    }
    const row = t.closest<HTMLElement>('tr[data-id]');
    if (row && !t.closest('a')) location.hash = href.site(row.dataset.id!);
  });
  $('#csv', main)!.addEventListener('click', () => {
    const blob = new Blob([pageViewsCsv(table)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const month = table.months.at(-2) ?? table.months.at(-1) ?? 'export';
    a.href = url;
    a.download = `pmw-page-views-${group}-${month}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  update();
}
