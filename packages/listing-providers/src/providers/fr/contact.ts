/**
 * Bien'ici portal-shaped contact adapter.
 *
 * Phone/email/WhatsApp normalization lives in package {@link buildContact} /
 * {@link contactFromUnknown} — do NOT re-implement cleaners here.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact, contactFromUnknown } from '../../contact';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * Map Bien'ici `contactRelativeData` onto the shared contact DTO.
 * Shared {@link contactFromUnknown} already understands `*ToDisplay` aliases;
 * this wrapper only sets agency/private kind from Bien'ici flags.
 */
export function contactFromBieniciRelative(value: unknown): NormalizedListingContact | undefined {
  if (!isRecord(value)) return undefined;
  const fromShared = contactFromUnknown(value);
  if (fromShared) {
    if (!fromShared.kind) {
      if (value.contactIsAgency === true || value.contactIsPro === true) {
        return { ...fromShared, kind: 'agency' };
      }
    }
    return fromShared;
  }
  // Fallback when shared extractor missed sparse blobs.
  return buildContact({
    phone: asString(value.phoneToDisplay),
    email: asString(value.emailToDisplay),
    agencyName: asString(value.agencyNameToDisplay),
    name: asString(value.contactNameToDisplay) ?? asString(value.agencyNameToDisplay),
    kind:
      value.contactIsAgency === true || value.contactIsPro === true ? 'agency' : 'private',
  });
}

export { contactFromUnknown };
