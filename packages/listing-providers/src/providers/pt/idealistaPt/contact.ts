/**
 * Idealista.pt contact AJAX helpers (pure).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromAdvertiser, mergeContact, normalizePhone } from '../../../parse/contact';
import { IDEALISTA_PT_BASE_URL } from './fixtures';

export function idealistaPtContactPhonesUrl(adId: string): string {
  return `${IDEALISTA_PT_BASE_URL}/pt/ajax/ads/${adId}/contact-phones`;
}

export function idealistaPtContactInfoUrl(adId: string): string {
  return `${IDEALISTA_PT_BASE_URL}/pt/ajax/listingController/adContactInfoForDetail.ajax?adId=${encodeURIComponent(adId)}`;
}

export function isIdealistaPtContactChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  return /captcha-delivery\.com|geo\.captcha|datadome|acesso negado/i.test(trimmed);
}

export function parseIdealistaPtContactPhones(body: string): string[] {
  if (isIdealistaPtContactChallenge(body)) return [];
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

export function parseIdealistaPtContactInfo(body: string): NormalizedListingContact | undefined {
  if (isIdealistaPtContactChallenge(body)) return undefined;
  try {
    return contactFromAdvertiser(JSON.parse(body.trim()) as unknown);
  } catch {
    return undefined;
  }
}

export { mergeContact as mergeIdealistaPtContact };
