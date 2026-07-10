"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGbHousingType = isGbHousingType;
exports.isOtmHousingPropSubId = isOtmHousingPropSubId;
exports.resolveGbPropertyType = resolveGbPropertyType;
const shared_types_1 = require("@homiio/shared-types");
/** Property-type / subtype tokens that are NOT residential housing. */
const NON_HOUSING_RE = /\b(garage|parking|car\s*park|storage|land|plot|commercial|office|retail|shop|warehouse|industrial|farm|equestrian|mobile\s*home|park\s*home|boat|mooring|garage\s*parking)\b/i;
/** OnTheMarket `propSubId` values that are non-housing. */
const NON_HOUSING_PROP_SUB_IDS = new Set([
    'garages',
    'garage',
    'parking',
    'land',
    'commercial',
    'farms',
    'farm',
]);
/** True when a free-text property type / title looks like residential housing. */
function isGbHousingType(raw) {
    if (!raw || raw.trim().length === 0)
        return true;
    return !NON_HOUSING_RE.test(raw);
}
/** True when an OnTheMarket propSubId is residential housing. */
function isOtmHousingPropSubId(propSubId) {
    if (!propSubId)
        return true;
    return !NON_HOUSING_PROP_SUB_IDS.has(propSubId.toLowerCase());
}
/** Map UK portal property-type strings onto Homiio PropertyType. */
function resolveGbPropertyType(raw) {
    const lower = (raw ?? '').toLowerCase();
    if (/\bstudio\b/.test(lower))
        return shared_types_1.PropertyType.STUDIO;
    if (/\broom\b|shared/.test(lower))
        return shared_types_1.PropertyType.ROOM;
    if (/\b(house|bungalow|cottage|detached|semi|terraced|townhouse|maisonette)\b/.test(lower)) {
        return shared_types_1.PropertyType.HOUSE;
    }
    return shared_types_1.PropertyType.APARTMENT;
}
