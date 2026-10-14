/* Monthly page views across sites — pure helpers for the page-views view and
 * its CSV export. n8n supplies pageViewsByMonth per site (12 full months plus
 * the current month so far); this only lines the months up and adds them. */

import type { SiteSummary } from '../types/health';
import { groupLabel, siteGroups } from './filters';

export interface PageViewRow {
  site: SiteSummary;
  /** One value per month column; null when the site has no data for it. */
  values: Array<number | null>;
  /** Sum of the full months (excludes the current, partial month). */
  fullMonthsTotal: number | null;
  /** Last full month, and the one before it. */
  lastMonth: number | null;
  prevMonth: number | null;
  /** Average per full month that has data. */
  avgMonth: number | null;
  /** Last full month vs the one before, in %; null when there's no base. */
  changePct: number | null;
}

export type PageViewSort = 'total' | 'last' | 'avg' | 'change' | 'name';

export interface PageViewTable {
  /** "YYYY-MM", oldest first. The last one is the current month so far. */
  months: string[];
  rows: PageViewRow[];
  totals: Array<number>;
  fullMonthsTotal: number;
  /** Sites with no page-view data yet (GA4 not readable / not run yet). */
  missing: SiteSummary[];
}

/** Every month any site reports, oldest first. */
export function monthColumns(sites: SiteSummary[]): string[] {
  const set = new Set<string>();
  for (const s of sites) for (const m of s.pageViewsByMonth ?? []) set.add(m.month);
  return [...set].sort();
}

export function pageViewTable(sites: SiteSummary[]): PageViewTable {
  const months = monthColumns(sites);
  const full = months.length - 1; // last column is the current month
  const rows: PageViewRow[] = [];
  const missing: SiteSummary[] = [];
  for (const site of sites) {
    if (!site.pageViewsByMonth?.length) {
      missing.push(site);
      continue;
    }
    const by = new Map(site.pageViewsByMonth.map((m) => [m.month, m.pageViews]));
    const values = months.map((m) => (by.has(m) ? by.get(m)! : null));
    const fullVals = values.slice(0, full);
    const fullMonthsTotal = fullVals.reduce<number>((t, v) => t + (v ?? 0), 0);
    const known = fullVals.filter((v): v is number => v != null);
    const lastMonth = full >= 1 ? (values[full - 1] ?? null) : null;
    const prevMonth = full >= 2 ? (values[full - 2] ?? null) : null;
    rows.push({
      site,
      values,
      fullMonthsTotal,
      lastMonth,
      prevMonth,
      avgMonth: known.length ? Math.round(fullMonthsTotal / known.length) : null,
      changePct: pctChange(lastMonth, prevMonth),
    });
  }
  rows.sort(
    (a, b) =>
      (b.fullMonthsTotal ?? 0) - (a.fullMonthsTotal ?? 0) || a.site.name.localeCompare(b.site.name),
  );
  const totals = months.map((_, i) => rows.reduce((t, r) => t + (r.values[i] ?? 0), 0));
  const fullMonthsTotal = rows.reduce((t, r) => t + (r.fullMonthsTotal ?? 0), 0);
  missing.sort((a, b) => a.name.localeCompare(b.name));
  return { months, rows, totals, fullMonthsTotal, missing };
}

function pctChange(cur: number | null, prev: number | null): number | null {
  if (cur == null || !prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** Summary numbers for the Total row, same shape as a site row's. */
export function totalSummary(t: PageViewTable) {
  const full = t.months.length - 1;
  const lastMonth = full >= 1 ? t.totals[full - 1]! : null;
  const prevMonth = full >= 2 ? t.totals[full - 2]! : null;
  return {
    lastMonth,
    prevMonth,
    avgMonth: full >= 1 ? Math.round(t.fullMonthsTotal / full) : null,
    changePct: pctChange(lastMonth, prevMonth),
  };
}

/** Rows matching a name/domain search, sorted. Ties fall back to name. */
export function sortRows(
  rows: PageViewRow[],
  sort: PageViewSort,
  dir: 'asc' | 'desc',
  q = '',
): PageViewRow[] {
  const needle = q.trim().toLowerCase();
  const key: Record<Exclude<PageViewSort, 'name'>, (r: PageViewRow) => number | null> = {
    total: (r) => r.fullMonthsTotal,
    last: (r) => r.lastMonth,
    avg: (r) => r.avgMonth,
    change: (r) => r.changePct,
  };
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .filter(
      (r) =>
        !needle ||
        r.site.name.toLowerCase().includes(needle) ||
        r.site.domain.toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      if (sort === 'name') return sign * a.site.name.localeCompare(b.site.name);
      const av = key[sort](a);
      const bv = key[sort](b);
      // Sites without a value always go last.
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      return sign * (av - bv) || a.site.name.localeCompare(b.site.name);
    });
}

/** "2026-10" → "Oct 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Quote a CSV field; neutralise leading = + - @ so spreadsheets don't run it. */
function csvField(v: string | number | null): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function pageViewsCsv(t: PageViewTable): string {
  const head = [
    'Site',
    'Domain',
    'Groups',
    ...t.months.map((m, i) =>
      i === t.months.length - 1 ? `${monthLabel(m)} (to date)` : monthLabel(m),
    ),
    `Total (last ${Math.max(0, t.months.length - 1)} full months)`,
  ];
  const lines = [head];
  for (const r of t.rows)
    lines.push([
      r.site.name,
      r.site.domain,
      siteGroups(r.site).map(groupLabel).join(' + '),
      ...r.values.map((v) => (v == null ? '' : String(v))),
      String(r.fullMonthsTotal ?? ''),
    ]);
  lines.push([
    `Total (${t.rows.length} sites)`,
    '',
    '',
    ...t.totals.map(String),
    String(t.fullMonthsTotal),
  ]);
  return lines.map((l) => l.map(csvField).join(',')).join('\r\n') + '\r\n';
}
