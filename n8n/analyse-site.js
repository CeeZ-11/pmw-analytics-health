/* PMW Analytics Health — per-site analysis used by the n8n "Daily monitor"
 * workflow ("Analyse sites" Code node). Kept in the repo so the rules are
 * versioned and testable; the Code node holds a copy of everything above the
 * "n8n glue" marker.
 *
 * Input per site: inventory row + raw responses from the homepage fetch, the
 * GTM container, the GA4 Admin property, the GA4 daily report and the GA4
 * events-by-name report. Output: one pmw_health_sites row (summaryJson /
 * detailJson / historyJson in the shapes of src/types/health.ts). */

const HISTORY_DAYS = 90;
const PERIOD_DAYS = 7;
const DAY_MS = 86400000;

// Volume floors so low-traffic noise doesn't raise alarms.
const MIN = { users: 50, sessions: 50, events: 200, conversions: 5 };

function isoDayInTz(date, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}
function addDays(isoDay, n) {
  return new Date(Date.parse(isoDay + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
}
function uniq(a) {
  return [...new Set(a)];
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function errText(r) {
  if (!r || !r.error) return '';
  const e = r.error;
  return String((e && (e.message || e.description)) || e);
}

function buildDays(daily, tz, now) {
  const yesterday = addDays(isoDayInTz(now, tz), -1);
  const byDate = {};
  for (const row of (daily && daily.rows) || []) {
    const d = row.dimensionValues[0].value; // YYYYMMDD
    const key = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const m = row.metricValues.map((x) => num(x.value));
    byDate[key] = { users: m[0], sessions: m[1], events: m[2], conversions: m[3] };
  }
  const days = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const date = addDays(yesterday, -i);
    days.push({ date, ...(byDate[date] || { users: 0, sessions: 0, events: 0, conversions: 0 }) });
  }
  return days;
}

function sum(days, k) {
  return days.reduce((t, d) => t + d[k], 0);
}

/* The most recent day can still be filling in on GA4's side, so period
 * comparisons use the 7 complete days ending the day before yesterday. */
function compare(days, conversionsConfigured) {
  const cur = days.slice(-PERIOD_DAYS - 1, -1);
  const prev = days.slice(-PERIOD_DAYS * 2 - 1, -PERIOD_DAYS - 1);
  return ['users', 'sessions', 'events', 'conversions'].map((metric) => {
    const current = sum(cur, metric);
    const previous = sum(prev, metric);
    const changePct = previous ? Math.round(((current - previous) / previous) * 1000) / 10 : 0;
    let status = 'healthy';
    let note;
    const floor = MIN[metric];
    const tracked = metric !== 'conversions' || conversionsConfigured;
    if (tracked && previous >= floor && current === 0) {
      status = 'critical';
      note = metric === 'conversions' ? 'Possible conversion tracking issue' : `No ${metric} recorded — possible tracking outage`;
    } else if (tracked && previous >= floor * (metric === 'conversions' ? 2 : 1)) {
      if (changePct <= -50) {
        status = 'critical';
        note = metric === 'conversions' ? 'Possible conversion tracking issue' : `${metric[0].toUpperCase()}${metric.slice(1)} down sharply`;
      } else if (changePct <= -25) {
        status = 'warning';
        note = `${metric[0].toUpperCase()}${metric.slice(1)} well below the previous ${PERIOD_DAYS} days`;
      } else if (changePct >= 100 && metric !== 'conversions') {
        status = 'warning';
        note = 'Unusual spike — check for duplicate tracking';
      }
    }
    return { metric, previous, current, changePct, status, ...(note ? { note } : {}) };
  });
}

function eventCounts(evs) {
  // rows: dimensionValues [eventName, dateRange]; ranges d1 / cur7 / prev28
  const out = {};
  for (const row of (evs && evs.rows) || []) {
    const name = row.dimensionValues[0].value;
    const range = row.dimensionValues[1] ? row.dimensionValues[1].value : 'cur7';
    out[name] = out[name] || { d1: 0, cur7: 0, prev28: 0 };
    out[name][range] = num(row.metricValues[0].value);
  }
  return out;
}

const RANK = { pass: 0, unknown: 1, warn: 2, fail: 3 };
function worst(...rs) {
  return rs.reduce((w, r) => (r && RANK[r] > RANK[w] ? r : w), 'pass');
}

function analyseSite(inv, home, gtm, prop, daily, evs, now) {
  const nowIso = now.toISOString();
  const issues = [];
  const issue = (code, category, severity, title, detail, comparison, key = '') =>
    issues.push({ id: `${inv.siteId}-${code}${key ? `-${key}` : ''}`, code, category, severity, title, detail, detectedAt: nowIso, ...(comparison ? { comparison } : {}) });
  const mid = (inv.ga4MeasurementId || '').trim();
  const gtmId = (inv.gtmContainerId || '').trim();
  const expectedEvents = String(inv.expectedEvents || '').split(',').map((s) => s.trim()).filter(Boolean);
  const expectedConversions = String(inv.expectedConversions || '').split(',').map((s) => s.trim()).filter(Boolean);

  // ---------------------------------------------------------------- website
  const html = typeof (home && (home.body ?? home.data)) === 'string' ? home.body ?? home.data : '';
  const status = num(home && home.statusCode);
  const crawlOk = !errText(home) && html.length > 500 && (status === 0 || (status >= 200 && status < 400));
  const gtmJs = gtm && typeof gtm.data === 'string' && gtm.data.length > 1000 ? gtm.data : '';
  const gtmIdsOnPage = uniq(html.match(/GTM-[A-Z0-9]{4,10}/g) || []);
  const gaPattern = /["'=](G-[A-Z0-9]{6,12})(?=["'&])/g;
  const gaIds = uniq([...(html + '\n' + gtmJs).matchAll(gaPattern)].map((m) => m[1]));
  const otherGa = gaIds.filter((g) => g !== mid);
  const gtmUnreadable = gtmId && !gtmJs;

  const t = {};
  if (!crawlOk) {
    const why = errText(home) || (status ? `HTTP ${status}` : 'empty response');
    for (const k of ['ga4_tag', 'gtm_container', 'measurement_id', 'duplicate']) t[k] = { result: 'unknown', detail: `Not checked — homepage fetch failed (${why}).` };
    issue('crawl_failed', 'tracking', 'warning', 'Website check failed', `The homepage couldn't be loaded (${why}), so tracking checks were skipped. GA4 data checks still ran.`);
  } else {
    if (!gtmId) t.gtm_container = { result: 'unknown', detail: 'No GTM container in the inventory for this site.' };
    else if (gtmIdsOnPage.includes(gtmId)) t.gtm_container = { result: 'pass', detail: `${gtmId} found on the homepage.` };
    else if (gtmIdsOnPage.length) {
      t.gtm_container = { result: 'fail', detail: `Expected ${gtmId}, found ${gtmIdsOnPage.join(', ')}.` };
      issue('gtm_container_mismatch', 'tracking', 'critical', 'Incorrect GTM container', `The homepage loads ${gtmIdsOnPage.join(', ')} instead of the expected ${gtmId}.`);
    } else {
      t.gtm_container = { result: 'fail', detail: `${gtmId} not found on the homepage.` };
      issue('gtm_missing', 'tracking', 'critical', 'GTM container missing', `The expected GTM container ${gtmId} is no longer on the homepage. This often happens after a theme update or site rebuild.`);
    }

    if (gtmUnreadable && !gaIds.length) {
      t.ga4_tag = { result: 'unknown', detail: `Couldn't read GTM container ${gtmId} to look for the GA4 tag.` };
      t.measurement_id = { result: 'unknown', detail: 'Not checked — GTM container unreadable.' };
    } else if (!gaIds.length) {
      t.ga4_tag = { result: 'fail', detail: 'No GA4 measurement ID on the homepage or in the GTM container.' };
      t.measurement_id = { result: 'fail', detail: 'No measurement ID present to compare.' };
      issue('ga4_missing', 'tracking', 'critical', 'GA4 missing', 'No GA4 tag was found on the homepage or in its GTM container.');
    } else {
      const where = html.includes(mid) ? 'on the homepage' : 'in the GTM container';
      t.ga4_tag = { result: 'pass', detail: gaIds.includes(mid) ? `${mid} found ${where}.` : `GA4 tag found (${gaIds.join(', ')}).` };
      if (gaIds.includes(mid) && !otherGa.length) t.measurement_id = { result: 'pass', detail: 'Sends to the expected GA4 stream.' };
      else if (gaIds.includes(mid)) {
        t.measurement_id = { result: 'warn', detail: `Expected ${mid} plus additional ID(s): ${otherGa.join(', ')}.` };
        issue('measurement_id_mismatch', 'tracking', 'warning', 'Additional GA4 measurement ID', `Besides ${mid}, the site also sends to ${otherGa.join(', ')}. Check whether that stream is intentional.`);
      } else {
        t.measurement_id = { result: 'fail', detail: `Expected ${mid}, found ${otherGa.join(', ')}.` };
        issue('measurement_id_mismatch', 'tracking', 'critical', 'Incorrect Measurement ID', `The site sends data to ${otherGa.join(', ')} instead of ${mid}, so this property isn't receiving it.`);
      }
    }

    if (mid && html.includes(`gtag/js?id=${mid}`) && gtmJs.includes(mid)) {
      t.duplicate = { result: 'warn', detail: `${mid} is installed both directly on the page and in GTM.` };
      issue('duplicate_tracking', 'tracking', 'warning', 'Potential duplicate tracking', `${mid} is loaded by a hard-coded gtag.js snippet and by GTM, which can double-count page views and events.`);
    } else t.duplicate = { result: 'pass', detail: 'One GA4 installation found.' };
  }
  t.tracking_request = { result: 'unknown', detail: 'Needs a real browser — not part of the daily HTML check yet.' };
  const tracking = [
    ['ga4_tag', 'GA4 detected'],
    ['gtm_container', 'GTM detected'],
    ['measurement_id', 'Measurement ID matches inventory'],
    ['tracking_request', 'Tracking request detected'],
    ['duplicate', 'No duplicate tracking'],
  ].map(([key, label]) => ({ key, label, ...t[key] }));

  // ------------------------------------------------------------------- GA4
  const g = {};
  let days = [];
  let comparisons = [];
  let last24h = null;
  let eventsList = expectedEvents.map((name) => ({ name, result: 'unknown', count24h: null }));
  let convItems = expectedConversions.map((name) => ({ name, result: 'unknown', count24h: null }));
  const ga4Err = errText(daily);
  const conversionsConfigured = expectedConversions.length > 0;
  if (!inv.ga4PropertyId) {
    for (const k of ['property_access', 'recent_data', 'events', 'conversions']) g[k] = { result: 'unknown', detail: 'No GA4 property linked — run GA4 discovery.' };
    issue('ga4_not_linked', 'analytics', 'warning', 'GA4 property not linked', 'This site has no GA4 property ID in the inventory, so no analytics checks ran.');
  } else if (ga4Err || !daily) {
    const denied = /403|PERMISSION|404|not found/i.test(ga4Err);
    g.property_access = { result: denied ? 'fail' : 'unknown', detail: ga4Err || 'No response from the GA4 Data API.' };
    for (const k of ['recent_data', 'events', 'conversions']) g[k] = { result: 'unknown', detail: 'Not checked — GA4 query failed.' };
    if (denied) issue('property_inaccessible', 'analytics', 'critical', 'GA4 property inaccessible', `The monitoring service account can't read GA4 property ${inv.ga4PropertyId} (${ga4Err}). Re-add it as a Viewer in GA4 → Admin → Property access management.`);
    else issue('ga4_query_failed', 'analytics', 'warning', 'GA4 query failed', `The GA4 Data API returned an error: ${ga4Err || 'no response'}. This is usually temporary.`);
  } else {
    const tz = (prop && prop.timeZone) || 'America/Los_Angeles';
    days = buildDays(daily, tz, now);
    comparisons = compare(days, conversionsConfigured);
    const y = days[days.length - 1];
    last24h = { users: y.users, sessions: y.sessions, events: y.events, conversions: y.conversions };
    g.property_access = { result: 'pass', detail: `GA4 property ${inv.ga4PropertyId} readable.` };

    const baseline = sum(days.slice(-31, -3), 'sessions') / 28;
    const last2 = days[days.length - 1].sessions + days[days.length - 2].sessions;
    let noData = false;
    if (baseline >= 5 && last2 === 0) {
      noData = true;
      g.recent_data = { result: 'fail', detail: `0 sessions in the last 2 days (usually ~${Math.round(baseline)}/day).` };
      issue('no_recent_data', 'analytics', 'critical', 'No recent GA4 data', `GA4 recorded no sessions for the last 2 days, against a normal ~${Math.round(baseline)} a day. Tracking may be broken.`);
    } else if (y.sessions === 0 && baseline >= 20) {
      g.recent_data = { result: 'warn', detail: 'No sessions yesterday yet — may be GA4 processing delay.' };
    } else {
      g.recent_data = { result: 'pass', detail: `${y.sessions.toLocaleString('en-US')} sessions yesterday.` };
    }

    const byName = (k) => comparisons.find((c) => c.metric === k);
    const usersC = byName('users');
    const eventsC = byName('events');
    const convC = byName('conversions');
    const cmp = (c) => ({ metric: c.metric, previous: c.previous, current: c.current, changePct: c.changePct });
    if (!noData && usersC.status !== 'healthy' && usersC.changePct < 0) {
      issue('traffic_drop', 'analytics', usersC.status === 'critical' ? 'critical' : 'warning', 'Sudden traffic drop', `Users fell ${Math.abs(usersC.changePct)}% versus the previous ${PERIOD_DAYS} days. Check for an indexing change, a paused campaign, or broken tracking.`, cmp(usersC));
    }
    if (!noData && eventsC.status !== 'healthy' && eventsC.changePct < 0 && usersC.status === 'healthy') {
      issue('event_drop', 'analytics', eventsC.status === 'critical' ? 'critical' : 'warning', 'Sudden event drop', `Events fell ${Math.abs(eventsC.changePct)}% while users held steady — a GTM tag or trigger may have stopped firing.`, cmp(eventsC));
    }
    if (eventsC.status === 'warning' && eventsC.changePct >= 100) {
      issue('baseline_deviation', 'data-quality', 'warning', 'Unusual event spike', `Events rose ${eventsC.changePct}% versus the previous ${PERIOD_DAYS} days. This can mean duplicate tracking.`, cmp(eventsC));
    }

    const counts = eventCounts(evs);
    const evItems = expectedEvents.map((name) => {
      const c = counts[name] || { d1: 0, cur7: 0, prev28: 0 };
      if (c.cur7 > 0) return { name, result: 'pass', count24h: c.d1 };
      if (c.prev28 > 0 && !noData) issue('expected_event_missing', 'data-quality', 'warning', `Expected event "${name}" missing`, `"${name}" was received ${c.prev28} times in the 4 weeks before, but not in the last 7 days.`, null, name);
      return { name, result: 'warn', count24h: c.d1 };
    });
    g.events = evItems.length
      ? { result: worst(...evItems.map((e) => e.result)), detail: evItems.every((e) => e.result === 'pass') ? 'All expected events received in the last 7 days.' : `Missing: ${evItems.filter((e) => e.result !== 'pass').map((e) => e.name).join(', ')}.` }
      : { result: 'unknown', detail: 'No expected events configured.' };

    convItems = expectedConversions.map((name) => {
      const c = counts[name] || { d1: 0, cur7: 0, prev28: 0 };
      if (c.cur7 > 0 || c.prev28 < 4) return { name, result: 'pass', count24h: c.d1 };
      if (!noData) issue('expected_conversion_missing', 'data-quality', 'warning', `Expected conversion "${name}" missing`, `"${name}" was recorded ${c.prev28} times in the 4 weeks before, but not in the last 7 days.`, null, name);
      return { name, result: 'warn', count24h: c.d1 };
    });
    if (!conversionsConfigured) {
      g.conversions = { result: 'warn', detail: 'No conversions (key events) are set up in this GA4 property.' };
      issue('conversions_not_configured', 'data-quality', 'warning', 'No conversions set up in GA4', 'GA4 is collecting traffic, but no key events (e.g. form submissions or calls) are marked as conversions, so leads aren’t being measured.');
    } else if (convC.status === 'critical' && !noData) {
      g.conversions = { result: 'fail', detail: `${convC.current} conversions in the last 7 complete days vs ${convC.previous} the week before.` };
      issue('conversion_drop', 'analytics', 'critical', convC.current === 0 ? 'Conversions dropped to zero' : 'Sudden conversion drop', `Conversions went from ${convC.previous} to ${convC.current} week over week. A form, call tracking or GTM trigger may have stopped working.`, cmp(convC));
    } else if (convC.status === 'warning' || convItems.some((c) => c.result !== 'pass')) {
      g.conversions = { result: 'warn', detail: `${convC.current} conversions in the last 7 complete days vs ${convC.previous} the week before.` };
      if (convC.status === 'warning' && !noData) issue('conversion_drop', 'analytics', 'warning', 'Conversions down', `Conversions went from ${convC.previous} to ${convC.current} week over week.`, cmp(convC));
    } else {
      g.conversions = { result: 'pass', detail: `${convC.current} conversions in the last 7 complete days.` };
    }
    eventsList = evItems;
  }
  const ga4 = [
    ['property_access', 'Property accessible'],
    ['recent_data', 'Recent data received'],
    ['events', 'Events received'],
    ['conversions', 'Conversions received'],
  ].map(([key, label]) => ({ key, label, ...g[key] }));

  const res = (arr, k) => (arr.find((c) => c.key === k) || {}).result;
  const sevRank = { critical: 2, warning: 1 };
  issues.sort((a, b) => sevRank[b.severity] - sevRank[a.severity]);
  const siteStatus = issues.some((i) => i.severity === 'critical') ? 'critical' : issues.length ? 'warning' : 'healthy';
  const summary = {
    id: inv.siteId,
    name: inv.name,
    domain: inv.domain,
    ga4PropertyId: inv.ga4PropertyId || null,
    ga4MeasurementId: mid || null,
    gtmContainerId: gtmId || null,
    expectedEvents,
    expectedConversions,
    status: siteStatus,
    lastChecked: nowIso,
    checks: {
      ga4: worst(res(tracking, 'ga4_tag'), res(tracking, 'measurement_id'), res(tracking, 'duplicate')),
      gtm: worst(res(tracking, 'gtm_container')),
      data: worst(res(ga4, 'property_access'), res(ga4, 'recent_data')),
      events: worst(res(ga4, 'events')),
      conversions: worst(res(ga4, 'conversions')),
    },
    issueCounts: {
      warning: issues.filter((i) => i.severity === 'warning').length,
      critical: issues.filter((i) => i.severity === 'critical').length,
    },
    issueCategories: uniq(issues.map((i) => i.category)),
    hasConversionIssue: issues.some((i) => /conversion/.test(i.code)),
    isSample: false,
  };
  const detail = {
    ...summary,
    tracking,
    ga4,
    last24h,
    events: eventsList,
    conversions: convItems,
    issues,
  };
  const history = { siteId: inv.siteId, days, periodDays: PERIOD_DAYS, comparisons };
  return {
    siteId: inv.siteId,
    name: inv.name,
    status: siteStatus,
    lastChecked: nowIso,
    isSample: false,
    summaryJson: JSON.stringify(summary),
    detailJson: JSON.stringify(detail),
    historyJson: JSON.stringify(history),
  };
}

// ---- n8n glue (below this line is replaced in the Code node) ----
if (typeof module !== 'undefined') module.exports = { analyseSite, buildDays, compare, eventCounts };
