/**
 * Multi-intent listing validation & normalization.
 *
 * Shared by the create and update controllers so the rules for `intents`,
 * `sale` and `exchange` live in exactly one place. Pure & typed against
 * `@homiio/shared-types`; it mutates the passed `propertyData` (defaulting
 * `intents` and computing `sale.pricePerSqm`) and throws a structured error
 * when an intent's required sub-payload is missing.
 */

import {
  ListingIntent,
  ExchangeMode,
  type PropertySale,
  type PropertyExchange
} from '@homiio/shared-types';

/** Subset of an incoming property body this module reads/writes. */
export interface IntentBearingPayload {
  intents?: unknown;
  sale?: Partial<PropertySale>;
  exchange?: Partial<PropertyExchange>;
  squareFootage?: number;
}

/** Thrown when an intent is declared without its required sub-payload. */
export class IntentValidationError extends Error {
  readonly code = 'INTENT_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'IntentValidationError';
  }
}

const VALID_INTENTS: ReadonlySet<string> = new Set(Object.values(ListingIntent));
const VALID_EXCHANGE_MODES: ReadonlySet<string> = new Set(Object.values(ExchangeMode));

/**
 * Coerce an incoming `intents` value into a validated, de-duplicated list.
 * Returns `undefined` when the field was absent (so callers can leave the
 * schema default in place on update) and an empty-safe list otherwise.
 */
function parseIntents(raw: unknown): ListingIntent[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  const valid = list.filter(
    (value): value is ListingIntent => typeof value === 'string' && VALID_INTENTS.has(value)
  );
  return Array.from(new Set(valid));
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Validate and normalize the multi-intent fields on a property body, in place.
 *
 * @param data            the incoming create/update body (mutated)
 * @param applyDefault    when true (create), default `intents` to `['rent']`
 *                        if omitted; when false (partial update), leave an
 *                        omitted `intents` untouched.
 * @throws IntentValidationError when a declared intent lacks its sub-payload.
 */
export function applyIntentRules(data: IntentBearingPayload, applyDefault: boolean): void {
  const parsed = parseIntents(data.intents);

  // Resolve the effective intent set for required-field checks.
  let intents: ListingIntent[] | undefined = parsed;
  if (intents === undefined && applyDefault) {
    intents = [ListingIntent.RENT];
  }

  // Persist the normalized list back (only when we have one to write).
  if (parsed !== undefined) {
    data.intents = parsed.length > 0 ? parsed : [ListingIntent.RENT];
  } else if (applyDefault) {
    data.intents = [ListingIntent.RENT];
  }

  const effectiveIntents = intents ?? [];

  // On a partial UPDATE (applyDefault=false) the stored sale/exchange blocks
  // persist when omitted from the body, so an intent declared WITHOUT its
  // sub-block is a legitimate edit (e.g. PATCH intents only). We therefore only
  // validate a sub-block when it is PRESENT in the body. On CREATE
  // (applyDefault=true) the sub-block is required whenever its intent is set.
  const salePresent = data.sale !== undefined && data.sale !== null;
  const exchangePresent = data.exchange !== undefined && data.exchange !== null;

  // SALE requires a price and currency — on create always, on update only when
  // the `sale` block is being written.
  if (effectiveIntents.includes(ListingIntent.SALE) && (applyDefault || salePresent)) {
    if (!isPositiveNumber(data.sale?.price)) {
      throw new IntentValidationError('A sale listing requires sale.price (a positive number)');
    }
    if (typeof data.sale?.currency !== 'string' || data.sale.currency.trim().length === 0) {
      throw new IntentValidationError('A sale listing requires sale.currency');
    }
  }

  // EXCHANGE requires a mode (availabilityWindows default to []) — on create
  // always, on update only when the `exchange` block is being written.
  if (effectiveIntents.includes(ListingIntent.EXCHANGE) && (applyDefault || exchangePresent)) {
    const mode = data.exchange?.mode;
    if (typeof mode !== 'string' || !VALID_EXCHANGE_MODES.has(mode)) {
      throw new IntentValidationError('An exchange listing requires a valid exchange.mode');
    }
  }

  // Derive sale.pricePerSqm server-side when both price and area are known.
  if (data.sale && isPositiveNumber(data.sale.price) && isPositiveNumber(data.squareFootage)) {
    data.sale.pricePerSqm = Math.round(data.sale.price / data.squareFootage);
  }
}
