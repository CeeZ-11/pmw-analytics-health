import type { HealthSummary, SiteDetail, SiteHistory, SiteSummary } from '../types/health';

/** Everything the UI can ask for. Both the mock provider and the n8n API
 *  provider implement exactly this, so swapping one for the other is a config
 *  change (VITE_DATA_SOURCE), not a code change. Conceptually:
 *
 *    GET /health-summary       → getHealthSummary()
 *    GET /sites                → getSites()
 *    GET /sites/:id            → getSite(id)
 *    GET /sites/:id/history    → getSiteHistory(id, days)
 */
export interface HealthDataProvider {
  readonly kind: 'mock' | 'api';
  getHealthSummary(): Promise<HealthSummary>;
  getSites(): Promise<SiteSummary[]>;
  /** Resolves null when the site doesn't exist (HTTP 404). */
  getSite(id: string): Promise<SiteDetail | null>;
  getSiteHistory(id: string, days: number): Promise<SiteHistory | null>;
}

/** A failure the UI can explain to a person: network, timeout, bad status,
 *  or a response that doesn't match the contract in types/health.ts. */
export class DataError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'timeout' | 'http' | 'contract',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DataError';
  }
}
