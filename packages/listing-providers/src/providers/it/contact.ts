/**
 * Shared contact helpers for Italian portals (pure parsing).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
  }
  return undefined;
}

export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.replace(/\D/g, '').length < 7) return undefined;
  return cleaned;
}

export function normalizeWhatsapp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (/wa\.me|api\.whatsapp|whatsapp\.com/i.test(raw)) {
    const match = raw.match(/(\d{7,15})/);
    return match?.[1];
  }
  return normalizePhone(raw);
}

/** Extract contact fields from a portal-shaped advertiser/agency JSON object. */
export function contactFromAdvertiser(value: unknown): NormalizedListingContact | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  const nested =
    asRecord(root.advertiser) ??
    asRecord(root.agency) ??
    asRecord(root.contact) ??
    asRecord(root.seller) ??
    asRecord(root.agent) ??
    root;

  const phone = normalizePhone(
    firstString(
      nested.phone,
      nested.phoneNumber,
      nested.mobile,
      nested.mobilePhone,
      nested.telephone,
      nested.tel,
    ),
  );
  const email = firstString(nested.email, nested.mail, nested.contactEmail);
  const whatsapp = normalizeWhatsapp(
    firstString(nested.whatsapp, nested.whatsApp, nested.whatsappPhone, nested.waPhone),
  );
  const agencyName = firstString(
    nested.agencyName,
    nested.displayName,
    nested.companyName,
    nested.businessName,
    nested.name,
    nested.label,
  );
  const kindRaw = firstString(nested.type, nested.kind, nested.advertiserType)?.toLowerCase();
  let kind: NormalizedListingContact['kind'];
  if (kindRaw) {
    if (/agency|agenzia|professional|impresa/.test(kindRaw)) kind = 'agency';
    else if (/private|privato|particular|individual|owner/.test(kindRaw)) kind = 'private';
    else kind = 'unknown';
  }

  const contact: NormalizedListingContact = {};
  if (phone) contact.phone = phone;
  if (email) contact.email = email;
  if (whatsapp) contact.whatsapp = whatsapp;
  if (agencyName) contact.agencyName = agencyName;
  if (kind) contact.kind = kind;
  return contact.phone || contact.email || contact.whatsapp || contact.agencyName ? contact : undefined;
}

export function mergeContact(
  ...parts: ReadonlyArray<NormalizedListingContact | undefined>
): NormalizedListingContact | undefined {
  const merged: NormalizedListingContact = {};
  for (const part of parts) {
    if (!part) continue;
    if (part.phone) merged.phone = part.phone;
    if (part.email) merged.email = part.email;
    if (part.whatsapp) merged.whatsapp = part.whatsapp;
    if (part.agencyName) merged.agencyName = part.agencyName;
    if (part.kind) merged.kind = part.kind;
  }
  return merged.phone || merged.email || merged.whatsapp || merged.agencyName ? merged : undefined;
}
