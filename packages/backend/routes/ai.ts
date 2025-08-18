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
type Filters = {
  maxRent?: number;
  minRent?: number;
  city?: string;
  type?: string;
  bedrooms?: number;
  bathrooms?: number;
  amenities?: string[];
  minSize?: number;
  availableNow?: boolean;
  budgetFriendly?: boolean;
  luxury?: boolean;
};

const isObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);
const getUserId = (req: any) => req.user?.oxyUserId || req.user?._id || req.user?.id;
const getBaseUrl = () => process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

const ok = (res: Response, data: any) => res.json(data);
const err = (res: Response, code: number, message: string) => res.status(code).json({ error: message });

const normalize = (s: string) => (s || '').toLowerCase().trim();

export default function aiRouter() {
  const router = express.Router();

  // ---------- AI Helpers ----------

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

  async function performWebSearch(query: string) {
    try {
      const q = normalize(query);
      const isCAT =
        ['catalunya', 'catalonia', 'barcelona', 'catalan', 'lloguer', 'sindicat', 'girona', 'tarragona', 'lleida', 'valencia', 'habitatge', 'propietat']
          .some(k => q.includes(k));

      if (isCAT) {
        try {
          const r = await fetch('https://sindicatdellogateres.org/', { method: 'GET' });
          if (r.ok) {
            return {
              source: 'Sindicat de Llogateres',
              content:
                'Sindicat de Llogateres: sindicado de inquilinas en Catalunya. Recursos: apoyo a huelgas de alquiler, asistencia legal, asambleas territoriales, fondo de resistencia y formación en derechos.',
              url: 'https://sindicatdellogateres.org/',
              additionalInfo:
                'Servicios clave: huelgas de alquiler, asistencia jurídica, asambleas, fondos de resistencia y materiales formativos.',
            };
          }
        } catch {
          // fall through to DDG
        }
      }

      const ddg = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const resp = await fetch(ddg);
      if (!resp.ok) return null;
      const data = await resp.json();

      if (data?.Abstract) {
        return {
          source: data.AbstractSource || 'DuckDuckGo',
          content: data.Abstract,
          url: data.AbstractURL,
        };
      }

      const first = data?.RelatedTopics?.[0];
      if (first) {
        return {
          source: 'DuckDuckGo',
          content: first.Text || first.FirstURL,
          url: first.FirstURL,
        };
      }

      return null;
    } catch (e) {
      console.error('[AI] web search error:', e);
      return null;
    }
  }

  function parsePropertyFilters(query: string): Filters {
    const f: Filters = { amenities: [] };
    const q = normalize(query);

    // price
    const max = q.match(/(?:under|less than|max|maximum|up to|cheap|cheaper|budget)\s*\$?(\d+)/);
    if (max) f.maxRent = parseInt(max[1], 10);

    const min = q.match(/(?:over|more than|minimum|min)\s*\$?(\d+)/);
    if (min) f.minRent = parseInt(min[1], 10);

    const range = q.match(/\$?(\d+)\s*(?:to|-)\s*\$?(\d+)/);
    if (range) {
      f.minRent = parseInt(range[1], 10);
      f.maxRent = parseInt(range[2], 10);
    }

    // location (EN/ES/CAT)
    const locPhrases = [
      'in', 'near', 'around', 'at', 'close to', 'within',
      'en', 'cerca de', 'cerca del', 'alrededor de', 'junto a', 'por', 'al lado de', 'cerca de la', 'cerca de los',
      'a prop de', 'a prop del', 'prop de', 'prop del', 'al costat de', 'a la vora de',
    ];
    for (const kw of locPhrases) {
      const m = q.match(new RegExp(`${kw}\\s+([\\p{L}\\s]+?)(?:\\s|$|,|\\?|!|\\d)`, 'iu'));
      if (m) {
        f.city = m[1].trim();
        break;
      }
    }

    // type
    const types: Record<string, string[]> = {
      apartment: ['apartment', 'apt', 'flat', 'pisos'],
      house: ['house', 'home', 'casa'],
      room: ['room', 'bedroom', 'habitación', 'habitacion'],
      studio: ['studio', 'loft'],
      shared: ['shared', 'coliving', 'co-living', 'roommate'],
    };
    for (const [t, kws] of Object.entries(types)) {
      if (kws.some(k => q.includes(k))) {
        f.type = t;
        break;
      }
    }

    // beds/baths
    const beds = q.match(/(\d+)\s*(?:bedroom|bed|br|room)s?/);
    if (beds) f.bedrooms = parseInt(beds[1], 10);

    const baths = q.match(/(\d+)\s*(?:bathroom|bath|ba)s?/);
    if (baths) f.bathrooms = parseInt(baths[1], 10);

    // amenities
    const amen: Record<string, string[]> = {
      furnished: ['furnished', 'furniture', 'mobiliado', 'amueblado'],
      parking: ['parking', 'garage', 'estacionamiento', 'garaje'],
      pet_friendly: ['pet', 'dog', 'cat', 'mascota', 'permiten mascotas', 'pet-friendly'],
      balcony: ['balcony', 'terrace', 'balcón', 'terraza'],
      gym: ['gym', 'fitness'],
      wifi: ['wifi', 'internet', 'wifi included'],
      air_conditioning: ['ac', 'air conditioning', 'aire acondicionado'],
      washer: ['washer', 'laundry', 'lavadora'],
      dishwasher: ['dishwasher', 'lavavajillas'],
      elevator: ['elevator', 'ascensor'],
    };
    for (const [feat, kws] of Object.entries(amen)) {
      if (kws.some(k => q.includes(k))) f.amenities!.push(feat);
    }

    // size
    const size = q.match(/(\d+)\s*(?:sq\s*ft|square\s*feet|m2|metros)/);
    if (size) f.minSize = parseInt(size[1], 10);

    // misc
    if (/(available now|immediate|urgent)/.test(q)) f.availableNow = true;
    if (/(cheap|affordable|budget|económico|economico)/.test(q)) f.budgetFriendly = true;
    // photos: support multilingual cues: en/es/ca
    // examples: 'with photos', 'only with photos', 'que tengan foto', 'con fotos', 'solo con fotos', 'amb fotos'
    const photosPatterns = [
      /\bwith\s+(?:photos|images|pictures)\b/,
      /\bonly\s+with\s+(?:photos|images|pictures)\b/,
      /\bphotos?\b/,
      /\bcon\s+fotos?\b/,
      /\bsolo\s+con\s+fotos?\b/,
      /\bque\s+tengan?\s+foto?s?\b/,
      /\bamb\s+fotos?\b/,
      /\bamb\s+imatges?\b/,
    ];
    if (photosPatterns.some(rx => rx.test(q))) (f as any).hasPhotos = true;

    return f;
  }

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
      const filters = parsePropertyFilters(query);
      // Get previously shown IDs for DB-level exclusion
      const prevIds = extractLastPropertyIdsFromMessages(priorMessages);

      // Always compute NEARBY list when possible (anchor on previous shown property)
      let nearby: any[] = [];
      if (prevIds.length) {
        const anchor = await getPropertyById(prevIds[0]);
        const coords: number[] | null = anchor?.location?.coordinates || null;
        if (coords && coords.length === 2) {
          const [longitude, latitude] = coords;
          const params = new URLSearchParams({
            longitude: String(longitude),
            latitude: String(latitude),
            maxDistance: '3000',
            limit: '12',
            available: 'true',
          });
          if (prevIds.length) params.set('excludeIds', prevIds.join(','));
          if (filters.type) params.set('type', filters.type);
          if (filters.minRent) params.set('minRent', String(filters.minRent));
          if (filters.maxRent) params.set('maxRent', String(filters.maxRent));
          if (filters.bedrooms) params.set('bedrooms', String(filters.bedrooms));
          if (filters.bathrooms) params.set('bathrooms', String(filters.bathrooms));
          if (filters.amenities?.length) params.set('amenities', filters.amenities.join(','));
          if ((filters as any).hasPhotos) params.set('hasPhotos', 'true');
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
        const params = new URLSearchParams({
          query,
          limit: '10',
          available: 'true',
        });
        if (prevIds.length) params.set('excludeIds', prevIds.join(','));
        if (filters.minRent) params.set('minRent', String(filters.minRent));
        if (filters.maxRent) params.set('maxRent', String(filters.maxRent));
        if (filters.city) params.set('city', filters.city);
        if (filters.type) params.set('type', filters.type);
        if (filters.bedrooms) params.set('bedrooms', String(filters.bedrooms));
        if (filters.bathrooms) params.set('bathrooms', String(filters.bathrooms));
        if (filters.amenities?.length) params.set('amenities', filters.amenities.join(','));
  if ((filters as any).hasPhotos) params.set('hasPhotos', 'true');
        const resp = await fetch(`${getBaseUrl()}/api/properties/search?${params.toString()}`);
        if (resp.ok) {
          const data = await resp.json();
          search = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        }
      }

      // Budget friendly ordering if requested (apply to each list)
      const sortBudget = (arr: any[]) =>
        filters.budgetFriendly && arr?.length ? arr.slice().sort((a, b) => (a.rent?.amount || 0) - (b.rent?.amount || 0)) : arr;

      return {
        nearby: sortBudget(nearby).slice(0, 5),
        search: sortBudget(search).slice(0, 5),
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
- Choose the list based on the user's request: if they ask for "nearby", "closest", "around", "others like these" etc., use the IDs from the "nearby" list; otherwise prefer the "search" list. You understand all languages—decide from meaning, not keywords.
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
      const text = normalize(last?.content || '');
      const needsCurrentInfo = [
        'current', 'recent', 'latest', 'new law', 'updated', '2024', '2025', 'recent case', 'local', 'organization',
        'catalunya', 'catalonia', 'barcelona', 'catalan', 'lloguer', 'sindicat', 'tenant union', 'rent strike',
      ].some(k => text.includes(k));

      const [searchResults, propertyResults] = await Promise.all([
        needsCurrentInfo ? performWebSearch(last?.content || '') : Promise.resolve(null),
        performAppPropertySearch(last?.content || '', messages as ChatMessage[]),
      ]);

      const enhanced: ChatMessage[] = [{ role: 'system', content: SINDI_SYSTEM_PROMPT }, ...messages];

      if (searchResults) {
        enhanced.push({
          role: 'system',
          content:
            `CURRENT INFO\nSource: ${searchResults.source}\nURL: ${searchResults.url}\nContent: ${searchResults.content}`.trim(),
        });
      }

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
