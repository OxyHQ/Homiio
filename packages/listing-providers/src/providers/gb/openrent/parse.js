"use strict";
/**
 * OpenRent parsers (housing-native private-landlord rentals).
 *
 * Search yields `/property-to-rent/.../<id>` links. Detail pages expose rent in
 * `<title>` and images via og:image; contact is often form-gated (best-effort).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.openrentSourceIdFromUrl = openrentSourceIdFromUrl;
exports.openrentSearchUrl = openrentSearchUrl;
exports.parseOpenRentSearch = parseOpenRentSearch;
exports.parseOpenRentDetail = parseOpenRentDetail;
const contact_1 = require("../../../parse/contact");
const housing_1 = require("../housing");
const fixtures_1 = require("./fixtures");
const DETAIL_PATH_RE = /href="(\/property-to-rent\/[^"]+\/(\d+))"/gi;
function asNumber(value) {
    if (!value)
        return undefined;
    const parsed = Number.parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
}
function openrentSourceIdFromUrl(url) {
    const match = url.match(/\/(\d+)\/?$/);
    return match?.[1];
}
function openrentSearchUrl(city, page = 1) {
    const slug = city
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const base = `${fixtures_1.OPENRENT_BASE_URL}/properties-to-rent/${slug}`;
    return page <= 1 ? base : `${base}?page=${page}`;
}
function parseOpenRentSearch(html) {
    const byId = new Map();
    for (const match of html.matchAll(DETAIL_PATH_RE)) {
        const path = match[1];
        const sourceId = match[2];
        if (!path || !sourceId || byId.has(sourceId))
            continue;
        if (!(0, housing_1.isGbHousingType)(path))
            continue;
        byId.set(sourceId, `${fixtures_1.OPENRENT_BASE_URL}${path}`);
    }
    return [...byId.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}
function parseOpenRentDetail(html, url) {
    const sourceId = openrentSourceIdFromUrl(url);
    if (!sourceId) {
        throw new Error(`openrent: cannot parse source id from ${url}`);
    }
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]
        ?.replace(/&#xA3;/gi, '£')
        .replace(/&amp;/g, '&')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .trim();
    if (title && !(0, housing_1.isGbHousingType)(title)) {
        throw new Error(`openrent: non-housing listing rejected at ${url}`);
    }
    const rentMatch = title?.match(/£([\d,]+\.?\d*)\s*p\/m/i);
    const priceAmount = asNumber(rentMatch?.[1]);
    const bedsMatch = title?.match(/(\d+)\s*Bed/i);
    const bedrooms = bedsMatch ? Number.parseInt(bedsMatch[1], 10) : undefined;
    // "London - 1 Bed Flat, London, WC2N - To Rent..."
    let displayAddress;
    if (title) {
        const addr = title.match(/^\s*[^-]+-\s*(.+?)\s*-\s*To Rent/i);
        displayAddress = addr?.[1]?.trim();
    }
    const images = [
        ...new Set([...html.matchAll(/https:\/\/imagescdn\.openrent\.co\.uk\/listings\/\d+\/[^"'>\s]+/gi)].map((m) => m[0])),
    ];
    const telMatch = html.match(/href="tel:([^"]+)"/i);
    const mailMatch = html.match(/href="mailto:([^"]+)"/i);
    const waMatch = html.match(/https:\/\/wa\.me\/(\d+)/i);
    const contact = (0, contact_1.buildContact)({
        phone: telMatch?.[1],
        email: mailMatch?.[1],
        whatsapp: waMatch ? `https://wa.me/${waMatch[1]}` : undefined,
        agencyName: 'OpenRent landlord',
        kind: 'private',
    });
    const propertyType = title?.match(/\d+\s*Bed\s+([^,]+)/i)?.[1] ?? 'Flat';
    return {
        sourceId,
        url: url.startsWith('http') ? url : `${fixtures_1.OPENRENT_BASE_URL}${url}`,
        title,
        displayAddress,
        bedrooms: Number.isFinite(bedrooms) ? bedrooms : undefined,
        propertyType,
        priceAmount,
        priceCurrency: 'GBP',
        images,
        contact,
    };
}
