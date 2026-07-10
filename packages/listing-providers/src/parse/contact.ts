/**
 * Normalize portal contact fields into {@link NormalizedListingContact}.
 * ONE chokepoint — portal AJAX parsers probe field names then delegate here.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { firstString, isRecord } from './guards';
import { isDataDomeAjaxChallenge } from './challenge';

export interface PortalContact {
  phone?: string;
  email?: string;
  whatsapp?: string;
  name?: string;
  agencyName?: string;
  kind?: NormalizedListingContact['kind'];
}

export type ListingContact = NormalizedListingContact;

export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  return hasPlus ? `+${digits}` : digits;
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
  if (!isRecord(value)) return;
  const nested = firstString(
    value.phone,
    value.phoneNumber,
    value.formattedPhone,
    value.nationalNumber,
    value.internationalNumber,
    value.number,
    value.value,
    value.mobile,
    value.mobilePhone,
    value.telephone,
    value.tel,
  );
  if (nested) {
    const phone = normalizePhone(nested);
    if (phone) out.push(phone);
  }
  for (const key of [
    'phone',
    'phoneNumber',
    'mobilePhone',
    'phones',
    'phoneNumbers',
    'contactPhones',
    'mobilePhones',
    'data',
    'items',
  ]) {
    if (key in value) collectPhonesFromUnknown(value[key], out);
  }
}

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

/** Idealista-era alias. */
export function parseContactPhonesJson(
  body: string,
  isChallenge?: (body: string) => boolean,
): string[] {
  if (isChallenge?.(body)) return [];
  return parseContactPhonesAjax(body);
}

export function contactFromRecord(value: unknown): PortalContact {
  const root = isRecord(value) ? value : undefined;
  if (!root) return {};

  const contactData = isRecord(root.contactData) ? root.contactData : undefined;
  const agent =
    (isRecord(contactData?.agent) ? contactData.agent : undefined) ??
    (isRecord(root.agent) ? root.agent : undefined);
  const intermediary = isRecord(root.intermediaryCard) ? root.intermediaryCard : undefined;
  const contactCard = isRecord(root.contactCard) ? root.contactCard : undefined;

  const data =
    (isRecord(root.data) ? root.data : undefined) ??
    (isRecord(root.result) ? root.result : undefined) ??
    (isRecord(root.contact) ? root.contact : undefined) ??
    (isRecord(root.advertiser) ? root.advertiser : undefined) ??
    (isRecord(root.agency) ? root.agency : undefined) ??
    (isRecord(root.seller) ? root.seller : undefined) ??
    agent ??
    root;

  const phones: string[] = [];
  collectPhonesFromUnknown(data, phones);
  if (phones.length === 0) {
    collectPhonesFromUnknown(root.phoneNumbers ?? root.phones, phones);
  }

  const email = normalizeEmail(
    firstString(
      data.emailToDisplay,
      data.email,
      data.email_address,
      data.contactEmail,
      data.mail,
      data.agencyEmail,
      data.emailAddress,
      root.email,
    ),
  );
  const whatsapp = normalizeWhatsapp(
    firstString(
      data.whatsapp,
      data.whatsApp,
      data.whatsappLink,
      data.whatsappPhone,
      data.whatsappNumber,
      data.waPhone,
    ),
  );
  const name = firstString(
    data.contactNameToDisplay,
    data.contactName,
    data.ownerName,
    data.owner_name,
    data.sellerName,
    data.userName,
    data.name,
    contactCard?.title,
    agent?.name,
  );
  const agencyName = firstString(
    data.agencyNameToDisplay,
    data.agencyName,
    data.agency_name,
    data.commercialName,
    data.advertiserName,
    data.professionalName,
    data.companyName,
    data.company,
    data.displayName,
    data.businessName,
    data.branchDisplayName,
    data.branchName,
    intermediary?.title,
    agent?.company,
  );

  const kindRaw = firstString(
    data.type,
    data.kind,
    data.advertiserType,
    data.user_type,
    root.publisherType,
  )?.toLowerCase();
  let kind: PortalContact['kind'];
  if (data.contactIsAgency === true || data.contactIsPro === true || data.isPro === true || root.isPrivateOwner === false) {
    kind = 'agency';
  } else if (root.isPrivateOwner === true) {
    kind = 'private';
  } else if (kindRaw) {
    if (/agency|agenzia|professional|impresa|pro|inmobiliaria/.test(kindRaw)) kind = 'agency';
    else if (/private|privato|particular|individual|owner/.test(kindRaw)) kind = 'private';
    else kind = 'unknown';
  }

  const contact: PortalContact = {};
  if (phones[0]) contact.phone = phones[0];
  if (email) contact.email = email;
  if (whatsapp) contact.whatsapp = whatsapp;
  if (name) contact.name = name;
  if (agencyName) contact.agencyName = agencyName;
  else if (kind === 'agency' && name) contact.agencyName = name;
  if (kind) contact.kind = kind;
  return contact;
}

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

export const mergeListingContact = mergeContact;

export function contactFromAdvertiser(value: unknown): NormalizedListingContact | undefined {
  return buildContact(contactFromRecord(value));
}

export function contactFromUnknown(value: unknown): NormalizedListingContact | undefined {
  return buildContact(contactFromRecord(value));
}

export function contactFromAjaxBody(body: string): NormalizedListingContact | undefined {
  if (isAjaxContactChallenge(body)) return undefined;
  return buildContact(parseContactInfoAjax(body));
}

/** Best-effort contact scrape from listing HTML (`tel:`, `mailto:`, WhatsApp). */
export function extractContactFromHtml(html: string): NormalizedListingContact | undefined {
  const phones: string[] = [];
  for (const match of html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    const raw = match[1];
    if (!raw) continue;
    try {
      const phone = normalizePhone(decodeURIComponent(raw));
      if (phone) phones.push(phone);
    } catch {
      const phone = normalizePhone(raw);
      if (phone) phones.push(phone);
    }
  }
  let whatsapp: string | undefined;
  for (const match of html.matchAll(
    /href=["']([^"']*(?:wa\.me|api\.whatsapp\.com|whatsapp\.com)[^"']*)["']/gi,
  )) {
    whatsapp = normalizeWhatsapp(match[1]);
    if (whatsapp) break;
  }
  if (!whatsapp) {
    whatsapp =
      html.match(/wa\.me\/(\d{7,15})/i)?.[1] ??
      html.match(/whatsapp\.com\/send\?phone=(\d+)/i)?.[1];
  }
  const mailto = html.match(/mailto:([^"'?\s>]+)/i)?.[1];
  let email: string | undefined;
  if (mailto) {
    try {
      email = normalizeEmail(decodeURIComponent(mailto));
    } catch {
      email = normalizeEmail(mailto);
    }
  }
  let kind: NormalizedListingContact['kind'];
  if (/privat/i.test(html)) kind = 'private';
  else if (/gewerblich|händler|haendler|firma|agency/i.test(html)) kind = 'agency';
  return buildContact({ phone: phones[0], email, whatsapp, kind });
}

export function hasContactFields(contact: NormalizedListingContact | undefined): boolean {
  if (!contact) return false;
  return !!(contact.phone || contact.email || contact.whatsapp || contact.agencyName || contact.name);
}
