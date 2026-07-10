import type { Request, Response } from 'express';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

import { logger } from '../../middlewares/logging';
import {
  Conversation,
  isObjectId,
  getUserId,
  err,
  setStreamingHeaders,
  onGracefulClose,
} from './shared';
import {
  SINDI_SYSTEM_PROMPT,
  CONTRACT_SYSTEM_PROMPT,
  IMG_SYSTEM_PROMPT,
  IMAGE_TAG_RE,
  FILE_TAG_RE,
  IMAGE_MAX_INLINE_MB,
  RESULTS_RETURN_MAX,
  ChatMessage,
  parseDataUrl,
  performAppPropertySearch,
  generateAITitle,
  toAmenityFlags,
  compact,
} from '../../services/aiService';

type StreamConversationDoc = {
  save: () => Promise<unknown>;
  addMessage: (role: string, content: string, attachments?: unknown[]) => Promise<unknown>;
  messages: Array<{ role?: string; content?: string }>;
  title: string;
  _id: unknown;
};

async function sendEmptyStream(res: Response) {
  const result = streamText({
    model: openai('gpt-4o'),
    temperature: 0,
    system: 'Return an empty response. Do not output any characters.',
    messages: [{ role: 'user', content: '' }],
    maxTokens: 1,
  } as any);
  (await result).pipeDataStreamToResponse(res);
}

export async function streamChat(req: Request, res: Response) {
  try {
    setStreamingHeaders(res);
    const { messages = [], conversationId } = (req as any).body as {
      messages: ChatMessage[];
      conversationId?: string;
    };

    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    // Ensure conversation
    let conversation: StreamConversationDoc | null = null;
    if (conversationId) {
      if (conversationId.startsWith('conv_')) {
        conversation = new Conversation({
          oxyUserId: userId,
          title: 'New Conversation',
          messages: [],
          status: 'active',
        }) as unknown as StreamConversationDoc;
        await conversation.save();
      } else if (isObjectId(conversationId)) {
        conversation = (await Conversation.findOne({
          _id: conversationId,
          oxyUserId: userId,
        })) as StreamConversationDoc | null;
      } else {
        return err(res, 400, 'Invalid conversation ID format');
      }
    } else {
      conversation = new Conversation({
        oxyUserId: userId,
        title: 'New Conversation',
        messages: [],
        status: 'active',
      }) as unknown as StreamConversationDoc;
      await conversation.save();
    }

    if (!conversation) {
      return err(res, 404, 'Conversation not found');
    }

    const last = messages[messages.length - 1];
    const lastContent = String(last?.content || '');
    const isLastTurnUser = last?.role === 'user';

    const tagMatch = lastContent.match(FILE_TAG_RE) || lastContent.match(IMAGE_TAG_RE);
    const hasInlineFile = !!tagMatch && typeof tagMatch[1] === 'string' && tagMatch[1].startsWith('data:');
    const cleanedLastContent = hasInlineFile
      ? lastContent.replace(FILE_TAG_RE, '').replace(IMAGE_TAG_RE, '').trim()
      : lastContent;
    const isAttachmentStub = hasInlineFile || /^(sent a file:|attached (image|file):)/i.test(lastContent);

    // If last message is not user, return empty stream for clean client resolution
    if (!isLastTurnUser) {
      if (conversationId && conversationId.startsWith('conv_') && conversation?._id) {
        res.setHeader('X-Conversation-ID', conversation._id.toString());
      }
      await sendEmptyStream(res);
      return;
    }

    const propertyResults = isAttachmentStub
      ? { nearby: [], search: [] }
      : await performAppPropertySearch(lastContent, messages);

    // Build enhanced messages
    const enhanced: ChatMessage[] = [{ role: 'system', content: SINDI_SYSTEM_PROMPT }, ...messages];

    if (
      !isAttachmentStub &&
      ((propertyResults?.nearby?.length ?? 0) || (propertyResults?.search?.length ?? 0))
    ) {
      const nearbyList: any[] = Array.isArray(propertyResults?.nearby) ? propertyResults.nearby : [];
      const searchList: any[] = Array.isArray(propertyResults?.search) ? propertyResults.search : [];

      const simplifiedNearby = nearbyList
        .slice(0, RESULTS_RETURN_MAX)
        .map((p: any) => p._id?.toString?.() || p.id)
        .filter(Boolean);
      const simplifiedSearch = searchList
        .slice(0, RESULTS_RETURN_MAX)
        .map((p: any) => p._id?.toString?.() || p.id)
        .filter(Boolean);

      enhanced.push({
        role: 'system',
        content: `<PROPERTIES_HINTS>${JSON.stringify({ nearby: simplifiedNearby, search: simplifiedSearch })}</PROPERTIES_HINTS>`,
      });

      const mergedLists = [...nearbyList.slice(0, RESULTS_RETURN_MAX), ...searchList.slice(0, RESULTS_RETURN_MAX)];
      const seen = new Set<string>();
      const deduped = mergedLists
        .filter((p: any) => {
          const id = p?._id?.toString?.() || p?.id;
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .slice(0, 8);

      // Geo is relational: resolve city/neighborhood NAMES from the canonical
      // geo docs (the address carries ids, not free-text names).
      const { resolveAddressDisplay } = require('../../services/geoDisplayService');
      const contexts = await Promise.all(
        deduped.map(async (p: any) => {
          const geo = await resolveAddressDisplay(p.address);
          return compact({
            id: p._id?.toString?.() || p.id,
            title: p.title,
            type: p.type,
            offerings: Array.isArray(p.offerings) ? p.offerings : undefined,
            longTermRent: p.longTermRent?.monthlyAmount
              ? compact({ monthlyAmount: p.longTermRent.monthlyAmount, currency: p.longTermRent.currency })
              : undefined,
            shortTermRent: p.shortTermRent?.nightlyRate
              ? compact({ nightlyRate: p.shortTermRent.nightlyRate, currency: p.shortTermRent.currency })
              : undefined,
            city: geo.city ?? undefined,
            neighborhood: geo.neighborhood ?? p.address?.district,
            bedrooms: p.bedrooms ?? p.features?.bedrooms,
            bathrooms: p.bathrooms ?? p.features?.bathrooms,
            sizeSqm: p.size ?? p.area?.m2 ?? p.areaSqm,
            amenities: toAmenityFlags(p),
            availabilityDate: p.availableFrom ?? p.availability?.from,
            description:
              p.description || p.summary ? String(p.description || p.summary).slice(0, 240) : undefined,
          });
        }),
      );

      enhanced.push({
        role: 'system',
        content: `<PROPERTIES_CONTEXT>${JSON.stringify(contexts)}</PROPERTIES_CONTEXT>`,
      });
      enhanced.push({
        role: 'system',
        content:
          'If and only if the user explicitly asked to search/show/find/browse listings in their current message, end your reply with a <PROPERTIES_JSON> block by copying the IDs verbatim from the appropriate list in <PROPERTIES_HINTS> (choose "nearby" for requests about nearby/closest/others-like-these; otherwise choose "search"). Otherwise, do not include any <PROPERTIES_JSON> block.',
      });
    }

    // Choose model path
    let result: ReturnType<typeof streamText>;

    if (hasInlineFile) {
      const parsed = parseDataUrl(tagMatch![1]);
      const mediaType = parsed?.mediaType || '';
      const bytes = parsed?.buffer?.byteLength || 0;

      if (mediaType.startsWith('application/pdf')) {
        const prior = (messages as ChatMessage[])
          .slice(0, -1)
          .map(m => ({ role: m.role, content: m.content }));
        const filename = 'upload.pdf';
        const userText =
          (cleanedLastContent || '').slice(0, 2000) || 'Please review this lease/contract and advise.';
        try {
          result = streamText({
            model: openai('gpt-4o-mini'),
            temperature: 0.2,
            messages: [
              { role: 'system', content: SINDI_SYSTEM_PROMPT },
              { role: 'system', content: CONTRACT_SYSTEM_PROMPT },
              ...prior,
              {
                role: 'user',
                content: [
                  { type: 'text', text: userText },
                  { type: 'file', data: parsed!.buffer, mediaType: 'application/pdf', filename },
                ],
              },
            ],
            maxTokens: 700,
          } as any);
        } catch (e) {
          logger.warn('PDF native model path failed, falling back to text extraction', {
            error: (e as Error)?.message,
          });
          const pdfParse = require('pdf-parse');
          const parsedText = await pdfParse(parsed!.buffer).then((r: any) => String(r?.text || ''));
          const clipped = parsedText.slice(0, 120000);
          result = streamText({
            model: openai('gpt-4o'),
            temperature: 0.2,
            messages: [
              { role: 'system', content: SINDI_SYSTEM_PROMPT },
              { role: 'system', content: CONTRACT_SYSTEM_PROMPT },
              ...prior,
              { role: 'user', content: `${userText}\n\n${clipped}` },
            ],
            maxTokens: 700,
          } as any);
        }
      } else if (!mediaType.startsWith('image/')) {
        result = streamText({
          model: openai('gpt-4o'),
          temperature: 0.2,
          messages: [
            { role: 'system', content: SINDI_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `I uploaded a ${mediaType || 'file'}; please accept images (png/jpg/webp) or PDFs for analysis.`,
            },
          ],
          maxTokens: 120,
        } as any);
      } else if (bytes > IMAGE_MAX_INLINE_MB * 1024 * 1024) {
        result = streamText({
          model: openai('gpt-4o'),
          temperature: 0.2,
          messages: [
            { role: 'system', content: SINDI_SYSTEM_PROMPT },
            {
              role: 'user',
              content:
                'The image appears very large (>20MB). Please compress or send a smaller photo. What should I capture for a clear assessment?',
            },
          ],
          maxTokens: 140,
        } as any);
      } else {
        // Image analysis
        const prior = (messages as ChatMessage[])
          .slice(0, -1)
          .map(m => ({ role: m.role, content: m.content }));
        const promptText =
          (cleanedLastContent || '').slice(0, 2000) ||
          'Describe what this image shows that is relevant to a housing issue (e.g., damages, mold, notices). Be concise and helpful to a tenant.';

        result = streamText({
          model: openai('gpt-4o'),
          temperature: 0.2,
          messages: [
            { role: 'system', content: SINDI_SYSTEM_PROMPT },
            { role: 'system', content: IMG_SYSTEM_PROMPT },
            ...prior,
            {
              role: 'user',
              content: [
                { type: 'text', text: promptText },
                { type: 'image', image: parsed!.buffer },
              ],
            },
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
        logger.warn('Failed to persist user message', { error: (e as Error)?.message });
      }
    }

    // Capture AI stream for persistence
    let aiResponse = '';
    (async () => {
      try {
        for await (const chunk of (await result).textStream) aiResponse += chunk;
        if (isLastTurnUser && conversation && aiResponse.trim()) {
          await conversation.addMessage('assistant', aiResponse.trim());

          if (conversation.title === 'New Conversation') {
            const firstUser = conversation.messages.find((m: any) => m.role === 'user')?.content;
            if (firstUser) {
              const title = await generateAITitle(firstUser);
              conversation.title =
                title || (firstUser.length > 50 ? `${firstUser.slice(0, 47)}...` : firstUser);
              await conversation.save();
            }
          }
        }
      } catch (e) {
        logger.warn('Failed to persist assistant message or update title', {
          error: (e as Error)?.message,
        });
      }
    })();

    if (conversationId && conversationId.startsWith('conv_') && conversation?._id) {
      res.setHeader('X-Conversation-ID', conversation._id.toString());
    }

    onGracefulClose(req, res);
    (await result).pipeDataStreamToResponse(res);
  } catch (e: any) {
    if ((res as any).headersSent) {
      try {
        (res as any).end?.();
      } catch (closeErr) {
        // best-effort: response already closed
      }
      return;
    }
    return res.status(500).json({ error: 'Failed to generate streaming response', details: e?.message });
  }
}
