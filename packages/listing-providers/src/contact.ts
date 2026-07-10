/**
 * Shared contact normalization for every listing provider.
 *
 * Market-specific modules (providers/.../contact.ts) call these helpers instead
 * of re-implementing phone/email/WhatsApp cleaning. Portal-shaped extractors
 * stay market-local; the DTO build/merge lives here once.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';

/** Alias used by Idealista / portal wrappers. */
export type ListingContact = NormalizedListingContact;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Strip to a dialable phone; undefined when fewer than 7 digits. */
export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d+()\s.-]/g, '').trim();
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  return cleaned;
}

/** Digits-only or wa.me URL; undefined when unusable. */
export function normalizeWhatsapp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/wa\.me\//i.test(trimmed) || /api\.whatsapp\.com/i.test(trimmed)) {
    const match = trimmed.match(/(\d{7,15})/);
    return match?.[1] ?? trimmed;
  }
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

/** Merge contact fragments; later non-empty fields win. */
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
    if (part.name) merged.name = part.name;
    if (part.kind) merged.kind = part.kind;
  }
  return merged.phone || merged.email || merged.whatsapp || merged.agencyName || merged.name
    ? merged
    : undefined;
}

/** Idealista-era alias. */
export const mergeListingContact = mergeContact;

function phoneFromList(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  for (const entry of value) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      const phone = normalizePhone(String(entry));
      if (phone) return phone;
    }
    if (isRecord(entry)) {
      const phone = normalizePhone(
        asString(entry.phone) ??
          asString(entry.phoneNumber) ??
          asString(entry.number) ??
          asString(entry.formattedPhone) ??
          asString(entry.value),
      );
      if (phone) return phone;
    }
  }
  return undefined;
}

/**
 * Best-effort extract from a loosely-shaped portal contact / agency / user blob.
 * Handles IS24 (`phoneNumbers`/`contactData.agent`), Immowelt (`intermediaryCard`), etc.
 */
export function contactFromUnknown(value: unknown): NormalizedListingContact | undefined {
  if (!isRecord(value)) return undefined;
  const contactData = isRecord(value.contactData) ? value.contactData : undefined;
  const agent =
    (isRecord(contactData?.agent) ? contactData.agent : undefined) ??
    (isRecord(value.agent) ? value.agent : undefined);
  const intermediary = isRecord(value.intermediaryCard) ? value.intermediaryCard : undefined;
  const contactCard = isRecord(value.contactCard) ? value.contactCard : undefined;
  const nested =
    (isRecord(value.advertiser) ? value.advertiser : undefined) ??
    (isRecord(value.agency) ? value.agency : undefined) ??
    (isRecord(value.contact) ? value.contact : undefined) ??
    (isRecord(value.seller) ? value.seller : undefined) ??
    (isRecord(value.user) ? value.user : undefined) ??
    agent ??
    (isRecord(value.publisher) ? value.publisher : undefined) ??
    value;

  const phone = normalizePhone(
    asString(nested.phone) ??
      asString(nested.phoneToDisplay) ??
      asString(nested.phone_number) ??
      asString(nested.phoneNumber) ??
      asString(nested.telephone) ??
      asString(nested.mobile) ??
      asString(nested.mobilePhone) ??
      asString(nested.tel) ??
      phoneFromList(nested.phones) ??
      phoneFromList(nested.phoneNumbers) ??
      phoneFromList(value.phones) ??
      phoneFromList(value.phoneNumbers),
  );
  const email = normalizeEmail(
    asString(nested.email) ??
      asString(nested.emailToDisplay) ??
      asString(nested.email_address) ??
      asString(nested.mail) ??
      asString(nested.contactEmail) ??
      asString(value.email),
  );
  const whatsapp = normalizeWhatsapp(
    asString(nested.whatsapp) ??
      asString(nested.whatsApp) ??
      asString(nested.whatsappLink) ??
      asString(nested.whatsappPhone) ??
      asString(nested.whatsappUrl) ??
      asString(nested.waPhone),
  );
  const agencyName = asString(
    nested.agencyNameToDisplay ??
      nested.agencyName ??
      nested.agency_name ??
      nested.company_name ??
      nested.companyName ??
      nested.company ??
      nested.commercialName ??
      nested.businessName ??
      nested.branchDisplayName ??
      nested.publisherName ??
      intermediary?.title ??
      agent?.company,
  );
  const name = asString(
    nested.contactNameToDisplay ??
      nested.contactName ??
      nested.name ??
      nested.ownerName ??
      nested.owner_name ??
      nested.sellerName ??
      contactCard?.title ??
      agent?.name ??
      agencyName,
  );
  const kindRaw = asString(
    nested.type ?? nested.kind ?? nested.advertiserType ?? nested.user_type ?? value.publisherType,
  )?.toLowerCase();
  let kind: NormalizedListingContact['kind'];
  if (
    nested.contactIsAgency === true ||
    nested.contactIsPro === true ||
    nested.isPro === true ||
    value.isPrivateOwner === false
  ) {
    kind = 'agency';
  } else if (value.isPrivateOwner === true) {
    kind = 'private';
  } else if (kindRaw) {
    if (/agency|agenzia|professional|pro|impresa|inmobiliaria/.test(kindRaw)) kind = 'agency';
    else if (/private|privato|particular|individual|owner/.test(kindRaw)) kind = 'private';
    else kind = 'unknown';
  }

  return buildContact({
    phone,
    email,
    whatsapp,
    agencyName,
    name: name ?? agencyName,
    kind,
  });
}

/** Idealista-era alias. */
export const contactFromRecord = contactFromUnknown;

/**
 * Best-effort contact scrape from listing HTML (`tel:`, `mailto:`, WhatsApp links).
 * Used by HTML-first portals (Kleinanzeigen, …) — no portal-specific duplication.
 */
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
  const mailto = html.match(/mailto:([^"'?\s>]+)/i)?.[1];
  let email: string | undefined;
  if (mailto) {
    try {
      email = normalizeEmail(decodeURIComponent(mailto));
    } catch {
      email = normalizeEmail(mailto);
    }
  }
  return buildContact({ phone: phones[0], email, whatsapp });
}

/** True when any contact channel is present. */
export function hasContactFields(contact: NormalizedListingContact | undefined): boolean {
  if (!contact) return false;
  return !!(contact.phone || contact.email || contact.whatsapp || contact.agencyName || contact.name);
}

/** Parse a JSON contact AJAX body. Never throws. */
export function contactFromAjaxBody(body: string): NormalizedListingContact | undefined {
  const trimmed = body.trim();
  if (!trimmed || /captcha|datadome|access denied/i.test(trimmed)) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'string') {
      return buildContact({ phone: parsed });
    }
    if (Array.isArray(parsed)) {
      const phone = parsed
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (isRecord(entry)) return asString(entry.phone) ?? asString(entry.number);
          return undefined;
        })
        .find((entry): entry is string => Boolean(entry));
      return buildContact({ phone });
    }
    if (isRecord(parsed)) {
      const data =
        (Array.isArray(parsed.data) ? { phones: parsed.data } : isRecord(parsed.data) ? parsed.data : undefined) ??
        parsed;
      const fromUnknown = contactFromUnknown(data);
      const whatsappUrl =
        asString(parsed.url) ?? asString(parsed.whatsappUrl) ?? asString(parsed.whatsAppUrl);
      if (whatsappUrl) {
        const digits = normalizeWhatsapp(whatsappUrl);
        return mergeContact(fromUnknown, buildContact({ whatsapp: digits, phone: digits }));
      }
      return fromUnknown;
    }
  } catch {
    const phone = normalizePhone(trimmed);
    if (phone) return buildContact({ phone });
  }
  return undefined;
}

/**
 * Parse Idealista-style contact-phones JSON into phone strings.
 * `isChallenge` skips captcha bodies.
 */
export function parseContactPhonesJson(
  body: string,
  isChallenge?: (body: string) => boolean,
): string[] {
  if (isChallenge?.(body)) return [];
  const trimmed = body.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const out: string[] = [];
    const push = (raw: unknown): void => {
      const phone = normalizePhone(
        asString(raw) ??
          (isRecord(raw)
            ? asString(raw.phone) ??
              asString(raw.number) ??
              asString(raw.phoneNumber) ??
              asString(raw.telephone)
            : undefined),
      );
      if (phone) out.push(phone);
    };
    if (Array.isArray(parsed)) {
      for (const entry of parsed) push(entry);
    } else if (isRecord(parsed)) {
      const data = parsed.data ?? parsed.phones ?? parsed.phoneNumbers ?? parsed;
      if (Array.isArray(data)) {
        for (const entry of data) push(entry);
      } else {
        push(data);
      }
    }
    return [...new Set(out)];
  } catch {
    const phone = normalizePhone(trimmed);
    return phone ? [phone] : [];
  }
}
