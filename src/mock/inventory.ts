/* SAMPLE site inventory. Every name, domain and ID here is fictional — the
 * `.example` TLD is reserved and can never resolve to a real site — so mock
 * mode can't be mistaken for real PMW client data. In api mode this file is
 * not used at all; n8n supplies the real inventory. */

import type { CheckResult, Issue, SiteInventory } from '../types/health';

/** What the fake "n8n run" found on a site. Each scenario mirrors one of the
 *  real issue types the dashboard has to be able to display. */
export type Scenario =
  | 'healthy'
  | 'conversion_drop'
  | 'gtm_missing'
  | 'property_inaccessible'
  | 'no_recent_data'
  | 'measurement_id_mismatch'
  | 'expected_event_missing'
  | 'expected_conversion_missing'
  | 'traffic_drop'
  | 'event_drop'
  | 'duplicate_tracking'
  | 'crawl_timeout';

export interface MockSite extends SiteInventory {
  scenario: Scenario;
  /** Rough daily users, so sites differ in scale. */
  baseUsers: number;
}

const EVENTS_STD = ['page_view', 'scroll', 'click', 'form_start', 'form_submit'];
const EVENTS_LISTING = [...EVENTS_STD, 'view_listing', 'schedule_showing'];
const CONV_STD = ['generate_lead'];
const CONV_LISTING = ['generate_lead', 'rental_application_start'];

function site(
  id: string,
  name: string,
  domain: string,
  n: number,
  scenario: Scenario,
  baseUsers: number,
  listing = false,
): MockSite {
  const hex = (n * 7919 + 104729).toString(36).toUpperCase().padStart(7, 'X').slice(0, 7);
  return {
    id,
    name,
    domain,
    ga4PropertyId: String(400000000 + n * 1373),
    ga4MeasurementId: `G-${hex}${String(n).padStart(3, '0')}`.slice(0, 12),
    gtmContainerId: `GTM-${hex}`,
    expectedEvents: listing ? EVENTS_LISTING : EVENTS_STD,
    expectedConversions: listing ? CONV_LISTING : CONV_STD,
    scenario,
    baseUsers,
    // Sample split so local dev shows both groups.
    group: n <= 13 ? 'elite' : 'pmi',
  };
}

export const MOCK_SITES: MockSite[] = [
  site(
    'oakridge-pm',
    'Oakridge Property Management',
    'oakridgepm.example',
    1,
    'healthy',
    610,
    true,
  ),
  site(
    'harbor-lane',
    'Harbor Lane Rentals',
    'harborlanerentals.example',
    2,
    'conversion_drop',
    540,
    true,
  ),
  site(
    'summit-residential',
    'Summit Residential',
    'summitresidential.example',
    3,
    'healthy',
    1320,
    true,
  ),
  site('cedar-point', 'Cedar Point Homes', 'cedarpointhomes.example', 4, 'gtm_missing', 280),
  site(
    'brightwater',
    'Brightwater Property Group',
    'brightwaterpg.example',
    5,
    'healthy',
    890,
    true,
  ),
  site(
    'mesa-verde-pm',
    'Mesa Verde PM',
    'mesaverdepm.example',
    6,
    'expected_conversion_missing',
    470,
    true,
  ),
  site('northgate', 'Northgate Leasing', 'northgateleasing.example', 7, 'healthy', 350),
  site(
    'pinecrest',
    'Pinecrest Management',
    'pinecrestmgmt.example',
    8,
    'measurement_id_mismatch',
    720,
    true,
  ),
  site('riverbend', 'Riverbend Realty & PM', 'riverbendrealty.example', 9, 'healthy', 1980, true),
  site(
    'silver-oak',
    'Silver Oak Rentals',
    'silveroakrentals.example',
    10,
    'property_inaccessible',
    400,
  ),
  site('keystone', 'Keystone Property Co.', 'keystoneproperty.example', 11, 'healthy', 510),
  site('lakeshore', 'Lakeshore Residential', 'lakeshoreres.example', 12, 'traffic_drop', 930, true),
  site('granite-peak', 'Granite Peak PM', 'granitepeakpm.example', 13, 'healthy', 260),
  site(
    'willow-creek',
    'Willow Creek Homes',
    'willowcreekhomes.example',
    14,
    'expected_event_missing',
    380,
    true,
  ),
  site('coastal-key', 'Coastal Key Management', 'coastalkey.example', 15, 'healthy', 1150, true),
  site('redstone', 'Redstone Leasing Group', 'redstoneleasing.example', 16, 'no_recent_data', 330),
  site('ironwood', 'Ironwood Property Partners', 'ironwoodpp.example', 17, 'healthy', 640, true),
  site('bluebird', 'Bluebird Rentals', 'bluebirdrentals.example', 18, 'duplicate_tracking', 450),
  site('heritage', 'Heritage Home Management', 'heritagehm.example', 19, 'healthy', 780, true),
  site('prairie-wind', 'Prairie Wind PM', 'prairiewindpm.example', 20, 'event_drop', 300, true),
  site('crescent', 'Crescent City Leasing', 'crescentleasing.example', 21, 'healthy', 1460, true),
  site('evergreen', 'Evergreen Residential', 'evergreenres.example', 22, 'crawl_timeout', 520),
  site('maple-row', 'Maple Row Property Mgmt', 'maplerowpm.example', 23, 'healthy', 230),
  site('high-desert', 'High Desert Rentals', 'highdesertrentals.example', 24, 'healthy', 410, true),
  site('fairview', 'Fairview Leasing', 'fairviewleasing.example', 25, 'healthy', 690),
];

/** Per-scenario overrides of individual check lines, keyed by CheckItem.key.
 *  Anything not listed passes. */
export type CheckOverrides = Record<string, { result: CheckResult; detail?: string }>;

export interface ScenarioSpec {
  tracking?: CheckOverrides;
  ga4?: CheckOverrides;
  /** Issues without id/detectedAt/comparison — the generator fills those in. */
  issues: Array<
    Omit<Issue, 'id' | 'detectedAt' | 'comparison'> & {
      daysAgo?: number;
      compare?: 'users' | 'events' | 'conversions';
    }
  >;
  /** Names of expected events/conversions that are not arriving. */
  missingEvents?: string[];
  missingConversions?: string[];
  /** GA4 couldn't be queried at all → no numbers, no history. */
  noGa4Data?: boolean;
  /** Multipliers applied to the most recent `days` of history. */
  history?: {
    days: number;
    users?: number;
    sessions?: number;
    events?: number;
    conversions?: number;
  };
}
