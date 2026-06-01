import { z } from 'zod';
import {
  OfferingType,
  PropertyStatus,
  PropertyType,
  UtilitiesIncluded,
} from '@homiio/shared-types';
import type { Property } from '@homiio/shared-types';
import { logger } from '@/utils/logger';

/**
 * Parsing + validation helpers for structured payloads embedded in Sindi chat
 * messages.
 *
 * Sindi (the AI assistant) can embed three kinds of structured content inside
 * an otherwise plain-text message:
 *
 *   1. `<PROPERTIES_JSON>[...ids]</PROPERTIES_JSON>` — a JSON array of property
 *      IDs the model wants rendered as cards. Parsed + sanitised by
 *      {@link normalizePropertyIds} and validated by {@link PropertyIdsSchema}.
 *   2. `PROPERTY SEARCH RESULTS:` system messages — a legacy plain-text list of
 *      `- Title (type, price), city` lines. Parsed by {@link parseSearchResultLines}.
 *   3. `<IMAGE_DATA_URL>…</IMAGE_DATA_URL>` / `<FILE_DATA_URL>…</FILE_DATA_URL>`
 *      tags carrying an uploaded attachment — stripped from the visible bubble
 *      text by {@link stripAttachmentDataUrls}.
 *
 * Keeping all of this in one module means the message-rendering components stay
 * declarative and the (regex-heavy, error-prone) parsing is unit-testable in
 * isolation.
 */

const PROPERTIES_JSON_START = '<PROPERTIES_JSON>';
const PROPERTIES_JSON_END = '</PROPERTIES_JSON>';

const PROPERTY_SEARCH_RESULTS_PREFIX = 'PROPERTY SEARCH RESULTS:';
const SEARCH_RESULT_LINE_PREFIX = '- ';

/** Maximum number of property ID cards rendered from a single model message. */
const MAX_PROPERTY_IDS = 5;

/** Minimum length for a slug-like ID to be considered non-junk. */
const MIN_SLUG_LENGTH = 6;

const OBJECT_ID_REGEX = /^[a-f0-9]{24}$/i;
const SLUG_LIKE_REGEX = new RegExp(`^[A-Za-z0-9_-]{${MIN_SLUG_LENGTH},}$`, 'i');
const ID_SEPARATOR_REGEX = /[\s,/]+/;

const IMAGE_DATA_URL_REGEX = /<IMAGE_DATA_URL>[\s\S]*?<\/IMAGE_DATA_URL>/i;
const FILE_DATA_URL_REGEX = /<FILE_DATA_URL>[\s\S]*?<\/FILE_DATA_URL>/i;

/** Defaults for the synthetic {@link Property} objects built from legacy search lines. */
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_PROPERTY_TYPE = PropertyType.APARTMENT;
const DEFAULT_UTILITIES = UtilitiesIncluded.EXCLUDED;
const DEFAULT_PROPERTY_STATUS = PropertyStatus.PUBLISHED;
const DEFAULT_ROOM_COUNT = 1;

/** Accepts the raw shapes the model may emit inside `<PROPERTIES_JSON>`. */
export const PropertyIdsSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.union([z.string(), z.number()])),
]);

/**
 * Whether a token looks like a usable property identifier (ObjectId or clean
 * slug) rather than model noise.
 */
function isUsableId(token: string): boolean {
  if (!token) return false;
  if (OBJECT_ID_REGEX.test(token)) return true;
  return SLUG_LIKE_REGEX.test(token) && !token.includes('/') && !token.includes(' ');
}

/**
 * Normalise and sanitise property IDs coming from model output. Splits
 * accidental concatenations (`a/b`, `a, b`), filters junk tokens, dedupes, and
 * caps to {@link MAX_PROPERTY_IDS}.
 */
export function normalizePropertyIds(raw: unknown, max = MAX_PROPERTY_IDS): string[] {
  const tokens: string[] = [];

  const pushToken = (value: string): void => {
    const trimmed = value.trim();
    if (isUsableId(trimmed)) tokens.push(trimmed);
  };

  const ingest = (value: string | number): void => {
    String(value)
      .split(ID_SEPARATOR_REGEX)
      .forEach(pushToken);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' || typeof item === 'number') ingest(item);
    }
  } else if (typeof raw === 'string' || typeof raw === 'number') {
    ingest(raw);
  }

  const deduped: string[] = [];
  for (const id of tokens) {
    if (!deduped.includes(id)) deduped.push(id);
  }
  return deduped.slice(0, max);
}

export interface ParsedPropertiesContent {
  /** Message text with the `<PROPERTIES_JSON>` block removed. */
  visible: string;
  /** Sanitised property IDs, or `null` when none were present/valid. */
  ids: string[] | null;
}

/**
 * Extract a `<PROPERTIES_JSON>` block from a message, returning the visible
 * text (block removed) and the sanitised ID list. When no valid block is found
 * the original content is returned with `ids: null`.
 */
export function extractPropertiesJson(content: string): ParsedPropertiesContent {
  const startIdx = content.indexOf(PROPERTIES_JSON_START);
  const endIdx = content.indexOf(PROPERTIES_JSON_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { visible: content, ids: null };
  }

  const jsonStr = content
    .substring(startIdx + PROPERTIES_JSON_START.length, endIdx)
    .trim();
  const visible = (
    content.substring(0, startIdx) +
    content.substring(endIdx + PROPERTIES_JSON_END.length)
  ).trim();

  const result = PropertyIdsSchema.safeParse(safeJsonParse(jsonStr));
  if (!result.success) {
    return { visible, ids: null };
  }

  const ids = normalizePropertyIds(result.data);
  return { visible, ids: ids.length > 0 ? ids : null };
}

/**
 * `JSON.parse` that returns `undefined` instead of throwing on malformed input.
 * Malformed payloads are expected mid-stream (the model emits partial JSON), so
 * the failure is logged at debug level rather than surfaced as an error.
 */
function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    logger.debug('Failed to parse PROPERTIES_JSON payload:', error);
    return undefined;
  }
}

/** Whether a message is a legacy `PROPERTY SEARCH RESULTS:` system payload. */
export function isPropertySearchResults(role: string, content: string): boolean {
  return role === 'system' && content.startsWith(PROPERTY_SEARCH_RESULTS_PREFIX);
}

const SEARCH_RESULT_LINE_REGEX = /^- (.*?) \((.*?)(?:,\s*([^)]+))?\)(?:,\s*(.*))?$/;

/**
 * Parse the legacy `PROPERTY SEARCH RESULTS:` plain-text list into synthetic
 * {@link Property} objects suitable for {@link PropertyCard}. Lines that do not
 * match the expected `- Title (type, price), city` shape are skipped.
 */
export function parseSearchResultLines(content: string): Property[] {
  return content
    .split('\n')
    .filter((line) => line.startsWith(SEARCH_RESULT_LINE_PREFIX))
    .map((line, index) => {
      const match = line.match(SEARCH_RESULT_LINE_REGEX);
      if (!match) return null;

      const [, title, type, priceRaw, cityRaw] = match;
      const price = Number.parseFloat(priceRaw || '0');
      const city = cityRaw || '';
      const id = `${title}-${city}` || `temp-${index}`;

      return buildSyntheticProperty({
        id,
        type,
        price: Number.isFinite(price) ? price : 0,
        city,
      });
    })
    .filter((property): property is Property => property !== null);
}

interface SyntheticPropertyInput {
  id: string;
  type: string;
  price: number;
  city: string;
}

const PROPERTY_TYPE_VALUES = new Set<string>(Object.values(PropertyType));

/** Coerce a raw type string from a search line to a valid {@link PropertyType}. */
function toPropertyType(raw: string): PropertyType {
  const normalized = raw.trim().toLowerCase();
  return PROPERTY_TYPE_VALUES.has(normalized)
    ? (normalized as PropertyType)
    : DEFAULT_PROPERTY_TYPE;
}

/**
 * Build a minimal but type-complete {@link Property} from a parsed search line.
 * Only the fields {@link PropertyCard} reads are populated; the rest use neutral
 * defaults so the object satisfies the shared `Property` contract.
 */
function buildSyntheticProperty({ id, type, price, city }: SyntheticPropertyInput): Property {
  const now = new Date().toISOString();
  return {
    _id: id,
    id,
    type: toPropertyType(type),
    // Synthetic search-line listings are long-term rentals — the only price the
    // legacy line carries is a monthly figure.
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: {
      monthlyAmount: price,
      currency: DEFAULT_CURRENCY,
      deposit: 0,
      utilities: DEFAULT_UTILITIES,
    },
    // Synthetic line: only the resolved display NAME is known (geo is
    // relational; there are no real geo ids for an AI-parsed search line).
    address: {
      street: '',
      postal_code: '',
      countryCode: '',
      countryId: '',
      regionId: '',
      cityId: '',
      cityName: city,
      location: city,
    },
    status: DEFAULT_PROPERTY_STATUS,
    bedrooms: DEFAULT_ROOM_COUNT,
    bathrooms: DEFAULT_ROOM_COUNT,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Remove `<IMAGE_DATA_URL>`/`<FILE_DATA_URL>` attachment tags from user message
 * text so the embedded base64 payload is never rendered. Falls back to the raw
 * content if stripping leaves an empty string.
 */
export function stripAttachmentDataUrls(content: string): string {
  const stripped = (content || '')
    .replace(IMAGE_DATA_URL_REGEX, '')
    .replace(FILE_DATA_URL_REGEX, '')
    .trim();
  return stripped || content;
}
