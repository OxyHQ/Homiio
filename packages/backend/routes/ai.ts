/**
 * AI Routes — streaming, search, conversations
 */

import express, { Request, Response } from 'express';
import { PassThrough } from 'stream';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
// CJS model exports
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Profile = require('../models/schemas/ProfileSchema');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Conversation = require('../models/schemas/ConversationSchema');
import mongoose from 'mongoose';

type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; timestamp?: Date };
// Filters are now parsed inside the properties API.

const isObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);
const getUserId = (req: any) => req.user?.oxyUserId || req.user?._id || req.user?.id;
const getBaseUrl = () => process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

const ok = (res: Response, data: any) => res.json(data);
const err = (res: Response, code: number, message: string) => res.status(code).json({ error: message });

const normalize = (s: string) => (s || '').toLowerCase().trim();

export default function aiRouter() {
  const router = express.Router();

  // ---------- AI Helpers ----------

  // Extract structured property filters using the model (no code keywords or language-specific parsing).
  async function extractFiltersWithAI(userText: string): Promise<Record<string, any>> {
    try {
      const instruction = `You extract structured search filters for rental properties from the user's message.
Return ONLY a compact JSON object with any of these keys when applicable; omit keys you cannot infer:
{
  "type": string,                  // one of: apartment | house | room | studio | shared
  "minRent": number,               // minimum monthly rent
  "maxRent": number,               // maximum monthly rent
  "city": string,                  // city name
  "state": string,                 // state/region
  "bedrooms": number,              // integer
  "bathrooms": number,             // integer
  "minBedrooms": number,
  "maxBedrooms": number,
  "minBathrooms": number,
  "maxBathrooms": number,
  "minSquareFootage": number,
  "maxSquareFootage": number,
  "minYearBuilt": number,
  "maxYearBuilt": number,
  "amenities": string[],          // amenity slugs (e.g., furnished, parking, pet_friendly, balcony, gym, wifi, air_conditioning, washer, dishwasher, elevator)
  "hasPhotos": boolean,            // true if the user explicitly requires photos
  "hasImages": boolean,            // alias accepted; same as hasPhotos
  "available": boolean,            // true if explicitly available now
  "verified": boolean,             // true if user asks for verified listings
  "eco": boolean,                  // true if eco-friendly preferred
  "budgetFriendly": boolean,       // true if user indicates budget/cheap/affordable preference
  "housingType": string,
  "layoutType": string,
  "furnishedStatus": string,
  "petFriendly": boolean,
  "utilitiesIncluded": boolean,
  "parkingType": string,
  "petPolicy": string,
  "leaseTerm": string,
  "priceUnit": string,
  "proximityToTransport": boolean,
  "proximityToSchools": boolean,
  "proximityToShopping": boolean,
  "availableFromBefore": string,
  "availableFromAfter": string
}`.trim();

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
      const jsonStart = trimmed.indexOf('{');
      const jsonEnd = trimmed.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        const json = trimmed.slice(jsonStart, jsonEnd + 1);
        const obj = JSON.parse(json);
        // Sanitize values
        const out: Record<string, any> = {};
        const put = (k: string, v: any) => { if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) out[k] = v; };
        if (typeof obj.type === 'string') put('type', obj.type);
        if (obj.minRent != null && !isNaN(Number(obj.minRent))) put('minRent', Number(obj.minRent));
        if (obj.maxRent != null && !isNaN(Number(obj.maxRent))) put('maxRent', Number(obj.maxRent));
        if (typeof obj.city === 'string') put('city', obj.city);
          if (typeof obj.state === 'string') put('state', obj.state);
        if (obj.bedrooms != null && !isNaN(Number(obj.bedrooms))) put('bedrooms', Number(obj.bedrooms));
        if (obj.bathrooms != null && !isNaN(Number(obj.bathrooms))) put('bathrooms', Number(obj.bathrooms));
          if (obj.minBedrooms != null && !isNaN(Number(obj.minBedrooms))) put('minBedrooms', Number(obj.minBedrooms));
          if (obj.maxBedrooms != null && !isNaN(Number(obj.maxBedrooms))) put('maxBedrooms', Number(obj.maxBedrooms));
          if (obj.minBathrooms != null && !isNaN(Number(obj.minBathrooms))) put('minBathrooms', Number(obj.minBathrooms));
          if (obj.maxBathrooms != null && !isNaN(Number(obj.maxBathrooms))) put('maxBathrooms', Number(obj.maxBathrooms));
          if (obj.minSquareFootage != null && !isNaN(Number(obj.minSquareFootage))) put('minSquareFootage', Number(obj.minSquareFootage));
          if (obj.maxSquareFootage != null && !isNaN(Number(obj.maxSquareFootage))) put('maxSquareFootage', Number(obj.maxSquareFootage));
          if (obj.minYearBuilt != null && !isNaN(Number(obj.minYearBuilt))) put('minYearBuilt', Number(obj.minYearBuilt));
          if (obj.maxYearBuilt != null && !isNaN(Number(obj.maxYearBuilt))) put('maxYearBuilt', Number(obj.maxYearBuilt));
        if (Array.isArray(obj.amenities)) put('amenities', obj.amenities.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim()));
          if (typeof obj.hasPhotos === 'boolean') put('hasPhotos', obj.hasPhotos);
          if (typeof obj.hasImages === 'boolean') put('hasPhotos', obj.hasImages);
        if (typeof obj.available === 'boolean') put('available', obj.available);
        if (typeof obj.verified === 'boolean') put('verified', obj.verified);
        if (typeof obj.eco === 'boolean') put('eco', obj.eco);
        if (typeof obj.budgetFriendly === 'boolean') put('budgetFriendly', obj.budgetFriendly);
        return out;
      }
      return {};
    } catch (e) {
      return {};
    }
  }

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

  // Web search removed: avoid keyword/language-based heuristics; rely on explicit property API filters only.

  // Note: We removed parsePropertyFilters here. The properties controller now owns query parsing.

  // Explicit user intent detector for property search
  // (Intentionally removed) No function-based intent detection; the model will decide based on prompt instructions.

  function extractLastPropertyIdsFromMessages(msgs: ChatMessage[]): string[] {
    const rev = [...msgs].reverse();
    for (const m of rev) {
      if (m.role !== 'assistant' || !m.content) continue;
      const match = m.content.match(/<PROPERTIES_JSON>([\s\S]*?)<\/PROPERTIES_JSON>/i);
      if (match) {
        try {
          const arr = JSON.parse(match[1].trim());
          if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
        } catch {}
      }
    }
    return [];
  }

  async function getPropertyById(id: string) {
    try {
      const resp = await fetch(`${getBaseUrl()}/api/properties/${id}`);
      if (!resp.ok) return null;
      const data = await resp.json();
      return data?.data || data || null;
    } catch {
      return null;
    }
  }

  async function performAppPropertySearch(query: string, priorMessages: ChatMessage[]) {
    try {
      // Get previously shown IDs for DB-level exclusion
      const prevIds = extractLastPropertyIdsFromMessages(priorMessages);
      // Extract structured filters once for this turn
      const filters = await extractFiltersWithAI(query);

      // Always compute NEARBY list when possible (anchor on previous shown property)
      let nearby: any[] = [];
      if (prevIds.length) {
        const anchor = await getPropertyById(prevIds[0]);
        const coords: number[] | null = anchor?.location?.coordinates || null;
        if (coords && coords.length === 2) {
          const [longitude, latitude] = coords;
          const params = new URLSearchParams({ longitude: String(longitude), latitude: String(latitude), maxDistance: '3000', limit: '12' });
          // Apply extracted filters as URL params
          if (filters.type) params.set('type', String(filters.type));
          if (filters.minRent != null) params.set('minRent', String(filters.minRent));
          if (filters.maxRent != null) params.set('maxRent', String(filters.maxRent));
          if (filters.bedrooms != null) params.set('bedrooms', String(filters.bedrooms));
          if (filters.bathrooms != null) params.set('bathrooms', String(filters.bathrooms));
          if (Array.isArray(filters.amenities) && filters.amenities.length) params.set('amenities', filters.amenities.join(','));
          if (filters.hasPhotos === true) params.set('hasPhotos', 'true');
          if (filters.hasImages === true) params.set('hasPhotos', 'true');
  if (filters.minBedrooms != null) params.set('minBedrooms', String(filters.minBedrooms));
  if (filters.maxBedrooms != null) params.set('maxBedrooms', String(filters.maxBedrooms));
  if (filters.minBathrooms != null) params.set('minBathrooms', String(filters.minBathrooms));
  if (filters.maxBathrooms != null) params.set('maxBathrooms', String(filters.maxBathrooms));
  if (filters.minSquareFootage != null) params.set('minSquareFootage', String(filters.minSquareFootage));
  if (filters.maxSquareFootage != null) params.set('maxSquareFootage', String(filters.maxSquareFootage));
  if (filters.minYearBuilt != null) params.set('minYearBuilt', String(filters.minYearBuilt));
  if (filters.maxYearBuilt != null) params.set('maxYearBuilt', String(filters.maxYearBuilt));
          if (filters.verified === true) params.set('verified', 'true');
          if (filters.eco === true) params.set('eco', 'true');
          if (filters.available === true) params.set('available', 'true');
          if (filters.housingType) params.set('housingType', String(filters.housingType));
          if (filters.layoutType) params.set('layoutType', String(filters.layoutType));
          if (filters.furnishedStatus) params.set('furnishedStatus', String(filters.furnishedStatus));
          if (filters.petFriendly != null) params.set('petFriendly', String(filters.petFriendly));
          if (filters.utilitiesIncluded != null) params.set('utilitiesIncluded', String(filters.utilitiesIncluded));
          if (filters.parkingType) params.set('parkingType', String(filters.parkingType));
          if (filters.petPolicy) params.set('petPolicy', String(filters.petPolicy));
          if (filters.leaseTerm) params.set('leaseTerm', String(filters.leaseTerm));
          if (filters.priceUnit) params.set('priceUnit', String(filters.priceUnit));
          if (filters.proximityToTransport != null) params.set('proximityToTransport', String(filters.proximityToTransport));
          if (filters.proximityToSchools != null) params.set('proximityToSchools', String(filters.proximityToSchools));
          if (filters.proximityToShopping != null) params.set('proximityToShopping', String(filters.proximityToShopping));
          if (filters.availableFromBefore) params.set('availableFromBefore', String(filters.availableFromBefore));
          if (filters.availableFromAfter) params.set('availableFromAfter', String(filters.availableFromAfter));
          // Note: city is not applied for nearby; it's geo-anchored from previous property
          if (filters.budgetFriendly === true) params.set('budgetFriendly', 'true');
          if (prevIds.length) params.set('excludeIds', prevIds.join(','));
          const resp = await fetch(`${getBaseUrl()}/api/properties/nearby?${params.toString()}`);
          if (resp.ok) {
            const data = await resp.json();
            nearby = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          }
        }
      }

      // Always compute SEARCH list
      let search: any[] = [];
      {
        const params = new URLSearchParams({ query, limit: '10' });
        if (filters.type) params.set('type', String(filters.type));
        if (filters.minRent != null) params.set('minRent', String(filters.minRent));
        if (filters.maxRent != null) params.set('maxRent', String(filters.maxRent));
        if (filters.city) params.set('city', String(filters.city));
  if (filters.state) params.set('state', String(filters.state));
        if (filters.bedrooms != null) params.set('bedrooms', String(filters.bedrooms));
        if (filters.bathrooms != null) params.set('bathrooms', String(filters.bathrooms));
        if (Array.isArray(filters.amenities) && filters.amenities.length) params.set('amenities', filters.amenities.join(','));
        if (filters.hasPhotos === true) params.set('hasPhotos', 'true');
        if (filters.verified === true) params.set('verified', 'true');
  if (filters.eco === true) params.set('eco', 'true');
        if (filters.available === true) params.set('available', 'true');
  if (filters.housingType) params.set('housingType', String(filters.housingType));
  if (filters.layoutType) params.set('layoutType', String(filters.layoutType));
  if (filters.furnishedStatus) params.set('furnishedStatus', String(filters.furnishedStatus));
  if (filters.petFriendly != null) params.set('petFriendly', String(filters.petFriendly));
  if (filters.utilitiesIncluded != null) params.set('utilitiesIncluded', String(filters.utilitiesIncluded));
  if (filters.parkingType) params.set('parkingType', String(filters.parkingType));
  if (filters.petPolicy) params.set('petPolicy', String(filters.petPolicy));
  if (filters.leaseTerm) params.set('leaseTerm', String(filters.leaseTerm));
  if (filters.priceUnit) params.set('priceUnit', String(filters.priceUnit));
  if (filters.proximityToTransport != null) params.set('proximityToTransport', String(filters.proximityToTransport));
  if (filters.proximityToSchools != null) params.set('proximityToSchools', String(filters.proximityToSchools));
  if (filters.proximityToShopping != null) params.set('proximityToShopping', String(filters.proximityToShopping));
  if (filters.availableFromBefore) params.set('availableFromBefore', String(filters.availableFromBefore));
  if (filters.availableFromAfter) params.set('availableFromAfter', String(filters.availableFromAfter));
  if (filters.minBedrooms != null) params.set('minBedrooms', String(filters.minBedrooms));
  if (filters.maxBedrooms != null) params.set('maxBedrooms', String(filters.maxBedrooms));
  if (filters.minBathrooms != null) params.set('minBathrooms', String(filters.minBathrooms));
  if (filters.maxBathrooms != null) params.set('maxBathrooms', String(filters.maxBathrooms));
  if (filters.minSquareFootage != null) params.set('minSquareFootage', String(filters.minSquareFootage));
  if (filters.maxSquareFootage != null) params.set('maxSquareFootage', String(filters.maxSquareFootage));
  if (filters.minYearBuilt != null) params.set('minYearBuilt', String(filters.minYearBuilt));
  if (filters.maxYearBuilt != null) params.set('maxYearBuilt', String(filters.maxYearBuilt));
        if (filters.budgetFriendly === true) params.set('budgetFriendly', 'true');
        if (prevIds.length) params.set('excludeIds', prevIds.join(','));
        const resp = await fetch(`${getBaseUrl()}/api/properties/search?${params.toString()}`);
        if (resp.ok) {
          const data = await resp.json();
          search = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        }
      }

      return {
        nearby: nearby.slice(0, 5),
        search: search.slice(0, 5),
      };
    } catch (e) {
      console.error('[AI] property search error:', e);
      return { nearby: [], search: [] };
    }
  }

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

Examples:
- Good (explicit ask):
  User: "Can you find budget apartments near Raval?"
  Assistant: "Here are some budget-friendly options near Raval and a few quick tips..."

  <PROPERTIES_JSON>[COPY THE EXACT IDs FROM the appropriate list in <PROPERTIES_HINTS>]</PROPERTIES_JSON>

- Good (follow-up ask): If the user says "Please search for me" and a hint is present this turn, end with the IDs block. No plain-text lists.

- Bad: "Here are the IDs: property123, property456" (Not allowed: visible-text IDs or invented IDs).
`.trim();

  // ---------- Routes ----------

  // Streaming chat
  router.post('/stream', async (req: Request, res: Response) => {
    try {
      const { messages = [], conversationId } = (req as any).body as { messages: ChatMessage[]; conversationId?: string };
      const userId = getUserId(req);
      if (!userId) return err(res, 401, 'Unauthorized');

      const activeProfile = await (Profile as any).findActiveByOxyUserId(userId);
      if (!activeProfile) return err(res, 404, 'No active profile found');

      // Ensure conversation
      let conversation: any = null;
      if (conversationId) {
        if (conversationId.startsWith('conv_')) {
          conversation = new (Conversation as any)({
            profileId: activeProfile._id.toString(),
            title: 'New Conversation',
            messages: [],
            status: 'active',
          });
          await conversation.save();
        } else if (isObjectId(conversationId)) {
          conversation = await (Conversation as any).findOne({ _id: conversationId, profileId: activeProfile._id.toString() });
        } else {
          return err(res, 400, 'Invalid conversation ID format');
        }
      } else {
        conversation = new (Conversation as any)({
          profileId: activeProfile._id.toString(),
          title: 'New Conversation',
          messages: [],
          status: 'active',
        });
        await conversation.save();
      }

  const last = messages[messages.length - 1];
  const propertyResults = await performAppPropertySearch(last?.content || '', messages as ChatMessage[]);

      const enhanced: ChatMessage[] = [{ role: 'system', content: SINDI_SYSTEM_PROMPT }, ...messages];

  // No external web search hints injected.

  if ((propertyResults?.nearby?.length || 0) || (propertyResults?.search?.length || 0)) {
        // Provide machine-readable hints for both lists so the model can choose correctly
        const nearbyList: any[] = Array.isArray(propertyResults?.nearby) ? propertyResults.nearby : [];
        const searchList: any[] = Array.isArray(propertyResults?.search) ? propertyResults.search : [];
        const simplifiedNearby = nearbyList
          .slice(0, 5)
          .map((p: any) => p._id?.toString?.() || p.id)
          .filter(Boolean);
        const simplifiedSearch = searchList
          .slice(0, 5)
          .map((p: any) => p._id?.toString?.() || p.id)
          .filter(Boolean);
        enhanced.push({
          role: 'system',
          content: `<PROPERTIES_HINTS>${JSON.stringify({ nearby: simplifiedNearby, search: simplifiedSearch })}</PROPERTIES_HINTS>`,
        });
        // Provide compact property context for the model (not to be shown to the user verbatim)
        const clean = (o: Record<string, any>) =>
          Object.fromEntries(Object.entries(o).filter(([_, v]) => v !== undefined && v !== null && v !== ''));
        const toAmenityFlags = (p: any) => {
          const a: string[] = [];
          const has = (...keys: string[]) => keys.some(k => (Array.isArray(p.amenities) ? p.amenities.includes(k) : p[k] || p.features?.[k]));
          if (has('balcony', 'terrace')) a.push('balcony');
          if (has('pet_friendly', 'pets', 'petFriendly')) a.push('pet-friendly');
          if (has('furnished')) a.push('furnished');
          if (has('parking', 'garage')) a.push('parking');
          if (has('air_conditioning', 'ac')) a.push('AC');
          if (has('elevator', 'lift')) a.push('elevator');
          if (has('washer', 'laundry')) a.push('washer');
          if (has('dishwasher')) a.push('dishwasher');
          if (has('wifi', 'internet')) a.push('wifi');
          if (has('gym', 'fitness')) a.push('gym');
          return a.slice(0, 8);
        };
        // Merge contexts from both lists, de-dupe by id, and keep a compact set
        const mergedLists = [...nearbyList.slice(0, 5), ...searchList.slice(0, 5)];
        const seenIds = new Set<string>();
        const contexts = mergedLists.filter((p: any) => {
          const id = p?._id?.toString?.() || p?.id;
          if (!id || seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
        }).slice(0, 8).map((p: any) =>
          clean({
            id: p._id?.toString?.() || p.id,
            title: p.title,
            type: p.type,
            rent: p.rent?.amount ? clean({ amount: p.rent.amount, currency: p.rent.currency }) : undefined,
            city: p.address?.city,
            neighborhood: p.address?.neighborhood || p.address?.district,
            bedrooms: p.bedrooms ?? p.features?.bedrooms,
            bathrooms: p.bathrooms ?? p.features?.bathrooms,
            sizeSqm: p.size ?? p.area?.m2 ?? p.areaSqm,
            amenities: toAmenityFlags(p),
            availabilityDate: p.availableFrom ?? p.availability?.from,
            description: (p.description || p.summary || '')
              ? String(p.description || p.summary).slice(0, 240)
              : undefined,
          }),
        );
        enhanced.push({
          role: 'system',
          content: `<PROPERTIES_CONTEXT>${JSON.stringify(contexts)}</PROPERTIES_CONTEXT>`,
        });
        // Reinforce copying behavior conditioned on explicit ask this turn
        enhanced.push({
          role: 'system',
          content:
            'If and only if the user explicitly asked to search/show/find/browse listings in their current message, end your reply with a <PROPERTIES_JSON> block by copying the IDs verbatim from the appropriate list in <PROPERTIES_HINTS> (choose "nearby" for requests about nearby/closest/others-like-these; otherwise choose "search"). Otherwise, do not include any <PROPERTIES_JSON> block.',
        });
      }

  const result = streamText({ model: openai('gpt-4o'), temperature: 0.2, messages: enhanced as any });

      // Save last user message before streaming
      const lastUser = messages.at(-1);
      if (conversation && lastUser?.role === 'user' && lastUser?.content) {
        try {
          await conversation.addMessage('user', lastUser.content);
        } catch (e) {
          console.error('[AI] save user message error:', e);
        }
      }

      // Capture AI stream to store after send
      let aiResponse = '';
      const capture = new PassThrough();

      (async () => {
        try {
          for await (const chunk of (await result).textStream) aiResponse += chunk;
          if (conversation && aiResponse.trim()) {
            await conversation.addMessage('assistant', aiResponse.trim());

            // Title after first exchange
            if (conversation.title === 'New Conversation') {
              const firstUser = conversation.messages.find((m: any) => m.role === 'user')?.content;
              if (firstUser) {
                const title = await generateAITitle(firstUser);
                if (title) {
                  conversation.title = title;
                  await conversation.save();
                } else {
                  conversation.title = firstUser.length > 50 ? `${firstUser.slice(0, 47)}...` : firstUser;
                  await conversation.save();
                }
              }
            }
          }
        } catch (e) {
          console.error('[AI] stream capture error:', e);
        } finally {
          capture.end();
        }
      })();

      // Include new DB conversation id if client used a temp id
      if (conversationId && conversationId.startsWith('conv_') && conversation?._id) {
        res.setHeader('X-Conversation-ID', conversation._id.toString());
      }

      // Pipe to HTTP response
      (await result).pipeDataStreamToResponse(res);
    } catch (e: any) {
      console.error('[AI] streaming error:', e);
      return res.status(500).json({ error: 'Failed to generate streaming response', details: e?.message });
    }
  });

  // Health
  router.get('/health', (_req, res) =>
    ok(res, {
      status: 'ok',
      service: 'AI Streaming Service',
      features: ['text-streaming', 'web-search'],
      timestamp: new Date().toISOString(),
    }),
  );

  // Simple (legacy) chat history on user object
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

    const profile = await (Profile as any).findOne({ oxyUserId: userId, profileType: 'personal' });
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

    const activeProfile = await (Profile as any).findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const conversations = await (Conversation as any)
      .find({ profileId: activeProfile._id.toString() })
      .sort({ updatedAt: -1 });

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

    const activeProfile = await (Profile as any).findActiveByOxyUserId(userId);
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

    const conversation = new (Conversation as any)({
      profileId: activeProfile._id.toString(),
      title: title || 'New Conversation',
      messages: conversationMessages.map(m => ({
        role: m.role || 'user',
        content: m.content || '',
        timestamp: m.timestamp || new Date(),
      })),
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

    const activeProfile = await (Profile as any).findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const conversation = await (Conversation as any).findOne({
      _id: conversationId,
      profileId: activeProfile._id.toString(),
    });
    if (!conversation) return err(res, 404, 'Conversation not found');

    return ok(res, { success: true, conversation });
  }) as any);

  router.put('/conversations/:id', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await (Profile as any).findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const { title, messages, status } = req.body || {};
    const conversation = await (Conversation as any).findOne({
      _id: req.params.id,
      profileId: activeProfile._id.toString(),
    });
    if (!conversation) return err(res, 404, 'Conversation not found');

    if (typeof title === 'string') conversation.title = title;
    if (Array.isArray(messages)) {
      conversation.messages = messages.map((m: any) => ({
        role: m.role,
        content: m.content,
        timestamp: new Date(m.timestamp || Date.now()),
      }));
    }
    if (typeof status === 'string') conversation.status = status;

    const saved = await conversation.save();
    return ok(res, { success: true, conversation: saved });
  }) as any);

  router.post('/conversations/:id/messages', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await (Profile as any).findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const { role, content, attachments } = req.body || {};
    if (!role || !content) return err(res, 400, 'Role and content are required');

    const conversation = await (Conversation as any).findOne({
      _id: req.params.id,
      profileId: activeProfile._id.toString(),
    });
    if (!conversation) return err(res, 404, 'Conversation not found');

    const newMessage = {
      role,
      content,
      timestamp: new Date(),
      attachments: attachments || [],
    };
    conversation.messages.push(newMessage);
    await conversation.save();

    return ok(res, { success: true, message: newMessage, conversation });
  }) as any);

  router.delete('/conversations/:id', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await (Profile as any).findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const deleted = await (Conversation as any).findOneAndDelete({
      _id: req.params.id,
      profileId: activeProfile._id.toString(),
    });
    if (!deleted) return err(res, 404, 'Conversation not found');

    return ok(res, { success: true, message: 'Conversation deleted' });
  }) as any);

  router.post('/conversations/:id/share', (async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await (Profile as any).findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const conversation = await (Conversation as any).findOne({
      _id: req.params.id,
      profileId: activeProfile._id.toString(),
    });
    if (!conversation) return err(res, 404, 'Conversation not found');

    await conversation.generateShareToken();
    const token = conversation.sharing.shareToken;

    return ok(res, { success: true, shareToken: token, shareUrl: `/shared/${token}` });
  }) as any);

  return router;
}
