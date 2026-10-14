/* All PMW GA4 properties — the rules that turn n8n's raw property list into
 * "how many page views do our client websites get". Pure functions so the
 * numbers Mikayla sees are tested, not hand-calculated.
 *
 * A property is counted unless (in priority order) the viewer changed it on
 * this device, the team made a decision in n8n, or one of these rules applies:
 *   zero      — no page views at all in the period (adds 0 either way)
 *   internal  — not a client website (rentvine.com, PMW's own sites, sandbox)
 *   rollup    — a property that also collects other sites' page views
 *   dup       — another property records the same website; keep the biggest
 *   stale     — page views earlier in the year but none in the last 3 months
 */

import type { AllPropertiesReport, GaProperty } from '../types/health';

export type RuleKey = 'dup' | 'rollup' | 'internal' | 'stale';
export type Rules = Record<RuleKey, boolean>;
export type Reason = RuleKey | 'zero';

export const DEFAULT_RULES: Rules = { dup: true, rollup: true, internal: true, stale: false };

/** GA4 accounts that are not client websites. */
export const INTERNAL_ACCOUNTS = ['PMW', 'Testing Sandbox', 'Rentvine'];
/** PMI's shared stream: every PMI franchise site also sends page views here. */
export const ROLLUP_MEASUREMENT_IDS = ['G-4K79NRW975'];

export interface PropertyRow extends GaProperty {
  domain: string;
  /** Sum of the 12 full months. */
  total: number;
  zero: boolean;
  internal: boolean;
  rollup: boolean;
  stale: boolean;
  /** Set when another property records the same website with more views. */
  dupOf: string | null;
}

/** "https://www.Example.com/path | …" → "example.com". */
export function domainOf(site: string): string {
  const first = (site || '').split(' | ')[0]!.trim().toLowerCase();
  return first
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]!
    .replace(/:\d+$/, '');
}

export function analyseProperties(r: AllPropertiesReport): PropertyRow[] {
  const full = r.months.length - 1; // the last month is still filling in
  const staleBefore = r.months[Math.max(0, full - 3)] ?? ''; // no data in the last 3 full months
  const rows: PropertyRow[] = r.properties.map((p) => {
    const total = p.m.slice(0, full).reduce((t, v) => t + v, 0);
    const zero = total === 0 && (p.m[full] ?? 0) === 0;
    return {
      ...p,
      domain: domainOf(p.site),
      total,
      zero,
      internal: INTERNAL_ACCOUNTS.includes(p.account.trim()),
      rollup:
        ROLLUP_MEASUREMENT_IDS.some((id) => p.mids.includes(id)) ||
        /entire brand network/i.test(p.name),
      stale: !zero && (!p.last || p.last < staleBefore),
      dupOf: null,
    };
  });
  const byDomain = new Map<string, PropertyRow[]>();
  for (const row of rows) {
    if (!row.domain) continue;
    const list = byDomain.get(row.domain) ?? [];
    list.push(row);
    byDomain.set(row.domain, list);
  }
  for (const list of byDomain.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
    for (const row of list.slice(1)) row.dupOf = list[0]!.id;
  }
  return rows;
}

/** Why a rule leaves this property out, or null when the rules count it. */
export function ruleReason(p: PropertyRow, rules: Rules): Reason | null {
  if (p.zero) return 'zero';
  if (rules.internal && p.internal) return 'internal';
  if (rules.rollup && p.rollup) return 'rollup';
  if (rules.dup && p.dupOf) return 'dup';
  if (rules.stale && p.stale) return 'stale';
  return null;
}

/** Device choice → team decision → rules. */
export function isCounted(
  p: PropertyRow,
  rules: Rules,
  local: Record<string, boolean> = {},
): boolean {
  if (p.id in local) return local[p.id]!;
  if (p.team) return p.team.counted;
  return ruleReason(p, rules) === null;
}

export function totals(rows: PropertyRow[], months: string[]) {
  const full = months.length - 1;
  const byMonth = months.map((_, i) => rows.reduce((t, p) => t + (p.m[i] ?? 0), 0));
  const total = byMonth.slice(0, full).reduce((t, v) => t + v, 0);
  const last = full >= 1 ? byMonth[full - 1]! : 0;
  const prev = full >= 2 ? byMonth[full - 2]! : 0;
  return {
    count: rows.length,
    byMonth,
    total,
    avg: full ? Math.round(total / full) : 0,
    last,
    changePct: prev ? Math.round(((last - prev) / prev) * 1000) / 10 : null,
  };
}

export const REASON_LABEL: Record<Reason, string> = {
  zero: 'No page views',
  internal: 'Not a client site',
  rollup: 'Roll-up property',
  dup: 'Duplicate website',
  stale: 'Stale',
};

function csvField(v: string | number | null): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function allPropertiesCsv(
  rows: PropertyRow[],
  report: AllPropertiesReport,
  rules: Rules,
  local: Record<string, boolean>,
  monthLabel: (m: string) => string,
): string {
  const full = report.months.length - 1;
  const head = [
    'Counted',
    'Why left out',
    'Account',
    'Property',
    'Property ID',
    'Website',
    'Logins',
    ...report.months.map((m, i) => (i === full ? `${monthLabel(m)} (to date)` : monthLabel(m))),
    `Total (last ${full} full months)`,
    'Last month with data',
  ];
  const lines: Array<Array<string | number | null>> = [head];
  for (const p of [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))) {
    const on = isCounted(p, rules, local);
    const why = on
      ? ''
      : p.id in local
        ? 'Left out on this device'
        : p.team
          ? `Team decision${p.team.note ? `: ${p.team.note}` : ''}`
          : REASON_LABEL[ruleReason(p, rules)!];
    lines.push([
      on ? 'Yes' : 'No',
      why,
      p.account,
      p.name,
      p.id,
      p.site,
      p.logins.map((i) => report.logins[i] ?? i).join(' / '),
      ...p.m,
      p.total,
      p.last,
    ]);
  }
  return lines.map((l) => l.map(csvField).join(',')).join('\r\n') + '\r\n';
}
