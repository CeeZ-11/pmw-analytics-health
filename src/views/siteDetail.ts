/* Site detail — overall verdict, open issues, tracking + GA4 checks, last
 * 24 hours, expected events/conversions and the historical view. Everything
 * rendered here is n8n's verdict; the page makes no judgements of its own. */

import type {
  CheckItem,
  ExpectedItemStatus,
  Issue,
  MetricTotals,
  SiteDetail,
  SiteHistory,
} from '../types/health';
import { analyticsHealth } from '../services/analyticsHealth';
import { $, esc, ICONS } from '../lib/dom';
import { fmtDateTime, fmtDay, fmtInt, fmtPct } from '../lib/format';
import { CATEGORY_LABEL, issueLabel } from '../lib/issues';
import { href, replaceHash } from '../lib/router';
import { CHECK_META, checkIcon, severityPill, STATUS_META, statusBadge } from '../lib/status';
import { renderChart } from '../lib/chart';
import { card, errorState, initials, loading, notFound, sampleNotice } from '../components/ui';
import { dashboardHref } from './dashboard';
import type { ViewContext } from './context';

type Metric = keyof MetricTotals;
const METRICS: Array<[Metric, string]> = [
  ['users', 'Users'],
  ['sessions', 'Sessions'],
  ['events', 'Events'],
  ['conversions', 'Conversions'],
];
const RANGES = [7, 14, 30, 90] as const;

function readView(params: URLSearchParams) {
  const m = params.get('metric') as Metric | null;
  const d = Number(params.get('days'));
  return {
    metric: METRICS.some(([k]) => k === m) ? (m as Metric) : ('users' as Metric),
    days: (RANGES as readonly number[]).includes(d) ? d : 30,
  };
}

export async function renderSiteDetail(
  ctx: ViewContext,
  id: string,
  params: URLSearchParams,
): Promise<void> {
  const { main } = ctx;
  const view = readView(params);
  main.innerHTML = loading([60, 70, 240, 320]);
  let site: SiteDetail | null;
  let history: SiteHistory | null;
  try {
    [site, history] = await Promise.all([
      analyticsHealth.getSite(id),
      analyticsHealth.getSiteHistory(id, view.days),
    ]);
  } catch (err) {
    if (!ctx.isCurrent()) return;
    main.innerHTML = errorState(err);
    $('#retry', main)?.addEventListener('click', () => renderSiteDetail(ctx, id, params));
    return;
  }
  if (!ctx.isCurrent()) return;
  if (!site) {
    document.title = 'Site not found · PMW Analytics Health';
    main.innerHTML = notFound(`No monitored site with the ID “${id}”.`);
    return;
  }
  document.title = `${site.name} · PMW Analytics Health`;
  const s = site;
  const meta = STATUS_META[s.status];

  main.innerHTML = `<div class="view" id="view">
    <a class="crumb" href="${dashboardHref()}">${ICONS.back}All sites</a>
    <header class="detail-head">
      <span class="site-ini" aria-hidden="true">${initials(s.name)}</span>
      <div style="min-width:0">
        <h1 class="ws-title">${esc(s.name)} ${statusBadge(s.status, { size: 'lg' })}</h1>
        <div class="detail-meta">
          <a href="https://${esc(s.domain)}" target="_blank" rel="noopener noreferrer">${esc(s.domain)}${ICONS.external}</a>
          <span>${ICONS.clock} Last checked ${esc(fmtDateTime(s.lastChecked))}</span>
        </div>
      </div>
    </header>
    ${sampleNotice(analyticsHealth.source)}
    <div class="verdict ${meta.tone}">${statusBadge(s.status)}<div><div class="verdict-t">${esc(verdictText(s))}</div><div class="verdict-d">${esc(meta.description)}</div></div></div>
    <div class="detail-grid">
      <div class="detail-main">
        ${issuesCard(s.issues)}
        <div class="two-col">
          ${card('Tracking', checkList(s.tracking), { icon: ICONS.tag, sub: 'What the crawler found on the live site.' })}
          ${card('GA4', checkList(s.ga4), { icon: ICONS.chart, sub: 'What the GA4 Data API returned for this property.' })}
        </div>
        ${card('Last 24 hours', last24h(s.last24h), { icon: ICONS.clock })}
        <section class="card" id="history-card"></section>
      </div>
      <aside class="detail-side">
        ${card('Site inventory', inventory(s))}
        ${card('Expected events', expectedList(s.events, 'No expected events configured.'), { sub: 'Count over the last 24 hours.' })}
        ${card('Expected conversions', expectedList(s.conversions, 'No expected conversions configured.'), { sub: 'Count over the last 24 hours.' })}
      </aside>
    </div></div>`;

  // History re-renders on its own when the metric/range changes; only a
  // range change needs a new request.
  const state = { ...view };
  let hist = history;
  const historyCard = $('#history-card', main)!;
  const paintHistory = () => {
    historyCard.innerHTML = historyBody(hist, state.metric, state.days);
    const canvas = $<HTMLCanvasElement>('#history-canvas', historyCard);
    if (canvas && hist) {
      renderChart(
        canvas,
        hist.days.map((d) => ({ date: d.date, value: d[state.metric] })),
        {
          kind: state.metric === 'conversions' ? 'bar' : 'line',
          label: METRICS.find(([k]) => k === state.metric)![1],
          highlightLast: state.days > hist.periodDays ? hist.periodDays : undefined,
          height: 210,
        },
      );
    }
  };
  const syncHash = () => {
    const p = new URLSearchParams();
    if (state.metric !== 'users') p.set('metric', state.metric);
    if (state.days !== 30) p.set('days', String(state.days));
    replaceHash(href.site(s.id, p));
  };
  const loadHistory = async (days: number) => {
    state.days = days;
    syncHash();
    historyCard.setAttribute('aria-busy', 'true');
    try {
      const next = await analyticsHealth.getSiteHistory(s.id, days);
      if (!ctx.isCurrent() || state.days !== days) return;
      hist = next;
      paintHistory();
    } catch (err) {
      if (!ctx.isCurrent()) return;
      historyCard.innerHTML = errorState(err, 'history-retry');
    } finally {
      historyCard.removeAttribute('aria-busy');
    }
  };
  historyCard.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#history-retry')) return void loadHistory(state.days);
    const m = t.closest<HTMLElement>('[data-metric]');
    if (m) {
      state.metric = m.dataset.metric as Metric;
      syncHash();
      return paintHistory();
    }
    const r = t.closest<HTMLElement>('[data-days]');
    if (r && Number(r.dataset.days) !== state.days) void loadHistory(Number(r.dataset.days));
  });
  paintHistory();
}

function verdictText(s: SiteDetail): string {
  const { critical, warning } = s.issueCounts;
  if (!critical && !warning) return 'All tracking and GA4 checks passed.';
  const parts = [critical && `${critical} critical`, warning && `${warning} warning`].filter(
    Boolean,
  );
  return `${parts.join(' and ')} issue${critical + warning === 1 ? '' : 's'} need${critical + warning === 1 ? 's' : ''} attention.`;
}

function issuesCard(issues: Issue[]): string {
  const sorted = [...issues].sort((a, b) =>
    a.severity === b.severity
      ? b.detectedAt.localeCompare(a.detectedAt)
      : a.severity === 'critical'
        ? -1
        : 1,
  );
  const body = sorted.length
    ? `<div class="issues">${sorted.map(issueItem).join('')}</div>`
    : '<div class="empty" style="padding:18px">No open issues. The last check found nothing unusual.</div>';
  return card('Recent issues', body, {
    icon: ICONS.alert,
    tools: sorted.length ? `<span class="pill muted">${sorted.length} open</span>` : '',
  });
}

function issueItem(i: Issue): string {
  const c = i.comparison;
  const metricName = c ? (METRICS.find(([k]) => k === c.metric)?.[1] ?? c.metric) : '';
  return `<article class="issue${i.severity === 'critical' ? ' is-critical' : ''}">
    <div class="issue-h">${severityPill(i.severity)}<span class="issue-t">${esc(i.title)}</span><span class="pill muted">${esc(CATEGORY_LABEL[i.category] ?? i.category)}</span></div>
    <p class="issue-d">${esc(i.detail)}</p>
    <div class="issue-f">
      ${c ? `<span class="issue-cmp">${esc(metricName)}: previous period <b>${fmtInt(c.previous)}</b> → current <b>${fmtInt(c.current)}</b> <span class="${c.changePct < 0 ? 'c-poor' : 'c-good'}">(${esc(fmtPct(c.changePct))})</span></span>` : ''}
      <span>Detected ${esc(fmtDateTime(i.detectedAt))}</span>
      <span title="${esc(`Issue code from n8n: ${i.code}`)}">${esc(issueLabel(i.code, i.code))}</span>
    </div></article>`;
}

function checkList(items: CheckItem[]): string {
  if (!items.length) return '<div class="empty" style="padding:18px">No checks reported.</div>';
  return `<ul class="checks">${items
    .map((c) => {
      const tone = CHECK_META[c.result]?.tone ?? 'muted';
      return `<li class="is-${tone}">${checkIcon(c.result, c.label)}<div><div class="ck-l">${esc(c.label)}</div>${c.detail ? `<div class="ck-d">${esc(c.detail)}</div>` : ''}</div></li>`;
    })
    .join('')}</ul>`;
}

function last24h(t: MetricTotals | null): string {
  if (!t)
    return '<div class="empty" style="padding:18px">GA4 data isn’t available for this site — see the issues above.</div>';
  return `<div class="tiles">${METRICS.map(([k, label]) => `<div class="tile"><div class="k">${label}</div><div class="v">${fmtInt(t[k])}</div></div>`).join('')}</div>`;
}

function expectedList(items: ExpectedItemStatus[], emptyText: string): string {
  if (!items.length) return `<div class="empty" style="padding:14px">${esc(emptyText)}</div>`;
  return `<ul class="checks">${items
    .map(
      (it) =>
        `<li class="is-${CHECK_META[it.result]?.tone ?? 'muted'}">${checkIcon(it.result, it.name)}<div><code>${esc(it.name)}</code></div><span class="ck-r">${it.count24h == null ? '—' : fmtInt(it.count24h)}</span></li>`,
    )
    .join('')}</ul>`;
}

function inventory(s: SiteDetail): string {
  const v = (x: string | null) =>
    x ? `<code>${esc(x)}</code>` : '<span class="c-muted">Not set</span>';
  return `<dl class="kv">
    <dt>Domain</dt><dd>${esc(s.domain)}</dd>
    <dt>GA4 property</dt><dd>${v(s.ga4PropertyId)}</dd>
    <dt>Measurement ID</dt><dd>${v(s.ga4MeasurementId)}</dd>
    <dt>GTM container</dt><dd>${v(s.gtmContainerId)}</dd>
    <dt>Events</dt><dd>${s.expectedEvents.length} expected</dd>
    <dt>Conversions</dt><dd>${s.expectedConversions.length} expected</dd>
    <dt>Last checked</dt><dd>${esc(fmtDateTime(s.lastChecked))}</dd>
  </dl>`;
}

function historyBody(h: SiteHistory | null, metric: Metric, days: number): string {
  const tools = `<div class="seg" role="group" aria-label="Metric">${METRICS.map(([k, l]) => `<button data-metric="${k}" class="${k === metric ? 'is-active' : ''}" aria-pressed="${k === metric}">${l}</button>`).join('')}</div>
    <div class="seg" role="group" aria-label="Date range">${RANGES.map((d) => `<button data-days="${d}" class="${d === days ? 'is-active' : ''}" aria-pressed="${d === days}">${d}d</button>`).join('')}</div>`;
  const head = `<div class="card-h"><h2 class="card-t" style="margin:0">${ICONS.chart}History</h2><div class="card-tools">${tools}</div></div>`;
  if (!h || !h.days.length) {
    return `${head}<div class="empty">No historical data is available for this site${h ? '' : ' yet'}.</div>`;
  }
  const label = METRICS.find(([k]) => k === metric)![1];
  const showBand = days > h.periodDays;
  return `${head}
    <div class="card-sub">Daily ${label.toLowerCase()} · last ${h.days.length} days (${esc(fmtDay(h.days[0]!.date))} – ${esc(fmtDay(h.days.at(-1)!.date))})</div>
    <div class="chart-box"><canvas id="history-canvas" height="210" role="img" aria-label="${esc(`${label} per day over the last ${h.days.length} days`)}"></canvas></div>
    ${showBand ? `<div class="chart-legend"><span><i></i>Current ${h.periodDays}-day comparison period</span></div>` : ''}
    ${comparisons(h)}
    <details class="daily"${days === 7 ? ' open' : ''}><summary>Daily values</summary>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Day</th>${METRICS.map(([, l]) => `<th class="r" scope="col">${l}</th>`).join('')}</tr></thead>
      <tbody>${[...h.days]
        .reverse()
        .map(
          (d) =>
            `<tr><td>${esc(fmtDay(d.date, 'weekday'))} <span class="c-muted">${esc(fmtDay(d.date))}</span></td>${METRICS.map(([k]) => `<td class="r num${k === metric ? '' : ' dim'}">${fmtInt(d[k])}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody></table></div>
    </details>`;
}

function comparisons(h: SiteHistory): string {
  if (!h.comparisons.length) {
    return `<div class="note" style="padding:0 14px 12px">Not enough history yet for a ${h.periodDays}-day period comparison.</div>`;
  }
  return `<div class="card-sub" style="margin-top:4px">Previous ${h.periodDays} days vs current ${h.periodDays} days</div>
    <div class="cmp-grid">${h.comparisons
      .map((c) => {
        const tone = STATUS_META[c.status]?.tone ?? 'muted';
        const label = METRICS.find(([k]) => k === c.metric)?.[1] ?? c.metric;
        return `<div class="cmp is-${tone}">
          <div class="cmp-k">${esc(label)}<span class="sdot sdot--${tone}" title="${esc(STATUS_META[c.status]?.label ?? '')}"></span></div>
          <div class="cmp-row"><span>Previous ${h.periodDays} days</span><b>${fmtInt(c.previous)}</b></div>
          <div class="cmp-row"><span>Current ${h.periodDays} days</span><b>${fmtInt(c.current)}</b></div>
          <div class="cmp-row"><span>Change</span><b class="${tone === 'good' ? '' : `c-${tone}`}">${esc(fmtPct(c.changePct))}</b></div>
          ${c.note ? `<div class="cmp-note c-${tone}">${esc(c.note)}</div>` : ''}
        </div>`;
      })
      .join('')}</div>`;
}
