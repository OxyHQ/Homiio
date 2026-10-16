import { PLATFORM_ROUTE_COVERAGE } from './platform';
import { LISTING_ROUTE_COVERAGE } from './listings';
import { SAVED_ROUTE_COVERAGE } from './saved';
import { PROPERTY_ROUTE_COVERAGE } from './properties';
import { VIEWING_ROUTE_COVERAGE } from './viewings';
import { RESERVATION_ROUTE_COVERAGE } from './reservations';
import { EXCHANGE_ROUTE_COVERAGE } from './exchanges';
import { APPLICATION_ROUTE_COVERAGE } from './applications';
import { LEASE_ROUTE_COVERAGE } from './leases';
import { PAYMENT_ROUTE_COVERAGE } from './payments';
import { MAINTENANCE_ROUTE_COVERAGE } from './maintenance';
import { EVICTION_ROUTE_COVERAGE } from './evictions';
import { REVIEW_ROUTE_COVERAGE } from './reviews';
import { ADDRESS_ROUTE_COVERAGE } from './addresses';
import { PROFILE_ROUTE_COVERAGE } from './profile';
import { NOTIFICATION_ROUTE_COVERAGE } from './notifications';
import { ROOMMATE_ROUTE_COVERAGE } from './roommates';
import { PARTNER_ROUTE_COVERAGE } from './partners';
import { ENTITLEMENT_ROUTE_COVERAGE } from './entitlements';
import type { RouteCoverage } from './types';

export type { RouteCoverage, RouteCoverageEntry } from './types';

const PARTS: readonly RouteCoverage[] = [
  PLATFORM_ROUTE_COVERAGE,
  LISTING_ROUTE_COVERAGE,
  SAVED_ROUTE_COVERAGE,
  PROPERTY_ROUTE_COVERAGE,
  VIEWING_ROUTE_COVERAGE,
  RESERVATION_ROUTE_COVERAGE,
  EXCHANGE_ROUTE_COVERAGE,
  APPLICATION_ROUTE_COVERAGE,
  LEASE_ROUTE_COVERAGE,
  PAYMENT_ROUTE_COVERAGE,
  MAINTENANCE_ROUTE_COVERAGE,
  EVICTION_ROUTE_COVERAGE,
  REVIEW_ROUTE_COVERAGE,
  ADDRESS_ROUTE_COVERAGE,
  PROFILE_ROUTE_COVERAGE,
  NOTIFICATION_ROUTE_COVERAGE,
  ROOMMATE_ROUTE_COVERAGE,
  PARTNER_ROUTE_COVERAGE,
  ENTITLEMENT_ROUTE_COVERAGE,
];

/** Every authenticated route's tool or exclusion. A key in two parts is a bug. */
export const AUTHENTICATED_ROUTE_COVERAGE: RouteCoverage = (() => {
  const merged: Record<string, RouteCoverage[string]> = {};
  for (const part of PARTS) {
    for (const [route, entry] of Object.entries(part)) {
      if (route in merged) throw new Error(`Route coverage declared twice: ${route}`);
      merged[route] = entry;
    }
  }
  return merged;
})();
