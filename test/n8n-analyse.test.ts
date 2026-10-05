/* Tests for n8n/analyse-site.js — the analysis the n8n daily monitor runs.
 * The file is evaluated the same way the n8n Code node runs it (plain script
 * text), not imported as a module. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertHistory, assertSiteDetail, assertSiteSummary } from '../src/services/contract';

const src = readFileSync(resolve(process.cwd(), 'n8n/analyse-site.js'), 'utf8').split(
  '// ---- n8n glue',
)[0];
const { analyseSite } = new Function(`${src}\nreturn { analyseSite };`)() as {
  analyseSite: (...a: unknown[]) => {
    status: string;
    summaryJson: string;
    detailJson: string;
    historyJson: string;
  };
};

const NOW = new Date('2026-10-01T13:00:00Z'); // 6 AM Pacific
const TZ = 'America/Los_Angeles';

const inv = {
  siteId: 'test-site',
  name: 'Test Site',
  domain: 'test.example',
  url: 'https://test.example/',
  ga4MeasurementId: 'G-ABC123XYZ9',
  ga4PropertyId: '123456',
  gtmContainerId: 'GTM-TEST123',
  expectedEvents: 'page_view',
  expectedConversions: 'form_submission,phone_call',
};
const html = `<html><head><script>(function(w,d,s,l,i){})(window,document,'script','dataLayer','GTM-TEST123');</script></head><body>${'x'.repeat(2000)}</body></html>`;
const home = { statusCode: 200, body: html };
const gtm = {
  data: `var data = {"tags":[{"function":"__googtag","vtp_tagId":"G-ABC123XYZ9"}]};${' '.repeat(2000)}`,
};
const prop = { timeZone: TZ };

/** GA4 daily report rows for the 90 days ending yesterday (Sep 30 in LA). */
function dailyReport(fn: (daysAgo: number) => [number, number, number, number], omitZero = false) {
  const rows = [];
  for (let ago = 90; ago >= 1; ago--) {
    const d = new Date(Date.UTC(2026, 9, 1) - ago * 86400000).toISOString().slice(0, 10);
    const m = fn(ago);
    if (omitZero && m.every((v) => v === 0)) continue;
    rows.push({
      dimensionValues: [{ value: d.replace(/-/g, '') }],
      metricValues: m.map((v) => ({ value: String(v) })),
    });
  }
  return { rows };
}
const steady = (ago: number): [number, number, number, number] => [200, 300, 1500, ago % 2 ? 3 : 2];
function eventsReport(counts: Record<string, [number, number, number]>) {
  const rows = [];
  for (const [name, [d1, cur7, prev28]] of Object.entries(counts)) {
    for (const [range, v] of [
      ['d1', d1],
      ['cur7', cur7],
      ['prev28', prev28],
    ] as const) {
      if (v)
        rows.push({
          dimensionValues: [{ value: name }, { value: range }],
          metricValues: [{ value: String(v) }],
        });
    }
  }
  return { rows };
}
const okEvents = eventsReport({
  page_view: [600, 4200, 16800],
  form_submission: [1, 10, 40],
  phone_call: [1, 7, 30],
});

function run(
  over: Partial<{ inv: object; home: object; gtm: object; daily: object; evs: object }> = {},
) {
  const row = analyseSite(
    over.inv ?? inv,
    over.home ?? home,
    over.gtm ?? gtm,
    prop,
    over.daily ?? dailyReport(steady),
    over.evs ?? okEvents,
    NOW,
  );
  return {
    row,
    summary: JSON.parse(row.summaryJson),
    detail: JSON.parse(row.detailJson),
    history: JSON.parse(row.historyJson),
    codes: JSON.parse(row.detailJson).issues.map((i: { code: string }) => i.code) as string[],
  };
}

describe('n8n analyse-site', () => {
  it('produces dashboard-contract-valid JSON for a healthy site', () => {
    const r = run();
    expect(r.row.status).toBe('healthy');
    expect(r.codes).toEqual([]);
    assertSiteSummary(r.summary);
    assertSiteDetail(r.detail);
    assertHistory(r.history);
    expect(r.summary.checks).toEqual({
      ga4: 'pass',
      gtm: 'pass',
      data: 'pass',
      events: 'pass',
      conversions: 'pass',
    });
    expect(r.history.days).toHaveLength(90);
    expect(r.history.days.at(-1).date).toBe('2026-09-30');
    expect(r.detail.last24h.sessions).toBe(300);
  });

  it('fills days GA4 omits (all-zero rows) with zeros', () => {
    const r = run({ daily: dailyReport((ago) => (ago === 10 ? [0, 0, 0, 0] : steady(ago)), true) });
    expect(r.history.days).toHaveLength(90);
    expect(r.history.days.find((d: { date: string }) => d.date === '2026-09-21').sessions).toBe(0);
  });

  it('flags conversions dropping to zero as critical', () => {
    const r = run({ daily: dailyReport((ago) => (ago <= 9 ? [200, 300, 1500, 0] : steady(ago))) });
    expect(r.row.status).toBe('critical');
    expect(r.codes).toContain('conversion_drop');
    const conv = r.history.comparisons.find((c: { metric: string }) => c.metric === 'conversions');
    expect(conv.current).toBe(0);
    expect(conv.note).toMatch(/conversion tracking/i);
  });

  it('warns when no conversions are configured, without fake conversion drops', () => {
    const r = run({
      inv: { ...inv, expectedConversions: '' },
      daily: dailyReport(() => [200, 300, 1500, 0]),
    });
    expect(r.row.status).toBe('warning');
    expect(r.codes).toEqual(['conversions_not_configured']);
    expect(r.summary.checks.conversions).toBe('warn');
  });

  it('flags no recent data', () => {
    const r = run({ daily: dailyReport((ago) => (ago <= 2 ? [0, 0, 0, 0] : steady(ago))) });
    expect(r.row.status).toBe('critical');
    expect(r.codes).toContain('no_recent_data');
    expect(r.codes).not.toContain('traffic_drop');
  });

  it('flags a traffic drop', () => {
    const r = run({
      daily: dailyReport((ago) => (ago >= 2 && ago <= 8 ? [80, 120, 600, 2] : steady(ago))),
    });
    expect(r.codes).toContain('traffic_drop');
  });

  it('detects a missing or wrong GTM container', () => {
    expect(run({ home: { statusCode: 200, body: 'x'.repeat(3000) } }).codes).toContain(
      'gtm_missing',
    );
    const wrong = run({
      home: { statusCode: 200, body: html.replace('GTM-TEST123', 'GTM-OTHER99') },
    });
    expect(wrong.codes).toContain('gtm_container_mismatch');
  });

  it('detects a wrong measurement ID and a missing GA4 tag', () => {
    const wrong = run({ gtm: { data: gtm.data.replace('G-ABC123XYZ9', 'G-ZZZ999YYY8') } });
    expect(wrong.codes).toContain('measurement_id_mismatch');
    expect(wrong.row.status).toBe('critical');
    const none = run({ gtm: { data: gtm.data.replace('"G-ABC123XYZ9"', '"none"') } });
    expect(none.codes).toContain('ga4_missing');
  });

  it('detects duplicate GA4 installs', () => {
    const r = run({
      home: {
        statusCode: 200,
        body:
          html + '<script src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9"></script>',
      },
    });
    expect(r.codes).toContain('duplicate_tracking');
  });

  it('detects two Google tags for the same ID inside GTM', () => {
    const tag = '{"function":"__googtag","once_per_event":true,"vtp_tagId":"G-ABC123XYZ9"}';
    const twice = run({ gtm: { data: `var data = {"tags":[${tag},${tag}]};${' '.repeat(2000)}` } });
    const dup = twice.detail.issues.find((i: { code: string }) => i.code === 'duplicate_tracking');
    expect(dup.title).toBe('Duplicate Google tag in GTM');
    expect(twice.summary.checks.ga4).toBe('warn');
    expect(run().codes).not.toContain('duplicate_tracking');
  });

  it('treats a failed homepage fetch as unknown tracking, not missing tracking', () => {
    const r = run({ home: { error: { message: 'timeout of 30000ms exceeded' } } });
    expect(r.codes).toEqual(['crawl_failed']);
    expect(r.detail.tracking.find((t: { key: string }) => t.key === 'gtm_container').result).toBe(
      'unknown',
    );
  });

  it('reports an inaccessible GA4 property as critical', () => {
    const r = run({
      daily: {
        error: { message: '403 - PERMISSION_DENIED: User does not have sufficient permissions' },
      },
    });
    expect(r.codes).toEqual(['property_inaccessible']);
    expect(r.detail.last24h).toBeNull();
    assertSiteDetail(r.detail);
  });

  it('flags an expected conversion that stopped, with a clean issue code', () => {
    const r = run({
      evs: eventsReport({
        page_view: [600, 4200, 16800],
        form_submission: [0, 0, 40],
        phone_call: [1, 7, 30],
      }),
    });
    const i = r.detail.issues.find(
      (x: { code: string }) => x.code === 'expected_conversion_missing',
    );
    expect(i.title).toContain('form_submission');
    expect(i.id).toBe('test-site-expected_conversion_missing-form_submission');
  });
});

const slackSrc = readFileSync(resolve(process.cwd(), 'n8n/slack-messages.js'), 'utf8').split(
  '// ---- n8n glue',
)[0];
const { buildSlackMessages } = new Function(`${slackSrc}\nreturn { buildSlackMessages };`)() as {
  buildSlackMessages: (cur: unknown[], prev: unknown[], now: Date) => string[];
};

describe('n8n slack messages', () => {
  const site = (i: number, group: string, status = 'warning') => {
    const r = run({
      inv: {
        ...inv,
        siteId: `s${i}`,
        name: `Site ${i}`,
        siteGroup: group,
        expectedConversions: '',
      },
    });
    return { ...r.row, status, detailJson: r.row.detailJson };
  };

  it('posts one summary per group, Elite first, with the group in the site', () => {
    const msgs = buildSlackMessages([site(1, 'pmi'), site(2, 'elite')], [], NOW);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toContain('· Elite —');
    expect(msgs[1]).toContain('· PMI —');
    expect(msgs[1]).toContain('?group=pmi');
    expect(JSON.parse(run({ inv: { ...inv, siteGroup: 'PMI' } }).row.summaryJson).group).toBe(
      'pmi',
    );
  });

  it('caps the needs-attention list for big groups', () => {
    const many = Array.from({ length: 40 }, (_, i) => site(i, 'pmi'));
    const [msg] = buildSlackMessages(many, [], NOW);
    expect(msg!.match(/:large_yellow_circle: </g)).toHaveLength(15);
    expect(msg).toContain('and 25 more');
  });
});
