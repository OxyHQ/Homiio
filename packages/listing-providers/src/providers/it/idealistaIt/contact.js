"use strict";
/**
 * Idealista.it contact AJAX helpers (pure).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeIdealistaItContact = void 0;
exports.idealistaItContactPhonesUrl = idealistaItContactPhonesUrl;
exports.idealistaItContactInfoUrl = idealistaItContactInfoUrl;
exports.isIdealistaItContactChallenge = isIdealistaItContactChallenge;
exports.parseIdealistaItContactPhones = parseIdealistaItContactPhones;
exports.parseIdealistaItContactInfo = parseIdealistaItContactInfo;
const contact_1 = require("../../../parse/contact");
Object.defineProperty(exports, "mergeIdealistaItContact", { enumerable: true, get: function () { return contact_1.mergeContact; } });
const fixtures_1 = require("./fixtures");
function idealistaItContactPhonesUrl(adId) {
    return `${fixtures_1.IDEALISTA_IT_BASE_URL}/it/ajax/ads/${adId}/contact-phones`;
}
function idealistaItContactInfoUrl(adId) {
    return `${fixtures_1.IDEALISTA_IT_BASE_URL}/it/ajax/listingController/adContactInfoForDetail.ajax?adId=${encodeURIComponent(adId)}`;
}
function isIdealistaItContactChallenge(body) {
    const trimmed = body.trim();
    if (trimmed.length === 0)
        return true;
    return /captcha-delivery\.com|geo\.captcha|datadome|accesso negato/i.test(trimmed);
}
function parseIdealistaItContactPhones(body) {
    if (isIdealistaItContactChallenge(body))
        return [];
    const trimmed = body.trim();
    try {
        const parsed = JSON.parse(trimmed);
        const phones = [];
        const walk = (value) => {
            if (typeof value === 'string' || typeof value === 'number') {
                const phone = (0, contact_1.normalizePhone)(String(value));
                if (phone)
                    phones.push(phone);
                return;
            }
            if (Array.isArray(value)) {
                for (const entry of value)
                    walk(entry);
                return;
            }
            if (typeof value === 'object' && value !== null) {
                const record = value;
                for (const key of Object.keys(record))
                    walk(record[key]);
            }
        };
        walk(parsed);
        return [...new Set(phones)];
    }
    catch {
        const phone = (0, contact_1.normalizePhone)(trimmed);
        return phone ? [phone] : [];
    }
}
function parseIdealistaItContactInfo(body) {
    if (isIdealistaItContactChallenge(body))
        return undefined;
    try {
        return (0, contact_1.contactFromAdvertiser)(JSON.parse(body.trim()));
    }
    catch {
        return undefined;
    }
}
