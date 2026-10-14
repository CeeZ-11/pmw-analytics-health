import { describe, expect, it } from 'vitest';
import {
  applyQuery,
  DEFAULT_QUERY,
  groupLabel,
  groupTabs,
  siteGroups,
  statusCounts,
  issueFilterCounts,
  parseQuery,
  queryToParams,
} from '../src/lib/filters';
import { href, parseHash } from '../src/lib/router';
import { checkIcon, statusBadge } from '../src/lib/status';
import { esc } from '../src/lib/dom';
import { fmtPct, fmtRelative } from '../src/lib/format';
import { createMockProvider } from '../src/services/mockProvider';
import {
  monthLabel,
  pageViewsCsv,
  pageViewTable,
  sortRows,
  totalSummary,
} from '../src/lib/pageViews';
import type { AllPropertiesReport, GaProperty, SiteSummary } from '../src/types/health';
import {
  allPropertiesCsv,
  analyseProperties,
  DEFAULT_RULES,
  isCounted,
  totals,
} from '../src/lib/allProperties';

const sitesP = createMockProvider({
  latencyMs: 0,
  now: () => new Date('2026-10-01T09:30:00'),
}).getSites();

describe('filters', () => {
  it('round-trips through URL params, omitting defaults', () => {
    const q = { ...DEFAULT_QUERY, status: 'critical' as const, q: 'harbor' };
    const p = queryToParams(q);
    expect(p.toString()).toBe('status=critical&q=harbor');
    expect(parseQuery(p)).toEqual(q);
  });

  it('ignores invalid values', () => {
    expect(parseQuery(new URLSearchParams('status=bogus&issue=x&sort=y'))).toEqual(DEFAULT_QUERY);
  });

  it('filters by status, issue type and text (name or domain)', async () => {
    const sites = await sitesP;
    expect(
      applyQuery(sites, { ...DEFAULT_QUERY, status: 'critical' }).every(
        (s) => s.status === 'critical',
      ),
    ).toBe(true);
    expect(
      applyQuery(sites, { ...DEFAULT_QUERY, issue: 'tracking' }).every((s) =>
        s.issueCategories.includes('tracking'),
      ),
    ).toBe(true);
    expect(
      applyQuery(sites, { ...DEFAULT_QUERY, issue: 'conversions' }).map((s) => s.id),
    ).toContain('harbor-lane');
    expect(applyQuery(sites, { ...DEFAULT_QUERY, q: 'HARBORLANE' }).map((s) => s.id)).toEqual([
      'harbor-lane',
    ]);
    expect(applyQuery(sites, { ...DEFAULT_QUERY, q: 'zzz' })).toHaveLength(0);
  });

  it('sorts critical sites first by default', async () => {
    const rows = applyQuery(await sitesP, DEFAULT_QUERY);
    const ranks = rows.map((s) => ({ critical: 2, warning: 1, healthy: 0 })[s.status]);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  it('counts sites per issue filter', async () => {
    const sites = await sitesP;
    const c = issueFilterCounts(sites);
    expect(c.any).toBe(sites.length);
    expect(c.tracking).toBeGreaterThan(0);
  });
});

describe('router', () => {
  it('parses dashboard, site, integration and unknown routes', () => {
    expect(parseHash('').name).toBe('dashboard');
    expect(parseHash('#/?status=warning').params.get('status')).toBe('warning');
    expect(parseHash('#/sites/harbor-lane?days=7')).toMatchObject({
      name: 'site',
      id: 'harbor-lane',
    });
    expect(parseHash('#/integration').name).toBe('integration');
    expect(parseHash('#/sites').name).toBe('not-found');
  });

  it('round-trips encoded ids', () => {
    expect(parseHash(href.site('a b'))).toMatchObject({ name: 'site', id: 'a b' });
  });
});

describe('status + formatting', () => {
  it('always pairs color with a text label', () => {
    expect(statusBadge('critical')).toContain('Critical');
    expect(checkIcon('fail', 'GTM')).toContain('aria-label="GTM: Failed"');
    expect(checkIcon('unknown')).toContain('Not checked');
  });

  it('escapes data before it reaches innerHTML', () => {
    expect(esc('<img onerror=x>"\'&')).toBe('&lt;img onerror=x&gt;&quot;&#39;&amp;');
  });

  it('formats changes and relative times', () => {
    expect(fmtPct(-100)).toBe('-100%');
    expect(fmtPct(12.34)).toBe('+12.3%');
    expect(fmtRelative(null)).toBe('Never');
    expect(fmtRelative(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3h ago');
  });
});

describe('groups', () => {
  it('filters by group and keeps it in the URL', async () => {
    const sites = await sitesP;
    const elite = applyQuery(sites, { ...DEFAULT_QUERY, group: 'elite' });
    expect(elite.length).toBeGreaterThan(0);
    expect(elite.every((s) => s.group === 'elite')).toBe(true);
    expect(queryToParams({ ...DEFAULT_QUERY, group: 'pmi' }).toString()).toBe('group=pmi');
    expect(parseQuery(new URLSearchParams('group=PMI')).group).toBe('pmi');
    expect(parseQuery(new URLSearchParams('group=<x>')).group).toBe('all');
    expect(groupLabel('pmw')).toBe('PMW');
    const dual = sites.find((s) => siteGroups(s).length > 1)!;
    expect(applyQuery(sites, { ...DEFAULT_QUERY, group: 'pmi' })).toContainEqual(dual);
    expect(elite).toContainEqual(dual);
    expect(groupLabel('west-coast')).toBe('West Coast');
  });

  it('always offers Elite and PMI tabs, with counts that add up', async () => {
    const sites = await sitesP;
    const tabs = groupTabs(sites);
    expect(tabs.slice(0, 2).map((t) => t[1])).toEqual(['Elite', 'PMI']);
    const both = sites.filter((s) => siteGroups(s).length > 1).length;
    expect(both).toBe(1);
    expect(tabs.reduce((n, t) => n + t[2], 0)).toBe(sites.length + both);
    expect(groupTabs([]).map((t) => t[2])).toEqual([0, 0]);
    const c = statusCounts(sites);
    expect(c.healthy + c.warning + c.critical).toBe(c.total);
  });
});

describe('monthly page views', () => {
  const site = (id: string, months: Array<[string, number]> | null, group = 'elite') =>
    ({
      id,
      name: id === 'evil' ? '=HYPERLINK("x")' : `Site ${id}`,
      domain: `${id}.example`,
      group,
      pageViewsByMonth: months && months.map(([month, pageViews]) => ({ month, pageViews })),
    }) as unknown as SiteSummary;

  it('lines months up, totals full months only, and lists sites without data', () => {
    const t = pageViewTable([
      site('a', [
        ['2026-08', 100],
        ['2026-09', 200],
        ['2026-10', 50],
      ]),
      site('b', [
        ['2026-09', 1000],
        ['2026-10', 10],
      ]),
      site('c', null),
    ]);
    expect(t.months).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(t.rows.map((r) => r.site.id)).toEqual(['b', 'a']);
    expect(t.rows[0]!.values).toEqual([null, 1000, 10]);
    expect(t.rows[1]!.fullMonthsTotal).toBe(300);
    expect(t.totals).toEqual([100, 1200, 60]);
    expect(t.fullMonthsTotal).toBe(1300);
    expect(t.missing.map((s) => s.id)).toEqual(['c']);
    expect(monthLabel('2026-10')).toBe('Oct 2026');
  });

  it('exports CSV with a total row and no spreadsheet formulas', () => {
    const csv = pageViewsCsv(
      pageViewTable([
        site('evil', [
          ['2026-09', 5],
          ['2026-10', 1],
        ]),
      ]),
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Site,Domain,Groups,Sep 2026,Oct 2026 (to date),Total (last 1 full months)',
    );
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")",evil.example,Elite,5,1,5`);
    expect(lines[2]).toBe('Total (1 sites),,,5,1,5');
  });

  it('computes last month, change and average, and sorts / searches rows', () => {
    const t = pageViewTable([
      site('a', [
        ['2026-08', 100],
        ['2026-09', 150],
        ['2026-10', 9],
      ]),
      site('b', [
        ['2026-08', 400],
        ['2026-09', 200],
        ['2026-10', 9],
      ]),
      site('c', [
        ['2026-09', 50],
        ['2026-10', 1],
      ]),
    ]);
    const a = t.rows.find((r) => r.site.id === 'a')!;
    expect(a).toMatchObject({ lastMonth: 150, prevMonth: 100, avgMonth: 125, changePct: 50 });
    expect(t.rows.find((r) => r.site.id === 'c')!.changePct).toBeNull();
    expect(totalSummary(t)).toEqual({
      lastMonth: 400,
      prevMonth: 500,
      avgMonth: 450,
      changePct: -20,
    });
    expect(sortRows(t.rows, 'change', 'desc').map((r) => r.site.id)).toEqual(['a', 'b', 'c']);
    expect(sortRows(t.rows, 'change', 'asc').map((r) => r.site.id)).toEqual(['b', 'a', 'c']);
    expect(sortRows(t.rows, 'name', 'asc').map((r) => r.site.id)).toEqual(['a', 'b', 'c']);
    expect(sortRows(t.rows, 'total', 'desc', 'B.EXAMPLE').map((r) => r.site.id)).toEqual(['b']);
  });

  it('mock sites carry 13 months, current month last', async () => {
    const sites = await sitesP;
    const withData = sites.filter((s) => s.pageViewsByMonth?.length);
    expect(withData.length).toBeGreaterThan(0);
    expect(withData[0]!.pageViewsByMonth).toHaveLength(13);
    expect(withData[0]!.pageViewsByMonth!.at(-1)!.month).toBe('2026-10');
  });
});

describe('all PMW sites', () => {
  const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const prop = (id: string, over: Partial<GaProperty> = {}): GaProperty => ({
    id,
    account: `Account ${id}`,
    name: `Property ${id}`,
    site: `https://www.site-${id}.example/`,
    mids: `G-${id}`,
    logins: [0],
    m: [100, 100, 100, 100, 50],
    last: '2026-10',
    ...over,
  });
  const report = (properties: GaProperty[]): AllPropertiesReport => ({
    generatedAt: '2026-10-15T00:00:00Z',
    runAt: '2026-10-14T22:30:00Z',
    months,
    logins: ['a@example.com'],
    properties,
  });

  it('flags duplicates, roll-ups, internal, stale and empty properties', () => {
    const rows = analyseProperties(
      report([
        prop('big', { site: 'https://www.same.example/' }),
        prop('small', { site: 'http://same.example', m: [1, 1, 1, 1, 0] }),
        prop('roll', { mids: 'G-AAA | G-4K79NRW975' }),
        prop('rv', { account: 'Rentvine' }),
        prop('old', { m: [100, 0, 0, 0, 0], last: '2026-06' }),
        prop('none', { m: [0, 0, 0, 0, 0], last: null }),
      ]),
    );
    const f = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(f.small!.dupOf).toBe('big');
    expect(f.big!.dupOf).toBeNull();
    expect(f.big!.domain).toBe('same.example');
    expect(f.roll!.rollup).toBe(true);
    expect(f.rv!.internal).toBe(true);
    expect(f.old!.stale).toBe(true);
    expect(f.none).toMatchObject({ zero: true, stale: false });
    expect(f.big!.total).toBe(400);
  });

  it('counts by device choice, then team decision, then rules', () => {
    const rows = analyseProperties(
      report([
        prop('a'),
        prop('roll', { mids: 'G-4K79NRW975' }),
        prop('t', { team: { counted: false, note: 'old' } }),
      ]),
    );
    const counted = (local = {}, rules = DEFAULT_RULES) =>
      rows.filter((p) => isCounted(p, rules, local)).map((p) => p.id);
    expect(counted()).toEqual(['a']);
    expect(counted({}, { ...DEFAULT_RULES, rollup: false })).toEqual(['a', 'roll']);
    expect(counted({ a: false, t: true })).toEqual(['t']);
    const t = totals(
      rows.filter((p) => isCounted(p, DEFAULT_RULES)),
      months,
    );
    expect(t).toMatchObject({ count: 1, total: 400, avg: 100, last: 100, changePct: 0 });
    expect(t.byMonth).toEqual([100, 100, 100, 100, 50]);
  });

  it('exports every property with why it was left out', () => {
    const r = report([prop('a'), prop('rv', { account: 'Rentvine', name: '=cmd' })]);
    const csv = allPropertiesCsv(analyseProperties(r), r, DEFAULT_RULES, {}, monthLabel)
      .trim()
      .split('\r\n');
    expect(csv[0]).toContain('Oct 2026 (to date),Total (last 4 full months)');
    expect(csv[1]!.startsWith("No,Not a client site,Rentvine,'=cmd,rv")).toBe(true);
    expect(csv[2]!.startsWith('Yes,,Account a,Property a,a,')).toBe(true);
  });

  it('mock data covers every rule', async () => {
    const r = await createMockProvider({
      latencyMs: 0,
      now: () => new Date('2026-10-15T09:00:00'),
    }).getAllProperties();
    const rows = analyseProperties(r);
    expect(r.months).toHaveLength(13);
    for (const k of ['rollup', 'internal', 'stale', 'zero'] as const)
      expect(rows.some((p) => p[k])).toBe(true);
    expect(rows.some((p) => p.dupOf)).toBe(true);
  });
});
