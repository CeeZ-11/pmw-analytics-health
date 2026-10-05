/* The data contract between the n8n monitoring automation and this dashboard.
 *
 * Every shape here is what n8n *returns* — the frontend never derives a health
 * status, detects an issue, or compares against a baseline itself. n8n runs
 * the crawls, GA4 Data API queries and historical comparisons, decides the
 * verdicts, and the dashboard only renders them. docs/n8n-api-contract.md
 * documents the same shapes with JSON examples for whoever builds the
 * workflows; keep the two in sync. */

/** Overall verdict for a site. Decided by n8n. */
export type HealthStatus = 'healthy' | 'warning' | 'critical';

/** Result of one individual check. `unknown` = n8n could not run the check
 *  (e.g. the site timed out), which is different from the check failing. */
export type CheckResult = 'pass' | 'warn' | 'fail' | 'unknown';

export type IssueCategory = 'tracking' | 'analytics' | 'data-quality';
export type IssueSeverity = 'warning' | 'critical';

/** Machine-readable issue codes n8n can emit. The dashboard has a friendly
 *  label for each (lib/issues.ts) but will still render an unrecognised code
 *  using the issue's own `title`, so n8n can add codes without a frontend
 *  release. */
export type IssueCode =
  // Tracking
  | 'ga4_missing'
  | 'gtm_missing'
  | 'measurement_id_mismatch'
  | 'gtm_container_mismatch'
  | 'tracking_request_missing'
  | 'duplicate_tracking'
  // Analytics
  | 'no_recent_data'
  | 'traffic_drop'
  | 'event_drop'
  | 'conversion_drop'
  | 'property_inaccessible'
  // Data quality
  | 'expected_event_missing'
  | 'expected_conversion_missing'
  | 'baseline_deviation';

/** The monitored-site inventory — what PMW expects to find on each site. */
export interface SiteInventory {
  /** Stable URL-safe identifier, e.g. "oakridge-pm". Used in routes. */
  id: string;
  name: string;
  /** Bare hostname, no scheme: "oakridgepm.example". */
  domain: string;
  /** Numeric GA4 property ID, e.g. "properties/123456789" → "123456789". */
  ga4PropertyId: string | null;
  /** GA4 web stream measurement ID, e.g. "G-ABC123XYZ". */
  ga4MeasurementId: string | null;
  /** GTM container ID, e.g. "GTM-ABC1234". */
  gtmContainerId: string | null;
  /** GA4 event names that should be arriving (e.g. "form_submit"). */
  expectedEvents: string[];
  /** GA4 key events / conversions that should be arriving. */
  expectedConversions: string[];
  /** Portfolio the site belongs to, lowercase slug: "elite", "pmi". */
  group?: string | null;
}

/** One column per dashboard-table cell. */
export interface SiteCheckColumns {
  ga4: CheckResult;
  gtm: CheckResult;
  data: CheckResult;
  events: CheckResult;
  conversions: CheckResult;
}

/** A row in the dashboard table — GET /sites returns an array of these. */
export interface SiteSummary extends SiteInventory {
  status: HealthStatus;
  /** ISO-8601 timestamp of the last completed check, or null if never checked. */
  lastChecked: string | null;
  checks: SiteCheckColumns;
  issueCounts: { warning: number; critical: number };
  /** Distinct categories among this site's open issues — drives the
   *  "Tracking / Analytics / Conversion issues" filters. */
  issueCategories: IssueCategory[];
  /** True when at least one open issue concerns conversions/key events. */
  hasConversionIssue: boolean;
  /** True for seed/sample rows served by n8n before real monitoring runs. */
  isSample?: boolean;
}

/** One line in a check group on the site detail page. */
export interface CheckItem {
  key: string;
  label: string;
  result: CheckResult;
  /** Optional evidence: "Found G-ABC123 in page source", "HTTP 403 from GA4 Data API". */
  detail?: string;
}

export interface MetricTotals {
  users: number;
  sessions: number;
  events: number;
  conversions: number;
}

/** Whether an expected event / conversion was seen in the lookback window. */
export interface ExpectedItemStatus {
  name: string;
  result: CheckResult;
  /** Count in the last 24 h, or null when GA4 couldn't be queried. */
  count24h: number | null;
}

export interface Issue {
  id: string;
  code: IssueCode | string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** ISO-8601 — when n8n first detected this issue. */
  detectedAt: string;
  /** For drop/deviation issues: the numbers n8n compared. */
  comparison?: {
    metric: keyof MetricTotals;
    previous: number;
    current: number;
    /** Percent change, e.g. -100 for 82 → 0. */
    changePct: number;
  };
}

/** GET /site?id=… */
export interface SiteDetail extends SiteSummary {
  tracking: CheckItem[];
  ga4: CheckItem[];
  /** GA4 totals for the last 24 hours, or null when unavailable. */
  last24h: MetricTotals | null;
  events: ExpectedItemStatus[];
  conversions: ExpectedItemStatus[];
  issues: Issue[];
}

export interface DailyMetrics extends MetricTotals {
  /** Calendar date in the site's reporting time zone, "YYYY-MM-DD". */
  date: string;
}

/** n8n's own current-vs-previous period comparison for one metric. */
export interface PeriodComparison {
  metric: keyof MetricTotals;
  previous: number;
  current: number;
  changePct: number;
  status: HealthStatus;
  /** Human sentence from n8n, e.g. "Possible conversion tracking issue". */
  note?: string;
}

/** GET /site-history?id=…&days=N */
export interface SiteHistory {
  siteId: string;
  days: DailyMetrics[];
  /** Comparisons of the most recent `periodDays` against the prior period. */
  periodDays: number;
  comparisons: PeriodComparison[];
}

/** GET /health-summary */
export interface HealthSummary {
  /** ISO-8601 — when n8n produced this summary. */
  generatedAt: string;
  /** ISO-8601 — when the most recent monitoring run finished. */
  lastRunAt: string | null;
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  /** True while n8n is serving seed/sample rows rather than real monitoring
   *  results — the dashboard keeps its "Sample data" labelling. */
  isSample?: boolean;
}
