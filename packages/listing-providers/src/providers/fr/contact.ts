/**
 * Normalize French portal contact blobs into {@link NormalizedListingContact}.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Strip to a dialable phone; undefined when too short. */
export function normalizeFrPhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d+()\s.-]/g, '').trim();
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  return cleaned;
}

export function normalizeFrEmail(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return undefined;
  return trimmed;
}

export function normalizeFrWhatsapp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/wa\.me\//i.test(trimmed) || /api\.whatsapp\.com/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  return digits;
}

/** Build a contact DTO, omitting empty objects. */
export function buildFrContact(parts: {
  phone?: string;
  email?: string;
  whatsapp?: string;
  agencyName?: string;
  name?: string;
  kind?: NormalizedListingContact['kind'];
}): NormalizedListingContact | undefined {
  const contact: NormalizedListingContact = {};
  const phone = normalizeFrPhone(parts.phone);
  const email = normalizeFrEmail(parts.email);
  const whatsapp = normalizeFrWhatsapp(parts.whatsapp);
  const agencyName = asString(parts.agencyName);
  const name = asString(parts.name);
  if (phone) contact.phone = phone;
  if (email) contact.email = email;
  if (whatsapp) contact.whatsapp = whatsapp;
  if (agencyName) contact.agencyName = agencyName;
  if (name) contact.name = name;
  if (parts.kind) contact.kind = parts.kind;
  return Object.keys(contact).length > 0 ? contact : undefined;
}

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
  return buildFrContact({
    phone,
    email,
    agencyName,
    name,
    kind: isAgency ? 'agency' : 'private',
  });
}

/** Leboncoin / SeLoger loosely-shaped owner/agency objects. */
export function contactFromFrUnknown(value: unknown): NormalizedListingContact | undefined {
  if (!isRecord(value)) return undefined;
  const phone =
    asString(value.phone) ??
    asString(value.phone_number) ??
    asString(value.telephone) ??
    asString(value.phoneNumber);
  const email = asString(value.email) ?? asString(value.email_address);
  const whatsapp = asString(value.whatsapp) ?? asString(value.whatsappLink);
  const agencyName =
    asString(value.agency_name) ??
    asString(value.agencyName) ??
    asString(value.company_name) ??
    asString(value.companyName) ??
    asString(value.name);
  const name = asString(value.name) ?? asString(value.owner_name) ?? agencyName;
  const kind: NormalizedListingContact['kind'] =
    value.user_type === 'pro' || value.type === 'pro' || value.isPro === true
      ? 'agency'
      : value.user_type === 'private' || value.type === 'private'
        ? 'private'
        : undefined;
  return buildFrContact({ phone, email, whatsapp, agencyName, name, kind });
}
