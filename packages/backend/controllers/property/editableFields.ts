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
 * `models/Property.ts`. Owner/system fields are intentionally absent.
 */

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
];

/**
 * Fields a user may change when UPDATING an existing listing. Identical to the
 * creatable set MINUS `type` (a listing's kind is immutable post-creation).
 */
export const EDITABLE_PROPERTY_FIELDS: readonly string[] = CREATABLE_PROPERTY_FIELDS.filter(
  (field) => field !== 'type',
);
