/* The one module views import to get data. It picks the provider from build
 * config (VITE_DATA_SOURCE) — views never know or care whether the numbers
 * came from bundled sample data or from n8n. */

import { config } from '../config';
import { createApiProvider } from './apiProvider';
import { createMockProvider } from './mockProvider';
import type { HealthDataProvider } from './provider';

export { DataError } from './provider';
export type { HealthDataProvider } from './provider';

let provider: HealthDataProvider =
  config.dataSource === 'api' ? createApiProvider(config) : createMockProvider();

/** Test seam: swap the provider without touching the views. */
export function setProvider(p: HealthDataProvider): void {
  provider = p;
}

export const analyticsHealth = {
  get source() {
    return provider.kind;
  },
  getHealthSummary: () => provider.getHealthSummary(),
  getSites: () => provider.getSites(),
  getSite: (id: string) => provider.getSite(id),
  getSiteHistory: (id: string, days = 7) => provider.getSiteHistory(id, days),
};
