import type { RouteCoverage } from './types';

/**
 * Authenticated routes that are not a person's housing actions at all, and so
 * have no tool. Each reason is the decision, not a placeholder.
 */
const SCRAPER =
  'Listing-provider infrastructure behind `requireAdmin` — the one sanctioned admin surface (AGENTS.md); never an agent action.';
const TELEGRAM =
  'Operator tooling for the Telegram listing bot (test messages, bulk notifications, group mapping); not something a signed-in person does.';
const BILLING_OPS = 'Stripe webhook, debug or manual-override plumbing; not a person action.';
const SUBSCRIPTION =
  'Homiio+ is bought and managed on Stripe-hosted pages the person completes themselves; the catalogue never moves money outside the `finance` limits, and the plan gate agents use is the `sindi.files` feature (readFileEntitlement / consumeFileCredit).';
const TEAM_CHAT =
  'Eviction team chat is MLS-encrypted Allo; opening or changing the group needs the person’s own device key material, which no server-side tool holds.';
const IMAGE_BYTES =
  'Raw multipart image upload/removal for the photo picker. A listing tool takes photos the app already uploaded; bytes never travel through a tool call.';

export const PLATFORM_ROUTE_COVERAGE: RouteCoverage = {
  'POST /api/team-chat/finalize': { excluded: TEAM_CHAT },
  'POST /api/evictions/:id/team-chat/operations': { excluded: TEAM_CHAT },
  'GET /api/evictions/:id/team-chat': { excluded: TEAM_CHAT },

  'GET /api/scraper/health': { excluded: SCRAPER },
  'POST /api/scraper/run': { excluded: SCRAPER },
  'POST /api/scraper/cleanup': { excluded: SCRAPER },
  'GET /api/scraper/sources': { excluded: SCRAPER },

  'GET /api/telegram/status': { excluded: TELEGRAM },
  'POST /api/telegram/test-message': { excluded: TELEGRAM },
  'POST /api/telegram/test-location-support': { excluded: TELEGRAM },
  'GET /api/telegram/check-location-support': { excluded: TELEGRAM },
  'POST /api/telegram/notify/:propertyId': { excluded: TELEGRAM },
  'POST /api/telegram/bulk-notify': { excluded: TELEGRAM },
  'GET /api/telegram/group-mapping/:city': { excluded: TELEGRAM },
  'GET /api/telegram/test-recent-properties': { excluded: TELEGRAM },

  'POST /api/billing/webhook': { excluded: BILLING_OPS },
  'GET /api/billing/webhook-test': { excluded: BILLING_OPS },
  'GET /api/billing/debug-billing': { excluded: BILLING_OPS },
  'POST /api/billing/manual-activate': { excluded: BILLING_OPS },
  'POST /api/billing/manual-cancel': { excluded: BILLING_OPS },
  'POST /api/billing/webhook-test-endpoint': { excluded: BILLING_OPS },
  'GET /api/billing/debug-subscription': { excluded: BILLING_OPS },
  'POST /api/billing/sync-subscription': { excluded: SUBSCRIPTION },
  'POST /api/billing/cancel-subscription': { excluded: SUBSCRIPTION },
  'POST /api/billing/reactivate-subscription': { excluded: SUBSCRIPTION },
  'POST /api/billing/checkout': { excluded: SUBSCRIPTION },
  'POST /api/billing/customer-portal': { excluded: SUBSCRIPTION },

  'POST /api/images/upload': { excluded: IMAGE_BYTES },
  'POST /api/images/upload-multiple': { excluded: IMAGE_BYTES },
  'DELETE /api/images/:imageKey': { excluded: IMAGE_BYTES },

  'POST /api/cities': {
    excluded: 'Admin-only city maintenance (owner veto on admin tools, AGENTS.md).',
  },
  'PUT /api/cities/:id/update-count': {
    excluded: 'Admin-only city maintenance (owner veto on admin tools, AGENTS.md).',
  },
  'GET /api/health': { excluded: 'A liveness probe, not a person action.' },
};
