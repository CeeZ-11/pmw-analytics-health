/* n8n API provider — reads monitoring results from n8n webhook endpoints.
 *
 * The browser only ever talks to n8n; n8n holds the GA4 service account and
 * talks to Google. Requests carry only the team access key the person typed
 * in (services/accessKey.ts) — never a Google, n8n or Slack credential. See
 * docs/n8n-api-contract.md for what each endpoint returns. */

import type { AppConfig } from '../config';
import type { HealthDataProvider } from './provider';
import { DataError } from './provider';
import { ACCESS_HEADER, getAccessKey } from './accessKey';
import { assertHistory, assertSiteDetail, assertSites, assertSummary, unwrap } from './contract';

/** Every path the dashboard calls, relative to VITE_API_BASE_URL. Keep this
 *  the one place endpoint paths are spelled out. */
export const ENDPOINTS = {
  healthSummary: () => '/health-summary',
  sites: () => '/sites',
  // Query parameters rather than /sites/:id — n8n prepends a random webhook
  // ID to any path containing a ":param", which would break a shared base URL.
  site: (id: string) => `/site?id=${encodeURIComponent(id)}`,
  siteHistory: (id: string, days: number) =>
    `/site-history?id=${encodeURIComponent(id)}&days=${encodeURIComponent(String(days))}`,
} as const;

export function createApiProvider(
  cfg: Pick<AppConfig, 'apiBaseUrl' | 'apiTimeoutMs'>,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  accessKey: () => string | null = getAccessKey,
): HealthDataProvider {
  async function get(path: string, { allow404 = false } = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.apiTimeoutMs);
    const key = accessKey();
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.apiBaseUrl}${path}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(key ? { [ACCESS_HEADER]: key } : {}),
        },
        // Never send cookies/credentials to n8n from a public static page.
        credentials: 'omit',
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new DataError(
          `n8n didn't respond within ${Math.round(cfg.apiTimeoutMs / 1000)}s.`,
          'timeout',
        );
      }
      throw new DataError(
        `Couldn't reach n8n (${(err as Error).message}). Check the API URL, that the workflow is active, and that CORS allows this site.`,
        'network',
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) {
      throw new DataError(
        key ? 'That access key was not accepted.' : 'This dashboard needs the team access key.',
        'auth',
        res.status,
      );
    }
    if (allow404 && res.status === 404) return null;
    if (!res.ok) throw new DataError(`n8n responded with HTTP ${res.status}.`, 'http', res.status);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new DataError('n8n returned a response that is not valid JSON.', 'contract');
    }
    return unwrap(body);
  }

  return {
    kind: 'api',
    async getHealthSummary() {
      return assertSummary(await get(ENDPOINTS.healthSummary()));
    },
    async getSites() {
      return assertSites(await get(ENDPOINTS.sites()));
    },
    async getSite(id) {
      const body = await get(ENDPOINTS.site(id), { allow404: true });
      return body == null ? null : assertSiteDetail(body);
    },
    async getSiteHistory(id, days) {
      const body = await get(ENDPOINTS.siteHistory(id, days), { allow404: true });
      return body == null ? null : assertHistory(body);
    },
  };
}
