/* Lightweight runtime checks on n8n responses.
 *
 * TypeScript types vanish at runtime, and an n8n workflow edited in the UI can
 * easily start returning a slightly different shape. These guards check the
 * fields the views actually dereference, so a contract break shows a clear
 * "n8n returned an unexpected response" message instead of a blank page or a
 * TypeError deep inside a render function. They are deliberately not a full
 * schema validator — extra fields are fine and optional ones may be absent. */

import type { HealthSummary, SiteDetail, SiteHistory, SiteSummary } from '../types/health';
import { DataError } from './provider';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(what: string, why: string): never {
  throw new DataError(`n8n returned an unexpected ${what} response: ${why}.`, 'contract');
}

function need(o: Obj, what: string, key: string, type: 'string' | 'number' | 'array' | 'object') {
  const v = o[key];
  const ok = type === 'array' ? Array.isArray(v) : type === 'object' ? isObj(v) : typeof v === type;
  if (!ok) fail(what, `"${key}" should be ${type === 'array' ? 'an array' : `a ${type}`}`);
}

/** n8n "Respond to Webhook" nodes often wrap payloads as { data: … }. Accept
 *  both the bare payload and that envelope. */
export function unwrap(body: unknown): unknown {
  if (isObj(body) && 'data' in body && Object.keys(body).length <= 2) return body.data;
  return body;
}

export function assertSummary(v: unknown): HealthSummary {
  if (!isObj(v)) fail('health-summary', 'expected an object');
  for (const k of ['total', 'healthy', 'warning', 'critical'])
    need(v, 'health-summary', k, 'number');
  need(v, 'health-summary', 'generatedAt', 'string');
  return v as unknown as HealthSummary;
}

export function assertSiteSummary(v: unknown, what = 'sites'): SiteSummary {
  if (!isObj(v)) fail(what, 'expected each site to be an object');
  for (const k of ['id', 'name', 'domain', 'status']) need(v, what, k, 'string');
  need(v, what, 'checks', 'object');
  need(v, what, 'issueCounts', 'object');
  need(v, what, 'issueCategories', 'array');
  need(v, what, 'expectedEvents', 'array');
  need(v, what, 'expectedConversions', 'array');
  if (!['healthy', 'warning', 'critical'].includes(v.status as string)) {
    fail(what, `"status" must be healthy, warning or critical (got "${String(v.status)}")`);
  }
  return v as unknown as SiteSummary;
}

export function assertSites(v: unknown): SiteSummary[] {
  if (!Array.isArray(v)) fail('sites', 'expected an array of sites');
  return v.map((s) => assertSiteSummary(s));
}

export function assertSiteDetail(v: unknown): SiteDetail {
  assertSiteSummary(v, 'site detail');
  const o = v as Obj;
  for (const k of ['tracking', 'ga4', 'events', 'conversions', 'issues'])
    need(o, 'site detail', k, 'array');
  return v as SiteDetail;
}

export function assertHistory(v: unknown): SiteHistory {
  if (!isObj(v)) fail('history', 'expected an object');
  need(v, 'history', 'days', 'array');
  need(v, 'history', 'comparisons', 'array');
  return v as unknown as SiteHistory;
}
