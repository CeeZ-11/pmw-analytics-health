/* What each SAMPLE scenario "found". These stand in for n8n's real verdicts —
 * in api mode none of this runs. */

import type { Scenario, ScenarioSpec } from './inventory';

export const SCENARIOS: Record<Scenario, ScenarioSpec> = {
  healthy: { issues: [] },

  conversion_drop: {
    ga4: {
      conversions: {
        result: 'fail',
        detail: 'No generate_lead or rental_application_start in the last 7 days.',
      },
    },
    missingConversions: ['generate_lead', 'rental_application_start'],
    history: { days: 7, conversions: 0 },
    issues: [
      {
        code: 'conversion_drop',
        category: 'analytics',
        severity: 'critical',
        title: 'Conversions dropped to zero',
        detail:
          'Traffic and events look normal, but no conversions were recorded in the last 7 days. The contact form may have changed or its GTM trigger stopped firing.',
        daysAgo: 7,
        compare: 'conversions',
      },
    ],
  },

  gtm_missing: {
    tracking: {
      ga4_tag: {
        result: 'fail',
        detail: 'No gtag.js or GA4 config found on any of 14 crawled pages.',
      },
      gtm_container: {
        result: 'fail',
        detail: 'GTM container snippet not found in <head> on any crawled page.',
      },
      measurement_id: { result: 'fail', detail: 'No measurement ID present to compare.' },
      tracking_request: {
        result: 'fail',
        detail: 'No requests to google-analytics.com/g/collect observed during page loads.',
      },
    },
    ga4: {
      recent_data: { result: 'fail', detail: '0 sessions in the last 72 hours.' },
      events: { result: 'fail' },
      conversions: { result: 'fail' },
    },
    missingEvents: ['page_view', 'scroll', 'click', 'form_start', 'form_submit'],
    missingConversions: ['generate_lead'],
    history: { days: 3, users: 0, sessions: 0, events: 0, conversions: 0 },
    issues: [
      {
        code: 'gtm_missing',
        category: 'tracking',
        severity: 'critical',
        title: 'GTM container missing',
        detail:
          'The expected GTM container is no longer on the site. This often happens after a theme update or site rebuild.',
        daysAgo: 3,
      },
      {
        code: 'tracking_request_missing',
        category: 'tracking',
        severity: 'critical',
        title: 'No GA4 tracking requests detected',
        detail: 'The crawler loaded pages in a real browser and saw no GA4 collect requests.',
        daysAgo: 3,
      },
      {
        code: 'no_recent_data',
        category: 'analytics',
        severity: 'critical',
        title: 'No recent GA4 data',
        detail: 'GA4 has recorded no sessions for this property in the last 72 hours.',
        daysAgo: 3,
        compare: 'users',
      },
    ],
  },

  property_inaccessible: {
    ga4: {
      property_access: {
        result: 'fail',
        detail: 'GA4 Data API returned 403 PERMISSION_DENIED for the monitoring service account.',
      },
      recent_data: { result: 'unknown', detail: 'Not checked — property not accessible.' },
      events: { result: 'unknown' },
      conversions: { result: 'unknown' },
    },
    noGa4Data: true,
    issues: [
      {
        code: 'property_inaccessible',
        category: 'analytics',
        severity: 'critical',
        title: 'GA4 property inaccessible',
        detail:
          'The monitoring service account no longer has Viewer access to this GA4 property, so no analytics checks could run. Re-grant access in GA4 → Admin → Property access management.',
        daysAgo: 2,
      },
    ],
  },

  no_recent_data: {
    ga4: {
      recent_data: { result: 'fail', detail: '0 sessions recorded since yesterday 00:00.' },
      events: { result: 'fail' },
      conversions: { result: 'fail' },
    },
    missingEvents: ['page_view', 'scroll', 'click', 'form_start', 'form_submit'],
    missingConversions: ['generate_lead'],
    history: { days: 2, users: 0, sessions: 0, events: 0, conversions: 0 },
    issues: [
      {
        code: 'no_recent_data',
        category: 'analytics',
        severity: 'critical',
        title: 'No recent GA4 data',
        detail:
          'Tags and collect requests are present on the site, but GA4 has recorded no data for 2 days. Check the data stream and any data filters on the property.',
        daysAgo: 2,
        compare: 'users',
      },
    ],
  },

  measurement_id_mismatch: {
    tracking: {
      measurement_id: {
        result: 'warn',
        detail: 'Found G-7Q2LMX91KD on 3 of 12 crawled pages instead of the expected ID.',
      },
    },
    issues: [
      {
        code: 'measurement_id_mismatch',
        category: 'tracking',
        severity: 'warning',
        title: 'Incorrect Measurement ID on some pages',
        detail:
          '3 pages (the blog templates) send data to a different GA4 stream, so their traffic is missing from this property.',
        daysAgo: 5,
      },
    ],
  },

  expected_event_missing: {
    ga4: {
      events: { result: 'warn', detail: 'schedule_showing not received in the last 7 days.' },
    },
    missingEvents: ['schedule_showing'],
    issues: [
      {
        code: 'expected_event_missing',
        category: 'data-quality',
        severity: 'warning',
        title: 'Expected event "schedule_showing" missing',
        detail:
          'This event averaged 11/day over the prior 4 weeks and hasn’t been received in 7 days.',
        daysAgo: 7,
      },
    ],
  },

  expected_conversion_missing: {
    ga4: {
      conversions: {
        result: 'warn',
        detail: 'rental_application_start not received in the last 5 days.',
      },
    },
    missingConversions: ['rental_application_start'],
    history: { days: 5, conversions: 0.55 },
    issues: [
      {
        code: 'expected_conversion_missing',
        category: 'data-quality',
        severity: 'warning',
        title: 'Expected conversion "rental_application_start" missing',
        detail:
          'generate_lead is still arriving, but rental_application_start has stopped. The apply-now link may point to a new portal URL.',
        daysAgo: 5,
        compare: 'conversions',
      },
    ],
  },

  traffic_drop: {
    ga4: { recent_data: { result: 'warn', detail: 'Users down 38% vs the previous 7 days.' } },
    history: { days: 7, users: 0.62, sessions: 0.63, events: 0.64, conversions: 0.7 },
    issues: [
      {
        code: 'traffic_drop',
        category: 'analytics',
        severity: 'warning',
        title: 'Sudden traffic drop',
        detail:
          'Users fell sharply across all channels. Check for an SEO/indexing change or a paused ad campaign.',
        daysAgo: 7,
        compare: 'users',
      },
    ],
  },

  event_drop: {
    ga4: {
      events: {
        result: 'warn',
        detail: 'Event volume down 41% vs the previous 7 days while users are flat.',
      },
    },
    history: { days: 7, events: 0.59 },
    issues: [
      {
        code: 'event_drop',
        category: 'analytics',
        severity: 'warning',
        title: 'Sudden event drop',
        detail:
          'Users are steady but events per session fell — likely a GTM tag or trigger that was paused or removed.',
        daysAgo: 7,
        compare: 'events',
      },
    ],
  },

  duplicate_tracking: {
    tracking: {
      duplicate: {
        result: 'warn',
        detail:
          'page_view fired twice per load: once from a hard-coded gtag.js snippet and once from GTM.',
      },
    },
    history: { days: 10, events: 1.85 },
    issues: [
      {
        code: 'duplicate_tracking',
        category: 'tracking',
        severity: 'warning',
        title: 'Potential duplicate tracking',
        detail:
          'Two GA4 installations on the same pages inflate page views and events. Remove the hard-coded snippet and keep GTM.',
        daysAgo: 10,
        compare: 'events',
      },
    ],
  },

  crawl_timeout: {
    tracking: {
      ga4_tag: {
        result: 'unknown',
        detail: 'Crawl timed out after 60s — the homepage never finished loading.',
      },
      gtm_container: { result: 'unknown' },
      measurement_id: { result: 'unknown' },
      tracking_request: { result: 'unknown' },
      duplicate: { result: 'unknown' },
    },
    issues: [
      {
        // Deliberately not in the IssueCode union: shows the dashboard still
        // renders codes n8n adds later, using the issue's own title.
        code: 'crawl_failed',
        category: 'tracking',
        severity: 'warning',
        title: 'Site crawl timed out',
        detail:
          'Tracking checks couldn’t run because the site didn’t respond in time. GA4 data checks still ran normally.',
        daysAgo: 0,
      },
    ],
  },
};
