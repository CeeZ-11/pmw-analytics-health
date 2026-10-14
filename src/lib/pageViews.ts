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
}

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
    const fullMonthsTotal = values.slice(0, full).reduce<number>((t, v) => t + (v ?? 0), 0);
    rows.push({ site, values, fullMonthsTotal });
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
