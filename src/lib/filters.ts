/* Dashboard filtering and sorting. Pure functions over what n8n returned —
 * they only choose which rows to show, never re-judge a site's health. */

import type { HealthStatus, SiteSummary } from '../types/health';
import { STATUS_META } from './status';

export type StatusFilter = 'all' | HealthStatus;
export type IssueFilter = 'any' | 'tracking' | 'analytics' | 'data-quality' | 'conversions';
export type SortKey = 'health' | 'name' | 'checked';

export interface SiteQuery {
  status: StatusFilter;
  issue: IssueFilter;
  q: string;
  sort: SortKey;
}

export const DEFAULT_QUERY: SiteQuery = { status: 'all', issue: 'any', q: '', sort: 'health' };

export const STATUS_FILTERS: Array<[StatusFilter, string]> = [
  ['all', 'All sites'],
  ['healthy', 'Healthy'],
  ['warning', 'Warning'],
  ['critical', 'Critical'],
];

export const ISSUE_FILTERS: Array<[IssueFilter, string]> = [
  ['any', 'Any issue type'],
  ['tracking', 'Tracking issues'],
  ['analytics', 'Analytics issues'],
  ['data-quality', 'Data quality'],
  ['conversions', 'Conversion issues'],
];

export function parseQuery(params: URLSearchParams): SiteQuery {
  const pick = <T extends string>(v: string | null, allowed: Array<[T, string]> | T[], d: T): T => {
    const keys = (allowed as Array<[T, string] | T>).map((a) => (Array.isArray(a) ? a[0] : a));
    return v && (keys as string[]).includes(v) ? (v as T) : d;
  };
  return {
    status: pick(params.get('status'), STATUS_FILTERS, DEFAULT_QUERY.status),
    issue: pick(params.get('issue'), ISSUE_FILTERS, DEFAULT_QUERY.issue),
    q: (params.get('q') || '').slice(0, 100),
    sort: pick<SortKey>(params.get('sort'), ['health', 'name', 'checked'], DEFAULT_QUERY.sort),
  };
}

/** Only non-default values, so shared URLs stay short. */
export function queryToParams(q: SiteQuery): URLSearchParams {
  const p = new URLSearchParams();
  (Object.keys(DEFAULT_QUERY) as Array<keyof SiteQuery>).forEach((k) => {
    if (q[k] && q[k] !== DEFAULT_QUERY[k]) p.set(k, q[k]);
  });
  return p;
}

function matchesIssue(s: SiteSummary, f: IssueFilter): boolean {
  if (f === 'any') return true;
  if (f === 'conversions') return s.hasConversionIssue;
  return s.issueCategories.includes(f);
}

function matchesText(s: SiteSummary, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return s.name.toLowerCase().includes(needle) || s.domain.toLowerCase().includes(needle);
}

export function applyQuery(sites: SiteSummary[], q: SiteQuery): SiteSummary[] {
  const out = sites.filter(
    (s) =>
      (q.status === 'all' || s.status === q.status) &&
      matchesIssue(s, q.issue) &&
      matchesText(s, q.q),
  );
  const byName = (a: SiteSummary, b: SiteSummary) => a.name.localeCompare(b.name);
  if (q.sort === 'name') return out.sort(byName);
  if (q.sort === 'checked') {
    // Oldest check first — the sites whose data is most out of date.
    return out.sort(
      (a, b) => (a.lastChecked ?? '').localeCompare(b.lastChecked ?? '') || byName(a, b),
    );
  }
  return out.sort(
    (a, b) =>
      STATUS_META[b.status].rank - STATUS_META[a.status].rank ||
      b.issueCounts.critical - a.issueCounts.critical ||
      b.issueCounts.warning - a.issueCounts.warning ||
      byName(a, b),
  );
}

/** Count per issue filter, for the chip badges. */
export function issueFilterCounts(sites: SiteSummary[]): Record<IssueFilter, number> {
  const r = {} as Record<IssueFilter, number>;
  for (const [f] of ISSUE_FILTERS) r[f] = sites.filter((s) => matchesIssue(s, f)).length;
  return r;
}
