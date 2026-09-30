import type { IssueCategory, IssueCode } from '../types/health';

export const CATEGORY_LABEL: Record<IssueCategory, string> = {
  tracking: 'Tracking',
  analytics: 'Analytics',
  'data-quality': 'Data quality',
};

/** Friendly names for the issue codes n8n emits. Unknown codes fall back to
 *  the issue's own title, so new codes never need a frontend change. */
export const ISSUE_LABEL: Record<IssueCode, string> = {
  ga4_missing: 'GA4 missing',
  gtm_missing: 'GTM missing',
  measurement_id_mismatch: 'Incorrect Measurement ID',
  gtm_container_mismatch: 'Incorrect GTM container',
  tracking_request_missing: 'Tracking request not detected',
  duplicate_tracking: 'Potential duplicate tracking',
  no_recent_data: 'No recent GA4 data',
  traffic_drop: 'Sudden traffic drop',
  event_drop: 'Sudden event drop',
  conversion_drop: 'Sudden conversion drop',
  property_inaccessible: 'GA4 property inaccessible',
  expected_event_missing: 'Expected event missing',
  expected_conversion_missing: 'Expected conversion missing',
  baseline_deviation: 'Deviation from historical baseline',
};

export function issueLabel(code: string, fallback: string): string {
  return (ISSUE_LABEL as Record<string, string>)[code] ?? fallback;
}
