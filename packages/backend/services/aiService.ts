/**
 * AI Service — pure logic for OpenAI prompts, attachment parsing,
 * property-search helpers, and conversation title generation.
 * No req/res, no Express types.
 */

import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { PropertyFilters } from '@homiio/shared-types';

import { logger } from '../middlewares/logging';

// -------------------------------
// Types
// -------------------------------
export type Role = 'system' | 'user' | 'assistant' | 'tool';
export type ChatMessage = { role: Role; content: string; timestamp?: Date };

// -------------------------------
// Constants
// -------------------------------
export const MAX_FILE_MB = 25;
export const IMAGE_MAX_INLINE_MB = 20;
export const DEFAULT_LIST_LIMIT = 10;
export const NEARBY_LIMIT = 12;
export const RESULTS_RETURN_MAX = 5;

export const SINDI_SYSTEM_PROMPT = `
You are Sindi, an AI tenant-rights assistant for Homiio. Be concise, accurate, and pro-tenant.
- Prioritize tenant rights, fair housing, and current local law.
- Search Homiio properties first when asked for places to rent; then add rights tips.
- Prefer official sources and Sindicat de Llogateres for Catalonia queries.
- Keep answers short unless asked for detail.

Only if the user explicitly asks in their current message to search/show/find/browse listings or homes (for example: "find listings", "show me apartments", "browse rentals", "recommend some places"), include at the end of your reply a single machine-readable block listing ONLY the matching property IDs using this exact format and tag (no extra text inside):

<PROPERTIES_JSON>["propertyId1","propertyId2","propertyId3"]</PROPERTIES_JSON>

Rules for the properties block:
- Include at most 5 items.
  - If the user's current message DOES explicitly ask to search/show/find/browse listings or homes AND a <PROPERTIES_HINTS> object is present in the context, you MUST copy the array of IDs EXACTLY from the appropriate list into <PROPERTIES_JSON> (no re-ordering, no changes, no additions). Never fabricate or guess property IDs.
  - Choose the list based on the user's intent (semantics). Do not rely on specific keywords or language. If the request is about items similar/close to previously shown ones, use the "nearby" list; otherwise prefer "search".
- If the user's current message does NOT explicitly ask to search/show/find/browse listings or homes, DO NOT include a <PROPERTIES_JSON> block under any circumstance, even if a <PROPERTIES_HINT_JSON> is present.
- If NO <PROPERTIES_HINTS> is present, OMIT the <PROPERTIES_JSON> block entirely.
- Place the block at the very end of your reply on a new line.

Strict output discipline:
- Never mention or list any property IDs in normal visible text. Property IDs may appear ONLY inside the <PROPERTIES_JSON> block when conditions are met.
- Never invent placeholders or any made-up IDs. If you have no <PROPERTIES_HINT_JSON>, do not claim you found properties and do not output IDs.
- If asked to search but no hint is present, say you didn’t find matching properties yet and ask for preferences (budget, area), and OMIT the <PROPERTIES_JSON> block.
- You may use details from <PROPERTIES_CONTEXT> (title, location, rent, amenities, etc.) to write a better natural-language answer, but do not reveal or quote the tag itself. Do not print raw IDs or the JSON; only summarize in your own words.

Avoid repetition:
- Do not include <PROPERTIES_JSON> unless the user explicitly asks to find/show/search listings in the current turn.
- If the user is asking about rights, leases, or any non-search topic, omit the properties block.
- When the user asks for "others" or "closest/nearby", prefer properties that were NOT previously shown and select the nearest options first.
`.trim();

export const CONTRACT_SYSTEM_PROMPT =
  'You are a tenant-friendly contract and lease reviewer. You identify risky clauses, illegal terms (jurisdiction-aware at a high level), fees, early termination, maintenance, deposits, and notice periods. Provide brief, actionable advice and suggest questions to ask a landlord. Be concise.';

export const CONTRACT_SYSTEM_FILE_PROMPT =
  'You are a tenant-friendly contract and lease reviewer. Identify risky clauses, illegal terms, fees, early termination, maintenance, deposits, and notice periods. Provide brief, actionable advice and questions to ask a landlord. Be concise.';

export const IMG_SYSTEM_PROMPT =
  'You analyze tenant-related images (e.g., damages, notices) and produce a brief, actionable summary. Be concise and specific. If the image is unclear, ask for one brief clarification question.';

export const IMAGE_TAG_RE = /<IMAGE_DATA_URL>([\s\S]*?)<\/IMAGE_DATA_URL>/i;
export const FILE_TAG_RE = /<FILE_DATA_URL>([\s\S]*?)<\/FILE_DATA_URL>/i;

// -------------------------------
// Utilities
// -------------------------------
export function getBaseUrl() {
  return process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
}

export function parseDataUrl(dataUrl: string): { mediaType: string; buffer: Buffer } | null {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
    if (!match) return null;
    return { mediaType: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
  } catch (e) {
    logger.warn('parseDataUrl failed', { error: (e as Error)?.message });
    return null;
  }
}

export function extractLastPropertyIdsFromMessages(msgs: ChatMessage[]): string[] {
  for (const m of [...msgs].reverse()) {
    if (m.role !== 'assistant' || !m.content) continue;
    const match = m.content.match(/<PROPERTIES_JSON>([\s\S]*?)<\/PROPERTIES_JSON>/i);
    if (!match) continue;
    try {
      const arr = JSON.parse(match[1].trim());
      if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    } catch (e) {
      logger.warn('Failed to parse PROPERTIES_JSON from prior message', { error: (e as Error)?.message });
    }
  }
  return [];
}

export async function getPropertyById(id: string) {
  try {
    const resp = await fetch(`${getBaseUrl()}/api/properties/${id}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.data ?? data ?? null;
  } catch (e) {
    logger.warn('getPropertyById failed', { id, error: (e as Error)?.message });
    return null;
  }
}

function addIf(params: URLSearchParams, key: string, value: any) {
  if (value === undefined || value === null || value === '') return;
  params.set(key, String(value));
}

function addBool(params: URLSearchParams, key: string, value?: boolean) {
  if (typeof value === 'boolean') params.set(key, String(value));
}

function addArrayCSV(params: URLSearchParams, key: string, arr?: string[]) {
  if (Array.isArray(arr) && arr.length) params.set(key, arr.join(','));
}

export function buildSearchParams(
  filters: PropertyFilters,
  base: { limit?: number; query?: string; excludeIds?: string[] } = {},
) {
  const params = new URLSearchParams();
  if (base.query && base.query.trim()) params.set('query', base.query);
  params.set('limit', String(base.limit ?? DEFAULT_LIST_LIMIT));
  if (base.excludeIds?.length) params.set('excludeIds', base.excludeIds.join(','));

  addIf(params, 'type', filters.type);
  addIf(params, 'minRent', filters.minRent);
  addIf(params, 'maxRent', filters.maxRent);
  addIf(params, 'city', filters.city);
  addIf(params, 'state', filters.state);
  addIf(params, 'bedrooms', filters.bedrooms);
  addIf(params, 'bathrooms', filters.bathrooms);
  addArrayCSV(params, 'amenities', filters.amenities);
  addBool(params, 'hasPhotos', filters.hasPhotos || filters.hasImages);
  addBool(params, 'verified', filters.verified);
  addBool(params, 'eco', filters.eco);
  addBool(params, 'available', filters.available);
  addIf(params, 'housingType', filters.housingType);
  addIf(params, 'layoutType', filters.layoutType);
  addIf(params, 'furnishedStatus', filters.furnishedStatus);
  addBool(params, 'petFriendly', filters.petFriendly);
  addBool(params, 'utilitiesIncluded', filters.utilitiesIncluded);
  addIf(params, 'parkingType', filters.parkingType);
  addIf(params, 'petPolicy', filters.petPolicy);
  addIf(params, 'leaseTerm', filters.leaseTerm);
  addIf(params, 'offering', filters.offering);
  addBool(params, 'proximityToTransport', filters.proximityToTransport);
  addBool(params, 'proximityToSchools', filters.proximityToSchools);
  addBool(params, 'proximityToShopping', filters.proximityToShopping);
  addIf(params, 'availableFromBefore', filters.availableFromBefore);
  addIf(params, 'availableFromAfter', filters.availableFromAfter);
  addIf(params, 'minBedrooms', filters.minBedrooms);
  addIf(params, 'maxBedrooms', filters.maxBedrooms);
  addIf(params, 'minBathrooms', filters.minBathrooms);
  addIf(params, 'maxBathrooms', filters.maxBathrooms);
  addIf(params, 'minSquareFootage', filters.minSquareFootage);
  addIf(params, 'maxSquareFootage', filters.maxSquareFootage);
  addIf(params, 'minYearBuilt', filters.minYearBuilt);
  addIf(params, 'maxYearBuilt', filters.maxYearBuilt);
  addBool(params, 'budgetFriendly', filters.budgetFriendly);

  return params;
}

export function toAmenityFlags(p: any) {
  const out: string[] = [];
  const has = (...keys: string[]) =>
    keys.some(k => (Array.isArray(p.amenities) ? p.amenities.includes(k) : p[k] || p.features?.[k]));
  if (has('balcony', 'terrace')) out.push('balcony');
  if (has('pet_friendly', 'pets', 'petFriendly')) out.push('pet-friendly');
  if (has('furnished')) out.push('furnished');
  if (has('parking', 'garage')) out.push('parking');
  if (has('air_conditioning', 'ac')) out.push('AC');
  if (has('elevator', 'lift')) out.push('elevator');
  if (has('washer', 'laundry')) out.push('washer');
  if (has('dishwasher')) out.push('dishwasher');
  if (has('wifi', 'internet')) out.push('wifi');
  if (has('gym', 'fitness')) out.push('gym');
  return out.slice(0, 8);
}

export const compact = (o: Record<string, any>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// -------------------------------
// AI helpers
// -------------------------------
export async function generateAITitle(userMessage: string) {
  try {
    const result = await streamText({
      model: openai('gpt-4o'),
      system:
        "Generate a concise, descriptive title (≤50 chars) for a tenant-rights chat based on the first user message. Return ONLY the title, no quotes.",
      messages: [{ role: 'user', content: userMessage }],
      temperature: 0.3,
      maxTokens: 24,
    });

    let title = '';
    for await (const chunk of result.textStream) title += chunk;
    title = title.trim().replace(/^["']|["']$/g, '');
    if (title.length > 50) title = `${title.slice(0, 47)}...`;
    return title && title !== 'New Conversation' ? title : null;
  } catch (e) {
    logger.warn('generateAITitle failed', { error: (e as Error)?.message });
    return null;
  }
}

export async function extractFiltersWithAI(userText: string): Promise<PropertyFilters> {
  const instruction = `You extract structured search filters for rental properties from the user's message.
Return ONLY a compact JSON object with the allowed keys; omit unknown/empty fields.

Available keys and their types:
- type (string): property type like "apartment", "house", "room", etc.
- minRent, maxRent (number): price range
- city, state (string): location filters - IMPORTANT: extract city and state from location mentions
- bedrooms, bathrooms (number): exact number
- minBedrooms, maxBedrooms, minBathrooms, maxBathrooms (number): ranges
- amenities (array of strings): features like "balcony", "parking", "pet_friendly", etc.
- petFriendly, utilitiesIncluded, verified, eco, available (boolean): boolean filters

Examples:
"Find apartments in Barcelona" → {"city": "Barcelona"}
"What properties are in Granollers?" → {"city": "Granollers"}
"Que pisos hay en Granollers?" → {"city": "Granollers"}
"2 bedroom places in Madrid under 1500" → {"city": "Madrid", "bedrooms": 2, "maxRent": 1500}
"Pet friendly houses in California" → {"state": "California", "type": "house", "petFriendly": true}
"Properties in Barcelona with parking" → {"city": "Barcelona", "amenities": ["parking"]}

Important: For simple location questions like "What's in [city]?" or "Properties in [city]", 
just extract the city name. Don't add extra filters unless explicitly mentioned.

Focus on extracting clear location information from the user's query.`;

  try {
    const result = await streamText({
      model: openai('gpt-4o'),
      temperature: 0,
      system: instruction,
      messages: [{ role: 'user', content: String(userText || '') }],
      maxTokens: 256,
    });

    let text = '';
    for await (const chunk of result.textStream) text += chunk;
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return {};

    const raw = JSON.parse(trimmed.slice(start, end + 1));
    const out: PropertyFilters = {};

    const numberish = (v: any) => (v != null && !isNaN(Number(v)) ? Number(v) : undefined);
    const put = (k: keyof PropertyFilters, v: any) => {
      const valid = Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';
      if (valid) (out as any)[k] = v;
    };

    put('type', typeof raw.type === 'string' ? raw.type : undefined);
    put('minRent', numberish(raw.minRent));
    put('maxRent', numberish(raw.maxRent));
    put('city', typeof raw.city === 'string' ? raw.city : undefined);
    put('state', typeof raw.state === 'string' ? raw.state : undefined);
    put('bedrooms', numberish(raw.bedrooms));
    put('bathrooms', numberish(raw.bathrooms));
    put('minBedrooms', numberish(raw.minBedrooms));
    put('maxBedrooms', numberish(raw.maxBedrooms));
    put('minBathrooms', numberish(raw.minBathrooms));
    put('maxBathrooms', numberish(raw.maxBathrooms));
    put('minSquareFootage', numberish(raw.minSquareFootage));
    put('maxSquareFootage', numberish(raw.maxSquareFootage));
    put('minYearBuilt', numberish(raw.minYearBuilt));
    put('maxYearBuilt', numberish(raw.maxYearBuilt));
    put(
      'amenities',
      Array.isArray(raw.amenities)
        ? raw.amenities.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim())
        : undefined,
    );
    put('hasPhotos', typeof raw.hasPhotos === 'boolean' ? raw.hasPhotos : undefined);
    put('hasImages', typeof raw.hasImages === 'boolean' ? raw.hasImages : undefined);
    put('available', typeof raw.available === 'boolean' ? raw.available : undefined);
    put('verified', typeof raw.verified === 'boolean' ? raw.verified : undefined);
    put('eco', typeof raw.eco === 'boolean' ? raw.eco : undefined);
    put('budgetFriendly', typeof raw.budgetFriendly === 'boolean' ? raw.budgetFriendly : undefined);
    put('housingType', typeof raw.housingType === 'string' ? raw.housingType : undefined);
    put('layoutType', typeof raw.layoutType === 'string' ? raw.layoutType : undefined);
    put('furnishedStatus', typeof raw.furnishedStatus === 'string' ? raw.furnishedStatus : undefined);
    put('petFriendly', typeof raw.petFriendly === 'boolean' ? raw.petFriendly : undefined);
    put('utilitiesIncluded', typeof raw.utilitiesIncluded === 'boolean' ? raw.utilitiesIncluded : undefined);
    put('parkingType', typeof raw.parkingType === 'string' ? raw.parkingType : undefined);
    put('petPolicy', typeof raw.petPolicy === 'string' ? raw.petPolicy : undefined);
    put('leaseTerm', typeof raw.leaseTerm === 'string' ? raw.leaseTerm : undefined);
    put('offering', typeof raw.offering === 'string' ? raw.offering : undefined);
    put('proximityToTransport', typeof raw.proximityToTransport === 'boolean' ? raw.proximityToTransport : undefined);
    put('proximityToSchools', typeof raw.proximityToSchools === 'boolean' ? raw.proximityToSchools : undefined);
    put('proximityToShopping', typeof raw.proximityToShopping === 'boolean' ? raw.proximityToShopping : undefined);
    put('availableFromBefore', typeof raw.availableFromBefore === 'string' ? raw.availableFromBefore : undefined);
    put('availableFromAfter', typeof raw.availableFromAfter === 'string' ? raw.availableFromAfter : undefined);

    return out;
  } catch (e) {
    logger.warn('extractFiltersWithAI failed', { error: (e as Error)?.message });
    return {};
  }
}

export async function performAppPropertySearch(query: string, priorMessages: ChatMessage[]) {
  try {
    const prevIds = extractLastPropertyIdsFromMessages(priorMessages);
    const filters = await extractFiltersWithAI(query);

    // Determine if this is a location-based search or text search
    const isLocationSearch = filters.city || filters.state;
    const hasTextualSearchTerms = /\b(furnished|pet|parking|balcony|pool|gym|modern|luxury|cheap|budget)\b/i.test(query);

    // For location searches, don't pass the full query as text search
    const searchQuery = isLocationSearch && !hasTextualSearchTerms ? undefined : query;

    // Nearby (anchor on previous shown property)
    let nearby: any[] = [];
    if (prevIds.length) {
      const anchor = await getPropertyById(prevIds[0]);
      const coords: number[] | null = anchor?.address?.coordinates?.coordinates || null;
      if (coords?.length === 2) {
        const [longitude, latitude] = coords;
        const params = buildSearchParams(filters, {
          limit: NEARBY_LIMIT,
          excludeIds: prevIds,
        });
        params.set('longitude', String(longitude));
        params.set('latitude', String(latitude));
        params.set('maxDistance', '3000');

        const resp = await fetch(`${getBaseUrl()}/api/properties/nearby?${params.toString()}`);
        if (resp.ok) {
          const data = await resp.json();
          nearby = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        } else {
          logger.warn('Nearby search request failed', { status: resp.status });
        }
      }
    }

    // Search
    const searchParams = buildSearchParams(filters, {
      limit: DEFAULT_LIST_LIMIT,
      query: searchQuery || '',
      excludeIds: prevIds,
    });
    const resp = await fetch(`${getBaseUrl()}/api/properties/search?${searchParams.toString()}`);
    const searchData = resp.ok ? await resp.json() : null;

    const search = Array.isArray(searchData?.data) ? searchData.data : Array.isArray(searchData) ? searchData : [];

    return { nearby: nearby.slice(0, RESULTS_RETURN_MAX), search: search.slice(0, RESULTS_RETURN_MAX) };
  } catch (e) {
    logger.warn('performAppPropertySearch failed', { error: (e as Error)?.message });
    return { nearby: [], search: [] };
  }
}
