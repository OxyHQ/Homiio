/**
 * AI Routes — streaming, search, conversations (refactor)
 */

import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

// CJS model exports (mantengo CJS si tus modelos están así)
const Profile = require('../models/schemas/ProfileSchema');
const Conversation = require('../models/schemas/ConversationSchema');

// -------------------------------
// Types
// -------------------------------
type Role = 'system' | 'user' | 'assistant' | 'tool';
type ChatMessage = { role: Role; content: string; timestamp?: Date };

type PropertyFilters = Partial<{
  type: string;
  minRent: number;
  maxRent: number;
  city: string;
  state: string;
  bedrooms: number;
  bathrooms: number;
  minBedrooms: number;
  maxBedrooms: number;
  minBathrooms: number;
  maxBathrooms: number;
  minSquareFootage: number;
  maxSquareFootage: number;
  minYearBuilt: number;
  maxYearBuilt: number;
  amenities: string[];
  hasPhotos: boolean;
  hasImages: boolean; // alias of hasPhotos
  available: boolean;
  verified: boolean;
  eco: boolean;
  budgetFriendly: boolean;
  housingType: string;
  layoutType: string;
  furnishedStatus: string;
  petFriendly: boolean;
  utilitiesIncluded: boolean;
  parkingType: string;
  petPolicy: string;
  leaseTerm: string;
  priceUnit: string;
  proximityToTransport: boolean;
  proximityToSchools: boolean;
  proximityToShopping: boolean;
  availableFromBefore: string;
  availableFromAfter: string;
}>;

// -------------------------------
// Constants
// -------------------------------
const MAX_FILE_MB = 25;
const IMAGE_MAX_INLINE_MB = 20;
const DEFAULT_LIST_LIMIT = 10;
const NEARBY_LIMIT = 12;
const RESULTS_RETURN_MAX = 5;

const SINDI_SYSTEM_PROMPT = `
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

// -------------------------------
/** Utilities */
// -------------------------------
const isObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);
const getUserId = (req: any) => req.user?.oxyUserId || req.user?._id || req.user?.id;
const getBaseUrl = () => {
  const baseUrl = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
  console.log('AI API Base URL:', baseUrl);
  return baseUrl;
};

const ok = (res: Response, data: any) => res.json(data);
const err = (res: Response, code: number, message: string) => res.status(code).json({ error: message });

const sendEmptyStream = async (res: Response) => {
  const result = streamText({
    model: openai('gpt-4o'),
    temperature: 0,
    system: 'Return an empty response. Do not output any characters.',
    messages: [{ role: 'user', content: '' }],
    maxTokens: 1,
  } as any);
  (await result).pipeDataStreamToResponse(res);
};

const setStreamingHeaders = (res: Response) => {
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  (res as any).setTimeout?.(0);
};

const onGracefulClose = (req: Request, res: Response) => {
  const onClose = () => {
    try {
  (res as any).end?.();
    } catch {}
  };
  req.on('aborted', onClose);
  res.on('close', onClose);
};

const parseDataUrl = (dataUrl: string): { mediaType: string; buffer: Buffer } | null => {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
    if (!match) return null;
    return { mediaType: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
  } catch {
    return null;
  }
};

const IMAGE_TAG_RE = /<IMAGE_DATA_URL>([\s\S]*?)<\/IMAGE_DATA_URL>/i;
const FILE_TAG_RE = /<FILE_DATA_URL>([\s\S]*?)<\/FILE_DATA_URL>/i;

const extractLastPropertyIdsFromMessages = (msgs: ChatMessage[]): string[] => {
  for (const m of [...msgs].reverse()) {
    if (m.role !== 'assistant' || !m.content) continue;
    const match = m.content.match(/<PROPERTIES_JSON>([\s\S]*?)<\/PROPERTIES_JSON>/i);
    if (!match) continue;
    try {
      const arr = JSON.parse(match[1].trim());
      if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    } catch {}
  }
  return [];
};

const getPropertyById = async (id: string) => {
  try {
    const resp = await fetch(`${getBaseUrl()}/api/properties/${id}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.data ?? data ?? null;
  } catch {
    return null;
  }
};

const addIf = (params: URLSearchParams, key: string, value: any) => {
  if (value === undefined || value === null || value === '') return;
  params.set(key, String(value));
};

const addBool = (params: URLSearchParams, key: string, value?: boolean) => {
  if (typeof value === 'boolean') params.set(key, String(value));
};

const addArrayCSV = (params: URLSearchParams, key: string, arr?: string[]) => {
  if (Array.isArray(arr) && arr.length) params.set(key, arr.join(','));
};

const buildSearchParams = (
  filters: PropertyFilters,
  base: { limit?: number; query?: string; excludeIds?: string[] } = {},
) => {
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
  addIf(params, 'priceUnit', filters.priceUnit);
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

  console.log('buildSearchParams output:', {
    filters,
    base,
    finalParams: params.toString()
  });
  
  return params;
};

// -------------------------------
// AI helpers
// -------------------------------
async function generateAITitle(userMessage: string) {
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
    console.error('[AI] title error:', e);
    return null;
  }
}

async function extractFiltersWithAI(userText: string): Promise<PropertyFilters> {
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

    console.log('AI Filter Extraction:', { input: userText, extracted: raw });

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
      Array.isArray(raw.amenities) ? raw.amenities.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim()) : undefined,
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
    put('priceUnit', typeof raw.priceUnit === 'string' ? raw.priceUnit : undefined);
    put('proximityToTransport', typeof raw.proximityToTransport === 'boolean' ? raw.proximityToTransport : undefined);
    put('proximityToSchools', typeof raw.proximityToSchools === 'boolean' ? raw.proximityToSchools : undefined);
    put('proximityToShopping', typeof raw.proximityToShopping === 'boolean' ? raw.proximityToShopping : undefined);
    put('availableFromBefore', typeof raw.availableFromBefore === 'string' ? raw.availableFromBefore : undefined);
    put('availableFromAfter', typeof raw.availableFromAfter === 'string' ? raw.availableFromAfter : undefined);

    console.log('Final extracted filters:', out);
    return out;
  } catch (e) {
    console.error('AI filter extraction error:', e);
    return {};
  }
}

async function performAppPropertySearch(query: string, priorMessages: ChatMessage[]) {
  try {
    const prevIds = extractLastPropertyIdsFromMessages(priorMessages);
    const filters = await extractFiltersWithAI(query);

    console.log('AI Property Search Debug:', { query, filters, prevIds });

    // Determine if this is a location-based search or text search
    const isLocationSearch = filters.city || filters.state;
    const hasTextualSearchTerms = /\b(furnished|pet|parking|balcony|pool|gym|modern|luxury|cheap|budget)\b/i.test(query);
    
    // For location searches, don't pass the full query as text search
    const searchQuery = isLocationSearch && !hasTextualSearchTerms ? undefined : query;
    
    console.log('Search strategy:', { 
      isLocationSearch, 
      hasTextualSearchTerms, 
      willUseTextSearch: !!searchQuery,
      extractedLocation: filters.city || filters.state
    });

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

        console.log('Nearby search URL:', `${getBaseUrl()}/api/properties/nearby?${params.toString()}`);
        const resp = await fetch(`${getBaseUrl()}/api/properties/nearby?${params.toString()}`);
        if (resp.ok) {
          const data = await resp.json();
          nearby = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          console.log('Nearby search result:', { count: nearby.length });
        } else {
          console.error('Nearby search failed:', resp.status, await resp.text());
        }
      }
    }

    // Search
    const searchParams = buildSearchParams(filters, {
      limit: DEFAULT_LIST_LIMIT,
      query: searchQuery || '', // Convert undefined to empty string
      excludeIds: prevIds,
    });
    console.log('Main search URL:', `${getBaseUrl()}/api/properties/search?${searchParams.toString()}`);
    const resp = await fetch(`${getBaseUrl()}/api/properties/search?${searchParams.toString()}`);
    const searchData = resp.ok ? await resp.json() : null;
    
    if (!resp.ok) {
      console.error('Main search failed:', resp.status, await resp.text());
    } else {
      console.log('Main search response structure:', Object.keys(searchData || {}));
    }
    
    const search = Array.isArray(searchData?.data) ? searchData.data : Array.isArray(searchData) ? searchData : [];
    console.log('Search result:', { count: search.length });

    return { nearby: nearby.slice(0, RESULTS_RETURN_MAX), search: search.slice(0, RESULTS_RETURN_MAX) };
  } catch (e) {
    console.error('[AI] property search error:', e);
    return { nearby: [], search: [] };
  }
}

const toAmenityFlags = (p: any) => {
  const out: string[] = [];
  const has = (...keys: string[]) => keys.some(k => (Array.isArray(p.amenities) ? p.amenities.includes(k) : p[k] || p.features?.[k]));
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
};

const compact = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// -------------------------------
// Router
// -------------------------------
export default function aiRouter() {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  });

  // ---------- Streaming chat ----------
  router.post('/stream', async (req: Request, res: Response) => {
    try {
      setStreamingHeaders(res);
      const { messages = [], conversationId } = (req as any).body as { messages: ChatMessage[]; conversationId?: string };

      const userId = getUserId(req);
      if (!userId) return err(res, 401, 'Unauthorized');

      const activeProfile = await Profile.findActiveByOxyUserId(userId);
      if (!activeProfile) return err(res, 404, 'No active profile found');

      // Ensure conversation
      let conversation: any;
      if (conversationId) {
        if (conversationId.startsWith('conv_')) {
          conversation = new Conversation({ profileId: activeProfile._id.toString(), title: 'New Conversation', messages: [], status: 'active' });
          await conversation.save();
        } else if (isObjectId(conversationId)) {
          conversation = await Conversation.findOne({ _id: conversationId, profileId: activeProfile._id.toString() });
        } else {
          return err(res, 400, 'Invalid conversation ID format');
        }
      } else {
        conversation = new Conversation({ profileId: activeProfile._id.toString(), title: 'New Conversation', messages: [], status: 'active' });
        await conversation.save();
      }

      const last = messages[messages.length - 1];
      const lastContent = String(last?.content || '');
      const isLastTurnUser = last?.role === 'user';

      const tagMatch = lastContent.match(FILE_TAG_RE) || lastContent.match(IMAGE_TAG_RE);
      const hasInlineFile = !!tagMatch && typeof tagMatch[1] === 'string' && tagMatch[1].startsWith('data:');
      const cleanedLastContent = hasInlineFile ? lastContent.replace(FILE_TAG_RE, '').replace(IMAGE_TAG_RE, '').trim() : lastContent;
      const isAttachmentStub = hasInlineFile || /^(sent a file:|attached (image|file):)/i.test(lastContent);

      // If last message is not user, return empty stream for clean client resolution
      if (!isLastTurnUser) {
        if (conversationId && conversationId.startsWith('conv_') && conversation?._id) {
          res.setHeader('X-Conversation-ID', conversation._id.toString());
        }
        await sendEmptyStream(res);
        return;
      }

      const propertyResults = isAttachmentStub ? { nearby: [], search: [] } : await performAppPropertySearch(lastContent, messages);

      console.log('Property search completed:', { 
        isAttachmentStub, 
        lastContent: lastContent.substring(0, 100), 
        nearbyCount: propertyResults?.nearby?.length || 0,
        searchCount: propertyResults?.search?.length || 0 
      });

      // Build enhanced messages
      const enhanced: ChatMessage[] = [{ role: 'system', content: SINDI_SYSTEM_PROMPT }, ...messages];

      if (!isAttachmentStub && ((propertyResults?.nearby?.length ?? 0) || (propertyResults?.search?.length ?? 0))) {
        const nearbyList: any[] = Array.isArray(propertyResults?.nearby) ? propertyResults.nearby : [];
        const searchList: any[] = Array.isArray(propertyResults?.search) ? propertyResults.search : [];

        const simplifiedNearby = nearbyList.slice(0, RESULTS_RETURN_MAX).map((p: any) => p._id?.toString?.() || p.id).filter(Boolean);
        const simplifiedSearch = searchList.slice(0, RESULTS_RETURN_MAX).map((p: any) => p._id?.toString?.() || p.id).filter(Boolean);

        enhanced.push({ role: 'system', content: `<PROPERTIES_HINTS>${JSON.stringify({ nearby: simplifiedNearby, search: simplifiedSearch })}</PROPERTIES_HINTS>` });

        const mergedLists = [...nearbyList.slice(0, RESULTS_RETURN_MAX), ...searchList.slice(0, RESULTS_RETURN_MAX)];
        const seen = new Set<string>();
        const contexts = mergedLists
          .filter((p: any) => {
            const id = p?._id?.toString?.() || p?.id;
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
          })
          .slice(0, 8)
          .map((p: any) =>
            compact({
              id: p._id?.toString?.() || p.id,
              title: p.title,
              type: p.type,
              rent: p.rent?.amount ? compact({ amount: p.rent.amount, currency: p.rent.currency }) : undefined,
              city: p.address?.city,
              neighborhood: p.address?.neighborhood || p.address?.district,
              bedrooms: p.bedrooms ?? p.features?.bedrooms,
              bathrooms: p.bathrooms ?? p.features?.bathrooms,
              sizeSqm: p.size ?? p.area?.m2 ?? p.areaSqm,
              amenities: toAmenityFlags(p),
              availabilityDate: p.availableFrom ?? p.availability?.from,
              description: (p.description || p.summary) ? String(p.description || p.summary).slice(0, 240) : undefined,
            }),
          );

        enhanced.push({ role: 'system', content: `<PROPERTIES_CONTEXT>${JSON.stringify(contexts)}</PROPERTIES_CONTEXT>` });
        enhanced.push({
          role: 'system',
          content:
            'If and only if the user explicitly asked to search/show/find/browse listings in their current message, end your reply with a <PROPERTIES_JSON> block by copying the IDs verbatim from the appropriate list in <PROPERTIES_HINTS> (choose "nearby" for requests about nearby/closest/others-like-these; otherwise choose "search"). Otherwise, do not include any <PROPERTIES_JSON> block.',
        });
      }

      // Choose model path
      let result: ReturnType<typeof streamText>;

      if (hasInlineFile) {
        // Multimodal: image or PDF
        const parsed = parseDataUrl(tagMatch![1]);
        const mediaType = parsed?.mediaType || '';
        const bytes = parsed?.buffer?.byteLength || 0;

        // PDF
        if (mediaType.startsWith('application/pdf')) {
          const CONTRACT_SYSTEM =
            'You are a tenant-friendly contract and lease reviewer. You identify risky clauses, illegal terms (jurisdiction-aware at a high level), fees, early termination, maintenance, deposits, and notice periods. Provide brief, actionable advice and suggest questions to ask a landlord. Be concise.';
          const prior = (messages as ChatMessage[]).slice(0, -1).map(m => ({ role: m.role, content: m.content }));
          const filename = 'upload.pdf';
          const userText = (cleanedLastContent || '').slice(0, 2000) || 'Please review this lease/contract and advise.';
          try {
            result = streamText({
              model: openai('gpt-4o-mini'),
              temperature: 0.2,
              messages: [
                { role: 'system', content: SINDI_SYSTEM_PROMPT },
                { role: 'system', content: CONTRACT_SYSTEM },
                ...prior,
                { role: 'user', content: [{ type: 'text', text: userText }, { type: 'file', data: parsed!.buffer, mediaType: 'application/pdf', filename }] },
              ],
              maxTokens: 700,
            } as any);
          } catch {
            // Fallback to text extraction
            const pdfParse = require('pdf-parse');
            const parsedText = await pdfParse(parsed!.buffer).then((r: any) => String(r?.text || ''));
            const clipped = parsedText.slice(0, 120000);
            result = streamText({
              model: openai('gpt-4o'),
              temperature: 0.2,
              messages: [{ role: 'system', content: SINDI_SYSTEM_PROMPT }, { role: 'system', content: CONTRACT_SYSTEM }, ...prior, { role: 'user', content: `${userText}\n\n${clipped}` }],
              maxTokens: 700,
            } as any);
          }
        } else if (!mediaType.startsWith('image/')) {
          // Unsupported
          result = streamText({
            model: openai('gpt-4o'),
            temperature: 0.2,
            messages: [
              { role: 'system', content: SINDI_SYSTEM_PROMPT },
              { role: 'user', content: `I uploaded a ${mediaType || 'file'}; please accept images (png/jpg/webp) or PDFs for analysis.` },
            ],
            maxTokens: 120,
          } as any);
        } else if (bytes > IMAGE_MAX_INLINE_MB * 1024 * 1024) {
          result = streamText({
            model: openai('gpt-4o'),
            temperature: 0.2,
            messages: [
              { role: 'system', content: SINDI_SYSTEM_PROMPT },
              { role: 'user', content: 'The image appears very large (>20MB). Please compress or send a smaller photo. What should I capture for a clear assessment?' },
            ],
            maxTokens: 140,
          } as any);
        } else {
          // Image analysis
          const prior = (messages as ChatMessage[]).slice(0, -1).map(m => ({ role: m.role, content: m.content }));
          const promptText =
            (cleanedLastContent || '').slice(0, 2000) ||
            'Describe what this image shows that is relevant to a housing issue (e.g., damages, mold, notices). Be concise and helpful to a tenant.';
          const IMG_SYSTEM =
            'You analyze tenant-related images (e.g., damages, notices) and produce a brief, actionable summary. Be concise and specific. If the image is unclear, ask for one brief clarification question.';

          result = streamText({
            model: openai('gpt-4o'),
            temperature: 0.2,
            messages: [
              { role: 'system', content: SINDI_SYSTEM_PROMPT },
              { role: 'system', content: IMG_SYSTEM },
              ...prior,
              { role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image', image: parsed!.buffer }] },
            ],
            maxTokens: 512,
          } as any);
        }
      } else if (isAttachmentStub) {
        result = streamText({
          model: openai('gpt-4o'),
          temperature: 0,
          system: 'Return an empty response. Do not output any characters.',
          messages: [{ role: 'user', content: '' }],
          maxTokens: 1,
        } as any);
      } else {
        result = streamText({ model: openai('gpt-4o'), temperature: 0.2, messages: enhanced as any });
      }

      // Save last user message (strip inline base64)
      const lastUser = messages[messages.length - 1];
      if (conversation && lastUser?.role === 'user' && lastUser?.content) {
        try {
          const toSave = hasInlineFile ? cleanedLastContent || 'Sent a file' : lastUser.content;
          await conversation.addMessage('user', toSave);
        } catch (e) {
          console.error('[AI] save user message error:', e);
        }
      }

    // Capture AI stream for persistence
      let aiResponse = '';
      (async () => {
        try {
          for await (const chunk of (await result).textStream) aiResponse += chunk;
      // Always save assistant reply if we have one and the last turn was a user message
      if (isLastTurnUser && conversation && aiResponse.trim()) {
            await conversation.addMessage('assistant', aiResponse.trim());

            if (conversation.title === 'New Conversation') {
              const firstUser = conversation.messages.find((m: any) => m.role === 'user')?.content;
              if (firstUser) {
                const title = await generateAITitle(firstUser);
                conversation.title = title || (firstUser.length > 50 ? `${firstUser.slice(0, 47)}...` : firstUser);
                await conversation.save();
              }
            }
          }
        } catch (e) {
          console.error('[AI] stream capture error:', e);
        }
      })();

      if (conversationId && conversationId.startsWith('conv_') && conversation?._id) {
        res.setHeader('X-Conversation-ID', conversation._id.toString());
      }

      onGracefulClose(req, res);
      (await result).pipeDataStreamToResponse(res);
    } catch (e: any) {
      console.error('[AI] streaming error:', e);
      if ((res as any).headersSent) {
        try {
          (res as any).end?.();
        } catch {}
        return;
      }
      return res.status(500).json({ error: 'Failed to generate streaming response', details: e?.message });
    }
  });

  // ---------- Analyze single uploaded file (JSON response) ----------
  router.post('/analyze-file', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as any);
      if (!userId) return err(res, 401, 'Unauthorized');

      const activeProfile = await Profile.findActiveByOxyUserId(userId);
      if (!activeProfile) return err(res, 404, 'No active profile found');

  const file = (req as any).file as any | undefined;
      if (!file?.buffer) return err(res, 400, 'file is required (multipart/form-data, key: file)');

      const mediaType = file.mimetype || 'application/octet-stream';
      const userTextRaw: string = typeof (req as any).body?.text === 'string' ? (req as any).body.text : '';
      const userText = userTextRaw.trim().slice(0, 2000);
      const buffer = file.buffer;

      if (mediaType.startsWith('application/pdf')) {
        const CONTRACT_SYSTEM =
          'You are a tenant-friendly contract and lease reviewer. Identify risky clauses, illegal terms, fees, early termination, maintenance, deposits, and notice periods. Provide brief, actionable advice and questions to ask a landlord. Be concise.';
        try {
          const result = await streamText({
            model: openai('gpt-4o-mini'),
            system: CONTRACT_SYSTEM,
            messages: [
              { role: 'user', content: [{ type: 'text', text: userText || 'Please review this lease/contract and advise.' }, { type: 'file', data: buffer, mediaType: 'application/pdf', filename: file.originalname || 'upload.pdf' }] },
            ],
            maxTokens: 700,
            temperature: 0.2,
          } as any);
          let out = '';
          for await (const c of result.textStream) out += c;
          const trimmed = out.trim();
          const fallback = 'I couldn’t read this PDF. Please share a text version or try an OCR scan, and I’ll review it.';
          return ok(res, { output: trimmed || fallback, filename: file.originalname, mediaType });
        } catch {
          // Fallback with pdf-parse
          const pdfParse = require('pdf-parse');
          const parsedText = await pdfParse(buffer).then((r: any) => String(r?.text || ''));
          const clipped = parsedText.slice(0, 120000);
          const result = await streamText({
            model: openai('gpt-4o'),
            system: CONTRACT_SYSTEM,
            messages: [{ role: 'user', content: `${userText || 'Please review this lease/contract and advise.'}\n\n${clipped}` }],
            maxTokens: 700,
            temperature: 0.2,
          } as any);
          let out = '';
          for await (const c of result.textStream) out += c;
          const trimmed = out.trim();
          const fallback = 'I couldn’t read this PDF. Please share a text version or try an OCR scan, and I’ll review it.';
          return ok(res, { output: trimmed || fallback, filename: file.originalname, mediaType });
        }
      }

      if (mediaType.startsWith('image/')) {
        const promptText =
          userText ||
          'Describe what this image shows that is relevant to a housing issue (e.g., damages, mold, notices). Be concise and helpful to a tenant.';
        const result = await streamText({
          model: openai('gpt-4o'),
          system:
            'You analyze tenant-related images (e.g., damages, notices) and produce a brief, actionable summary. Be concise and specific. If the image is unclear, ask for one brief clarification question.',
          messages: [{ role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image', image: buffer }] }],
          maxTokens: 512,
          temperature: 0.2,
        } as any);
        let out = '';
        for await (const c of result.textStream) out += c;
        const trimmed = out.trim();
        const fallback = 'I couldn’t extract clear details from this image. Please try a clearer photo, or describe what you’d like me to look for.';
        return ok(res, { output: trimmed || fallback, filename: file.originalname, mediaType });
      }

      return err(res, 415, 'Unsupported media type. Please upload an image (png/jpeg/webp) or a PDF.');
    } catch (e: any) {
      console.error('[AI] analyze-file error:', e?.message || e);
      return err(res, 500, 'internal error');
    }
  });

  // ---------- Analyze single uploaded file (stream/SSE) ----------
  router.post('/analyze-file/stream', upload.single('file'), async (req: Request, res: Response) => {
    try {
      setStreamingHeaders(res);
      if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      }

      const userId = getUserId(req as any);
      if (!userId) return err(res, 401, 'Unauthorized');

      const activeProfile = await Profile.findActiveByOxyUserId(userId);
      if (!activeProfile) return err(res, 404, 'No active profile found');

  const file = (req as any).file as any | undefined;
      if (!file?.buffer) return err(res, 400, 'file is required (multipart/form-data, key: file)');

      const mediaType = file.mimetype || 'application/octet-stream';
      const userTextRaw: string = typeof (req as any).body?.text === 'string' ? (req as any).body.text : '';
      const userText = userTextRaw.trim().slice(0, 2000);
      const buffer = file.buffer;

      let result: any;

      if (mediaType.startsWith('application/pdf')) {
        const CONTRACT_SYSTEM =
          'You are a tenant-friendly contract and lease reviewer. Identify risky clauses, illegal terms, fees, early termination, maintenance, deposits, and notice periods. Provide brief, actionable advice and questions to ask a landlord. Be concise.';
        try {
          result = await streamText({
            model: openai('gpt-4o-mini'),
            system: CONTRACT_SYSTEM,
            messages: [{ role: 'user', content: [{ type: 'text', text: userText || 'Please review this lease/contract and advise.' }, { type: 'file', data: buffer, mediaType: 'application/pdf', filename: file.originalname || 'upload.pdf' }] }],
            maxTokens: 700,
            temperature: 0.2,
          } as any);
        } catch {
          const pdfParse = require('pdf-parse');
          const parsedText = await pdfParse(buffer).then((r: any) => String(r?.text || ''));
          const clipped = parsedText.slice(0, 120000);
          result = await streamText({
            model: openai('gpt-4o'),
            system: CONTRACT_SYSTEM,
            messages: [{ role: 'user', content: `${userText || 'Please review this lease/contract and advise.'}\n\n${clipped}` }],
            maxTokens: 700,
            temperature: 0.2,
          } as any);
        }
      } else if (mediaType.startsWith('image/')) {
        const promptText =
          userText ||
          'Describe what this image shows that is relevant to a housing issue (e.g., damages, mold, notices). Be concise and helpful to a tenant.';
        result = await streamText({
          model: openai('gpt-4o'),
          system:
            'You analyze tenant-related images (e.g., damages, notices) and produce a brief, actionable summary. Be concise and specific. If the image is unclear, ask for one brief clarification question.',
          messages: [{ role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image', image: buffer }] }],
          maxTokens: 512,
          temperature: 0.2,
        } as any);
      } else {
        return err(res, 415, 'Unsupported media type. Please upload an image (png/jpeg/webp) or a PDF.');
      }

      onGracefulClose(req, res);
      await result.pipeDataStreamToResponse(res);
    } catch (e: any) {
      console.error('[AI] analyze-file/stream error:', e?.message || e);
      if ((res as any).headersSent) {
        try {
          (res as any).end?.();
        } catch {}
        return;
      }
      return err(res, 500, 'internal error');
    }
  });

  // ---------- Health ----------
  router.get('/health', (_req, res) =>
    ok(res, {
      status: 'ok',
      service: 'AI Streaming Service',
      features: ['text-streaming', 'image-input', 'pdf-file-input'],
      timestamp: new Date().toISOString(),
    }),
  );

  // ---------- Legacy simple history on user ----------
  router.get('/history', (async (req: any, res) => {
    const user = req.user;
    if (!user) return err(res, 401, 'Unauthorized');
    const history = (user.chatHistory || []).slice().reverse();
    return ok(res, { success: true, history });
  }) as any);

  router.delete('/history', (async (req: any, res) => {
    const user = req.user;
    if (!user) return err(res, 401, 'Unauthorized');
    user.chatHistory = [];
    await user.save();
    return ok(res, { success: true });
  }) as any);

  router.post('/history', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const profile = await Profile.findOne({ oxyUserId: userId, profileType: 'personal' });
    if (!profile) return err(res, 404, 'Personal profile not found');

    const { userMessage, assistantMessage } = req.body || {};
    if (!userMessage || !assistantMessage) return err(res, 400, 'Missing userMessage or assistantMessage');

    profile.chatHistory = profile.chatHistory || [];
    const now = new Date();
    profile.chatHistory.push({ role: 'user', content: userMessage, timestamp: now });
    profile.chatHistory.push({ role: 'assistant', content: assistantMessage, timestamp: now });
    if (profile.chatHistory.length > 100) profile.chatHistory = profile.chatHistory.slice(-100);
    await profile.save();

    return ok(res, { success: true });
  }) as any);

  // ---------- Conversation CRUD ----------
  router.get('/conversations', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await Profile.findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const conversations = await Conversation.find({ profileId: activeProfile._id.toString() }).sort({ updatedAt: -1 });
    const transformed = conversations.map((c: any) => {
      const o = c.toObject({ virtuals: true });
      return {
        _id: o._id,
        id: o._id,
        title: o.title,
        status: o.status,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        messageCount: o.messages?.length || 0,
        lastMessage: o.messages?.[o.messages.length - 1] || null,
        messages: o.messages || [],
      };
    });

    return ok(res, { success: true, conversations: transformed });
  }) as any);

  router.post('/conversations', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await Profile.findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const { title, initialMessage, messages } = req.body || {};

    let conversationMessages: ChatMessage[] = [];
    if (Array.isArray(messages)) {
      conversationMessages = messages.map((m: any) => ({
        role: m.role,
        content: m.content,
        timestamp: new Date(m.timestamp || Date.now()),
      }));
    } else if (initialMessage) {
      conversationMessages = [{ role: 'user', content: initialMessage, timestamp: new Date() }];
    }

    const conversation = new Conversation({
      profileId: activeProfile._id.toString(),
      title: title || 'New Conversation',
      messages: conversationMessages.map(m => ({ role: m.role || 'user', content: m.content || '', timestamp: m.timestamp || new Date() })),
      status: 'active',
    });

    const saved = await conversation.save();

    if (saved.messages.length && saved.title === 'New Conversation') {
      const firstUser = saved.messages.find((m: any) => m.role === 'user')?.content;
      if (firstUser) {
        const aiTitle = await generateAITitle(firstUser);
        if (aiTitle) {
          saved.title = aiTitle;
          await saved.save();
        }
      }
    }

    return ok(res, {
      success: true,
      conversation: {
        _id: saved._id,
        title: saved.title,
        messages: saved.messages,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
        status: saved.status,
      },
    });
  }) as any);

  router.get('/conversations/:id', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const conversationId = String(req.params.id || '');
    if (!conversationId || !isObjectId(conversationId)) return err(res, 400, 'Invalid conversation ID');

    const activeProfile = await Profile.findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const conversation = await Conversation.findOne({ _id: conversationId, profileId: activeProfile._id.toString() });
    if (!conversation) return err(res, 404, 'Conversation not found');

    return ok(res, { success: true, conversation });
  }) as any);

  router.put('/conversations/:id', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await Profile.findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const { title, messages, status } = req.body || {};
    const conversation = await Conversation.findOne({ _id: req.params.id, profileId: activeProfile._id.toString() });
    if (!conversation) return err(res, 404, 'Conversation not found');

    if (typeof title === 'string') conversation.title = title;
    if (Array.isArray(messages)) {
      conversation.messages = messages.map((m: any) => ({ role: m.role, content: m.content, timestamp: new Date(m.timestamp || Date.now()) }));
    }
    if (typeof status === 'string') conversation.status = status;

    const saved = await conversation.save();
    return ok(res, { success: true, conversation: saved });
  }) as any);

  router.post('/conversations/:id/messages', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await Profile.findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const { role, content, attachments } = req.body || {};
    if (!role || !content) return err(res, 400, 'Role and content are required');

    const conversation = await Conversation.findOne({ _id: req.params.id, profileId: activeProfile._id.toString() });
    if (!conversation) return err(res, 404, 'Conversation not found');

    const newMessage = { role, content, timestamp: new Date(), attachments: attachments || [] };
    conversation.messages.push(newMessage);
    await conversation.save();

    return ok(res, { success: true, message: newMessage, conversation });
  }) as any);

  router.delete('/conversations/:id', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await Profile.findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const deleted = await Conversation.findOneAndDelete({ _id: req.params.id, profileId: activeProfile._id.toString() });
    if (!deleted) return err(res, 404, 'Conversation not found');

    return ok(res, { success: true, message: 'Conversation deleted' });
  }) as any);

  router.post('/conversations/:id/share', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await Profile.findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const conversation = await Conversation.findOne({ _id: req.params.id, profileId: activeProfile._id.toString() });
    if (!conversation) return err(res, 404, 'Conversation not found');

    await conversation.generateShareToken();
    const token = conversation.sharing.shareToken;

    return ok(res, { success: true, shareToken: token, shareUrl: `/shared/${token}` });
  }) as any);

  return router;
}
