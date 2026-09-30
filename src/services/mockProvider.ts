/* Mock provider — serves the bundled SAMPLE data through the same interface
 * the n8n API provider implements. A small artificial delay keeps loading
 * states honest during development. */

import { mockHealthSummary, mockHistory, mockSiteDetails, toSummary } from '../mock/generate';
import type { HealthDataProvider } from './provider';

export function createMockProvider({
  latencyMs = 180,
  now = () => new Date(),
} = {}): HealthDataProvider {
  const wait = <T>(v: T): Promise<T> =>
    latencyMs > 0 ? new Promise((r) => setTimeout(() => r(v), latencyMs)) : Promise.resolve(v);
  const clamp = (days: number) => Math.max(1, Math.min(90, Math.round(days) || 7));

  return {
    kind: 'mock',
    getHealthSummary: () => wait(mockHealthSummary(now())),
    getSites: () => wait(mockSiteDetails(now()).map(toSummary)),
    getSite: (id) => wait(mockSiteDetails(now()).find((s) => s.id === id) ?? null),
    getSiteHistory: (id, days) => wait(mockHistory(id, clamp(days), now())),
  };
}
