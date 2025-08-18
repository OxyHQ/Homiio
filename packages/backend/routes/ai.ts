/**
 * AI Routes — streaming, search, conversations
 */

import express, { Request, Response } from 'express';
import { PassThrough } from 'stream';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import Profile from '../models/schemas/ProfileSchema';
import Conversation from '../models/schemas/ConversationSchema';
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
        maxOutputTokens: 24,
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

    // location
    for (const kw of ['in', 'near', 'around', 'at', 'close to', 'within']) {
      const m = q.match(new RegExp(`${kw}\\s+([a-zA-Z\\s]+?)(?:\\s|$|,|\\?|!|\\d)`, 'i'));
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

    return f;
  }

  async function performAppPropertySearch(query: string) {
    try {
      const filters = parsePropertyFilters(query);
      const params = new URLSearchParams({
        query,
        limit: '10',
        available: 'true',
      });
      if (filters.minRent) params.set('minRent', String(filters.minRent));
      if (filters.maxRent) params.set('maxRent', String(filters.maxRent));
      if (filters.city) params.set('city', filters.city);
      if (filters.type) params.set('type', filters.type);
      if (filters.bedrooms) params.set('bedrooms', String(filters.bedrooms));
      if (filters.bathrooms) params.set('bathrooms', String(filters.bathrooms));
      if (filters.amenities?.length) params.set('amenities', filters.amenities.join(','));

      const resp = await fetch(`${getBaseUrl()}/api/properties/search?${params.toString()}`);
      if (!resp.ok) return [];

      const data = await resp.json();
      let properties: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

      if (filters.budgetFriendly) {
        properties = properties.sort((a, b) => (a.rent?.amount || 0) - (b.rent?.amount || 0));
      }

      return properties.slice(0, 5);
    } catch (e) {
      console.error('[AI] property search error:', e);
      return [];
    }
  }

  const SINDI_SYSTEM_PROMPT = `
You are Sindi, an AI tenant-rights assistant for Homiio. Be concise, accurate, and pro-tenant.
- Prioritize tenant rights, fair housing, and current local law.
- Search Homiio properties first when asked for places to rent; then add rights tips.
- Prefer official sources and Sindicat de Llogateres for Catalunya queries.
- Keep answers short unless asked for detail.`.trim();

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

      const isPropertySearch = [
        'find property', 'available property', 'search property', 'rental', 'apartment', 'house', 'room', 'flat', 'pisos', 'lloguer',
        'property near', 'property in', 'available home', 'buscar piso', 'buscar lloguer', 'find home', 'property listings',
        'property for rent', 'pisos en alquiler', 'casas en alquiler', 'habitación', 'room for rent', 'studio', 'shared flat',
        'shared house', 'cercar propietat', 'propietat disponible', 'lloguer disponible', 'apartament', 'casa', 'habitació',
        'pis', 'propietat a prop', 'propietat a', 'llistats de propietats', 'propietat de lloguer', 'pisos de lloguer',
        'cases de lloguer',
      ].some(k => text.includes(k));

      const [searchResults, propertyResults] = await Promise.all([
        needsCurrentInfo ? performWebSearch(last?.content || '') : Promise.resolve(null),
        isPropertySearch ? performAppPropertySearch(last?.content || '') : Promise.resolve(null),
      ]);

      const enhanced: ChatMessage[] = [{ role: 'system', content: SINDI_SYSTEM_PROMPT }, ...messages];

      if (searchResults) {
        enhanced.push({
          role: 'system',
          content:
            `CURRENT INFO\nSource: ${searchResults.source}\nURL: ${searchResults.url}\nContent: ${searchResults.content}`.trim(),
        });
      }

      if (propertyResults?.length) {
        const ctx =
          'PROPERTY RESULTS:\n' +
          propertyResults
            .map(
              (p: any) =>
                `- ${p.title || p.address?.city || 'Property'} ` +
                `(${p.type || ''}${p.rent?.amount ? `, ${p.rent.amount} ${p.rent.currency || ''}` : ''})` +
                `${p.address?.city ? `, ${p.address.city}` : ''}`,
            )
            .join('\n');
        enhanced.push({ role: 'system', content: ctx });
      }

      const result = streamText({ model: openai('gpt-4o'), messages: enhanced });

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
