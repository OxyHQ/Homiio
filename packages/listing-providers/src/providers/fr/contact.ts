/**
 * French portal contact adapters — portal-specific field probes only.
 * Normalization always delegates to shared {@link ../../parse/contact}.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { asString, isRecord } from '../../parse/guards';
import { buildContact, contactFromUnknown } from '../../parse/contact';

/**
 * Bien'ici `contactRelativeData` (and similar FR agency blobs).
 * Email is often gated (`hasEmailToDisplay`) without the address itself.
 */
export function contactFromBieniciRelative(value: unknown): NormalizedListingContact | undefined {
  if (!isRecord(value)) return undefined;
  const phone =
    asString(value.phoneToDisplay) ?? asString(value.phone) ?? asString(value.telephone);
  const email = asString(value.emailToDisplay) ?? asString(value.email);
  const agencyName =
    asString(value.agencyNameToDisplay) ?? asString(value.agencyName) ?? asString(value.companyName);
  const name = asString(value.contactNameToDisplay) ?? asString(value.contactName) ?? agencyName;
  const isAgency = value.contactIsAgency === true || value.contactIsPro === true;
  return buildContact({
    phone,
    email,
    agencyName,
    name,
    kind: isAgency ? 'agency' : 'private',
  });
}

/** Leboncoin / SeLoger loosely-shaped owner/agency objects → shared extractor. */
export function contactFromFrUnknown(value: unknown): NormalizedListingContact | undefined {
  return contactFromUnknown(value);
}
