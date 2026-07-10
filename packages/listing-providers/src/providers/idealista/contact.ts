/**
 * Idealista contact AJAX helpers (pure parsing + URL building).
 *
 * After a warmed Playwright session, Idealista may unlock contact AJAX endpoints.
 * Field probing delegates to the shared {@link ../../parse/contact} module.
 */

import {
  isAjaxContactChallenge,
  mergePortalContact,
  parseContactInfoAjax,
  parseContactPhonesAjax,
  type PortalContact,
} from '../../parse/contact';
import { IDEALISTA_BASE_URL } from './fixtures';

export type IdealistaContact = PortalContact;

export function idealistaContactPhonesUrl(adId: string): string {
  return `${IDEALISTA_BASE_URL}/es/ajax/ads/${adId}/contact-phones`;
}

export function idealistaContactInfoUrl(adId: string): string {
  return `${IDEALISTA_BASE_URL}/es/ajax/listingController/adContactInfoForDetail.ajax?adId=${encodeURIComponent(adId)}`;
}

export function isIdealistaContactChallenge(body: string): boolean {
  return isAjaxContactChallenge(body);
}

export function parseIdealistaContactPhones(body: string): string[] {
  return parseContactPhonesAjax(body);
}

export function parseIdealistaContactInfo(body: string): IdealistaContact {
  return parseContactInfoAjax(body);
}

export function mergeIdealistaContact(
  ...parts: ReadonlyArray<IdealistaContact | undefined>
): IdealistaContact | undefined {
  return mergePortalContact(...parts);
}
