"use strict";
/**
 * milanuncios JSON parsers + housing guards.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.milanunciosSourceIdFromUrl = milanunciosSourceIdFromUrl;
exports.parseMilanunciosSearchJson = parseMilanunciosSearchJson;
exports.parseMilanunciosAdvert = parseMilanunciosAdvert;
exports.normalizeMilanunciosRaw = normalizeMilanunciosRaw;
const shared_types_1 = require("@homiio/shared-types");
const classifieds_1 = require("../../parse/classifieds");
const fixtures_1 = require("./fixtures");
const PROVIDER_ID = 'milanuncios';
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
        const parsed = Number.parseFloat(value.replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
function milanunciosSourceIdFromUrl(url) {
    return url.match(/(\d{6,})\.htm/i)?.[1] ?? url.match(/\/(\d{6,})\/?$/)?.[1];
}
function categoryFromRecord(record) {
    const nested = isRecord(record.category) ? record.category : undefined;
    const slug = asString(nested?.slug) ??
        asString(record.categorySlug) ??
        asString(record.category_name) ??
        asString(record.category) ??
        '';
    const id = asString(nested?.id) ?? asString(record.categoryId);
    return { slug, id };
}
function isAllowedCategory(slug, id) {
    const deaccent = slug
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (fixtures_1.MILANUNCIOS_HOUSING_CATEGORY_SLUGS.has(deaccent))
        return true;
    if (id && fixtures_1.MILANUNCIOS_HOUSING_CATEGORY_IDS.has(id))
        return true;
    return (0, classifieds_1.isHousingCategory)(slug);
}
/**
 * Parse a list/search AJAX JSON body into detail refs. Only housing-category
 * adverts are yielded.
 */
function parseMilanunciosSearchJson(body) {
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
    const adverts = [];
    if (Array.isArray(root)) {
        adverts.push(...root);
    }
    else if (isRecord(root)) {
        for (const key of ['adverts', 'ads', 'items', 'results', 'data', 'list']) {
            const value = root[key];
            if (Array.isArray(value)) {
                adverts.push(...value);
                break;
            }
            if (isRecord(value) && Array.isArray(value.adverts)) {
                adverts.push(...value.adverts);
                break;
            }
        }
    }
    const seen = new Set();
    const refs = [];
    for (const entry of adverts) {
        if (!isRecord(entry))
            continue;
        const { slug, id } = categoryFromRecord(entry);
        if (slug && !isAllowedCategory(slug, id))
            continue;
        const sourceId = asString(entry.id) ??
            asString(entry.advertId) ??
            (typeof entry.id === 'number' ? String(entry.id) : undefined);
        const url = asString(entry.url) ??
            asString(entry.detailUrl) ??
            (sourceId ? `${fixtures_1.MILANUNCIOS_BASE_URL}/alquiler-de-pisos/${sourceId}.htm` : undefined);
        if (!sourceId || !url || seen.has(sourceId))
            continue;
        seen.add(sourceId);
        refs.push({ sourceId, url });
    }
    return refs;
}
/** Parse a single advert JSON object into {@link MilanunciosRaw}. */
function parseMilanunciosAdvert(payload, fallbackUrl) {
    if (!isRecord(payload)) {
        throw new Error('milanuncios: advert payload is not an object');
    }
    const sourceId = asString(payload.id) ??
        asString(payload.advertId) ??
        (typeof payload.id === 'number' ? String(payload.id) : undefined);
    if (!sourceId)
        throw new Error('milanuncios: advert missing id');
    const { slug, id } = categoryFromRecord(payload);
    const url = asString(payload.url) ??
        asString(payload.detailUrl) ??
        fallbackUrl ??
        `${fixtures_1.MILANUNCIOS_BASE_URL}/anuncio/${sourceId}.htm`;
    const location = isRecord(payload.location) ? payload.location : undefined;
    const city = asString(location?.city) ?? asString(payload.city) ?? '';
    const price = asNumber(payload.price);
    if (price === undefined)
        throw new Error(`milanuncios: listing ${sourceId} has no price`);
    const operationRaw = asString(payload.operation)?.toLowerCase() ?? '';
    const operation = operationRaw.includes('sale') || operationRaw.includes('venta') || url.includes('venta-')
        ? 'sale'
        : 'rent';
    const imagesRaw = payload.images ?? payload.photos;
    const images = [];
    if (Array.isArray(imagesRaw)) {
        for (const img of imagesRaw) {
            if (typeof img === 'string')
                images.push(img);
            else if (isRecord(img)) {
                const u = asString(img.url) ?? asString(img.src);
                if (u)
                    images.push(u);
            }
        }
    }
    const contactRaw = isRecord(payload.contact) ? payload.contact : undefined;
    const phone = asString(contactRaw?.phone) ?? asString(payload.phone);
    const contact = phone
        ? {
            phone,
            agencyName: asString(contactRaw?.name) ?? asString(payload.agencyName),
            email: asString(contactRaw?.email),
            kind: 'unknown',
        }
        : undefined;
    return {
        sourceId,
        url,
        categorySlug: slug,
        categoryId: id,
        title: asString(payload.title) ?? asString(payload.subject) ?? `Listing ${sourceId}`,
        description: asString(payload.description),
        price,
        currency: asString(payload.currency) ?? 'EUR',
        operation,
        typology: asString(payload.typology) ?? asString(payload.propertyType) ?? slug,
        rooms: asNumber(payload.rooms) ?? asNumber(payload.bedrooms),
        bathrooms: asNumber(payload.bathrooms),
        squareMeters: asNumber(payload.size) ?? asNumber(payload.squareMeters) ?? asNumber(payload.m2),
        city,
        neighborhood: asString(location?.neighborhood) ?? asString(payload.neighborhood),
        province: asString(location?.province) ?? asString(payload.province),
        images,
        contact,
    };
}
function resolvePropertyType(typology) {
    const t = (typology ?? '').toLowerCase();
    if (t.includes('casa') || t.includes('chalet') || t.includes('house'))
        return shared_types_1.PropertyType.HOUSE;
    if (t.includes('estudio') || t.includes('studio'))
        return shared_types_1.PropertyType.STUDIO;
    if (t.includes('habitacion') || t.includes('room'))
        return shared_types_1.PropertyType.ROOM;
    return shared_types_1.PropertyType.APARTMENT;
}
function toRemoteImages(urls) {
    return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}
/**
 * Map a raw advert onto {@link NormalizedListing}, hard-rejecting non-housing.
 */
function normalizeMilanunciosRaw(raw) {
    (0, classifieds_1.assertHousingListing)(PROVIDER_ID, raw.sourceId, {
        category: raw.categorySlug,
        typology: raw.typology,
        squareMeters: raw.squareMeters,
        bedrooms: raw.rooms,
        bathrooms: raw.bathrooms,
        hasAddressLike: Boolean(raw.city || raw.neighborhood || raw.province),
        hasPrice: Number.isFinite(raw.price),
    });
    if (raw.categoryId && !fixtures_1.MILANUNCIOS_HOUSING_CATEGORY_IDS.has(raw.categoryId) && raw.categorySlug) {
        // id alone is not enough to reject when slug is housing; already checked above.
    }
    const isSale = raw.operation === 'sale';
    const result = {
        source: PROVIDER_ID,
        sourceId: raw.sourceId,
        sourceUrl: raw.url,
        address: {
            street: raw.neighborhood ?? raw.city,
            city: raw.city || raw.province || '',
            state: raw.province,
            neighborhood: raw.neighborhood,
            countryCode: 'ES',
        },
        type: resolvePropertyType(raw.typology),
        offerings: isSale ? [shared_types_1.OfferingType.SALE] : [shared_types_1.OfferingType.LONG_TERM_RENT],
        longTermRent: isSale ? undefined : { monthlyAmount: raw.price, currency: raw.currency },
        sale: isSale ? { price: raw.price, currency: raw.currency } : undefined,
        description: raw.description ?? raw.title,
        bedrooms: raw.rooms,
        bathrooms: raw.bathrooms,
        squareFootage: raw.squareMeters,
        remoteImages: toRemoteImages(raw.images),
        status: 'published',
    };
    if (raw.contact)
        result.contact = raw.contact;
    return result;
}
