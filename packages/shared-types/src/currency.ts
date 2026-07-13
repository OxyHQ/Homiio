/**
 * Currency code sets shared by the Homiio frontend and backend.
 *
 * There are two DISTINCT scopes — keep them separate, never merge:
 *
 * 1. {@link LISTING_CURRENCIES} — the price shown ON a property / city / country
 *    listing. Homiio ingests external listings from many markets, and each portal
 *    emits its local currency (Otodom → PLN, MercadoLibre MX → MXN, Zonaprop →
 *    ARS, …). This set therefore MUST cover every market the provider registry
 *    can ingest, otherwise the Property mongoose enum rejects a real listing at
 *    ingest. `FAIR` (FairCoin) is included for the ethical-pricing exchange flow
 *    and is the only non-ISO-4217, 4-character code.
 *
 * 2. {@link PAYMENT_CURRENCIES} — money that actually MOVES through Homiio's
 *    in-app payment + partner-commission pipeline (lease rent, review-reported
 *    rent). Kept deliberately narrow to the currencies the payout / settlement
 *    infrastructure supports today; widen this only alongside real payment-
 *    processor support, not because a listing exists in that currency (external
 *    listings never enter the in-app payment flow).
 */

/**
 * ISO-4217 codes for every market Homiio ingests, plus `FAIR` (FairCoin).
 *
 * Coverage (see `packages/listing-providers` provider registry):
 * - USD: US, EC
 * - EUR: ES, PT, IT, FR, DE, BE, NL, IE, RO (Romanian real estate is priced in EUR)
 * - GBP: GB
 * - CAD: CA
 * - PLN: PL   - MXN: MX   - ARS: AR   - RON: RO   - COP: CO
 * - CLP: CL   - PEN: PE   - BRL: BR   - AUD: AU   - AED: AE
 * - FAIR: FairCoin (ethical-pricing / home-exchange)
 */
export const LISTING_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'PLN',
  'MXN',
  'ARS',
  'RON',
  'COP',
  'CLP',
  'PEN',
  'BRL',
  'AUD',
  'AED',
  'FAIR',
] as const;

/** A currency accepted on a property / city / country listing block. */
export type ListingCurrency = (typeof LISTING_CURRENCIES)[number];

/**
 * Currencies Homiio's in-app payment + commission pipeline settles (lease rent,
 * review-reported rent). Narrow on purpose — see the module doc.
 */
export const PAYMENT_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD'] as const;

/** A currency accepted for in-app payment records (lease / review). */
export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];
