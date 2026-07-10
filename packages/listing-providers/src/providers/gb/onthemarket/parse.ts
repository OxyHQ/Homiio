/**
 * OnTheMarket JSON parsers (pure).
 *
 * Detail pages embed listing JSON in `__NEXT_DATA__.props.initialReduxState.property`.
 * Search pages expose `/details/<id>` links; housing-only filter rejects garages etc.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../parse/contact';
import { asNumberUs as asNumber, asString, isRecord } from '../../../parse/guards';
import { stripHtmlToPlainText } from '../../../parse/htmlText';
import { parseNextData } from '../../../parse/nextData';
import { isGbHousingType, isOtmHousingPropSubId, rejectGbNonHousing } from '../housing';
import { ONTHEMARKET_BASE_URL } from './fixtures';

const DETAIL_ID_RE = /\/details\/(\d+)/g;


export interface OnTheMarketListingJson {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
  displayAddress?: string;
  addressLocality?: string;
  summary?: string;
  description?: string;
  bedrooms?: number;
  bathrooms?: number;
  propertyType?: string;
  propSubId?: string;
  priceAmount?: number;
  priceCurrency?: string;
  latitude?: number;
  longitude?: number;
  images: string[];
  contact?: NormalizedListingContact;
}

export function onthemarketSourceIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/details\/(\d+)/i);
  return match?.[1];
}

export function onthemarketDetailUrl(sourceId: string): string {
  return `${ONTHEMARKET_BASE_URL}/details/${sourceId}/`;
}

export function onthemarketSearchUrl(city: string, page = 1): string {
  const slug = city
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = `${ONTHEMARKET_BASE_URL}/to-rent/property/${slug}/`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

/** De-duplicated housing detail refs from a search HTML page. */
export function parseOnTheMarketSearch(html: string): { sourceId: string; url: string }[] {
  const byId = new Map<string, string>();
  for (const match of html.matchAll(/<a[^>]+href="(\/details\/(\d+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const sourceId = match[2];
    const label = match[3]?.replace(/<[^>]+>/g, ' ') ?? '';
    if (!sourceId || byId.has(sourceId)) continue;
    if (!isGbHousingType(label) || /garage|parking|storage/i.test(label)) continue;
    byId.set(sourceId, onthemarketDetailUrl(sourceId));
  }
  // Fallback: bare /details/ids when anchors lack labels — still filter by nearby context.
  if (byId.size === 0) {
    for (const match of html.matchAll(DETAIL_ID_RE)) {
      const sourceId = match[1];
      if (!sourceId || byId.has(sourceId)) continue;
      const index = match.index ?? 0;
      const context = html.slice(Math.max(0, index - 200), index + 200);
      if (!isGbHousingType(context) || /garage|parking|storage/i.test(context)) continue;
      byId.set(sourceId, onthemarketDetailUrl(sourceId));
    }
  }
  return [...byId.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}

function imagesFromProperty(prop: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (Array.isArray(prop.images)) {
    for (const image of prop.images) {
      if (!isRecord(image)) continue;
      const url = asString(image.largeUrl) ?? asString(image.url);
      if (url?.startsWith('http')) out.push(url);
    }
  }
  return out;
}

function contactFromProperty(prop: Record<string, unknown>): NormalizedListingContact | undefined {
  const agent = isRecord(prop.agent) ? prop.agent : undefined;
  return buildContact({
    phone: agent
      ? asString(agent.telephone) ?? asString(agent.telephoneEnquiries)
      : undefined,
    whatsapp: asString(prop.whatsappLink),
    agencyName: agent
      ? asString(agent.name) ?? asString(agent.companyName)
      : undefined,
    kind: 'agency',
  });
}

function priceAmountFromProperty(prop: Record<string, unknown>): number | undefined {
  // For lettings priceRaw is monthly when shortPrice is pcm; for garages it can be weekly.
  const priceText = asString(prop.price) ?? asString(prop.shortPrice) ?? '';
  const pcm = priceText.match(/£([\d,]+)\s*pcm/i);
  if (pcm?.[1]) return asNumber(pcm[1]);
  const raw = asNumber(prop.priceRaw);
  if (raw !== undefined && /pcm/i.test(priceText)) return raw;
  if (raw !== undefined && !/pw\b/i.test(priceText)) return raw;
  return asNumber(prop.priceRaw);
}

/** Parse detail `__NEXT_DATA__` redux property JSON. */
export function parseOnTheMarketDetail(html: string, url: string): OnTheMarketListingJson {
  const parsed = parseNextData(html);
  if (!parsed) {
    throw new Error(`onthemarket: no __NEXT_DATA__ at ${url}`);
  }
  const props = parsed.props;
  const redux = isRecord(props) ? props.initialReduxState : undefined;
  const prop = isRecord(redux) && isRecord(redux.property) ? redux.property : undefined;
  if (!prop) {
    throw new Error(`onthemarket: missing property redux state at ${url}`);
  }

  const sourceId =
    asString(prop.id) ??
    (asNumber(prop.id) !== undefined ? String(Math.trunc(asNumber(prop.id)!)) : undefined) ??
    onthemarketSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`onthemarket: missing listing id at ${url}`);
  }

  const propSubId = asString(prop.propSubId);
  const humanised = asString(prop.humanisedPropertyType);
  if (!isOtmHousingPropSubId(propSubId)) {
    rejectGbNonHousing('onthemarket', sourceId, `propSubId "${propSubId ?? ''}"`);
  }
  if (!isGbHousingType(humanised)) {
    rejectGbNonHousing('onthemarket', sourceId, `property type "${humanised ?? ''}"`);
  }

  const location = isRecord(prop.location) ? prop.location : undefined;
  const toRent = prop.toRent === true || asString(prop.searchType) === 'to-rent';
  const descriptionHtml = asString(prop.description);
  const description =
    stripHtmlToPlainText(descriptionHtml) ?? stripHtmlToPlainText(asString(prop.summary));

  return {
    sourceId,
    url: onthemarketDetailUrl(sourceId),
    kind: toRent ? 'rent' : 'sale',
    displayAddress: asString(prop.displayAddress),
    addressLocality: asString(prop.addressLocality),
    summary: asString(prop.summary),
    description,
    bedrooms: asNumber(prop.bedrooms),
    bathrooms: asNumber(prop.bathrooms),
    propertyType: humanised,
    propSubId,
    priceAmount: priceAmountFromProperty(prop),
    priceCurrency: 'GBP',
    latitude: location ? asNumber(location.lat) : undefined,
    longitude: location ? asNumber(location.lon) : undefined,
    images: imagesFromProperty(prop),
    contact: contactFromProperty(prop),
  };
}
