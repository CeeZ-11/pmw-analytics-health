/* Turns the SAMPLE inventory + scenarios into the exact response shapes n8n
 * will return (types/health.ts). This file is the mock stand-in for n8n's
 * analysis — status verdicts and period comparisons are decided here only so
 * the sample data looks coherent. In api mode nothing here runs, and the
 * real dashboard views never make these decisions themselves. */

import type {
  CheckItem,
  CheckResult,
  DailyMetrics,
  ExpectedItemStatus,
  HealthStatus,
  HealthSummary,
  Issue,
  IssueCategory,
  MetricTotals,
  PeriodComparison,
  SiteDetail,
  SiteHistory,
  SiteSummary,
} from '../types/health';
import { MOCK_SITES, type CheckOverrides, type MockSite } from './inventory';
import { SCENARIOS } from './scenarios';

const HISTORY_DAYS = 90;
const PERIOD_DAYS = 7;
const DAY_MS = 86_400_000;

// ------------------------------------------------------------ deterministic
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The sample "n8n run" happens daily at 3:00 AM local time. */
export function lastRunTime(now: Date): Date {
  const run = new Date(now);
  run.setHours(3, 0, 0, 0);
  if (now.getTime() < run.getTime() + 20 * 60_000) run.setDate(run.getDate() - 1);
  return run;
}

// ------------------------------------------------------------------ checks
const TRACKING_CHECKS: Array<[string, string, string]> = [
  ['ga4_tag', 'GA4 detected', 'GA4 config found on every crawled page.'],
  ['gtm_container', 'GTM detected', 'Expected GTM container found in <head>.'],
  [
    'measurement_id',
    'Measurement ID matches inventory',
    'All pages send to the expected GA4 stream.',
  ],
  ['tracking_request', 'Tracking request detected', 'GA4 collect requests observed on page load.'],
  ['duplicate', 'No duplicate tracking', 'One GA4 installation per page.'],
];
const GA4_CHECKS: Array<[string, string, string]> = [
  ['property_access', 'Property accessible', 'GA4 Data API query succeeded.'],
  ['recent_data', 'Recent data received', 'Sessions recorded in the last 24 hours.'],
  ['events', 'Events received', 'All expected events received.'],
  ['conversions', 'Conversions received', 'All expected conversions received.'],
];

function buildChecks(
  defs: Array<[string, string, string]>,
  overrides: CheckOverrides = {},
): CheckItem[] {
  return defs.map(([key, label, okDetail]) => {
    const o = overrides[key];
    return { key, label, result: o?.result ?? 'pass', detail: o ? o.detail : okDetail };
  });
}

const RANK: Record<CheckResult, number> = { pass: 0, unknown: 1, warn: 2, fail: 3 };
function worst(...results: Array<CheckResult | undefined>): CheckResult {
  return results.reduce<CheckResult>((w, r) => (r && RANK[r] > RANK[w] ? r : w), 'pass');
}
function resultOf(items: CheckItem[], key: string): CheckResult | undefined {
  return items.find((c) => c.key === key)?.result;
}

// ----------------------------------------------------------------- history
function buildDays(s: MockSite, now: Date): DailyMetrics[] {
  const spec = SCENARIOS[s.scenario];
  if (spec.noGa4Data) return [];
  const rand = rng(hashSeed(s.id));
  const sessionsPerUser = 1.3 + rand() * 0.3;
  const eventsPerSession = 4 + rand() * 2;
  const convRate = 0.008 + rand() * 0.012;
  const yesterday = new Date(lastRunTime(now).getTime() - DAY_MS);
  const days: DailyMetrics[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(yesterday.getTime() - i * DAY_MS);
    const weekend = d.getDay() === 0 || d.getDay() === 6 ? 0.78 : 1;
    const drift = 1 + ((HISTORY_DAYS - i) / HISTORY_DAYS) * 0.06; // slow growth
    const users = Math.round(s.baseUsers * weekend * drift * (0.93 + rand() * 0.14));
    const sessions = Math.round(users * sessionsPerUser * (0.97 + rand() * 0.06));
    const events = Math.round(sessions * eventsPerSession * (0.96 + rand() * 0.08));
    const conversions = Math.round(users * convRate * (0.7 + rand() * 0.6));
    const day: DailyMetrics = { date: isoDate(d), users, sessions, events, conversions };
    const h = spec.history;
    if (h && i < h.days) {
      for (const k of ['users', 'sessions', 'events', 'conversions'] as const) {
        if (h[k] !== undefined) day[k] = Math.round(day[k] * (h[k] as number));
      }
    }
    days.push(day);
  }
  return days;
}

function sum(days: DailyMetrics[], k: keyof MetricTotals): number {
  return days.reduce((t, d) => t + d[k], 0);
}

function compare(days: DailyMetrics[]): PeriodComparison[] {
  if (days.length < PERIOD_DAYS * 2) return [];
  const cur = days.slice(-PERIOD_DAYS);
  const prev = days.slice(-PERIOD_DAYS * 2, -PERIOD_DAYS);
  return (['users', 'sessions', 'events', 'conversions'] as const).map((metric) => {
    const current = sum(cur, metric);
    const previous = sum(prev, metric);
    const changePct = previous ? Math.round(((current - previous) / previous) * 1000) / 10 : 0;
    let status: HealthStatus = 'healthy';
    let note: string | undefined;
    if ((previous > 0 && current === 0) || changePct <= -50) {
      status = 'critical';
      note =
        metric === 'conversions'
          ? 'Possible conversion tracking issue'
          : `Possible ${metric} tracking issue`;
    } else if (changePct <= -25) {
      status = 'warning';
      note = `${metric[0]!.toUpperCase()}${metric.slice(1)} well below the previous ${PERIOD_DAYS} days`;
    } else if (changePct >= 50) {
      status = 'warning';
      note = `Unusual spike — check for duplicate tracking`;
    }
    return { metric, previous, current, changePct, status, ...(note ? { note } : {}) };
  });
}

// ------------------------------------------------------------------- sites
function expectedItems(
  names: string[],
  missing: string[] = [],
  missingResult: CheckResult,
  noData: boolean,
  counts: (name: string, i: number) => number,
): ExpectedItemStatus[] {
  return names.map((name, i) => {
    if (noData) return { name, result: 'unknown', count24h: null };
    if (missing.includes(name)) return { name, result: missingResult, count24h: 0 };
    return { name, result: 'pass', count24h: counts(name, i) };
  });
}

function buildDetail(s: MockSite, index: number, now: Date): SiteDetail {
  const spec = SCENARIOS[s.scenario];
  const run = lastRunTime(now);
  const lastChecked = new Date(run.getTime() + index * 47_000).toISOString();
  const days = buildDays(s, now);
  const comparisons = compare(days);
  const last = days.at(-1);
  const last24h: MetricTotals | null = last
    ? {
        users: last.users,
        sessions: last.sessions,
        events: last.events,
        conversions: last.conversions,
      }
    : null;

  const tracking = buildChecks(TRACKING_CHECKS, spec.tracking);
  const ga4 = buildChecks(GA4_CHECKS, spec.ga4);

  const events = expectedItems(
    s.expectedEvents,
    spec.missingEvents,
    resultOf(ga4, 'events') === 'fail' ? 'fail' : 'warn',
    !!spec.noGa4Data,
    (name) => {
      const ev = last24h?.events ?? 0;
      const share: Record<string, number> = {
        page_view: 0.42,
        scroll: 0.2,
        click: 0.18,
        form_start: 0.03,
        form_submit: 0.012,
        view_listing: 0.11,
        schedule_showing: 0.006,
      };
      return Math.round(ev * (share[name] ?? 0.02));
    },
  );
  const conversions = expectedItems(
    s.expectedConversions,
    spec.missingConversions,
    resultOf(ga4, 'conversions') === 'fail' ? 'fail' : 'warn',
    !!spec.noGa4Data,
    (_n, i) => Math.round((last24h?.conversions ?? 0) * (i === 0 ? 0.7 : 0.3)),
  );

  const issues: Issue[] = spec.issues.map(({ daysAgo = 0, compare: metric, ...rest }, i) => {
    const c = metric ? comparisons.find((x) => x.metric === metric) : undefined;
    return {
      id: `${s.id}-${rest.code}-${i}`,
      ...rest,
      detectedAt: new Date(run.getTime() - daysAgo * DAY_MS).toISOString(),
      ...(c
        ? {
            comparison: {
              metric: c.metric,
              previous: c.previous,
              current: c.current,
              changePct: c.changePct,
            },
          }
        : {}),
    };
  });

  const status: HealthStatus = issues.some((x) => x.severity === 'critical')
    ? 'critical'
    : issues.length
      ? 'warning'
      : 'healthy';
  const issueCategories = [...new Set(issues.map((x) => x.category))] as IssueCategory[];
  const { scenario: _scenario, baseUsers: _baseUsers, ...inventory } = s;

  return {
    ...inventory,
    status,
    lastChecked,
    checks: {
      ga4: worst(
        resultOf(tracking, 'ga4_tag'),
        resultOf(tracking, 'measurement_id'),
        resultOf(tracking, 'duplicate'),
      ),
      gtm: worst(resultOf(tracking, 'gtm_container')),
      data: worst(resultOf(ga4, 'property_access'), resultOf(ga4, 'recent_data')),
      events: worst(resultOf(ga4, 'events')),
      conversions: worst(resultOf(ga4, 'conversions')),
    },
    issueCounts: {
      warning: issues.filter((x) => x.severity === 'warning').length,
      critical: issues.filter((x) => x.severity === 'critical').length,
    },
    issueCategories,
    hasConversionIssue: issues.some((x) => /conversion/.test(x.code)),
    tracking,
    ga4,
    last24h,
    events,
    conversions,
    issues,
  };
}

// --------------------------------------------------------------- public API
export function mockSiteDetails(now = new Date()): SiteDetail[] {
  return MOCK_SITES.map((s, i) => buildDetail(s, i, now));
}

export function toSummary(d: SiteDetail): SiteSummary {
  const {
    tracking: _t,
    ga4: _g,
    last24h: _l,
    events: _e,
    conversions: _c,
    issues: _i,
    ...summary
  } = d;
  return summary;
}

export function mockHealthSummary(now = new Date()): HealthSummary {
  const sites = mockSiteDetails(now);
  return {
    generatedAt: now.toISOString(),
    lastRunAt:
      sites
        .map((s) => s.lastChecked)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
    total: sites.length,
    healthy: sites.filter((s) => s.status === 'healthy').length,
    warning: sites.filter((s) => s.status === 'warning').length,
    critical: sites.filter((s) => s.status === 'critical').length,
  };
}

export function mockHistory(id: string, days: number, now = new Date()): SiteHistory | null {
  const s = MOCK_SITES.find((x) => x.id === id);
  if (!s) return null;
  const all = buildDays(s, now);
  return { siteId: id, days: all.slice(-days), periodDays: PERIOD_DAYS, comparisons: compare(all) };
}
