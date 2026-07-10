/**
 * Normalize portal contact fields into {@link NormalizedListingContact}.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { asString, isRecord } from '../../parse/guards';

/** Strip to a dialable phone string; returns undefined when too short. */
export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d+()\s-]/g, '').trim();
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  return cleaned;
}

/** Prefer digits; accept wa.me URLs and keep them as-is when already a link. */
export function normalizeWhatsapp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/wa\.me\//i.test(trimmed) || /api\.whatsapp\.com/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  return digits;
}

export function normalizeEmail(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return undefined;
  return trimmed;
}

/** Build a contact DTO, omitting empty objects. */
export function buildContact(parts: {
  phone?: string;
  email?: string;
  whatsapp?: string;
  agencyName?: string;
  name?: string;
  kind?: NormalizedListingContact['kind'];
}): NormalizedListingContact | undefined {
  const contact: NormalizedListingContact = {};
  const phone = normalizePhone(parts.phone);
  const email = normalizeEmail(parts.email);
  const whatsapp = normalizeWhatsapp(parts.whatsapp);
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

/** Pull phone/email/whatsapp/agency from a loosely-shaped portal contact blob. */
export function contactFromUnknown(value: unknown): NormalizedListingContact | undefined {
  if (!isRecord(value)) return undefined;
  const phone =
    asString(value.phone) ??
    asString(value.telephone) ??
    asString(value.telephoneEnquiries) ??
    (isRecord(value.telephoneNumbers)
      ? asString(value.telephoneNumbers.localNumber) ?? asString(value.telephoneNumbers.internationalNumber)
      : undefined);
  const email = asString(value.email) ?? asString(value.emailAddress);
  const whatsapp =
    asString(value.whatsapp) ?? asString(value.whatsappLink) ?? asString(value.whatsApp);
  const agencyName =
    asString(value.agencyName) ??
    asString(value.branchDisplayName) ??
    asString(value.branchName) ??
    asString(value.companyName) ??
    asString(value.name);
  return buildContact({ phone, email, whatsapp, agencyName, kind: 'agency' });
}
