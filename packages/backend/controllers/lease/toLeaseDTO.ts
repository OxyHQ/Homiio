/**
 * Lease DTO serializer.
 *
 * Converts a Lease Mongoose document (optionally populated with its property
 * and landlord/tenant profiles) into the flat-ish DTO the frontend consumes:
 *   - `_id` → `id` on the lease and on every `documents` / `paymentSchedule`
 *     subdocument,
 *   - reference fields kept as string ids (`propertyId`, `landlordProfileId`,
 *     `tenantProfileId`) AND, when populated, surfaced as nested objects
 *     (`property`, `landlord`, `tenant`).
 *
 * The shape mirrors `Lease` in `@homiio/shared-types`, which treats the Mongoose
 * schema as the single authority.
 */

const mongoose = require('mongoose');

type Loose = Record<string, unknown>;

interface HasToJSON {
  toJSON(): Loose;
}

function hasToJSON(value: unknown): value is HasToJSON {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  );
}

function plain(value: unknown): Loose {
  if (hasToJSON(value)) {
    return value.toJSON();
  }
  return (value ?? {}) as Loose;
}

export function refToId(ref: unknown): string | undefined {
  if (ref === null || ref === undefined) return undefined;
  if (ref instanceof mongoose.Types.ObjectId) return ref.toString();
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object') {
    const obj = ref as { _id?: unknown; id?: unknown };
    if (obj._id !== undefined && obj._id !== null) return String(obj._id);
    if (obj.id !== undefined && obj.id !== null) return String(obj.id);
  }
  return String(ref);
}

/** Return the populated document (as a plain object) or undefined for a bare id ref. */
function refToDoc(ref: unknown): Loose | undefined {
  if (ref === null || ref === undefined) return undefined;
  if (ref instanceof mongoose.Types.ObjectId) return undefined;
  if (typeof ref !== 'object') return undefined;
  return plain(ref);
}

function withId(subdoc: unknown): Loose {
  const obj = plain(subdoc);
  const id = refToId(obj._id ?? obj.id);
  return id ? { ...obj, id } : { ...obj };
}

export function toLeaseDTO(leaseDoc: unknown): Loose {
  const lease = plain(leaseDoc);

  const documents = Array.isArray(lease.documents)
    ? lease.documents.map(withId)
    : [];
  const paymentSchedule = Array.isArray(lease.paymentSchedule)
    ? lease.paymentSchedule.map(withId)
    : [];
  const coTenants = Array.isArray(lease.coTenants)
    ? lease.coTenants.map((ct) => {
        const obj = plain(ct);
        return { ...obj, profileId: refToId(obj.profileId) };
      })
    : [];

  return {
    ...lease,
    id: refToId(lease._id ?? lease.id),
    propertyId: refToId(lease.propertyId),
    property: refToDoc(lease.propertyId),
    landlordProfileId: refToId(lease.landlordProfileId),
    landlord: refToDoc(lease.landlordProfileId),
    tenantProfileId: refToId(lease.tenantProfileId),
    tenant: refToDoc(lease.tenantProfileId),
    roomId: refToId(lease.roomId),
    coTenants,
    documents,
    paymentSchedule,
  };
}

export default toLeaseDTO;
