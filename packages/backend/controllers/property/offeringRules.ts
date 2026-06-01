/**
 * Per-offering listing validation & normalization.
 *
 * Shared by the create and update controllers so the rules for `offerings`,
 * the priced blocks (`longTermRent`/`shortTermRent`/`sale`/`exchange`) live in
 * exactly one place. The structural "offerings equals the present blocks, each
 * with a positive price" rule is delegated to the shared `validateOfferings`
 * (the SAME function the Property schema validator uses), so the controller and
 * the DB can never disagree. This module adds the create/update semantics on
 * top: it throws a structured error on create, is lenient on partial updates,
 * and derives `sale.pricePerSqm` server-side.
 *
 * Pure & typed against `@homiio/shared-types`; it mutates the passed body.
 */

import { OfferingType, type PropertySale } from '@homiio/shared-types';
import {
  validateOfferings,
  parseOfferings,
  presentOfferings,
  type OfferingBearing,
} from '../../models/schemas/offeringValidation';

/** Subset of an incoming property body this module reads/writes. */
export interface OfferingBearingPayload extends OfferingBearing {
  sale?: Partial<PropertySale> | null;
  squareFootage?: number;
}

/** Thrown when the offerings/blocks configuration is invalid. */
export class OfferingValidationError extends Error {
  readonly code = 'OFFERING_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'OfferingValidationError';
  }
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Derive `sale.pricePerSqm` server-side when both price and area are known. */
function deriveSalePricePerSqm(data: OfferingBearingPayload): void {
  if (data.sale && isPositiveNumber(data.sale.price) && isPositiveNumber(data.squareFootage)) {
    data.sale.pricePerSqm = Math.round(data.sale.price / data.squareFootage);
  }
}

/**
 * Validate and normalize the per-offering fields on a CREATE body, in place.
 *
 * `offerings` must be present and fully coherent with its blocks — the full
 * {@link validateOfferings} rule is enforced. `offerings` is de-duplicated and
 * `sale.pricePerSqm` is derived. Throws {@link OfferingValidationError} on any
 * violation.
 */
export function applyOfferingRulesForCreate(data: OfferingBearingPayload): void {
  deriveSalePricePerSqm(data);

  const parsed = parseOfferings(data.offerings);
  if (parsed === null) {
    throw new OfferingValidationError('offerings must be an array of valid offering types');
  }
  data.offerings = parsed;

  const error = validateOfferings(data);
  if (error !== null) {
    throw new OfferingValidationError(error);
  }
}

/**
 * Validate and normalize the per-offering fields on a partial UPDATE body, in
 * place, against the listing's CURRENT stored state.
 *
 * A PATCH may touch `offerings` and/or any block independently, so coherence is
 * checked on the EFFECTIVE document — the stored fields overlaid with whatever
 * the body supplies. This lets a client e.g. add the SHORT_TERM_RENT offering
 * by sending `offerings` + `shortTermRent` together, or drop an offering by
 * clearing both, without resending the untouched blocks. `offerings` is
 * de-duplicated and `sale.pricePerSqm` is derived. Throws on any violation.
 *
 * @param data    the incoming partial update body (mutated)
 * @param current the listing's stored offering state (read-only)
 */
export function applyOfferingRulesForUpdate(
  data: OfferingBearingPayload,
  current: OfferingBearing
): void {
  deriveSalePricePerSqm(data);

  // `offerings` omitted entirely → nothing structural to normalize here; the
  // effective check below still runs against the merged document.
  if (data.offerings !== undefined) {
    const parsed = parseOfferings(data.offerings);
    if (parsed === null) {
      throw new OfferingValidationError('offerings must be an array of valid offering types');
    }
    data.offerings = parsed;
  }

  // Overlay the body onto the stored state: a key present in the body wins
  // (including an explicit `null`, which clears a block); otherwise the stored
  // value stands. This mirrors the `$set` Mongo will perform.
  const pick = <K extends keyof OfferingBearing>(key: K): OfferingBearing[K] =>
    (key in data ? (data as OfferingBearing)[key] : current[key]);

  const effective: OfferingBearing = {
    offerings: pick('offerings'),
    longTermRent: pick('longTermRent'),
    shortTermRent: pick('shortTermRent'),
    sale: pick('sale'),
    exchange: pick('exchange'),
  };

  const error = validateOfferings(effective);
  if (error !== null) {
    throw new OfferingValidationError(error);
  }
}

export { OfferingType, presentOfferings };
