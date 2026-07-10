/**
 * Re-export shared contact helpers — canonical impl in {@link ./parse/contact}.
 */

export {
  normalizePhone,
  normalizeWhatsapp,
  normalizeEmail,
  isAjaxContactChallenge,
  parseContactPhonesAjax,
  parseContactPhonesJson,
  contactFromRecord,
  parseContactInfoAjax,
  buildContact,
  toNormalizedListingContact,
  mergePortalContact,
  mergeContact,
  mergeListingContact,
  contactFromAdvertiser,
  contactFromUnknown,
  contactFromAjaxBody,
  extractContactFromHtml,
  hasContactFields,
  type PortalContact,
  type ListingContact,
} from './parse/contact';
