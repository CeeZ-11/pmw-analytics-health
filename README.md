# PMW Analytics Health Dashboard

Internal dashboard that answers: **which PMW sites are healthy, which have
tracking/data issues, and which need attention?**

This repo is **only the frontend** — a static site for GitHub Pages. All
monitoring (scheduled checks, crawling, GA4 Data API, GTM/tracking checks,
historical comparison, Slack alerts) lives in **n8n**. The dashboard displays
the results n8n returns and makes no health judgements of its own.

```
GitHub Pages (this repo) ──GET JSON──► n8n ──► GA4 · site crawl · PageSpeed
                                        └──► Slack
```

It shares its visual language with the PMW Speed Engine (`../PSI Audit Engine`):
the same dark palette, icon rail + top bar shell, cards, pills, tables and
hand-drawn canvas charts.

> Until n8n is connected, the app runs on **sample data**. Every sample site
> uses a fictional `.example` domain, and the UI shows a "Sample data" badge
> and notice on every page.

## Quick start

Requires Node 22+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (service layer, contract guards, filters, router)
npm run build      # typecheck + production build → dist/
npm run preview    # serve dist/ locally
```

## Configuration

Build-time variables (see `.env.example`; copy to `.env.local` for local use):

| Variable              | Default | Meaning                                                                       |
| --------------------- | ------- | ----------------------------------------------------------------------------- |
| `VITE_DATA_SOURCE`    | `mock`  | `mock` = bundled sample data · `api` = n8n endpoints                          |
| `VITE_API_BASE_URL`   | —       | n8n webhook base, e.g. `https://n8n.example.com/webhook/pmw-analytics-health` |
| `VITE_API_TIMEOUT_MS` | `15000` | Request timeout                                                               |

`api` without a base URL falls back to `mock`. **These values are public** —
they're compiled into the JS bundle. Never put credentials in them.

## Deploying to GitHub Pages

1. Create a GitHub repo (e.g. `pmw-analytics-health`) and push this folder to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. (When n8n is ready) **Settings → Secrets and variables → Actions → Variables**:
   add `VITE_DATA_SOURCE=api` and `VITE_API_BASE_URL=…`. Use _Variables_, not _Secrets_.
4. Push to `main` (or run the workflow manually). `.github/workflows/deploy.yml`
   runs the tests, builds, and publishes `dist/`.

The build uses relative asset paths and hash routing (`#/sites/:id`), so it
works at `https://<org>.github.io/pmw-analytics-health/`, on a custom domain,
and on reload of any deep link — no `404.html` workaround needed.

## Project structure

```
src/
  types/health.ts          Data contract with n8n (single source of truth)
  config.ts                Reads VITE_* build config
  services/
    analyticsHealth.ts     The only data module views import
    provider.ts            HealthDataProvider interface + DataError
    apiProvider.ts         n8n implementation (ENDPOINTS, timeout, errors)
    mockProvider.ts        Sample-data implementation
    contract.ts            Runtime checks on n8n responses
  mock/                    Fictional inventory + scenarios (stand-in for n8n)
  lib/                     status system, filters, router, chart, formatting
  components/ui.ts         Cards, page head, loading/error/sample notices
  views/                   dashboard, siteDetail, integration
  styles/app.css           PMW design tokens + components
docs/n8n-api-contract.md   Endpoint shapes, security notes, n8n layout
```

### Pages

- **Dashboard** `#/` — summary tiles (monitored / healthy / warning / critical),
  status distribution bar, site table (GA4 · GTM · Data · Events · Conversions ·
  Issues · Last checked · Health) with search by name/domain, status filters,
  issue-type filters (tracking · analytics · data quality · conversions) and
  sorting. Filters live in the URL, so filtered views can be shared.
- **Site detail** `#/sites/:id` — overall verdict, recent issues (with
  previous → current numbers), tracking checks, GA4 checks, last 24 hours,
  expected events and conversions, site inventory, and history: users /
  sessions / events / conversions over 7–90 days, n8n's period comparisons and
  a daily values table.
- **Data source** `#/integration` — active data source and the exact endpoints
  this build calls.

## Connecting n8n

Build the four read-only webhooks described in
[`docs/n8n-api-contract.md`](docs/n8n-api-contract.md):

```
GET /health-summary
GET /sites
GET /sites/:id
GET /sites/:id/history?days=N
```

Then set `VITE_DATA_SOURCE=api` and `VITE_API_BASE_URL`. No frontend code changes.
