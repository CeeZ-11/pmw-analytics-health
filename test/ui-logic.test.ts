import { describe, expect, it } from 'vitest';
import {
  applyQuery,
  DEFAULT_QUERY,
  groupTabs,
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
  });

  it('always offers Elite and PMI tabs, with counts that add up', async () => {
    const sites = await sitesP;
    const tabs = groupTabs(sites);
    expect(tabs.slice(0, 2).map((t) => t[1])).toEqual(['Elite', 'PMI']);
    expect(tabs.reduce((n, t) => n + t[2], 0)).toBe(sites.length);
    expect(groupTabs([]).map((t) => t[2])).toEqual([0, 0]);
    const c = statusCounts(sites);
    expect(c.healthy + c.warning + c.critical).toBe(c.total);
  });
});
