import { describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/config';
import { createApiProvider, ENDPOINTS } from '../src/services/apiProvider';
import { createMockProvider } from '../src/services/mockProvider';
import {
  assertHistory,
  assertSiteDetail,
  assertSites,
  assertSummary,
} from '../src/services/contract';
import { DataError } from '../src/services/provider';

const NOW = new Date('2026-10-01T09:30:00');
const mock = createMockProvider({ latencyMs: 0, now: () => NOW });

describe('config', () => {
  it('defaults to mock', () => {
    expect(readConfig({}).dataSource).toBe('mock');
  });
  it('falls back to mock when api is requested without a base URL', () => {
    expect(readConfig({ VITE_DATA_SOURCE: 'api' }).dataSource).toBe('mock');
  });
  it('uses the api when configured and strips trailing slashes', () => {
    const c = readConfig({
      VITE_DATA_SOURCE: 'API',
      VITE_API_BASE_URL: 'https://n8n.test/webhook/pmw/',
    });
    expect(c).toMatchObject({ dataSource: 'api', apiBaseUrl: 'https://n8n.test/webhook/pmw' });
  });
});

describe('mock provider matches the n8n contract', () => {
  it('summary counts agree with the site list', async () => {
    const summary = assertSummary(await mock.getHealthSummary());
    const sites = assertSites(await mock.getSites());
    expect(summary.total).toBe(sites.length);
    expect(summary.healthy + summary.warning + summary.critical).toBe(sites.length);
    expect(summary.critical).toBe(sites.filter((s) => s.status === 'critical').length);
  });

  it('every site detail and history passes the contract guards', async () => {
    for (const s of await mock.getSites()) {
      const d = assertSiteDetail(await mock.getSite(s.id));
      expect(d.id).toBe(s.id);
      const h = await mock.getSiteHistory(s.id, 7);
      assertHistory(h);
    }
  });

  it('summary rows omit detail-only fields', async () => {
    const [row] = await mock.getSites();
    expect(row).not.toHaveProperty('issues');
    expect(row).not.toHaveProperty('tracking');
  });

  it('models a conversion drop as critical with a "possible tracking issue" comparison', async () => {
    const d = (await mock.getSite('harbor-lane'))!;
    expect(d.status).toBe('critical');
    expect(d.checks.conversions).toBe('fail');
    expect(d.hasConversionIssue).toBe(true);
    const h = (await mock.getSiteHistory('harbor-lane', 7))!;
    const conv = h.comparisons.find((c) => c.metric === 'conversions')!;
    expect(conv.current).toBe(0);
    expect(conv.previous).toBeGreaterThan(0);
    expect(conv.status).toBe('critical');
    expect(conv.note).toMatch(/conversion tracking/i);
  });

  it('an inaccessible property has no GA4 numbers and no history', async () => {
    const d = (await mock.getSite('silver-oak'))!;
    expect(d.last24h).toBeNull();
    expect(d.checks.data).toBe('fail');
    expect(d.events.every((e) => e.result === 'unknown' && e.count24h === null)).toBe(true);
    const h = (await mock.getSiteHistory('silver-oak', 30))!;
    expect(h.days).toHaveLength(0);
  });

  it('returns the requested number of days, and null for unknown sites', async () => {
    expect((await mock.getSiteHistory('oakridge-pm', 30))!.days).toHaveLength(30);
    expect(await mock.getSite('nope')).toBeNull();
    expect(await mock.getSiteHistory('nope', 7)).toBeNull();
  });

  it('only uses reserved .example domains', async () => {
    for (const s of await mock.getSites()) expect(s.domain).toMatch(/\.example$/);
  });

  it('is deterministic for the same clock', async () => {
    const other = createMockProvider({ latencyMs: 0, now: () => NOW });
    expect(await other.getSiteHistory('riverbend', 14)).toEqual(
      await mock.getSiteHistory('riverbend', 14),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api provider', () => {
  const cfg = { apiBaseUrl: 'https://n8n.test/webhook/pmw', apiTimeoutMs: 50 };

  it('builds endpoint URLs from the base and encodes ids', async () => {
    const detail = await mock.getSite('oakridge-pm');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detail));
    const api = createApiProvider(cfg, fetchMock);
    await api.getSite('a b/c');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://n8n.test/webhook/pmw/sites/a%20b%2Fc');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'GET', credentials: 'omit' });
    expect(ENDPOINTS.siteHistory('x', 30)).toBe('/sites/x/history?days=30');
  });

  it('never sends an Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(await mock.getHealthSummary()));
    await createApiProvider(cfg, fetchMock).getHealthSummary();
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
  });

  it('accepts an n8n { data } envelope', async () => {
    const sites = await mock.getSites();
    const api = createApiProvider(cfg, vi.fn().mockResolvedValue(jsonResponse({ data: sites })));
    expect(await api.getSites()).toHaveLength(sites.length);
  });

  it('maps 404 to null for a site', async () => {
    const api = createApiProvider(
      cfg,
      vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 404)),
    );
    expect(await api.getSite('missing')).toBeNull();
  });

  it('raises typed errors for HTTP, contract and network failures', async () => {
    const http = createApiProvider(cfg, vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(http.getSites()).rejects.toMatchObject({ kind: 'http', status: 500 });

    const bad = createApiProvider(cfg, vi.fn().mockResolvedValue(jsonResponse([{ id: 'x' }])));
    await expect(bad.getSites()).rejects.toMatchObject({ kind: 'contract' });

    const down = createApiProvider(
      cfg,
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    await expect(down.getSites()).rejects.toBeInstanceOf(DataError);
  });

  it('times out slow responses', async () => {
    const slow = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) =>
          init.signal!.addEventListener('abort', () => rej(new Error('aborted'))),
        ),
    );
    await expect(
      createApiProvider(cfg, slow as unknown as typeof fetch).getHealthSummary(),
    ).rejects.toMatchObject({
      kind: 'timeout',
    });
  });
});
