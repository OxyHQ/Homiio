/**
 * Turning an allowlisted review body into typed column values — the layer
 * Mongoose used to be.
 *
 * ## Why this file exists at all, when the previous port did not need one
 *
 * `createReview` used to hand `pickFields` output straight to `new Review(...)`,
 * and mongoose did three separate jobs on the way in that no longer happen:
 *
 *  1. **CASTING.** `price: "1200"` became `1200`, `livedFrom: "2020-01-01"`
 *     became a `Date`, `rating: "4"` became `4`. postgres.js does none of it: a
 *     string bound to `double precision` is `22P02 invalid_text_representation`,
 *     and an `Invalid Date` is not a storable `timestamptz` at all.
 *  2. **VALIDATION that produced a 400.** The schema's `enum`, `min`/`max`,
 *     `minlength`/`maxlength` and the pros/cons `≤ 10` validator all ran on
 *     CREATE, and the controller answered `ValidationError` with a 400 naming
 *     the fields. The equivalent CHECKs now live in `db/schema/reviews.ts` —
 *     which is STRONGER, because they also hold on an UPDATE, where mongoose's
 *     validators never ran — but a CHECK violation reaches the controller as a
 *     driver error and would be answered 500. A rejected review is a 400.
 *  3. **The length caps that have NO Postgres counterpart.** `CONVENTIONS.md`
 *     defers `maxlength` and format validators out of this migration
 *     deliberately, so `title ≤ 120`, `opinion ≤ 2000` and the image-URL shape
 *     are enforced HERE or nowhere. `db/schema/reviews.ts` states the pros/cons
 *     cap as the controller's job in as many words ("capped at ten by the
 *     controller"), so this module is the place that sentence points at.
 *
 * ## Every vocabulary is derived, never re-spelled
 *
 * The membership tests read the SAME `const` tuples the CHECK constraints are
 * built from (`db/schema/reviews.ts`), so a value this module accepts is one the
 * database accepts by construction. Re-typing the lists here would create two
 * vocabularies that agree until somebody edits one.
 */

import { PAYMENT_CURRENCIES } from '@homiio/shared-types';
import {
  CLEANING_RATINGS,
  CONDITION_RATINGS,
  DEPOSIT_RETURNS,
  LANDLORD_TREATMENTS,
  LIGHT_LEVELS,
  NEIGHBOR_RATINGS,
  NEIGHBOR_RELATIONS,
  NOISE_LEVELS,
  RESPONSE_RATINGS,
  SECURITY_LEVELS,
  SERVICE_TYPES,
  TEMPERATURE_RATINGS,
  TOURIST_LEVELS,
} from '../../db/schema/reviews';
import type { ReviewPatch } from '../../db/reviews/reviewWrites';

// Length bounds, verbatim from `ReviewSchema`. They have no CHECK behind them —
// see the header — so these numbers are the only thing enforcing them.
const MAX_TITLE_LENGTH = 120;
const MAX_OPINION_LENGTH = 2000;
const MAX_ADVICE_LENGTH = 1000;
const MAX_LIST_ITEM_LENGTH = 140;
const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_LIST_ITEMS = 10;

/** `ReviewSchema`'s own image validator: an http(s) URL ending in a raster extension. */
const IMAGE_URL = /^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i;

/** The rating bounds, mirroring `reviews_rating_check`. */
const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * The six columns `reviews` declares `NOT NULL` with no default.
 *
 * `title` is deliberately absent: the TABLE allows a review with no headline
 * (legacy rows predate the field) while the CONTROLLER requires one for a new
 * submission, with its own minimum length and its own message.
 */
const CREATE_REQUIRED = ['price', 'rating', 'recommendation', 'opinion', 'livedFrom', 'livedTo'] as const;

/** A patch that carries every column a create needs. */
export type ReviewCreateFields = ReviewPatch &
  Required<Pick<ReviewPatch, (typeof CREATE_REQUIRED)[number]>>;

/**
 * A normalization outcome.
 *
 * A discriminated union rather than a throw, because the caller answers a
 * refusal with the SAME `{ message: 'Validation error', errors: [...] }` body
 * the mongoose `ValidationError` branch produced — a shape the frontend already
 * renders.
 */
export type ReviewInputResult<T> =
  | { readonly ok: true; readonly values: T }
  | { readonly ok: false; readonly errors: string[] };

/** A collector, so one bad body reports every problem at once as mongoose did. */
class Errors {
  readonly list: string[] = [];

  add(message: string): void {
    this.list.push(message);
  }
}

/** A trimmed, length-capped string; `null` for an absent/blank optional field. */
function optionalText(
  errors: Errors,
  field: string,
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    errors.add(`${field} must be a string`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    errors.add(`${field} cannot exceed ${maxLength} characters`);
    return undefined;
  }
  return trimmed.length > 0 ? trimmed : null;
}

/** A member of a closed vocabulary; `null` when the field is cleared. */
function optionalEnum<T extends string>(
  errors: Errors,
  field: string,
  value: unknown,
  allowed: readonly T[],
): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    errors.add(`${field} must be one of: ${allowed.join(', ')}`);
    return undefined;
  }
  return value as T;
}

function optionalBoolean(errors: Errors, field: string, value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'boolean') {
    errors.add(`${field} must be a boolean`);
    return undefined;
  }
  return value;
}

/**
 * A list of short strings, capped in BOTH dimensions.
 *
 * `null` is not representable: the three list columns are `NOT NULL DEFAULT
 * '{}'`, so clearing one is an empty array.
 */
function stringList(
  errors: Errors,
  field: string,
  value: unknown,
  options: { maxItems: number; maxItemLength: number; pattern?: RegExp },
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.add(`${field} must be an array`);
    return undefined;
  }
  if (value.length > options.maxItems) {
    errors.add(`${field} can list at most ${options.maxItems} entries`);
    return undefined;
  }
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      errors.add(`${field} must contain only strings`);
      return undefined;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > options.maxItemLength) {
      errors.add(`Each ${field} entry cannot exceed ${options.maxItemLength} characters`);
      return undefined;
    }
    if (options.pattern && !options.pattern.test(trimmed)) {
      errors.add(`${field} contains an invalid entry`);
      return undefined;
    }
    items.push(trimmed);
  }
  return items;
}

/**
 * A `services` list, checked against the SERVICE_TYPES vocabulary.
 *
 * `reviews_services_check` is `services <@ '{…}'`, so an undeclared member is a
 * `23514` rather than a stored value — this is the 400 that replaces it.
 */
function serviceList(errors: Errors, value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.add('services must be an array');
    return undefined;
  }
  const services: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !SERVICE_TYPES.includes(entry as (typeof SERVICE_TYPES)[number])) {
      errors.add(`services must contain only: ${SERVICE_TYPES.join(', ')}`);
      return undefined;
    }
    services.push(entry);
  }
  return services;
}

/**
 * A tenancy date.
 *
 * Accepts what mongoose accepted — an ISO string or an epoch number — and
 * refuses anything `Date` cannot parse, which mongoose reported as a
 * `CastError`. An `Invalid Date` is not a storable `timestamptz`, so this
 * refusal is the difference between a 400 and a driver error.
 */
function tenancyDate(errors: Errors, field: string, value: unknown): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : undefined;
  if (parsed === undefined || Number.isNaN(parsed.getTime())) {
    errors.add(`${field} is not a valid date`);
    return undefined;
  }
  return parsed;
}

/**
 * Normalize an allowlisted review body into column values.
 *
 * `picked` has already been through `pickFields`, so nothing server-owned can be
 * present. This decides only whether the user-supplied half is STORABLE.
 *
 * The result is assembled field by field rather than accumulated into a
 * `Record<string, unknown>` and cast: every assignment below is checked against
 * the column's own type, so a vocabulary that drifted from its CHECK would fail
 * `tsc` instead of failing a request.
 */
function normalize(picked: Record<string, unknown>): ReviewInputResult<ReviewPatch> {
  const errors = new Errors();
  const values: ReviewPatch = {};

  const title = optionalText(errors, 'title', picked.title, MAX_TITLE_LENGTH);
  if (title !== undefined) values.title = title;

  const adviceToAgency = optionalText(errors, 'adviceToAgency', picked.adviceToAgency, MAX_ADVICE_LENGTH);
  if (adviceToAgency !== undefined) values.adviceToAgency = adviceToAgency;

  const adviceToLandlord = optionalText(errors, 'adviceToLandlord', picked.adviceToLandlord, MAX_ADVICE_LENGTH);
  if (adviceToLandlord !== undefined) values.adviceToLandlord = adviceToLandlord;

  if (picked.opinion !== undefined) {
    const opinion = optionalText(errors, 'opinion', picked.opinion, MAX_OPINION_LENGTH);
    if (opinion === null) errors.add('opinion is required');
    else if (opinion !== undefined) values.opinion = opinion;
  }

  if (picked.price !== undefined) {
    if (typeof picked.price !== 'number' || !Number.isFinite(picked.price) || picked.price < 0) {
      errors.add('price must be a positive number');
    } else {
      values.price = picked.price;
    }
  }

  const currency = optionalEnum(errors, 'currency', picked.currency, PAYMENT_CURRENCIES);
  // `currency` is `NOT NULL DEFAULT 'EUR'`, so a cleared value is an omission
  // rather than a NULL — the default then applies, exactly as mongoose's did.
  if (currency !== undefined && currency !== null) values.currency = currency;

  if (picked.rating !== undefined) {
    if (
      typeof picked.rating !== 'number' ||
      !Number.isInteger(picked.rating) ||
      picked.rating < MIN_RATING ||
      picked.rating > MAX_RATING
    ) {
      errors.add(`rating must be a whole number between ${MIN_RATING} and ${MAX_RATING}`);
    } else {
      values.rating = picked.rating;
    }
  }

  if (picked.recommendation !== undefined) {
    if (typeof picked.recommendation !== 'boolean') errors.add('recommendation must be a boolean');
    else values.recommendation = picked.recommendation;
  }

  const livedFrom = tenancyDate(errors, 'livedFrom', picked.livedFrom);
  const livedTo = tenancyDate(errors, 'livedTo', picked.livedTo);
  if (livedFrom !== undefined) values.livedFrom = livedFrom;
  if (livedTo !== undefined) values.livedTo = livedTo;
  // `reviews_lived_order_check` enforces this too and would answer a driver
  // error; checking it here is what makes an inverted tenancy a 400. It can only
  // be checked when BOTH sides are present, which on an edit they need not be —
  // the constraint covers that case, against the resulting row.
  if (livedFrom && livedTo && livedTo.getTime() <= livedFrom.getTime()) {
    errors.add('livedTo must be after livedFrom');
  }

  const prosItems = stringList(errors, 'prosItems', picked.prosItems, {
    maxItems: MAX_LIST_ITEMS,
    maxItemLength: MAX_LIST_ITEM_LENGTH,
  });
  if (prosItems !== undefined) values.prosItems = prosItems;

  const consItems = stringList(errors, 'consItems', picked.consItems, {
    maxItems: MAX_LIST_ITEMS,
    maxItemLength: MAX_LIST_ITEM_LENGTH,
  });
  if (consItems !== undefined) values.consItems = consItems;

  const images = stringList(errors, 'images', picked.images, {
    maxItems: MAX_LIST_ITEMS,
    maxItemLength: MAX_IMAGE_URL_LENGTH,
    pattern: IMAGE_URL,
  });
  if (images !== undefined) values.images = images;

  const services = serviceList(errors, picked.services);
  if (services !== undefined) values.services = services;

  const summerTemperature = optionalEnum(errors, 'summerTemperature', picked.summerTemperature, TEMPERATURE_RATINGS);
  if (summerTemperature !== undefined) values.summerTemperature = summerTemperature;

  const winterTemperature = optionalEnum(errors, 'winterTemperature', picked.winterTemperature, TEMPERATURE_RATINGS);
  if (winterTemperature !== undefined) values.winterTemperature = winterTemperature;

  const noise = optionalEnum(errors, 'noise', picked.noise, NOISE_LEVELS);
  if (noise !== undefined) values.noise = noise;

  const light = optionalEnum(errors, 'light', picked.light, LIGHT_LEVELS);
  if (light !== undefined) values.light = light;

  const conditionAndMaintenance = optionalEnum(errors, 'conditionAndMaintenance', picked.conditionAndMaintenance, CONDITION_RATINGS);
  if (conditionAndMaintenance !== undefined) values.conditionAndMaintenance = conditionAndMaintenance;

  const landlordTreatment = optionalEnum(errors, 'landlordTreatment', picked.landlordTreatment, LANDLORD_TREATMENTS);
  if (landlordTreatment !== undefined) values.landlordTreatment = landlordTreatment;

  const problemResponse = optionalEnum(errors, 'problemResponse', picked.problemResponse, RESPONSE_RATINGS);
  if (problemResponse !== undefined) values.problemResponse = problemResponse;

  const depositReturned = optionalEnum(errors, 'depositReturned', picked.depositReturned, DEPOSIT_RETURNS);
  if (depositReturned !== undefined) values.depositReturned = depositReturned;

  const staircaseNeighbors = optionalEnum(errors, 'staircaseNeighbors', picked.staircaseNeighbors, NEIGHBOR_RATINGS);
  if (staircaseNeighbors !== undefined) values.staircaseNeighbors = staircaseNeighbors;

  const neighborRelations = optionalEnum(errors, 'neighborRelations', picked.neighborRelations, NEIGHBOR_RELATIONS);
  if (neighborRelations !== undefined) values.neighborRelations = neighborRelations;

  const cleaning = optionalEnum(errors, 'cleaning', picked.cleaning, CLEANING_RATINGS);
  if (cleaning !== undefined) values.cleaning = cleaning;

  const areaTourists = optionalEnum(errors, 'areaTourists', picked.areaTourists, TOURIST_LEVELS);
  if (areaTourists !== undefined) values.areaTourists = areaTourists;

  const areaSecurity = optionalEnum(errors, 'areaSecurity', picked.areaSecurity, SECURITY_LEVELS);
  if (areaSecurity !== undefined) values.areaSecurity = areaSecurity;

  const areaNoise = optionalEnum(errors, 'areaNoise', picked.areaNoise, NOISE_LEVELS);
  if (areaNoise !== undefined) values.areaNoise = areaNoise;

  const areaCleanliness = optionalEnum(errors, 'areaCleanliness', picked.areaCleanliness, CLEANING_RATINGS);
  if (areaCleanliness !== undefined) values.areaCleanliness = areaCleanliness;

  const touristApartments = optionalBoolean(errors, 'touristApartments', picked.touristApartments);
  if (touristApartments !== undefined) values.touristApartments = touristApartments;

  if (errors.list.length > 0) return { ok: false, errors: errors.list };
  return { ok: true, values };
}

/** Which of the six mandatory create columns the body did not supply. */
function missingCreateFields(values: ReviewPatch): string[] {
  return CREATE_REQUIRED.filter((field) => values[field] === undefined);
}

/**
 * Whether a patch carries every mandatory create column.
 *
 * A type predicate rather than a non-null assertion at the call site: each of
 * the six was assigned above only after its own type check, so "present" really
 * does establish the type, and the caller gets `livedFrom: Date` instead of
 * `Date | undefined` to hand to `insertReview`.
 */
function hasCreateRequirements(values: ReviewPatch): values is ReviewCreateFields {
  return missingCreateFields(values).length === 0;
}

/** Normalize a CREATE body — every mandatory column must be present. */
export function normalizeReviewCreateInput(
  picked: Record<string, unknown>,
): ReviewInputResult<ReviewCreateFields> {
  const result = normalize(picked);
  if (!result.ok) return result;
  if (!hasCreateRequirements(result.values)) {
    return { ok: false, errors: missingCreateFields(result.values).map((field) => `${field} is required`) };
  }
  return { ok: true, values: result.values };
}

/** Normalize an EDIT body — an absent field is simply not written. */
export function normalizeReviewEditInput(
  picked: Record<string, unknown>,
): ReviewInputResult<ReviewPatch> {
  return normalize(picked);
}
