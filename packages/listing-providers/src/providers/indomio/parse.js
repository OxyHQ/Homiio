"use strict";
/**
 * indomio.es JSON parsers (pure).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.indomioSourceIdFromUrl = indomioSourceIdFromUrl;
exports.parseIndomioSearchJson = parseIndomioSearchJson;
exports.parseIndomioDetailJson = parseIndomioDetailJson;
exports.normalizeIndomioRaw = normalizeIndomioRaw;
const shared_types_1 = require("@homiio/shared-types");
const fixtures_1 = require("./fixtures");
const PROVIDER_ID = 'indomio';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
function indomioSourceIdFromUrl(url) {
    return url.match(/\/(?:anuncio|inmueble)\/(\d+)/)?.[1] ?? url.match(/\/(\d{5,})\/?$/)?.[1];
}
function parseIndomioSearchJson(body) {
    const trimmed = body.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('['))
        return [];
    let root;
    try {
        root = JSON.parse(trimmed);
    }
    catch {
        return [];
    }
    const items = [];
    if (Array.isArray(root))
        items.push(...root);
    else if (isRecord(root)) {
        for (const key of ['listings', 'results', 'items', 'ads', 'data']) {
            if (Array.isArray(root[key])) {
                items.push(...root[key]);
                break;
            }
        }
    }
    const seen = new Set();
    const refs = [];
    for (const entry of items) {
        if (!isRecord(entry))
            continue;
        const sourceId = asString(entry.id) ?? (typeof entry.id === 'number' ? String(entry.id) : undefined);
        const url = asString(entry.url) ??
            (sourceId ? `${fixtures_1.INDOMIO_BASE_URL}/anuncio/${sourceId}/` : undefined);
        if (!sourceId || !url || seen.has(sourceId))
            continue;
        seen.add(sourceId);
        refs.push({ sourceId, url });
    }
    return refs;
}
function parseIndomioDetailJson(payload, fallbackUrl) {
    if (!isRecord(payload))
        throw new Error('indomio: detail payload is not an object');
    const sourceId = asString(payload.id) ?? (typeof payload.id === 'number' ? String(payload.id) : undefined);
    if (!sourceId)
        throw new Error('indomio: missing id');
    const price = asNumber(payload.price);
    if (price === undefined)
        throw new Error(`indomio: listing ${sourceId} has no price`);
    const address = isRecord(payload.address) ? payload.address : undefined;
    const city = asString(address?.city) ?? asString(payload.city) ?? '';
    if (!city)
        throw new Error(`indomio: listing ${sourceId} has no city`);
    const images = [];
    if (Array.isArray(payload.images)) {
        for (const img of payload.images) {
            if (typeof img === 'string')
                images.push(img);
        }
    }
    const contactRaw = isRecord(payload.contact) ? payload.contact : undefined;
    const phone = asString(contactRaw?.phone);
    const contact = phone
        ? {
            phone,
            agencyName: asString(contactRaw?.agencyName) ?? asString(contactRaw?.name),
            kind: 'agency',
        }
        : undefined;
    const operationRaw = asString(payload.operation)?.toLowerCase() ?? 'rent';
    return {
        sourceId,
        url: asString(payload.url) ?? fallbackUrl ?? `${fixtures_1.INDOMIO_BASE_URL}/anuncio/${sourceId}/`,
        title: asString(payload.title) ?? `Listing ${sourceId}`,
        description: asString(payload.description),
        price,
        currency: asString(payload.currency) ?? 'EUR',
        operation: operationRaw.includes('sale') || operationRaw.includes('venta') ? 'sale' : 'rent',
        rooms: asNumber(payload.rooms) ?? asNumber(payload.bedrooms),
        bathrooms: asNumber(payload.bathrooms),
        squareMeters: asNumber(payload.size) ?? asNumber(payload.squareMeters),
        street: asString(address?.street) ?? city,
        city,
        province: asString(address?.province),
        neighborhood: asString(address?.neighborhood),
        images,
        contact,
    };
}
function normalizeIndomioRaw(raw) {
    const isSale = raw.operation === 'sale';
    const result = {
        source: PROVIDER_ID,
        sourceId: raw.sourceId,
        sourceUrl: raw.url,
        address: {
            street: raw.street,
            city: raw.city,
            state: raw.province,
            neighborhood: raw.neighborhood,
            countryCode: 'ES',
        },
        type: shared_types_1.PropertyType.APARTMENT,
        offerings: isSale ? [shared_types_1.OfferingType.SALE] : [shared_types_1.OfferingType.LONG_TERM_RENT],
        longTermRent: isSale ? undefined : { monthlyAmount: raw.price, currency: raw.currency },
        sale: isSale ? { price: raw.price, currency: raw.currency } : undefined,
        description: raw.description ?? raw.title,
        bedrooms: raw.rooms,
        bathrooms: raw.bathrooms,
        squareFootage: raw.squareMeters,
        remoteImages: raw.images.map((url, index) => ({ url, isPrimary: index === 0 })),
        status: 'published',
    };
    if (raw.contact)
        result.contact = raw.contact;
    return result;
}
