/**
 * Per-offering pricing validation — the single source of truth shared by both
 * Property schema files (`models/Property.ts` runtime type + this CommonJS
 * runtime schema) and the create/update controllers, so the "offerings must
 * equal the present priced blocks, each with a positive price" rule can never
 * drift between layers.
 *
 * Pure & dependency-free apart from the `OfferingType`/`ExchangeMode` enums.
 */

import { OfferingType, ExchangeMode } from '@homiio/shared-types';

const VALID_OFFERINGS: ReadonlySet<string> = new Set(Object.values(OfferingType));
const VALID_EXCHANGE_MODES: ReadonlySet<string> = new Set(Object.values(ExchangeMode));

/** Subset of a property document this module inspects. */
export interface OfferingBearing {
  offerings?: unknown;
  longTermRent?: { monthlyAmount?: unknown } | null;
  shortTermRent?: { nightlyRate?: unknown } | null;
  sale?: { price?: unknown } | null;
  exchange?: { mode?: unknown } | null;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** A priced block is "present" when it is a non-null object on the document. */
function isPresent(block: unknown): boolean {
  return block !== undefined && block !== null && typeof block === 'object';
}

/**
 * The set of offerings that are actually backed by a present block on the
 * document — i.e. what `offerings` MUST equal for the listing to be coherent.
 */
export function presentOfferings(doc: OfferingBearing): OfferingType[] {
  const present: OfferingType[] = [];
  if (isPresent(doc.longTermRent)) present.push(OfferingType.LONG_TERM_RENT);
  if (isPresent(doc.shortTermRent)) present.push(OfferingType.SHORT_TERM_RENT);
  if (isPresent(doc.sale)) present.push(OfferingType.SALE);
  if (isPresent(doc.exchange)) present.push(OfferingType.EXCHANGE);
  return present;
}

/** Validated, de-duplicated `offerings` list, or null when the field is malformed. */
export function parseOfferings(raw: unknown): OfferingType[] | null {
  if (!Array.isArray(raw)) return null;
  const valid = raw.filter(
    (value): value is OfferingType => typeof value === 'string' && VALID_OFFERINGS.has(value)
  );
  if (valid.length !== raw.length) return null;
  return Array.from(new Set(valid));
}

/**
 * Validate a property's `offerings` against its priced blocks. Returns an error
 * message string on the first violation, or null when the listing is coherent:
 *  - `offerings` is a non-empty, valid, de-duplicated list,
 *  - it equals EXACTLY the set of present blocks (a block without its offering,
 *    or an offering without its block, is rejected), and
 *  - each present block carries a positive price / valid exchange mode.
 */
export function validateOfferings(doc: OfferingBearing): string | null {
  const offerings = parseOfferings(doc.offerings);
  if (offerings === null) {
    return 'offerings must be an array of valid offering types';
  }
  if (offerings.length === 0) {
    return 'A listing must declare at least one offering';
  }

  const declared = new Set<OfferingType>(offerings);
  const present = new Set<OfferingType>(presentOfferings(doc));

  for (const offering of declared) {
    if (!present.has(offering)) {
      return `Offering "${offering}" is declared but its pricing block is missing`;
    }
  }
  for (const offering of present) {
    if (!declared.has(offering)) {
      return `Pricing block for "${offering}" is present but the offering is not declared`;
    }
  }

  if (declared.has(OfferingType.LONG_TERM_RENT) && !isPositiveNumber(doc.longTermRent?.monthlyAmount)) {
    return 'A long-term-rent listing requires longTermRent.monthlyAmount (a positive number)';
  }
  if (declared.has(OfferingType.SHORT_TERM_RENT) && !isPositiveNumber(doc.shortTermRent?.nightlyRate)) {
    return 'A short-term-rent listing requires shortTermRent.nightlyRate (a positive number)';
  }
  if (declared.has(OfferingType.SALE) && !isPositiveNumber(doc.sale?.price)) {
    return 'A sale listing requires sale.price (a positive number)';
  }
  if (declared.has(OfferingType.EXCHANGE)) {
    const mode = doc.exchange?.mode;
    if (typeof mode !== 'string' || !VALID_EXCHANGE_MODES.has(mode)) {
      return 'An exchange listing requires a valid exchange.mode';
    }
  }

  return null;
}
