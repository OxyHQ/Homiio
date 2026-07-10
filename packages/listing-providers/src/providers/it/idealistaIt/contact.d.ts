/**
 * Idealista.it contact AJAX helpers (pure).
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
import { mergeContact } from '../../../parse/contact';
export declare function idealistaItContactPhonesUrl(adId: string): string;
export declare function idealistaItContactInfoUrl(adId: string): string;
export declare function isIdealistaItContactChallenge(body: string): boolean;
export declare function parseIdealistaItContactPhones(body: string): string[];
export declare function parseIdealistaItContactInfo(body: string): NormalizedListingContact | undefined;
export { mergeContact as mergeIdealistaItContact };
