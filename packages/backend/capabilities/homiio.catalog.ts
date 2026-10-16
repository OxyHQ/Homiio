/**
 * Homiio's capability catalogue — everything a signed-in person can do in
 * Homiio, as that person, for Alia (`/_oxy/mcp`) and for any OAuth MCP client
 * (`mcp.homiio.com/mcp`). The accepted design is `docs/sindi.md`.
 *
 * One tool per person action. Each tool's handler (`homiio.handlers.ts`) calls
 * the SAME domain use case the Express route calls (`domain/*`), as the
 * effective account, so a tool returns exactly what the route returns to that
 * person (ADR 0003) and a non-owner gets the route's not-found. Which routes
 * have no tool, and why, is `routeCoverage/*`.
 *
 * **Bump `version` whenever a tool changes.** Oxy registers a catalogue by
 * (appId, version, digest); `catalogVersion.test.ts` pins the digest so a change
 * without a bump fails here rather than as a registration refusal at boot.
 */

import type { AppCapabilityCatalog } from '@oxy.so/contracts';
import { LISTING_TOOLS } from './catalog/listings';
import { SAVED_TOOLS } from './catalog/saved';
import { PROPERTY_TOOLS } from './catalog/properties';
import { VIEWING_TOOLS } from './catalog/viewings';
import { RESERVATION_TOOLS } from './catalog/reservations';
import { EXCHANGE_TOOLS } from './catalog/exchanges';
import { APPLICATION_TOOLS } from './catalog/applications';
import { LEASE_TOOLS } from './catalog/leases';
import { PAYMENT_TOOLS } from './catalog/payments';
import { MAINTENANCE_TOOLS } from './catalog/maintenance';
import { EVICTION_TOOLS } from './catalog/evictions';
import { REVIEW_TOOLS } from './catalog/reviews';
import { ADDRESS_TOOLS } from './catalog/addresses';
import { PROFILE_TOOLS } from './catalog/profile';
import { NOTIFICATION_TOOLS } from './catalog/notifications';
import { ROOMMATE_TOOLS } from './catalog/roommates';
import { PARTNER_TOOLS } from './catalog/partners';
import { ENTITLEMENT_TOOLS } from './catalog/entitlements';

export const HOMIIO_SINDI_FILES_FEATURE = 'sindi.files';

export const HOMIIO_CAPABILITY_CATALOG: AppCapabilityCatalog = {
  schemaVersion: '1',
  appId: 'homiio',
  version: '1.0.0',
  audience: 'oxy-homiio-api',
  internalBaseUrl: 'https://api.homiio.com',
  internalTransport: 'mcp',
  accountResourceType: 'homiio_account',
  externalMcp: { resource: 'https://mcp.homiio.com' },
  features: [
    {
      key: HOMIIO_SINDI_FILES_FEATURE,
      description:
        'Reading files and photos the person attaches (contract review, housing image analysis). Homiio+ unlocks it; otherwise each use spends one file credit.',
      checkTool: 'readFileEntitlement',
      consumeTool: 'consumeFileCredit',
    },
  ],
  tools: [
    ...LISTING_TOOLS,
    ...SAVED_TOOLS,
    ...PROPERTY_TOOLS,
    ...VIEWING_TOOLS,
    ...RESERVATION_TOOLS,
    ...EXCHANGE_TOOLS,
    ...APPLICATION_TOOLS,
    ...LEASE_TOOLS,
    ...PAYMENT_TOOLS,
    ...MAINTENANCE_TOOLS,
    ...EVICTION_TOOLS,
    ...REVIEW_TOOLS,
    ...ADDRESS_TOOLS,
    ...PROFILE_TOOLS,
    ...NOTIFICATION_TOOLS,
    ...ROOMMATE_TOOLS,
    ...PARTNER_TOOLS,
    ...ENTITLEMENT_TOOLS,
  ],
  events: [],
};
