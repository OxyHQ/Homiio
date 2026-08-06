/**
 * Utility Functions
 * Common helper functions used across the application
 */

/**
 * Transform address fields for Property documents
 * Converts populated addressId to address field
 */
interface AddressTransformable {
  addressId?: unknown;
  address?: Record<string, unknown> & { showAddressNumber?: unknown };
  [key: string]: unknown;
}

/**
 * Whether `value` is an ADDRESS RECORD rather than a reference to one.
 *
 * The question this answers is "did the read produce the address, or only a
 * pointer to it?", and it is answered by looking for the address's own mandatory
 * field. `street` is that field in BOTH stores — `required: true` on the
 * Mongoose schema, `NOT NULL` on `addresses.street` — so every address record
 * carries it and no representation of an id does: a bson `ObjectId`, a 24-char
 * hex string and a uuid v7 all fail it.
 *
 * **It deliberately does not look at an id field.** The guard this replaced
 * tested `addressId._id`, which is not a question about the address at all — it
 * is a question about MONGO'S SPELLING of an id. The moment a row comes back
 * carrying `id` instead, that test answers "not populated", the caller returns
 * without setting `obj.address`, and every property card loses its location
 * label with no error, no log and no failing request anywhere. Widening it to
 * `_id ?? id` would only move the same mistake one spelling further along.
 */
const isAddressRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && 'street' in value;

const transformAddressFields = <T extends AddressTransformable>(obj: T): T => {
  if (obj && isAddressRecord(obj.addressId)) {
    obj.address = { ...obj.addressId };

    // Remove showAddressNumber from address object if present (legacy data cleanup)
    // showAddressNumber should only exist at property level, not address level
    if (obj.address && obj.address.showAddressNumber !== undefined) {
      delete obj.address.showAddressNumber;
    }

    // Remove addressId from response - only return the aliased address
    delete obj.addressId;
  }
  return obj;
};

export {
  transformAddressFields
};
