/**
 * Mass-assignment protection for property/room write endpoints.
 *
 * The create/update controllers must NEVER spread `req.body` straight into the
 * Property model: that would let a client set owner/system-managed fields
 * (`profileId`, `isVerified`, `views`, partner attribution, etc.) and reassign
 * ownership (IDOR / privilege escalation). Instead, every write path picks ONLY
 * the explicit, user-editable fields listed here. Anything not on this list is
 * resolved server-side (`profileId`, `addressId`), derived (`sale.pricePerSqm`),
 * system-managed (`views`, `rating`, timestamps), or simply rejected.
 *
 * Keep this list in sync with the user-facing fields of the Property schema in
 * `models/schemas/PropertySchema.ts`. Owner/system fields are intentionally absent.
 */

import { LISTING_ADDRESS_PRECISIONS, isListingAddressPrecision } from '@homiio/shared-types';

import { AppError } from '../../middlewares/errorHandler';

/**
 * Fields a user may set when CREATING a listing. `type` is allowed here (it is
 * fixed at creation) but is intentionally NOT in {@link EDITABLE_PROPERTY_FIELDS}
 * so it cannot be changed on update.
 */
export const CREATABLE_PROPERTY_FIELDS: readonly string[] = [
  'type',
  'housingType',
  'layoutType',
  'description',
  'squareFootage',
  'bedrooms',
  'bathrooms',
  'offerings',
  'longTermRent',
  'shortTermRent',
  'amenities',
  'images',
  'status',
  'floor',
  'hasElevator',
  'parkingSpaces',
  'yearBuilt',
  'furnishedStatus',
  'utilitiesIncluded',
  'petFriendly',
  'petPolicy',
  'petFee',
  'parkingType',
  'hasBalcony',
  'hasGarden',
  'proximityToTransport',
  'proximityToSchools',
  'proximityToShopping',
  'availableFrom',
  'leaseTerm',
  'smokingAllowed',
  'partiesAllowed',
  'guestsAllowed',
  'maxGuests',
  'availabilityWindows',
  'cancellationPolicy',
  'sale',
  'exchange',
  'isEcoFriendly',
  'addressPublishedPrecision',
];

/**
 * The owner's own publication choice, validated before it reaches the CHECK.
 *
 * A value outside the ladder would otherwise surface as a constraint violation
 * and a 500. Returns the 400 to send, or `null` when the payload either names a
 * valid precision or does not mention one (a create then stores the column
 * default, `building`; an update leaves the stored choice alone).
 */
export function invalidAddressPublishedPrecision(payload: Record<string, unknown>): AppError | null {
  if (!Object.prototype.hasOwnProperty.call(payload, 'addressPublishedPrecision')) return null;
  if (isListingAddressPrecision(payload.addressPublishedPrecision)) return null;
  return new AppError(
    `addressPublishedPrecision must be one of: ${LISTING_ADDRESS_PRECISIONS.join(', ')}`,
    400,
    'INVALID_ADDRESS_PRECISION',
  );
}

/**
 * Fields a user may change when UPDATING an existing listing. Identical to the
 * creatable set MINUS `type` (a listing's kind is immutable post-creation).
 */
export const EDITABLE_PROPERTY_FIELDS: readonly string[] = CREATABLE_PROPERTY_FIELDS.filter(
  (field) => field !== 'type',
);
