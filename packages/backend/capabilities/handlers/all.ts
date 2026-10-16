import { LISTING_HANDLERS } from './listings';
import { SAVED_HANDLERS } from './saved';
import { PROPERTY_HANDLERS } from './properties';
import { VIEWING_HANDLERS } from './viewings';
import { RESERVATION_HANDLERS } from './reservations';
import { EXCHANGE_HANDLERS } from './exchanges';
import { APPLICATION_HANDLERS } from './applications';
import { LEASE_HANDLERS } from './leases';
import { PAYMENT_HANDLERS } from './payments';
import { MAINTENANCE_HANDLERS } from './maintenance';
import { EVICTION_HANDLERS } from './evictions';
import { REVIEW_HANDLERS } from './reviews';
import { ADDRESS_HANDLERS } from './addresses';
import { PROFILE_HANDLERS } from './profile';
import { NOTIFICATION_HANDLERS } from './notifications';
import { ROOMMATE_HANDLERS } from './roommates';
import { PARTNER_HANDLERS } from './partners';
import { ENTITLEMENT_HANDLERS } from './entitlements';
import type { HomiioToolHandler, HomiioToolHandlers } from './context';

const PARTS: readonly HomiioToolHandlers[] = [
  LISTING_HANDLERS,
  SAVED_HANDLERS,
  PROPERTY_HANDLERS,
  VIEWING_HANDLERS,
  RESERVATION_HANDLERS,
  EXCHANGE_HANDLERS,
  APPLICATION_HANDLERS,
  LEASE_HANDLERS,
  PAYMENT_HANDLERS,
  MAINTENANCE_HANDLERS,
  EVICTION_HANDLERS,
  REVIEW_HANDLERS,
  ADDRESS_HANDLERS,
  PROFILE_HANDLERS,
  NOTIFICATION_HANDLERS,
  ROOMMATE_HANDLERS,
  PARTNER_HANDLERS,
  ENTITLEMENT_HANDLERS,
];

/** Every tool's handler by name. A name in two parts is a bug. */
export const HOMIIO_TOOL_HANDLERS: HomiioToolHandlers = (() => {
  const merged: Record<string, HomiioToolHandler> = {};
  for (const part of PARTS) {
    for (const [name, handler] of Object.entries(part)) {
      if (name in merged) throw new Error(`Tool handler declared twice: ${name}`);
      merged[name] = handler;
    }
  }
  return merged;
})();
