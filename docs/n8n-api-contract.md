# n8n ↔ Dashboard API contract

The dashboard is a static page on GitHub Pages. It reads **four read-only JSON
endpoints** from n8n. n8n does all monitoring, analysis and alerting; the
dashboard only displays what n8n returns.

The TypeScript source of truth for these shapes is
[`src/types/health.ts`](../src/types/health.ts). Keep this document in sync
with it. The bundled mock data (`src/mock/`) produces exactly these shapes and
is a good reference for realistic payloads — run the app in mock mode and
inspect `analyticsHealth.getSite('harbor-lane')` etc.

```
GitHub Pages ──GET JSON──► n8n webhooks ──► GA4 Data API / crawler / PageSpeed
                                   │
                                   └──► Slack
```

## Configuration

| Variable              | Example                                                |
| --------------------- | ------------------------------------------------------ |
| `VITE_DATA_SOURCE`    | `api`                                                  |
| `VITE_API_BASE_URL`   | `https://n8n.example.com/webhook/pmw-analytics-health` |
| `VITE_API_TIMEOUT_MS` | `15000`                                                |

The app appends the paths below to `VITE_API_BASE_URL`. All endpoint paths
are defined in one place: `ENDPOINTS` in `src/services/apiProvider.ts`.

## Current n8n setup

Instance: `https://rentvine.app.n8n.cloud` · project: personal (Seamor Estrabon) · folder **PMW Analytics Health**

| Piece                                                | What it is                                                                                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data table `pmw_health_sites`                        | One row per site: `siteId`, `name`, `status`, `lastChecked`, `isSample`, and the JSON the API serves (`summaryJson`, `detailJson`, `historyJson`). The monitoring workflow should upsert into this table on `siteId`. |
| Workflow **PMW Analytics Health — Dashboard API**    | The four GET webhooks below, published. CORS: `https://ceez-11.github.io` + localhost dev ports.                                                                                                                      |
| Workflow **PMW Analytics Health — Seed sample data** | Manual run: writes 25 fictional sites with `isSample = true`. Delete those rows once real monitoring data exists.                                                                                                     |

Base URL: `https://rentvine.app.n8n.cloud/webhook/pmw-analytics-health`

`isSample` (optional, on the summary and on each site) keeps the dashboard's
"Sample data" labelling while seed rows are being served.

## General rules

- `GET` only, `Accept: application/json`. The dashboard sends **no
  credentials, cookies or auth headers**.
- Respond with the payload directly, **or** wrapped as `{ "data": <payload> }`
  (the default shape of many n8n "Respond to Webhook" setups) — both work.
- Timestamps are ISO-8601 strings with an offset (`2026-10-01T03:00:00.000Z`).
  Calendar days in history are `YYYY-MM-DD` in the property's reporting time zone.
- Unknown site → HTTP `404`. Any other non-2xx is shown as an error.
- Extra fields are ignored, so n8n can add data before the UI uses it.
- CORS: respond with `Access-Control-Allow-Origin: https://<org>.github.io`
  (the Pages origin). In the n8n Webhook node set **Options → Allowed Origins (CORS)**.

### Enumerations

| Type            | Values                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| `HealthStatus`  | `healthy`, `warning`, `critical`                                        |
| `CheckResult`   | `pass`, `warn`, `fail`, `unknown` (= check couldn't run, not a failure) |
| `IssueCategory` | `tracking`, `analytics`, `data-quality`                                 |
| `IssueSeverity` | `warning`, `critical`                                                   |

Issue codes with built-in labels: `ga4_missing`, `gtm_missing`,
`measurement_id_mismatch`, `gtm_container_mismatch`, `tracking_request_missing`,
`duplicate_tracking`, `no_recent_data`, `traffic_drop`, `event_drop`,
`conversion_drop`, `property_inaccessible`, `expected_event_missing`,
`expected_conversion_missing`, `baseline_deviation`. Any other code still
renders, using the issue's own `title`.

---

## `GET /health-summary`

Summary tiles and "Last run" in the top bar.

```json
{
  "generatedAt": "2026-10-01T09:30:00.000Z",
  "lastRunAt": "2026-10-01T03:18:48.000Z",
  "total": 52,
  "healthy": 46,
  "warning": 4,
  "critical": 2
}
```

## `GET /sites`

One row per monitored site (the dashboard table). Array of `SiteSummary`.

```json
[
  {
    "id": "harbor-lane",
    "name": "Harbor Lane Rentals",
    "domain": "harborlanerentals.example",
    "ga4PropertyId": "400002746",
    "ga4MeasurementId": "G-XXX2L13002",
    "gtmContainerId": "GTM-XXX2L13",
    "expectedEvents": ["page_view", "scroll", "form_submit"],
    "expectedConversions": ["generate_lead"],
    "status": "critical",
    "lastChecked": "2026-10-01T03:00:47.000Z",
    "checks": {
      "ga4": "pass",
      "gtm": "pass",
      "data": "pass",
      "events": "pass",
      "conversions": "fail"
    },
    "issueCounts": { "warning": 0, "critical": 1 },
    "issueCategories": ["analytics"],
    "hasConversionIssue": true
  }
]
```

`checks` drives the table columns:

| Column        | Suggested n8n rule (worst of)                                 |
| ------------- | ------------------------------------------------------------- |
| `ga4`         | GA4 tag found · measurement ID matches · no duplicate install |
| `gtm`         | expected GTM container found                                  |
| `data`        | GA4 property accessible · recent data received                |
| `events`      | all `expectedEvents` received in the lookback window          |
| `conversions` | all `expectedConversions` received in the lookback window     |

`issueCategories` / `hasConversionIssue` power the dashboard's
Tracking / Analytics / Data quality / Conversion filters.

## `GET /site?id={siteId}`

Everything in `SiteSummary`, plus:

```json
{
  "...": "all SiteSummary fields",
  "tracking": [
    {
      "key": "ga4_tag",
      "label": "GA4 detected",
      "result": "pass",
      "detail": "GA4 config found on every crawled page."
    },
    { "key": "gtm_container", "label": "GTM detected", "result": "pass" },
    { "key": "measurement_id", "label": "Measurement ID matches inventory", "result": "pass" },
    { "key": "tracking_request", "label": "Tracking request detected", "result": "pass" },
    { "key": "duplicate", "label": "No duplicate tracking", "result": "pass" }
  ],
  "ga4": [
    { "key": "property_access", "label": "Property accessible", "result": "pass" },
    { "key": "recent_data", "label": "Recent data received", "result": "pass" },
    { "key": "events", "label": "Events received", "result": "pass" },
    {
      "key": "conversions",
      "label": "Conversions received",
      "result": "fail",
      "detail": "No generate_lead in the last 7 days."
    }
  ],
  "last24h": { "users": 183, "sessions": 421, "events": 2104, "conversions": 14 },
  "events": [{ "name": "form_submit", "result": "pass", "count24h": 12 }],
  "conversions": [{ "name": "generate_lead", "result": "fail", "count24h": 0 }],
  "issues": [
    {
      "id": "harbor-lane-conversion_drop-0",
      "code": "conversion_drop",
      "category": "analytics",
      "severity": "critical",
      "title": "Conversions dropped to zero",
      "detail": "Traffic and events look normal, but no conversions were recorded in the last 7 days.",
      "detectedAt": "2026-09-24T03:00:00.000Z",
      "comparison": { "metric": "conversions", "previous": 82, "current": 0, "changePct": -100 }
    }
  ]
}
```

- `tracking` / `ga4` are ordered lists; the dashboard renders them as given, so
  n8n can add check lines without a frontend change.
- `last24h` is `null` when GA4 couldn't be queried; `count24h` is `null` likewise.
- `issues` are the **open** issues. `comparison` is optional.

## `GET /site-history?id={siteId}&days={N}`

`N` is one of 7, 14, 30, 90.

```json
{
  "siteId": "harbor-lane",
  "periodDays": 7,
  "days": [
    { "date": "2026-09-24", "users": 1240, "sessions": 1702, "events": 9120, "conversions": 11 }
  ],
  "comparisons": [
    {
      "metric": "conversions",
      "previous": 82,
      "current": 0,
      "changePct": -100,
      "status": "critical",
      "note": "Possible conversion tracking issue"
    },
    { "metric": "users", "previous": 8626, "current": 8410, "changePct": -2.5, "status": "healthy" }
  ]
}
```

- `days` oldest → newest, complete days only (usually ending yesterday).
- `comparisons` are **n8n's** verdict: most recent `periodDays` vs the prior
  `periodDays`, regardless of `N`. Return `[]` if there isn't enough history.
- A site with no GA4 access returns `"days": [], "comparisons": []`.

---

## Security

- **Team access key.** All four endpoints use n8n Header Auth (credential
  **PMW Dashboard Access**, header `X-PMW-Access-Key`). Requests without the
  right key get `403` and run nothing. Each person types the key into the
  dashboard once per device; it is kept only in that browser's localStorage and
  is never in the build, the repo or the public page. Share it via 1Password.
  To rotate: change the credential's value in n8n, share the new key; everyone
  re-enters it (Data source page → "Forget key on this device").
- **No credentials in the frontend.** GA4 service-account key, Slack token and
  the access key's stored value live only in n8n credentials.
- **Content-Security-Policy** (added at build, see `vite.config.ts`): scripts
  only from the site, network requests only to the site and the n8n origin.
- **CORS** limits browser reads to `https://ceez-11.github.io` and localhost.
- **GA4 access** is a dedicated service account with Viewer (read-only) role
  and the `analytics.readonly` scope.
- **Logs:** the Dashboard API saves no execution data on success; the daily
  monitor posts to Slack if a run fails.
- **Slack** channel `#pmw-analytics-monitor` is private.

## Suggested n8n layout

1. **Monitor (Schedule, e.g. daily 03:00)** — read the site inventory (n8n Data
   Table / Google Sheet / Postgres) → for each site: crawl pages with a headless
   browser and record GA4/GTM tags, measurement IDs and `collect` requests →
   query the GA4 Data API (`runReport`: activeUsers, sessions, eventCount,
   keyEvents by date and by eventName) → compare to the previous period →
   write results + daily metrics to storage.
2. **Alerts** — after each run, post new critical issues to Slack immediately
   and a daily summary to a channel.
3. **Dashboard API (Webhooks)** — four `GET` webhooks reading from storage and
   shaping the JSON above. Keep them fast (read precomputed results; don't call
   GA4 per request).
