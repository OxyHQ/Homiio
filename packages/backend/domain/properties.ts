/**
 * A listing's owner side: create, edit, publish, delete, close the deal, and
 * read one's own listings.
 *
 * The Express handlers in `controllers/property/*` and the capability tools in
 * `capabilities/handlers/properties.ts` both call these, so a route and its
 * tool are one implementation. Every function takes the acting account's
 * `oxyUserId` explicitly — the session on the route, the verified ticket or
 * OAuth connection on a tool — and never reads an owner from its input.
 *
 * Ownership is enforced in the repository QUERY (`{ ownedBy }` on the write,
 * `ownedBy()` on the read), so somebody else's listing answers not-found. The
 * one exception is {@link markPropertyTransacted}, which has always answered
 * 403 for a non-owner; that behaviour is kept as the route ships it.
 *
 * Writes pick fields from `controllers/property/editableFields.ts` and never
 * spread a body into a row.
 */

import { and, eq } from 'drizzle-orm';
import { OfferingType, PropertyStatus } from '@homiio/shared-types';

import {
  applyOfferingRulesForCreate,
  applyOfferingRulesForUpdate,
  OfferingValidationError,
  type OfferingBearingPayload,
} from '../controllers/property/offeringRules';
import {
  CREATABLE_PROPERTY_FIELDS,
  EDITABLE_PROPERTY_FIELDS,
  invalidAddressPublishedPrecision,
} from '../controllers/property/editableFields';
import { normalizePropertyPhotos } from '../controllers/property/photoIntake';
import { getDb } from '../db/postgres';
import {
  allOf,
  countProperties,
  findProperties,
  findPropertyById,
  NEWEST_FIRST,
  propertyOrderBy,
} from '../db/properties/propertyReads';
import {
  idNotIn,
  notDeleted,
  notModerationRestricted,
  ownedBy,
  statusIs,
  statusIsNot,
} from '../db/properties/propertyFilters';
import { serializeProperty } from '../db/properties/propertySerializer';
import {
  insertProperty,
  softDeleteProperty,
  updateProperty as updatePropertyRow,
} from '../db/properties/propertyWrites';
import { partners } from '../db/schema';
import { AppError, describeErrorForLog } from '../middlewares/errorHandler';
import { businessLogger, logger } from '../middlewares/logging';
import { telegramService } from '../services';
import { findOrCreateCanonicalAddress } from '../services/addressService';
import { onPropertyTransacted } from '../services/commissionService';
import { schedulePriceEthicsScore } from '../services/priceEthicsService';
import {
  readPropertySnapshot,
  recordPropertyChangeEvents,
  recordPropertyCreatedEvent,
  recordPropertyRemovedEvent,
} from '../services/watches/propertyEventProducer';
import { pickFields } from '../utils/pickFields';
import { getErrorName, getValidationMessages } from '../utils/errors';

export type SerializedProperty = ReturnType<typeof serializeProperty>;

/** A page of listings, as `paginationResponse` takes it. */
export interface PropertyPage {
  readonly items: SerializedProperty[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

/** Statuses that close a deal and (for sourced listings) earn a commission. */
const TERMINAL_STATUSES: ReadonlyArray<string> = [PropertyStatus.RENTED, PropertyStatus.SOLD];

type Body = Record<string, unknown>;
/** The resolver validates and whitelists the address fields itself. */
type CanonicalAddressInput = Parameters<typeof findOrCreateCanonicalAddress>[0];

/**
 * Validates and fixes coordinate order to ensure GeoJSON compliance
 * GeoJSON standard requires [longitude, latitude] format
 *
 * @param coords - Array of coordinates [number, number]
 * @returns Array in correct [longitude, latitude] format
 */
function validateAndFixCoordinateOrder(coords: number[]): number[] {
  if (!Array.isArray(coords) || coords.length !== 2) {
    throw new Error('Coordinates must be an array of exactly 2 numbers');
  }

  const [first, second] = coords;

  // Validate that both are valid numbers
  if (Number.isNaN(first) || Number.isNaN(second)) {
    throw new Error('Coordinates must be valid numbers');
  }

  // Basic range validation - both values must be within reasonable bounds
  if (Math.abs(first) > 180 || Math.abs(second) > 180) {
    throw new Error('Coordinates out of valid range');
  }

  // Improved heuristic to detect if coordinates are swapped
  // Strong indicators that coordinates are in [lat, lng] format instead of [lng, lat]:

  // 1. Clear case: first value in lat range, second clearly longitude (> 90 or < -90)
  const firstInLatRange = first >= -90 && first <= 90;
  const secondClearlyLongitude = Math.abs(second) > 90;

  // 2. Geographical pattern: positive first value (likely latitude) with negative second
  // BUT only if the negative second has reasonable magnitude for longitude
  const positiveLatNegativeLng = first > 0 && first <= 90 && second < 0 && Math.abs(second) > 10; // Must be significant longitude

  // 3. For Eastern hemisphere: small positive first value with larger positive second
  const smallFirstLargeSecond = first > 0 && first <= 90 && second > 90 && second <= 180;

  // Only swap if we have strong evidence of incorrect order
  const shouldSwap =
    (firstInLatRange && secondClearlyLongitude) || positiveLatNegativeLng || smallFirstLargeSecond;

  const finalCoords = shouldSwap ? [second, first] : [first, second];

  // Final validation of corrected coordinates
  const [lng, lat] = finalCoords;
  if (lng < -180 || lng > 180) {
    throw new Error('Longitude must be between -180 and 180 degrees');
  }
  if (lat < -90 || lat > 90) {
    throw new Error('Latitude must be between -90 and 90 degrees');
  }

  return finalCoords;
}

function locationCoordinates(body: Body): number[] | undefined {
  const location = body.location as { coordinates?: unknown[] } | undefined;
  return Array.isArray(location?.coordinates)
    ? location.coordinates.map((coord) => Number(coord))
    : undefined;
}

function locationType(body: Body): string {
  const type = (body.location as { type?: unknown } | undefined)?.type;
  return typeof type === 'string' && type.length > 0 ? type : 'Point';
}

/** The offering rules' refusal, as the 400 the routes have always answered. */
function asOfferingError(error: unknown): unknown {
  return error instanceof OfferingValidationError
    ? new AppError(error.message, 400, error.code)
    : error;
}

/**
 * Create a listing owned by `oxyUserId` from a create body (the route's
 * `req.body`): whitelisted fields, an inline `address` (+ optional `location`)
 * or an `addressId`, an optional partner `referralCode`.
 */
export async function createProperty(oxyUserId: string, body: Body): Promise<SerializedProperty> {
  try {
    const propertyData = pickFields<OfferingBearingPayload>(body, CREATABLE_PROPERTY_FIELDS);
    propertyData.oxyUserId = oxyUserId;
    const precisionError = invalidAddressPublishedPrecision(propertyData);
    if (precisionError) throw precisionError;

    // Resolve an optional partner referral code into an attribution: a valid,
    // active partner stamps `sourcedByPartner` + `sourcedByReferralCode` on the
    // listing. An unknown/inactive code is ignored (the listing is still
    // created — referral attribution is best-effort, never a hard failure). The
    // raw `referralCode` is read straight from the body and is never part of the
    // whitelisted payload, so it is never persisted directly.
    const referralCode = typeof body.referralCode === 'string' ? body.referralCode.trim() : '';
    if (referralCode) {
      // Resolved against the POSTGRES `partners` table, which is the table
      // `properties.sourced_by_partner_id` actually references, so the stamped
      // id always resolves and a referred listing never fails with a `23503`.
      const [partner] = await getDb()
        .select({ id: partners.id, referralCode: partners.referralCode })
        .from(partners)
        .where(
          and(eq(partners.referralCode, referralCode.toLowerCase()), eq(partners.status, 'active')),
        )
        .limit(1);
      if (partner) {
        propertyData.sourcedByPartnerId = partner.id;
        propertyData.sourcedByReferralCode = partner.referralCode;
      } else {
        logger.info('Property create: referral code did not match an active partner', {
          referralCode,
        });
      }
    }

    // Validate & normalize per-offering fields: `offerings` must be present and
    // equal the set of present priced blocks, each with a positive price /
    // valid exchange mode. Also derives `sale.pricePerSqm`.
    applyOfferingRulesForCreate(propertyData);

    // Validate the photos and carry their storage keys forward, so the write
    // transaction can mint each one's canonical `images` row once the listing
    // has an id. Without this the insert hits `property_images.image_id`'s NOT
    // NULL and every publish with a photo is a 500 — see `photoIntake`.
    await normalizePropertyPhotos(propertyData);

    // Handle address creation or reference
    let addressId: unknown;
    if (body.address) {
      const addressData: Record<string, unknown> = { ...(body.address as Body) };
      const coords = locationCoordinates(body);
      if (coords) {
        // GeoJSON standard requires [longitude, latitude] format
        const validatedCoords = validateAndFixCoordinateOrder(coords);
        addressData.coordinates = { type: locationType(body), coordinates: validatedCoords };
        if (validatedCoords[0] !== coords[0] || validatedCoords[1] !== coords[1]) {
          logger.info('Corrected coordinate order', {
            original: coords,
            corrected: validatedCoords,
            reason:
              'Coordinates appeared to be in [latitude, longitude] format, corrected to [longitude, latitude]',
          });
        }
      }
      const address = await findOrCreateCanonicalAddress(
        addressData as unknown as CanonicalAddressInput,
      );
      addressId = address.id;
    } else if (body.addressId) {
      addressId = body.addressId;
    } else {
      throw new AppError('Address information is required', 400, 'MISSING_ADDRESS');
    }

    // Link the resolved address. (`address`/`location` are never whitelisted
    // into propertyData, so there is nothing to strip here.)
    propertyData.addressId = addressId;

    logger.info('Creating property with data', { propertyData });
    // One transaction writes the listing and its children, then the row is read
    // back through the SAME repository the catalogue endpoints read through —
    // so a listing created here is visible to `GET /properties` in the next
    // request, and the 201 body is byte-identical to what a later fetch returns.
    const created = await insertProperty(propertyData);
    // Two bodies: the 201 goes back to the owner who just wrote it, while the
    // Telegram group post below is a PUBLICATION and gets what anybody gets.
    const savedProperty = serializeProperty(created, 'owner');
    const publishedProperty = serializeProperty(created, 'public');
    const propertyId = created.property.id;

    // The watch matcher's fact (#356). Best effort inside the producer: the
    // listing is already committed, and a mailbox that could not be told must
    // not turn a successful create into a 500.
    await recordPropertyCreatedEvent(propertyId);

    const savedOwnerId = created.property.oxyUserId;
    if (savedOwnerId) {
      businessLogger.propertyCreated(propertyId, savedOwnerId);
    } else {
      logger.warn('Created property without oxyUserId', { propertyId });
    }
    telegramService.sendPropertyNotification(publishedProperty).catch((error: unknown) => {
      logger.error('Failed to send Telegram notification for new property', {
        propertyId,
        error: describeErrorForLog(error),
      });
    });
    schedulePriceEthicsScore(propertyId);
    return savedProperty;
  } catch (error) {
    if (error instanceof OfferingValidationError) {
      throw new AppError(error.message, 400, error.code);
    }
    if (getErrorName(error) === 'ValidationError') {
      const validationError: AppError & { details?: unknown } = new AppError(
        'Property validation failed',
        400,
        'VALIDATION_ERROR',
      );
      validationError.details = getValidationMessages(error);
      throw validationError;
    }
    throw error;
  }
}

/**
 * Edit one of `oxyUserId`'s listings with an update body (the route's
 * `req.body`): only {@link EDITABLE_PROPERTY_FIELDS} reach the row, an inline
 * `address` is re-resolved through the canonical resolver. A listing that is
 * not theirs answers 404.
 */
export async function updateProperty(
  oxyUserId: string,
  propertyId: string,
  body: Body,
): Promise<SerializedProperty> {
  try {
    const updateData = pickFields<OfferingBearingPayload>(body, EDITABLE_PROPERTY_FIELDS);
    const precisionError = invalidAddressPublishedPrecision(updateData);
    if (precisionError) throw precisionError;

    // Read the CURRENT listing first: the offering rules are evaluated against
    // the merge of stored and incoming state, so a partial update that mentions
    // only `sale` is still judged against the offerings the listing already
    // declares. The ownership predicate is repeated on the UPDATE itself, so
    // this read is not the authorization — it is the rules' input.
    const existing = await findPropertyById(propertyId);
    if (!existing || existing.property.oxyUserId !== oxyUserId) {
      throw new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND');
    }
    const current = serializeProperty(existing, 'system');

    applyOfferingRulesForUpdate(updateData, {
      offerings: current.offerings,
      longTermRent: current.longTermRent as { monthlyAmount?: unknown } | undefined,
      shortTermRent: current.shortTermRent as { nightlyRate?: unknown } | undefined,
      sale: current.sale as { price?: unknown } | undefined,
      exchange: current.exchange as { mode?: unknown } | undefined,
    });

    // Same intake as create: a photo added during an edit has no `images` row
    // either, and the reordered list's positions are its stored order. A body
    // that does not mention `images` leaves the listing's photos untouched.
    await normalizePropertyPhotos(updateData);

    if (body.address) {
      // Address writes go through the canonical resolver, which whitelists the
      // address fields into an explicit `docFields` set (never a raw spread) and
      // server-resolves the geo id chain — so client `body.address` keys
      // outside that allowlist never reach the Address document.
      const addressData: Record<string, unknown> = { ...(body.address as Body) };
      const coords = locationCoordinates(body);
      if (coords) {
        addressData.coordinates = { type: locationType(body), coordinates: coords };
      }
      const address = await findOrCreateCanonicalAddress(
        addressData as unknown as CanonicalAddressInput,
      );
      updateData.addressId = address.id;
    }

    // The BEFORE half of any change event (#356), read while it is still true.
    const beforeSnapshot = await readPropertySnapshot(getDb(), String(propertyId));

    // The ownership predicate rides on the UPDATE, so the check and the write
    // are one statement and a change of owner cannot interleave between them.
    const updated = await updatePropertyRow(propertyId, updateData, { ownedBy: oxyUserId });
    if (!updated) throw new AppError('Failed to update property', 500, 'UPDATE_FAILED');
    const updatedProperty = serializeProperty(updated, 'owner');

    if (beforeSnapshot) {
      const afterSnapshot = await readPropertySnapshot(getDb(), String(propertyId));
      if (afterSnapshot) await recordPropertyChangeEvents(beforeSnapshot, afterSnapshot);
    }

    const transitionedToTerminal =
      existing.property.status !== updated.property.status &&
      TERMINAL_STATUSES.includes(updated.property.status);
    if (transitionedToTerminal && updated.property.sourcedByPartnerId) {
      try {
        await onPropertyTransacted({
          ...updatedProperty,
          _id: updated.property.id,
          sourcedByPartner: updated.property.sourcedByPartnerId,
        });
      } catch (commissionError) {
        logger.error('Failed to process commission on property close', {
          propertyId: String(propertyId),
          error: describeErrorForLog(commissionError),
        });
      }
    }

    schedulePriceEthicsScore(String(propertyId));
    return updatedProperty;
  } catch (error) {
    throw asOfferingError(error);
  }
}

/**
 * Publish (`published`) or withdraw (`draft`) one of `oxyUserId`'s listings.
 *
 * The app publishes by sending `status: 'published'` through the edit; this is
 * that edit with ONLY the status, so the offering rules still judge the stored
 * listing and the change events and price scoring still run.
 */
export function setPropertyPublication(
  oxyUserId: string,
  propertyId: string,
  published: boolean,
): Promise<SerializedProperty> {
  return updateProperty(oxyUserId, propertyId, {
    status: published ? PropertyStatus.PUBLISHED : PropertyStatus.DRAFT,
  });
}

/**
 * Soft-delete one of `oxyUserId`'s listings. No row matched means either no
 * such listing or not theirs, deliberately indistinguishable (404).
 */
export async function deleteProperty(oxyUserId: string, propertyId: string): Promise<void> {
  // Read BEFORE the write: the title and the coordinates a `listing_removed`
  // event needs are only readable while the listing is still visible. It is
  // discarded when the delete turns out not to have been this caller's.
  const snapshot = await readPropertySnapshot(getDb(), String(propertyId));
  const deleted = await softDeleteProperty(propertyId, { ownedBy: oxyUserId });
  if (!deleted) throw new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND');
  if (snapshot) await recordPropertyRemovedEvent(snapshot);
  logger.info('Property soft-deleted', { propertyId: String(propertyId), oxyUserId });
}

/**
 * Pick the terminal status that matches the listing's offerings when the caller
 * does not pass one explicitly: a sale listing → SOLD, otherwise RENTED.
 */
function defaultTerminalStatus(offerings: unknown): string {
  const list = Array.isArray(offerings) ? offerings : [];
  return list.includes(OfferingType.SALE) ? PropertyStatus.SOLD : PropertyStatus.RENTED;
}

/**
 * Close a deal on one of `oxyUserId`'s listings (rented / sold) and run the
 * partner commission trigger, which creates at most one commission per listing
 * ever. A listing that is not theirs answers 403 (the route's contract).
 */
export async function markPropertyTransacted(
  oxyUserId: string,
  propertyId: string,
  requestedStatus?: string,
): Promise<{ property: SerializedProperty; commission: unknown }> {
  const existing = await findPropertyById(propertyId);
  if (!existing) throw new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND');
  if (!existing.property.oxyUserId || existing.property.oxyUserId !== oxyUserId) {
    throw new AppError('Access denied - you can only close your own properties', 403, 'FORBIDDEN');
  }

  if (requestedStatus !== undefined && !TERMINAL_STATUSES.includes(requestedStatus)) {
    throw new AppError('status must be a terminal status (rented or sold)', 400, 'INVALID_STATUS');
  }
  const nextStatus = requestedStatus ?? defaultTerminalStatus(existing.property.offerings);

  // Only write when the status actually moves. The endpoint is idempotent by
  // contract — an owner re-marking a closed listing must not touch the row —
  // and the commission trigger below is idempotent independently of this.
  const hydrated =
    existing.property.status === nextStatus
      ? existing
      : ((await updatePropertyRow(propertyId, { status: nextStatus }, { ownedBy: oxyUserId })) ??
        existing);
  const property = serializeProperty(hydrated, 'owner');

  // Idempotent: creates at most one commission for this property, ever.
  const commission = await onPropertyTransacted({
    ...property,
    _id: hydrated.property.id,
    sourcedByPartner: hydrated.property.sourcedByPartnerId,
  });

  logger.info('Property marked transacted', {
    propertyId: hydrated.property.id,
    status: nextStatus,
    commissionCreated: Boolean(commission),
  });

  return { property, commission: commission ? commission.toJSON() : null };
}

/**
 * `oxyUserId`'s own listings, drafts included, archived excluded, newest first.
 * Deliberately WITHOUT the moderation filter every public feed applies: an
 * owner whose listing a jury restricted must still be able to see it.
 */
export async function listMyProperties(
  oxyUserId: string,
  { page, limit }: { page: number; limit: number },
): Promise<PropertyPage> {
  const where = allOf([ownedBy(oxyUserId), statusIsNot('archived')]);
  const [hydrated, total] = await Promise.all([
    // Newest first, and deliberately WITHOUT the `has_images DESC` key every
    // public feed leads with: a listing the owner just created must appear at
    // the top whether or not they have uploaded a photo yet.
    findProperties({ where, orderBy: [NEWEST_FIRST], limit, offset: (page - 1) * limit }),
    countProperties(where),
  ]);
  return {
    items: hydrated.map((listing) => serializeProperty(listing, 'owner')),
    page,
    limit,
    total,
  };
}

/**
 * One of `oxyUserId`'s own listings, at the owner's precision. Somebody else's
 * listing, or one that does not exist, answers 404 — the public view of a
 * listing is `getListing`, not this.
 */
export async function getMyProperty(
  oxyUserId: string,
  propertyId: string,
): Promise<SerializedProperty> {
  const hydrated = await findPropertyById(propertyId);
  if (!hydrated || hydrated.property.oxyUserId !== oxyUserId) {
    throw new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND');
  }
  return serializeProperty(hydrated, 'owner');
}

/**
 * What a landlord is offering: their PUBLISHED, visible listings, at the public
 * precision. A discovery feed — any signed-in person may name any owner.
 */
export async function listPropertiesByOwner(
  ownerOxyUserId: string,
  { page, limit, exclude }: { page: number; limit: number; exclude?: string },
): Promise<PropertyPage> {
  if (!ownerOxyUserId) throw new AppError('Invalid owner id', 400, 'INVALID_ID');
  const where = allOf([
    ownedBy(ownerOxyUserId),
    notDeleted(),
    notModerationRestricted(),
    statusIs(PropertyStatus.PUBLISHED),
    exclude ? idNotIn([exclude]) : undefined,
  ]);
  const [hydrated, total] = await Promise.all([
    // Image-bearing listings first (product rule), then newest.
    findProperties({
      where,
      orderBy: propertyOrderBy(NEWEST_FIRST),
      limit,
      offset: (page - 1) * limit,
    }),
    countProperties(where),
  ]);
  return {
    items: hydrated.map((listing) => serializeProperty(listing, 'public')),
    page,
    limit,
    total,
  };
}
