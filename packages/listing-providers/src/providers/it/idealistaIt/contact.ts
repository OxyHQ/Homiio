/**
 * Idealista.it contact AJAX helpers (pure).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromAdvertiser, mergeContact, normalizePhone } from '../../../parse/contact';
import { IDEALISTA_IT_BASE_URL } from './fixtures';

export function idealistaItContactPhonesUrl(adId: string): string {
  return `${IDEALISTA_IT_BASE_URL}/it/ajax/ads/${adId}/contact-phones`;
}

export function idealistaItContactInfoUrl(adId: string): string {
  return `${IDEALISTA_IT_BASE_URL}/it/ajax/listingController/adContactInfoForDetail.ajax?adId=${encodeURIComponent(adId)}`;
}

export function isIdealistaItContactChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  return /captcha-delivery\.com|geo\.captcha|datadome|accesso negato/i.test(trimmed);
}

export function parseIdealistaItContactPhones(body: string): string[] {
  if (isIdealistaItContactChallenge(body)) return [];
  const trimmed = body.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const phones: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string' || typeof value === 'number') {
        const phone = normalizePhone(String(value));
        if (phone) phones.push(phone);
        return;
      }
      if (Array.isArray(value)) {
        for (const entry of value) walk(entry);
        return;
      }
      if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        for (const key of Object.keys(record)) walk(record[key]);
      }
    };
    walk(parsed);
    return [...new Set(phones)];
  } catch {
    const phone = normalizePhone(trimmed);
    return phone ? [phone] : [];
  }
}

export function parseIdealistaItContactInfo(body: string): NormalizedListingContact | undefined {
  if (isIdealistaItContactChallenge(body)) return undefined;
  try {
    return contactFromAdvertiser(JSON.parse(body.trim()) as unknown);
  } catch {
    return undefined;
  }
}

export { mergeContact as mergeIdealistaItContact };
