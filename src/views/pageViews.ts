/* Monthly page views — GA4 page views per site per month for the last 12 full
 * months plus the current month so far, with totals and a CSV download.
 * Numbers come from n8n (pageViewsByMonth on each site); nothing is computed
 * from raw GA4 data here. */

import type { SiteSummary } from '../types/health';
import { analyticsHealth } from '../services/analyticsHealth';
import { $, esc, ICONS } from '../lib/dom';
import { fmtDateTime, fmtInt, fmtPct } from '../lib/format';
import { renderChart } from '../lib/chart';
import { groupLabel, groupTabs, inGroup, siteGroups } from '../lib/filters';
import {
  monthLabel,
  pageViewsCsv,
  pageViewTable,
  sortRows,
  totalSummary,
  type PageViewRow,
  type PageViewSort,
  type PageViewTable,
} from '../lib/pageViews';
import { href, replaceHash } from '../lib/router';
import { errorState, loading, pageHead, pageViewsScope, sampleNotice } from '../components/ui';
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

  const state = {
    sort: 'total' as PageViewSort,
    dir: 'desc' as 'asc' | 'desc',
    q: '',
    allMonths: false,
  };

  main.innerHTML = `<div class="view" id="view">
    ${pageHead(
      'Monthly page views',
      'GA4 page views per site for the last 12 full months and this month so far, with totals across all monitored sites.',
      `<button class="btn btn-primary" id="csv" type="button">${ICONS.download}Download CSV</button>`,
    )}
    ${sampleNotice(analyticsHealth.source, isSample)}
    ${pageViewsScope('monitored')}
    <div class="seg group-tabs" id="group-tabs" role="group" aria-label="Site group"></div>
    <div class="stats" id="pv-stats"></div>
    <section class="card" id="pv-chart-card">
      <div class="card-h"><h2 class="card-t" style="margin:0">${ICONS.chart}Total page views per month</h2>
        <span class="card-tools note">Updated ${esc(fmtDateTime(lastRunAt))}</span></div>
      <div class="chart-box"><canvas id="pv-canvas" height="220" role="img" aria-label="Total page views per month"></canvas></div>
      <div class="chart-legend"><span><i class="partial"></i>Current month so far (still filling in)</span></div>
    </section>
    <section class="card">
      <div class="card-h"><h2 class="card-t" style="margin:0">${ICONS.pulse}Sites</h2></div>
      <div class="toolbar">
        <label class="search">${ICONS.search}<input id="pv-q" class="input" type="search" placeholder="Search site name or domain…" autocomplete="off" aria-label="Search sites by name or domain" /></label>
        <div class="seg" role="group" aria-label="Columns">
          <button type="button" data-cols="summary" class="is-active" aria-pressed="true">Summary</button>
          <button type="button" data-cols="months" aria-pressed="false">All months</button>
        </div>
        <span class="count" id="pv-count" aria-live="polite"></span>
      </div>
      <div id="pv-body"></div>
    </section></div>`;

  let table: PageViewTable = pageViewTable(sites);
  const update = () => {
    replaceHash(href.pageViews(group === 'all' ? undefined : new URLSearchParams({ group })));
    table = pageViewTable(inGroup(sites, group));
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
    renderChartCard(table);
    renderTable();
    ($('#csv', main) as HTMLButtonElement).disabled = !table.rows.length;
  };

  function renderStats(t: PageViewTable) {
    const n = t.months.length;
    if (!n) {
      $('#pv-stats', main)!.innerHTML = '';
      return;
    }
    const tot = totalSummary(t);
    const lastLabel = monthLabel(t.months[n - 2] ?? t.months[0]!);
    const tile = (k: string, v: string, sub: string) =>
      `<div class="stat info"><span class="stat-k">${esc(k)}</span><span class="stat-v num">${v}</span><span class="stat-sub">${sub}</span></div>`;
    $('#pv-stats', main)!.innerHTML =
      tile(
        lastLabel,
        fmtInt(tot.lastMonth),
        tot.changePct == null
          ? 'Page views, last full month'
          : `${changeHtml(tot.changePct)} vs ${esc(monthLabel(t.months[n - 3]!))}`,
      ) +
      tile(
        'Last 12 months',
        fmtInt(t.fullMonthsTotal),
        `${esc(monthLabel(t.months[0]!))} – ${esc(lastLabel)} · avg ${esc(fmtInt(tot.avgMonth))}/month`,
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
      );
  }

  function renderChartCard(t: PageViewTable) {
    const card = $('#pv-chart-card', main)!;
    card.hidden = !t.rows.length;
    if (!t.rows.length) return;
    const canvas = $('#pv-canvas', main) as HTMLCanvasElement;
    const last = t.months.length - 1;
    renderChart(
      canvas,
      t.months.map((m, i) => ({ date: `${m}-01`, value: t.totals[i]! })),
      {
        kind: 'bar',
        label: 'Page views',
        partialLast: true,
        height: 220,
        xLabel: (p) => monthLabel(p.date.slice(0, 7)).replace(/ (\d\d)(\d\d)$/, " '$2"),
        tipLabel: (p, i) => `${monthLabel(p.date.slice(0, 7))}${i === last ? ' (so far)' : ''}`,
      },
    );
  }

  function renderTable() {
    const t = table;
    const body = $('#pv-body', main)!;
    if (!t.rows.length) {
      $('#pv-count', main)!.textContent = '';
      body.innerHTML = `<div class="empty">${
        sites.some((s) => s.pageViewsByMonth?.length)
          ? 'No sites in this group have page-view data yet.'
          : 'Monthly page views will appear after the next daily monitoring run (6:00 AM Pacific).'
      }</div>`;
      return;
    }
    const rows = sortRows(t.rows, state.sort, state.dir, state.q);
    $('#pv-count', main)!.textContent =
      rows.length === t.rows.length
        ? `${t.rows.length} sites`
        : `${rows.length} of ${t.rows.length} sites`;
    const n = t.months.length;
    const lastFull = monthLabel(t.months[n - 2] ?? t.months[0]!);
    const sortTh = (key: PageViewSort, label: string, cls = 'r') => {
      const active = state.sort === key;
      const arrow = active ? (state.dir === 'desc' ? '↓' : '↑') : '';
      return `<th class="${cls}" scope="col" aria-sort="${active ? (state.dir === 'desc' ? 'descending' : 'ascending') : 'none'}"><button type="button" class="th-sort${active ? ' is-active' : ''}" data-sort="${key}">${label}<span class="arr">${arrow}</span></button></th>`;
    };
    const siteCell = (r: PageViewRow) =>
      `<td class="sticky-col"><a class="site-name" href="${href.site(r.site.id)}">${esc(r.site.name)}</a><div class="site-domain">${esc(r.site.domain)}${
        group === 'all'
          ? siteGroups(r.site)
              .map((x) => ` <span class="pill muted">${esc(groupLabel(x))}</span>`)
              .join('')
          : ''
      }</div></td>`;
    const tot = totalSummary(t);
    const totalLabel = `<td class="sticky-col"><b>Total</b><div class="site-domain">${t.rows.length} sites${state.q ? ' · all, not just search results' : ''}</div></td>`;
    const cell = (v: number | null, bold = false) =>
      `<td class="r num">${v == null ? '<span class="c-muted">—</span>' : bold ? `<b>${fmtInt(v)}</b>` : fmtInt(v)}</td>`;

    let head: string;
    let totalRow: string;
    let bodyRows: string;
    if (state.allMonths) {
      head = `${sortTh('name', 'Site', 'sticky-col')}${t.months
        .map(
          (m, i) =>
            `<th class="r" scope="col">${esc(monthLabel(m))}${i === n - 1 ? '<br><span class="c-muted small">so far</span>' : ''}</th>`,
        )
        .join('')}${sortTh('total', 'Last 12 months')}`;
      totalRow = `${totalLabel}${t.totals.map((v) => cell(v, true)).join('')}${cell(t.fullMonthsTotal, true)}`;
      bodyRows = rows
        .map(
          (r) =>
            `<tr class="is-link" data-id="${esc(r.site.id)}">${siteCell(r)}${r.values.map((v) => cell(v)).join('')}${cell(r.fullMonthsTotal, true)}</tr>`,
        )
        .join('');
    } else {
      head = `${sortTh('name', 'Site', 'sticky-col')}${sortTh('last', esc(lastFull))}${sortTh('change', 'vs month before')}${sortTh('avg', 'Avg / month')}<th scope="col">12-month trend</th>${sortTh('total', 'Last 12 months')}<th class="r" scope="col">${esc(monthLabel(t.months[n - 1]!))}<br><span class="c-muted small">so far</span></th>`;
      totalRow = `${totalLabel}${cell(tot.lastMonth, true)}<td class="r num">${changeHtml(tot.changePct)}</td>${cell(tot.avgMonth, true)}<td>${sparkline(t.totals.slice(0, n - 1))}</td>${cell(t.fullMonthsTotal, true)}${cell(t.totals[n - 1]!, true)}`;
      bodyRows = rows
        .map(
          (r) =>
            `<tr class="is-link" data-id="${esc(r.site.id)}">${siteCell(r)}${cell(r.lastMonth)}<td class="r num">${changeHtml(r.changePct)}</td>${cell(r.avgMonth)}<td>${sparkline(r.values.slice(0, n - 1))}</td>${cell(r.fullMonthsTotal, true)}${cell(r.values[n - 1] ?? null)}</tr>`,
        )
        .join('');
    }
    body.innerHTML = `<div class="tbl-wrap"><table class="tbl pv-table" id="pv-table">
      <thead><tr>${head}</tr></thead>
      <tbody><tr class="total-row">${totalRow}</tr>${bodyRows || `<tr><td colspan="99" class="c-muted">No sites match “${esc(state.q)}”.</td></tr>`}</tbody>
    </table></div>
    <p class="note" style="padding:10px 14px;margin:0">Page views = GA4 “Views”. “Last 12 months” adds up the 12 full months; the current month is still filling in. A site in two groups (e.g. Elite + PMI) is counted once in “All sites”.${
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
    const sortBtn = t.closest<HTMLElement>('[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort as PageViewSort;
      if (state.sort === key) state.dir = state.dir === 'desc' ? 'asc' : 'desc';
      else {
        state.sort = key;
        state.dir = key === 'name' ? 'asc' : 'desc';
      }
      return renderTable();
    }
    const cols = t.closest<HTMLElement>('[data-cols]');
    if (cols) {
      state.allMonths = cols.dataset.cols === 'months';
      if (state.allMonths && !['name', 'total'].includes(state.sort)) {
        state.sort = 'total';
        state.dir = 'desc';
      }
      cols.parentElement!.querySelectorAll('button').forEach((b) => {
        const on = b === cols;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      return renderTable();
    }
    const row = t.closest<HTMLElement>('tr[data-id]');
    if (row && !t.closest('a')) location.hash = href.site(row.dataset.id!);
  });
  $('#pv-q', main)!.addEventListener('input', (e) => {
    state.q = (e.target as HTMLInputElement).value;
    renderTable();
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

/** "▲ 12.3%" in green / "▼ 4%" in red; "—" when there's no comparison. */
function changeHtml(pct: number | null): string {
  if (pct == null) return '<span class="c-muted">—</span>';
  const cls = pct > 0 ? 'c-good' : pct < 0 ? 'c-poor' : 'c-muted';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '';
  return `<span class="${cls}">${arrow} ${esc(fmtPct(pct).replace(/^[+-]/, ''))}</span>`;
}

/** Tiny inline line of the full months; gaps (no data) are skipped. */
function sparkline(values: Array<number | null>): string {
  const pts = values
    .map((v, i) => [i, v] as const)
    .filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return '<span class="c-muted">—</span>';
  const w = 96;
  const h = 24;
  // Scale to the site's own range so the shape of the trend is visible.
  const vals = pts.map((p) => p[1]);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const span = hi - lo || hi || 1;
  const step = w / Math.max(1, values.length - 1);
  const xy = pts.map(
    ([i, v]) => `${(i * step).toFixed(1)},${(h - 3 - ((v - lo) / span) * (h - 6)).toFixed(1)}`,
  );
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${xy.join(' ')}"/><circle cx="${xy.at(-1)!.split(',')[0]}" cy="${xy.at(-1)!.split(',')[1]}" r="2"/></svg>`;
}
