/* All PMW sites — page views across every GA4 property the PMW Google logins
 * can see (not just the sites in the health monitor). The rules in
 * lib/allProperties.ts decide what counts; viewers can untick a property on
 * their own device, and team decisions come from n8n. */

import type { AllPropertiesReport } from '../types/health';
import { analyticsHealth } from '../services/analyticsHealth';
import { $, esc, ICONS } from '../lib/dom';
import { fmtDateTime, fmtInt, fmtPct } from '../lib/format';
import { renderChart } from '../lib/chart';
import { monthLabel } from '../lib/pageViews';
import {
  allPropertiesCsv,
  analyseProperties,
  DEFAULT_RULES,
  isCounted,
  REASON_LABEL,
  ruleReason,
  totals,
  type PropertyRow,
  type RuleKey,
  type Rules,
} from '../lib/allProperties';
import { errorState, loading, pageHead, pageViewsScope, sampleNotice } from '../components/ui';
import type { ViewContext } from './context';

const STORE_RULES = 'pmw-all-sites-rules';
const STORE_LOCAL = 'pmw-all-sites-choices';
const read = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private window — choices just aren't remembered */
  }
};

type Filter = 'all' | 'counted' | 'out' | 'dup' | 'stale' | 'zero' | 'internal' | 'mine';
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['counted', 'Counted'],
  ['out', 'Left out'],
  ['dup', 'Duplicates'],
  ['stale', 'Stale'],
  ['zero', 'No page views'],
  ['internal', 'Internal & roll-up'],
  ['mine', 'My changes'],
];
const PAGE = 200;

export async function renderAllSites(ctx: ViewContext): Promise<void> {
  const { main } = ctx;
  main.innerHTML = loading([40, 96, 260, 420]);
  let report: AllPropertiesReport;
  try {
    report = await analyticsHealth.getAllProperties();
  } catch (err) {
    if (!ctx.isCurrent()) return;
    main.innerHTML = errorState(err);
    $('#retry', main)?.addEventListener('click', () => renderAllSites(ctx));
    return;
  }
  if (!ctx.isCurrent()) return;

  const rows = analyseProperties(report);
  const rules: Rules = { ...DEFAULT_RULES, ...read<Partial<Rules>>(STORE_RULES, {}) };
  let local = read<Record<string, boolean>>(STORE_LOCAL, {});
  let filter: Filter = 'all';
  let q = '';
  let limit = PAGE;
  const n = report.months.length;
  const lastFull = n >= 2 ? report.months[n - 2]! : (report.months[0] ?? '');

  main.innerHTML = `<div class="view" id="view">
    ${pageHead(
      'All PMW sites',
      'Page views across every GA4 property the PMW Google logins can see. Each property is counted once, and duplicates, roll-ups and non-client sites are left out.',
      `<button class="btn btn-primary" id="csv" type="button">${ICONS.download}Download CSV</button>`,
    )}
    ${sampleNotice(analyticsHealth.source, false)}
    ${pageViewsScope('all')}
    ${
      rows.length
        ? `<div class="stats" id="ap-stats"></div>
    <section class="card">
      <div class="card-h"><h2 class="card-t" style="margin:0">${ICONS.chart}Total page views per month</h2>
        <span class="card-tools note">Checked ${esc(fmtDateTime(report.runAt))}</span></div>
      <div class="chart-box"><canvas id="ap-canvas" height="220" role="img" aria-label="Total page views per month across counted sites"></canvas></div>
      <div class="chart-legend"><span><i class="partial"></i>Current month so far (still filling in)</span></div>
    </section>
    <section class="card">
      <div class="card-h"><h2 class="card-t" style="margin:0">${ICONS.info}What’s counted</h2></div>
      <div class="rules" id="ap-rules"></div>
    </section>
    <section class="card">
      <div class="card-h"><h2 class="card-t" style="margin:0">${ICONS.pulse}Properties</h2></div>
      <div class="toolbar">
        <label class="search">${ICONS.search}<input id="ap-q" class="input" type="search" placeholder="Search account, property or website…" autocomplete="off" aria-label="Search properties" /></label>
        <div class="chips" id="ap-chips" role="group" aria-label="Filter properties"></div>
        <button class="btn btn-ghost" id="ap-reset" type="button">Undo my changes</button>
        <span class="count" id="ap-count" aria-live="polite"></span>
      </div>
      <div id="ap-body"></div>
    </section>`
        : `<section class="card"><div class="empty">No properties yet. Run the “PMW — All GA4 properties: page views review” workflow in n8n to fill this page.</div></section>`
    }
  </div>`;
  if (!rows.length) {
    ($('#csv', main) as HTMLButtonElement).disabled = true;
    return;
  }

  const counted = () => rows.filter((p) => isCounted(p, rules, local));

  function renderStats() {
    const t = totals(counted(), report.months);
    const tile = (k: string, v: string, sub: string) =>
      `<div class="stat info"><span class="stat-k">${esc(k)}</span><span class="stat-v num">${v}</span><span class="stat-sub">${sub}</span></div>`;
    const change =
      t.changePct == null
        ? 'Page views, last full month'
        : `<span class="${t.changePct >= 0 ? 'c-good' : 'c-poor'}">${t.changePct >= 0 ? '▲' : '▼'} ${esc(fmtPct(t.changePct).replace(/^[+-]/, ''))}</span> vs ${esc(monthLabel(report.months[n - 3] ?? lastFull))}`;
    $('#ap-stats', main)!.innerHTML =
      tile(monthLabel(lastFull), fmtInt(t.last), change) +
      tile(
        'Average per month',
        fmtInt(t.avg),
        `${esc(monthLabel(report.months[0]!))} – ${esc(monthLabel(lastFull))}`,
      ) +
      tile('Last 12 months', fmtInt(t.total), 'Total page views, full months') +
      tile('Sites counted', fmtInt(t.count), `of ${fmtInt(rows.length)} GA4 properties found`);
    renderChart(
      $('#ap-canvas', main) as HTMLCanvasElement,
      report.months.map((m, i) => ({ date: `${m}-01`, value: t.byMonth[i]! })),
      {
        kind: 'bar',
        label: 'Page views',
        partialLast: true,
        height: 220,
        xLabel: (p) => monthLabel(p.date.slice(0, 7)).replace(/ (\d\d)(\d\d)$/, " '$2"),
        tipLabel: (p, i) => `${monthLabel(p.date.slice(0, 7))}${i === n - 1 ? ' (so far)' : ''}`,
      },
    );
  }

  function renderRules() {
    const count = (f: (p: PropertyRow) => boolean) => fmtInt(rows.filter(f).length);
    const RULES: Array<[RuleKey, string, string]> = [
      [
        'dup',
        'Remove duplicate websites',
        `When several properties record the same website, only the one with the most page views is counted (${count((p) => !!p.dupOf)} left out).`,
      ],
      [
        'rollup',
        'Leave out roll-up properties',
        `PMI’s “Entire Brand Network” also receives every PMI franchise site’s page views, so counting it would count PMI sites twice (${count((p) => p.rollup)}).`,
      ],
      [
        'internal',
        'Leave out sites that aren’t client websites',
        `rentvine.com, PMW’s own sites and the testing sandbox (${count((p) => p.internal)}).`,
      ],
      [
        'stale',
        'Leave out stale sites',
        `Sites with page views earlier in the year but none in the last 3 months (${count((p) => p.stale)}). Off by default because those page views were real.`,
      ],
    ];
    const teamCount = rows.filter((p) => p.team).length;
    $('#ap-rules', main)!.innerHTML =
      RULES.map(
        ([k, t, d]) =>
          `<label><input type="checkbox" data-rule="${k}" ${rules[k] ? 'checked' : ''}/><span><b>${esc(t)}</b><br><span class="hint">${esc(d)}</span></span></label>`,
      ).join('') +
      `<p class="hint" style="margin:0">Properties with no page views in the last 12 months add nothing either way (${count((p) => p.zero)}).${teamCount ? ` ${fmtInt(teamCount)} properties have a team decision, which overrides these rules.` : ''} Unticking a property below only changes this device.</p>`;
  }

  function reasonText(p: PropertyRow): string {
    if (p.id in local) return local[p.id] ? 'Added on this device' : 'Left out on this device';
    if (p.team)
      return p.team.counted
        ? 'Team: counted'
        : `Team: left out${p.team.note ? ` — ${p.team.note}` : ''}`;
    const r = ruleReason(p, rules);
    return r ? REASON_LABEL[r] : '';
  }

  function visible(): PropertyRow[] {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((p) => {
        if (needle && !`${p.name} ${p.account} ${p.site} ${p.id}`.toLowerCase().includes(needle))
          return false;
        switch (filter) {
          case 'counted':
            return isCounted(p, rules, local);
          case 'out':
            return !isCounted(p, rules, local);
          case 'dup':
            return !!p.dupOf;
          case 'stale':
            return p.stale;
          case 'zero':
            return p.zero;
          case 'internal':
            return p.internal || p.rollup;
          case 'mine':
            return p.id in local;
          default:
            return true;
        }
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }

  function renderTable() {
    $('#ap-chips', main)!.innerHTML = FILTERS.map(
      ([k, label]) =>
        `<button class="chip${filter === k ? ' is-active' : ''}" data-filter="${k}" aria-pressed="${filter === k}">${esc(label)}</button>`,
    ).join('');
    const list = visible();
    $('#ap-count', main)!.textContent = `${fmtInt(list.length)} properties`;
    const shown = list.slice(0, limit);
    $('#ap-body', main)!.innerHTML = `<div class="tbl-wrap"><table class="tbl ap-table">
      <thead><tr><th scope="col">Count</th><th scope="col">Property</th><th scope="col">Website</th>
        <th class="r" scope="col">${esc(monthLabel(lastFull))}</th><th class="r" scope="col">Last 12 months</th>
        <th scope="col">Last data</th><th scope="col">Note</th></tr></thead>
      <tbody>${
        shown
          .map((p) => {
            const on = isCounted(p, rules, local);
            const why = reasonText(p);
            return `<tr class="${on ? '' : 'is-out'}">
              <td class="inc"><input type="checkbox" data-id="${esc(p.id)}" ${on ? 'checked' : ''} aria-label="Count ${esc(p.name)}" /></td>
              <td><b>${esc(p.name)}</b><div class="acct">${esc(p.account)} · ${esc(p.id)}</div></td>
              <td class="site">${p.site ? esc(p.site) : '<span class="c-muted">No web stream</span>'}</td>
              <td class="r num">${fmtInt(p.m[n - 2] ?? 0)}</td>
              <td class="r num"><b>${fmtInt(p.total)}</b></td>
              <td class="num when">${p.last ? esc(monthLabel(p.last)) : '<span class="c-muted">—</span>'}</td>
              <td>${why ? `<span class="pill muted">${esc(why)}</span>` : ''}${p.dupOf ? ` <span class="small c-muted">same site as ${esc(rows.find((x) => x.id === p.dupOf)?.name ?? p.dupOf)}</span>` : ''}</td>
            </tr>`;
          })
          .join('') || '<tr><td colspan="7" class="c-muted">No properties match.</td></tr>'
      }</tbody></table></div>
      <div class="ap-more">${
        list.length > limit
          ? `<button class="btn btn-ghost" id="ap-more" type="button">Show ${fmtInt(Math.min(500, list.length - limit))} more</button>`
          : ''
      }</div>`;
  }

  const update = () => {
    renderStats();
    renderTable();
  };

  const view = $('#view', main)!;
  view.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.rule) {
      rules[t.dataset.rule as RuleKey] = t.checked;
      write(STORE_RULES, rules);
      return update();
    }
    if (t.dataset.id) {
      const p = rows.find((x) => x.id === t.dataset.id)!;
      const { [p.id]: _drop, ...rest } = local;
      local = rest;
      if (isCounted(p, rules, local) !== t.checked) local[p.id] = t.checked;
      write(STORE_LOCAL, local);
      return update();
    }
  });
  view.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-filter],#ap-more,#ap-reset');
    if (!t) return;
    if (t.dataset.filter) {
      filter = t.dataset.filter as Filter;
      limit = PAGE;
      return renderTable();
    }
    if (t.id === 'ap-more') {
      limit += 500;
      return renderTable();
    }
    if (t.id === 'ap-reset') {
      local = {};
      write(STORE_LOCAL, local);
      return update();
    }
  });
  $('#ap-q', main)!.addEventListener('input', (e) => {
    q = (e.target as HTMLInputElement).value;
    limit = PAGE;
    renderTable();
  });
  $('#csv', main)!.addEventListener('click', () => {
    const blob = new Blob([allPropertiesCsv(rows, report, rules, local, monthLabel)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pmw-all-sites-page-views-${lastFull}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  renderRules();
  update();
}
