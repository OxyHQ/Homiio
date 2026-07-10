/**
 * Idealista contact AJAX helpers (pure parsing + URL building).
 *
 * After a warmed Playwright session, Idealista may unlock:
 *   - `/es/ajax/ads/{adId}/contact-phones`
 *   - `/es/ajax/listingController/adContactInfoForDetail.ajax?adId=`
 *
 * Cold HTTP returns DataDome 403. These parsers are best-effort: empty contact
 * on challenge/unknown shapes is success (never throw). Contact is merged into
 * {@link IdealistaRaw} and then {@link NormalizedListing.contact}.
 */

import { IDEALISTA_BASE_URL } from './fixtures';

/** Contact fields Homiio can surface for direct outreach on external listings. */
export interface IdealistaContact {
  phone?: string;
  email?: string;
  whatsapp?: string;
  name?: string;
  agencyName?: string;
}

/** Build the contact-phones AJAX URL for an ad id. */
export function idealistaContactPhonesUrl(adId: string): string {
  return `${IDEALISTA_BASE_URL}/es/ajax/ads/${adId}/contact-phones`;
}

/** Build the adContactInfoForDetail AJAX URL for an ad id. */
export function idealistaContactInfoUrl(adId: string): string {
  return `${IDEALISTA_BASE_URL}/es/ajax/listingController/adContactInfoForDetail.ajax?adId=${encodeURIComponent(adId)}`;
}

/** True when the body is a DataDome / empty challenge rather than contact JSON. */
export function isIdealistaContactChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  if (/captcha-delivery\.com|geo\.captcha|datadome|acceso denegado/i.test(trimmed)) return true;
  return false;
}

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
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }
  return undefined;
}

function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Keep leading +, strip spaces/dashes/parens for tel:/wa.me links.
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.replace(/\D/g, '').length < 7) return undefined;
  return cleaned;
}

function normalizeWhatsapp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (/wa\.me|api\.whatsapp|whatsapp\.com/i.test(raw)) {
    const match = raw.match(/(\d{7,15})/);
    return match?.[1];
  }
  return normalizePhone(raw);
}

function collectPhonesFromUnknown(value: unknown, out: string[]): void {
  if (typeof value === 'string' || typeof value === 'number') {
    const phone = normalizePhone(String(value));
    if (phone) out.push(phone);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectPhonesFromUnknown(entry, out);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const nested = firstString(
    record.phone,
    record.phoneNumber,
    record.formattedPhone,
    record.nationalNumber,
    record.internationalNumber,
    record.number,
    record.value,
  );
  if (nested) {
    const phone = normalizePhone(nested);
    if (phone) out.push(phone);
  }
  for (const key of ['phones', 'phoneNumbers', 'contactPhones', 'mobilePhones', 'data', 'items']) {
    if (key in record) collectPhonesFromUnknown(record[key], out);
  }
}

/**
 * Parse contact-phones AJAX JSON into a de-duplicated phone list.
 * Accepts arrays, `{ phones: [...] }`, or objects with phone-like keys.
 */
export function parseIdealistaContactPhones(body: string): string[] {
  if (isIdealistaContactChallenge(body)) return [];
  const trimmed = body.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    // Plain-text phone body.
    const phone = normalizePhone(trimmed);
    return phone ? [phone] : [];
  }
  const phones: string[] = [];
  collectPhonesFromUnknown(parsed, phones);
  return [...new Set(phones)];
}

/**
 * Parse adContactInfoForDetail (or similar) into {@link IdealistaContact}.
 * Field names vary; we probe common Idealista / scraper shapes.
 */
export function parseIdealistaContactInfo(body: string): IdealistaContact {
  if (isIdealistaContactChallenge(body)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim()) as unknown;
  } catch {
    return {};
  }

  const root = asRecord(parsed) ?? {};
  const data = asRecord(root.data) ?? asRecord(root.result) ?? asRecord(root.contact) ?? root;

  const phones: string[] = [];
  collectPhonesFromUnknown(
    data.phone ?? data.phoneNumber ?? data.phones ?? data.contactPhones ?? data.mobilePhone,
    phones,
  );

  const email = firstString(data.email, data.contactEmail, data.mail, data.agencyEmail);
  const whatsapp = normalizeWhatsapp(
    firstString(data.whatsapp, data.whatsApp, data.whatsappPhone, data.whatsappNumber, data.waPhone),
  );
  const name = firstString(data.contactName, data.ownerName, data.sellerName, data.userName);
  const agencyName = firstString(
    data.agencyName,
    data.commercialName,
    data.advertiserName,
    data.professionalName,
  );

  const contact: IdealistaContact = {};
  if (phones[0]) contact.phone = phones[0];
  if (email) contact.email = email;
  if (whatsapp) contact.whatsapp = whatsapp;
  if (name) contact.name = name;
  if (agencyName) contact.agencyName = agencyName;
  return contact;
}

/** Merge contact fragments; later non-empty fields win over earlier empties. */
export function mergeIdealistaContact(
  ...parts: ReadonlyArray<IdealistaContact | undefined>
): IdealistaContact | undefined {
  const merged: IdealistaContact = {};
  for (const part of parts) {
    if (!part) continue;
    if (part.phone) merged.phone = part.phone;
    if (part.email) merged.email = part.email;
    if (part.whatsapp) merged.whatsapp = part.whatsapp;
    if (part.agencyName) merged.agencyName = part.agencyName;
  }
  return merged.phone || merged.email || merged.whatsapp || merged.name || merged.agencyName
    ? merged
    : undefined;
}
