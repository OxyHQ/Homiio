/**
 * Normalize portal contact fields into {@link NormalizedListingContact}.
 *
 * ONE chokepoint for phone/email/whatsapp mapping — portal AJAX parsers probe
 * portal-specific field names then delegate here.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { firstString, isRecord } from './guards';
import { isDataDomeAjaxChallenge } from './challenge';

/** Portal contact fragment before mapping to NormalizedListingContact. */
export interface PortalContact {
  phone?: string;
  email?: string;
  whatsapp?: string;
  name?: string;
  agencyName?: string;
  kind?: NormalizedListingContact['kind'];
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

export function normalizeEmail(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return undefined;
  return trimmed;
}

export function isAjaxContactChallenge(body: string): boolean {
  return isDataDomeAjaxChallenge(body);
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
  const record = isRecord(value) ? value : undefined;
  if (!record) return;
  const nested = firstString(
    record.phone,
    record.phoneNumber,
    record.formattedPhone,
    record.nationalNumber,
    record.internationalNumber,
    record.number,
    record.value,
    record.mobile,
    record.mobilePhone,
    record.telephone,
    record.tel,
  );
  if (nested) {
    const phone = normalizePhone(nested);
    if (phone) out.push(phone);
  }
  for (const key of ['phones', 'phoneNumbers', 'contactPhones', 'mobilePhones', 'data', 'items']) {
    if (key in record) collectPhonesFromUnknown(record[key], out);
  }
}

/** Parse a contact-phones AJAX body into a de-duplicated phone list. */
export function parseContactPhonesAjax(body: string): string[] {
  if (isAjaxContactChallenge(body)) return [];
  const trimmed = body.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const phones: string[] = [];
    collectPhonesFromUnknown(parsed, phones);
    return [...new Set(phones)];
  } catch {
    const phone = normalizePhone(trimmed);
    return phone ? [phone] : [];
  }
}

/** Probe common portal field names on a contact/advertiser record. */
export function contactFromRecord(value: unknown): PortalContact {
  const root = isRecord(value) ? value : undefined;
  if (!root) return {};

  const data =
    (isRecord(root.data) ? root.data : undefined) ??
    (isRecord(root.result) ? root.result : undefined) ??
    (isRecord(root.contact) ? root.contact : undefined) ??
    (isRecord(root.advertiser) ? root.advertiser : undefined) ??
    (isRecord(root.agency) ? root.agency : undefined) ??
    (isRecord(root.seller) ? root.seller : undefined) ??
    (isRecord(root.agent) ? root.agent : undefined) ??
    root;

  const phones: string[] = [];
  collectPhonesFromUnknown(
    data.phone ?? data.phoneNumber ?? data.phones ?? data.contactPhones ?? data.mobilePhone,
    phones,
  );

  const email = normalizeEmail(
    firstString(data.email, data.contactEmail, data.mail, data.agencyEmail, data.emailAddress),
  );
  const whatsapp = normalizeWhatsapp(
    firstString(data.whatsapp, data.whatsApp, data.whatsappPhone, data.whatsappNumber, data.waPhone),
  );
  const name = firstString(data.contactName, data.ownerName, data.sellerName, data.userName, data.name);
  const agencyName = firstString(
    data.agencyName,
    data.commercialName,
    data.advertiserName,
    data.professionalName,
    data.companyName,
    data.displayName,
    data.businessName,
    data.branchDisplayName,
    data.branchName,
  );

  const kindRaw = firstString(data.type, data.kind, data.advertiserType, data.user_type)?.toLowerCase();
  let kind: PortalContact['kind'];
  if (kindRaw) {
    if (/agency|agenzia|professional|impresa|pro/.test(kindRaw)) kind = 'agency';
    else if (/private|privato|particular|individual|owner/.test(kindRaw)) kind = 'private';
    else kind = 'unknown';
  } else if (data.contactIsAgency === true || data.contactIsPro === true || data.isPro === true) {
    kind = 'agency';
  }

  const contact: PortalContact = {};
  if (phones[0]) contact.phone = phones[0];
  if (email) contact.email = email;
  if (whatsapp) contact.whatsapp = whatsapp;
  if (name) contact.name = name;
  if (agencyName) contact.agencyName = agencyName;
  if (kind) contact.kind = kind;
  return contact;
}

/** Parse a contact-info AJAX JSON body into a {@link PortalContact}. */
export function parseContactInfoAjax(body: string): PortalContact {
  if (isAjaxContactChallenge(body)) return {};
  try {
    return contactFromRecord(JSON.parse(body.trim()) as unknown);
  } catch {
    return {};
  }
}

export function buildContact(parts: PortalContact): NormalizedListingContact | undefined {
  const contact: NormalizedListingContact = {};
  const phone = normalizePhone(parts.phone);
  const email = normalizeEmail(parts.email);
  const whatsapp = normalizeWhatsapp(parts.whatsapp);
  if (phone) contact.phone = phone;
  if (email) contact.email = email;
  if (whatsapp) contact.whatsapp = whatsapp;
  if (parts.name) contact.name = parts.name;
  if (parts.agencyName) contact.agencyName = parts.agencyName;
  if (parts.kind) contact.kind = parts.kind;
  return contact.phone || contact.email || contact.whatsapp || contact.name || contact.agencyName
    ? contact
    : undefined;
}

export function toNormalizedListingContact(
  contact: PortalContact | undefined,
): NormalizedListingContact | undefined {
  if (!contact) return undefined;
  return buildContact(contact);
}

export function mergePortalContact(
  ...parts: ReadonlyArray<PortalContact | NormalizedListingContact | undefined>
): PortalContact | undefined {
  const merged: PortalContact = {};
  for (const part of parts) {
    if (!part) continue;
    if (part.phone) merged.phone = part.phone;
    if (part.email) merged.email = part.email;
    if (part.whatsapp) merged.whatsapp = part.whatsapp;
    if (part.name) merged.name = part.name;
    if (part.agencyName) merged.agencyName = part.agencyName;
    if ('kind' in part && part.kind) merged.kind = part.kind;
  }
  return merged.phone || merged.email || merged.whatsapp || merged.name || merged.agencyName
    ? merged
    : undefined;
}

export function mergeContact(
  ...parts: ReadonlyArray<NormalizedListingContact | undefined>
): NormalizedListingContact | undefined {
  const merged = mergePortalContact(...parts);
  return merged ? buildContact(merged) : undefined;
}

/** Pull phone/email/whatsapp/agency from a loosely-shaped portal contact blob. */
export function contactFromUnknown(value: unknown): NormalizedListingContact | undefined {
  if (!isRecord(value)) return undefined;
  const phone =
    firstString(value.phone, value.telephone, value.telephoneEnquiries, value.phoneToDisplay) ??
    (isRecord(value.telephoneNumbers)
      ? firstString(value.telephoneNumbers.localNumber, value.telephoneNumbers.internationalNumber)
      : undefined);
  const email = firstString(value.email, value.emailAddress, value.emailToDisplay);
  const whatsapp = firstString(value.whatsapp, value.whatsappLink, value.whatsApp);
  const agencyName = firstString(
    value.agencyName,
    value.agencyNameToDisplay,
    value.branchDisplayName,
    value.branchName,
    value.companyName,
    value.name,
  );
  return buildContact({ phone, email, whatsapp, agencyName, kind: 'agency' });
}

/** Extract contact from advertiser/agency JSON (Immobiliare, Idealista.it, …). */
export function contactFromAdvertiser(value: unknown): NormalizedListingContact | undefined {
  return buildContact(contactFromRecord(value));
}
