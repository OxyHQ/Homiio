/**
 * AI Routes — streaming, search, conversations.
 *
 * ## The conversation surface here was BROKEN, and the port is the fix
 *
 * `2d1376a` renamed `Conversation.profileId` to `oxyUserId` and updated the
 * handlers that then lived in `controllers/ai/`. `eeb4845` deleted that
 * directory; this file — the one `routes/index.ts` actually mounts at `/api/ai`
 * — kept the old spelling. mongoose strict mode drops a path the schema does not
 * declare, so every `new Conversation({ profileId })` lost the field and then
 * failed `required: true` on `oxyUserId`, and every `find({ profileId })`
 * matched nothing. Production holds ZERO conversations as a result.
 *
 * The ported handlers key on the session's Oxy account id directly. There is no
 * `Profile` lookup in front of them any more: `conversations.oxy_user_id` IS the
 * owner, so resolving a profile first only added a 404 for a person who has
 * never opened the profile screen.
 *
 * `/history` had the same defect one level up — it read and wrote
 * `profile.chatHistory`, while `ProfileSchema` declares the array at
 * `personalProfile.chatHistory`. Strict mode dropped it on write and returned
 * `undefined` on read, so `GET` always answered `[]`, `POST` stored nothing and
 * `DELETE` was a no-op. All five production profiles have an empty transcript.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { formatDataStreamPart, pipeDataStreamToResponse } from 'ai';
import { OxyInferenceError } from '@oxyhq/core';
import { getOxyUserId } from '@oxyhq/core/server';
import type { InferenceContentPart, InferenceMessage } from '@oxyhq/contracts';
import { getErrorMessage } from '../utils/errors';
import { logger } from '../middlewares/logging';
import { getDb } from '../db/postgres';
import {
  PLACEHOLDER_CONVERSATION_TITLE,
  appendMessages,
  createConversation,
  deleteConversation,
  findConversationForOwner,
  listConversations,
  renameConversation,
  replaceMessages,
  setConversationStatus,
  shareConversation,
  titleFromFirstUserMessage,
  type ConversationRow,
  type MessageInput,
} from '../db/conversations/conversationRepository';
import {
  toConversationDTO,
  toConversationSummaryDTO,
  toMessageDTO,
} from '../db/conversations/conversationSerializer';
import {
  appendProfileChatTurn,
  clearProfileChatHistory,
  ensureProfile,
  listProfileChatHistory,
} from '../db/profiles/profileRepository';
import { resolveAddressDisplay } from '../services/geoDisplayService';
import {
  HomiioInferenceConfigurationError,
  homiioInference,
  textMessage,
} from '../services/oxyInferenceService';
import { AliaChatError, aliaChat } from '../services/aliaChatService';
import pdfParse from 'pdf-parse';

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
  offering: string;
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
// Resolve the authenticated Oxy user id (or null) from a request whose session
// was already populated by `@oxyhq/core/server` auth middleware in server.ts.
const getUserId = (req: Request): string | null => getOxyUserId(req);

const getUserAccessToken = (req: Request): string | null => {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
};

/**
 * The client's own placeholder id for a chat it has not saved yet.
 *
 * `store/conversationStore.ts` mints `conv_<timestamp>` locally so a new chat
 * renders before the server has heard of it, and sends it back on the first
 * `/stream`. It is a request to CREATE, not a lookup key, and it is the reason
 * this file cannot simply treat every `conversationId` as an id.
 */
const CLIENT_PLACEHOLDER_PREFIX = 'conv_';
const isClientPlaceholderId = (id: string): boolean => id.startsWith(CLIENT_PLACEHOLDER_PREFIX);

/**
 * Tell the client which stored conversation its turn landed in.
 *
 * Sent whenever `/stream` CREATED one, which is wider than the Mongo handler:
 * that only set the header when the client had supplied a `conv_…` placeholder,
 * so a request carrying no `conversationId` at all created a conversation and
 * never told anybody its id — an orphan on every such call. Widening it is
 * safe in the only direction that matters, since a client that ignores the
 * header is unaffected.
 */
function announceConversationId(
  res: Response,
  conversation: ConversationRow | undefined,
  isNew: boolean,
): void {
  if (isNew && conversation) res.setHeader('X-Conversation-ID', conversation.id);
}

/**
 * Narrow an untrusted role to one `conversation_messages_role_check` accepts.
 *
 * The CHECK would refuse anything else with a `23514`, which reaches the client
 * as a 500 for input it should have been told about with a 400.
 */
const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
function isMessageRole(value: unknown): value is MessageInput['role'] {
  return typeof value === 'string' && (MESSAGE_ROLES as readonly string[]).includes(value);
}

const CONVERSATION_STATUS_VALUES = ['active', 'archived', 'deleted'] as const;
function isConversationStatus(value: unknown): value is ConversationRow['status'] {
  return (
    typeof value === 'string' && (CONVERSATION_STATUS_VALUES as readonly string[]).includes(value)
  );
}

const ATTACHMENT_TYPES = ['file', 'image', 'document'] as const;

/** The attachments off a request body, dropping anything that is not an object. */
function readAttachmentInputs(value: unknown): MessageInput['attachments'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const attachment = entry as Record<string, unknown>;
    const type = attachment.type;
    const size = attachment.size;
    return [
      {
        type:
          typeof type === 'string' && (ATTACHMENT_TYPES as readonly string[]).includes(type)
            ? (type as (typeof ATTACHMENT_TYPES)[number])
            : undefined,
        name: typeof attachment.name === 'string' ? attachment.name : undefined,
        url: typeof attachment.url === 'string' ? attachment.url : undefined,
        size: typeof size === 'number' && Number.isFinite(size) ? size : undefined,
      },
    ];
  });
}

/**
 * The opening transcript off a request body.
 *
 * `messages` wins over `initialMessage`, matching the Mongo handler's
 * `if (Array.isArray(messages)) … else if (initialMessage) …`. A turn with no
 * usable role or content is DROPPED rather than defaulted to `user` with an
 * empty string: `content` is `NOT NULL` and an empty assistant turn in a
 * transcript is worse than a missing one.
 */
function readMessageInputs(messages: unknown, initialMessage: unknown): MessageInput[] {
  if (Array.isArray(messages)) {
    return messages.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const message = entry as Record<string, unknown>;
      if (!isMessageRole(message.role)) return [];
      if (typeof message.content !== 'string' || message.content === '') return [];
      const timestamp =
        typeof message.timestamp === 'string' || typeof message.timestamp === 'number'
          ? new Date(message.timestamp)
          : undefined;
      return [
        {
          role: message.role,
          content: message.content,
          timestamp: timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : undefined,
          attachments: readAttachmentInputs(message.attachments),
        },
      ];
    });
  }
  if (typeof initialMessage === 'string' && initialMessage !== '') {
    return [{ role: 'user', content: initialMessage }];
  }
  return [];
}

/**
 * The two `mongoose.Types.ObjectId.isValid` guards that used to live here are
 * DELETED rather than widened.
 *
 * `db/ids.ts` names this file specifically: the guard was reached through a
 * local `isObjectId` wrapper, so a grep for the literal saw one site where there
 * were three. Post-cutover it answers `false` for every uuid v7, so keeping it
 * would 400 every conversation created from the cutover onward. A `text` column
 * takes any string and a lookup for a nonsense id returns no rows, which is the
 * 404 the handler already produces — so the guard has nothing left to do.
 */
const getBaseUrl = () => {
  const baseUrl = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
  return baseUrl;
};

const ok = (res: Response, data: any) => res.json(data);
const err = (res: Response, code: number, message: string) => res.status(code).json({ error: message });

const pipeTextDataStream = (res: Response, text: string): void => {
  pipeDataStreamToResponse(res, {
    execute(writer) {
      if (text !== '') writer.write(formatDataStreamPart('text', text));
    },
  });
};

const sendEmptyStream = (res: Response): void => pipeTextDataStream(res, '');

const setStreamingHeaders = (res: Response) => {
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setTimeout(0);
};

const onGracefulClose = (req: Request, res: Response) => {
  const onClose = () => {
    try {
      res.end();
    } catch (error: unknown) {
      logger.warn('Failed to end AI response on client disconnect', { error: getErrorMessage(error) });
    }
  };
  req.on('aborted', onClose);
  res.on('close', onClose);
};

const toInferenceMessages = (messages: readonly ChatMessage[]): InferenceMessage[] =>
  messages
    .filter((message) => message.role !== 'tool')
    .map((message) => textMessage(message.role, message.content));

const inlineContent = (
  type: 'image' | 'file',
  mediaType: string,
  buffer: Buffer,
  filename?: string,
): InferenceContentPart => ({
  type,
  source: { kind: 'inline', mediaType, data: buffer.toString('base64') },
  ...(type === 'file' && filename ? { filename } : {}),
});

const inferenceFailure = (res: Response, error: unknown, message: string): Response => {
  if (error instanceof HomiioInferenceConfigurationError) {
    return res.status(503).json({ error: message, code: 'inference_not_configured' });
  }
  if (error instanceof OxyInferenceError) {
    if (error.retryAfterMs !== undefined) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil(error.retryAfterMs / 1000)));
    }
    return res.status(error.status === 429 ? 429 : 503).json({
      error: message,
      code: error.code,
      requestId: error.requestId,
      retryable: error.retryable,
    });
  }
  return res.status(500).json({ error: message });
};

const chatFailure = (res: Response, error: unknown): Response => {
  if (error instanceof AliaChatError) {
    return res.status(error.status === 401 || error.status === 403 ? 401 : 503).json({
      error: 'Sindi chat is temporarily unavailable',
      code: error.status === 401 || error.status === 403 ? 'chat_auth_required' : 'chat_unavailable',
    });
  }
  return res.status(500).json({ error: 'Failed to generate response' });
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
    } catch (error: unknown) {
      logger.warn('Failed to parse <PROPERTIES_JSON> block from assistant message', {
        error: getErrorMessage(error),
      });
    }
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
};

// -------------------------------
// AI helpers
// -------------------------------
async function generateAITitle(userMessage: string, oxyUserId: string) {
  try {
    let title = await homiioInference.respondText({
      delegatedUserId: oxyUserId,
      feature: 'conversation-title',
      messages: [
        textMessage(
          'system',
          "Generate a concise, descriptive title (≤50 chars) for a tenant-rights chat based on the first user message. Return ONLY the title, no quotes.",
        ),
        textMessage('user', userMessage),
      ],
      temperature: 0.3,
      maxOutputTokens: 24,
    });
    title = title.trim().replace(/^["']|["']$/g, '');
    if (title.length > 50) title = `${title.slice(0, 47)}...`;
    return title && title !== 'New Conversation' ? title : null;
  } catch {
    return null;
  }
}

async function extractFiltersWithAI(
  userText: string,
  oxyUserId: string,
): Promise<PropertyFilters> {
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
    const text = await homiioInference.respondText({
      delegatedUserId: oxyUserId,
      feature: 'property-filter-extraction',
      messages: [textMessage('system', instruction), textMessage('user', String(userText || ''))],
      temperature: 0,
      maxOutputTokens: 256,
      responseFormat: { type: 'json_object' },
    });
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return {};

    const raw = JSON.parse(trimmed.slice(start, end + 1));
    const out: PropertyFilters = {};

    const numberish = (v: unknown) => (v != null && !isNaN(Number(v)) ? Number(v) : undefined);
    const put = <K extends keyof PropertyFilters>(k: K, v: PropertyFilters[K] | undefined) => {
      const valid = Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';
      if (valid) out[k] = v;
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
    put('offering', typeof raw.offering === 'string' ? raw.offering : undefined);
    put('proximityToTransport', typeof raw.proximityToTransport === 'boolean' ? raw.proximityToTransport : undefined);
    put('proximityToSchools', typeof raw.proximityToSchools === 'boolean' ? raw.proximityToSchools : undefined);
    put('proximityToShopping', typeof raw.proximityToShopping === 'boolean' ? raw.proximityToShopping : undefined);
    put('availableFromBefore', typeof raw.availableFromBefore === 'string' ? raw.availableFromBefore : undefined);
    put('availableFromAfter', typeof raw.availableFromAfter === 'string' ? raw.availableFromAfter : undefined);

    return out;
  } catch {
    return {};
  }
}

async function analyzeHousingFile(input: {
  buffer: Buffer;
  mediaType: string;
  filename: string;
  userText: string;
  oxyUserId: string;
}): Promise<string> {
  if (input.mediaType.startsWith('application/pdf')) {
    const system =
      'You are a tenant-friendly contract and lease reviewer. Identify risky clauses, illegal terms, fees, early termination, maintenance, deposits, and notice periods. Provide brief, actionable advice and questions to ask a landlord. Be concise.';
    let parsedText = '';
    try {
      parsedText = await pdfParse(input.buffer).then((result) => String(result.text || ''));
    } catch (error: unknown) {
      logger.info('PDF text extraction unavailable; sending the file through Oxy inference', {
        error: getErrorMessage(error),
      });
    }
    const prompt = input.userText || 'Please review this lease/contract and advise.';
    const content: InferenceContentPart[] = [
      { type: 'text', text: parsedText ? `${prompt}\n\n${parsedText.slice(0, 120000)}` : prompt },
    ];
    if (!parsedText) {
      content.push(inlineContent('file', input.mediaType, input.buffer, input.filename));
    }
    return homiioInference.respondText({
      delegatedUserId: input.oxyUserId,
      feature: 'contract-review',
      messages: [textMessage('system', system), { role: 'user', content }],
      maxOutputTokens: 700,
      temperature: 0.2,
    });
  }

  if (input.mediaType.startsWith('image/')) {
    const prompt =
      input.userText ||
      'Describe what this image shows that is relevant to a housing issue (e.g., damages, mold, notices). Be concise and helpful to a tenant.';
    return homiioInference.respondText({
      delegatedUserId: input.oxyUserId,
      feature: 'housing-image-analysis',
      messages: [
        textMessage(
          'system',
          'You analyze tenant-related images (e.g., damages, notices) and produce a brief, actionable summary. Be concise and specific. If the image is unclear, ask for one brief clarification question.',
        ),
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            inlineContent('image', input.mediaType, input.buffer),
          ],
        },
      ],
      maxOutputTokens: 512,
      temperature: 0.2,
    });
  }

  throw new Error('Unsupported media type');
}

async function performAppPropertySearch(
  query: string,
  priorMessages: ChatMessage[],
  oxyUserId: string,
) {
  try {
    const prevIds = extractLastPropertyIdsFromMessages(priorMessages);
    const filters = await extractFiltersWithAI(query, oxyUserId);

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
          logger.warn('AI nearby property search returned non-OK', { status: resp.status });
        }
      }
    }

    // Search
    const searchParams = buildSearchParams(filters, {
      limit: DEFAULT_LIST_LIMIT,
      query: searchQuery || '', // Convert undefined to empty string
      excludeIds: prevIds,
    });
    const resp = await fetch(`${getBaseUrl()}/api/properties/search?${searchParams.toString()}`);
    const searchData = resp.ok ? await resp.json() : null;
    
    const search = Array.isArray(searchData?.data) ? searchData.data : Array.isArray(searchData) ? searchData : [];

    return { nearby: nearby.slice(0, RESULTS_RETURN_MAX), search: search.slice(0, RESULTS_RETURN_MAX) };
  } catch {
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

  // ---------- Generate Smart Suggestions ----------
  router.post('/suggestions', async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return err(res, 401, 'Unauthorized');

      // The `Profile.findByOxyUserId` gate that stood here is GONE. It bound
      // `activeProfile` and never read it: the profile row scoped nothing, so
      // the only thing it did was 404 an authenticated caller who had never
      // opened the profile screen. Same removal, same reason, as in `/stream`
      // and `/history` — and the same reason `getUserId` above is the real gate.

      const { propertyContext, conversationContext } = req.body || {};
      
      // Build context for AI suggestion generation
      let contextPrompt = 'Generate 5-6 relevant, actionable chat suggestions for a rental property chat assistant. ';
      
      if (propertyContext) {
        const { type, city, bedrooms, bathrooms, longTermRent, shortTermRent, amenities } = propertyContext;
        contextPrompt += `Property context: ${type || 'Property'} in ${city || 'the area'}`;
        if (bedrooms) contextPrompt += `, ${bedrooms} bedrooms`;
        if (bathrooms) contextPrompt += `, ${bathrooms} bathrooms`;
        // Deliberately NOT the shared display formatter (issue #357): this is a
        // PROMPT, and its reader is a language model. A bare amount beside its
        // ISO code is unambiguous to one; `1.700 €` is a grouping convention it
        // has to guess at, and the guess is wrong exactly where the separators
        // differ. The currency code is always emitted, so the model is never
        // handed a naked number.
        if (longTermRent?.monthlyAmount) {
          contextPrompt += `, ${longTermRent.monthlyAmount} ${longTermRent.currency || 'EUR'}/month`;
        } else if (shortTermRent?.nightlyRate) {
          contextPrompt += `, ${shortTermRent.nightlyRate} ${shortTermRent.currency || 'EUR'}/night`;
        }
        if (amenities?.length) contextPrompt += `, amenities: ${amenities.slice(0, 3).join(', ')}`;
        contextPrompt += '. ';
      }

      if (conversationContext) {
        contextPrompt += `Recent conversation topics: ${conversationContext.slice(0, 200)}. `;
      }

      contextPrompt += `
Return suggestions as a JSON array of objects with only "text" field. 
Focus on practical questions tenants ask about properties: budget, legal rights, neighborhood, lease terms, inspections, negotiations, and area information.
Make suggestions conversational and specific. Examples:
{"text": "How much should I budget monthly?"}
{"text": "What should I inspect before signing?"}
{"text": "Tell me about this neighborhood"}
{"text": "Review these lease terms"}

Return only the JSON array, no other text.`;

      const generatedText = await homiioInference.respondText({
        delegatedUserId: userId,
        feature: 'smart-suggestions',
        messages: [
          textMessage(
            'system',
            'You are a helpful AI that generates relevant chat suggestions for rental property conversations. Return valid JSON only.',
          ),
          textMessage('user', contextPrompt),
        ],
        temperature: 0.7,
        maxOutputTokens: 500,
      });

      // Parse AI response
      let suggestions;
      try {
        // Clean the response and extract JSON
        const cleaned = generatedText.trim().replace(/```json|```/g, '');
        suggestions = JSON.parse(cleaned);
        
        // Validate format
        if (!Array.isArray(suggestions)) {
          throw new Error('Response is not an array');
        }
        
        // Ensure all suggestions have required fields
        suggestions = suggestions.filter(s => s.text && typeof s.text === 'string');
        
        // Limit to 8 suggestions max
        suggestions = suggestions.slice(0, 8);
        
      } catch {
        // Fallback to default suggestions
        suggestions = [
          { text: 'How much should I budget?' },
          { text: 'Review my lease terms' },
          { text: 'What are my rights?' },
          { text: 'Tell me about this area' },
          { text: 'Are there hidden costs?' },
          { text: 'What should I inspect?' },
          { text: 'How to negotiate rent?' },
          { text: 'Red flags to watch for?' },
        ];
      }

      return ok(res, {
        success: true,
        suggestions,
        generated: suggestions.length > 0,
        propertyContext: !!propertyContext,
      });

    } catch (error: unknown) {
      logger.error('AI suggestions failed', { error: getErrorMessage(error) });
      return inferenceFailure(res, error, 'Failed to generate suggestions');
    }
  });

  // ---------- Streaming chat ----------
  router.post('/stream', async (req: Request, res: Response) => {
    try {
      setStreamingHeaders(res);
      const { messages = [], conversationId } = (req.body ?? {}) as { messages?: ChatMessage[]; conversationId?: string };

      const userId = getUserId(req);
      if (!userId) return err(res, 401, 'Unauthorized');
      const userAccessToken = getUserAccessToken(req);
      if (!userAccessToken) return err(res, 401, 'User session token required');

      // No `Profile` lookup: `conversations.oxy_user_id` is the owner, so the
      // "No active profile found" 404 was refusing a chat to anyone who had
      // never opened the profile screen, for no benefit.
      //
      // A client placeholder id (`conv_…`), or none at all, means CREATE. A real
      // id means look it up, scoped to the caller — the ownership is in the
      // predicate, never a second statement.
      // **The CLIENT owns creation, and this handler must not race it.**
      //
      // `useSindiConversation` sends `conversationId: undefined` for a chat it
      // has not persisted yet, and `conversationStore.saveConversation`
      // separately POSTs `/ai/conversations` with the whole transcript. So
      // treating "no id" as CREATE — which the Mongo handler did — produces TWO
      // rows for one chat, one of which the user cannot recognise. That never
      // showed up before only because every Mongo write failed validation; the
      // moment the write path works, the duplicate is real and visible in
      // `GET /ai/conversations`.
      //
      // Nothing on the client reads `X-Conversation-ID` either (the AI SDK's
      // `useChat` does not surface response headers), so announcing the id
      // cannot reconcile the two. Hence: no id means PERSIST NOTHING and let the
      // client's own POST be the single writer. An explicit `conv_…` placeholder
      // still means create — a caller that sends one is asking for a row, and it
      // gets the header back.
      const db = getDb();
      let conversation: ConversationRow | undefined;
      let conversationIsNew = false;
      if (conversationId && !isClientPlaceholderId(conversationId)) {
        conversation = (await findConversationForOwner(db, conversationId, userId))?.conversation;
      } else if (conversationId) {
        conversation = (
          await db.transaction((tx) =>
            createConversation(tx, {
              oxyUserId: userId,
              title: PLACEHOLDER_CONVERSATION_TITLE,
            }),
          )
        ).conversation;
        conversationIsNew = true;
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
        announceConversationId(res, conversation, conversationIsNew);
        sendEmptyStream(res);
        return;
      }

      const propertyResults = isAttachmentStub
        ? { nearby: [], search: [] }
        : await performAppPropertySearch(lastContent, messages, userId);

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
              description: (p.description || p.summary) ? String(p.description || p.summary).slice(0, 240) : undefined,
            });
          }),
        );

        enhanced.push({ role: 'system', content: `<PROPERTIES_CONTEXT>${JSON.stringify(contexts)}</PROPERTIES_CONTEXT>` });
        enhanced.push({
          role: 'system',
          content:
            'If and only if the user explicitly asked to search/show/find/browse listings in their current message, end your reply with a <PROPERTIES_JSON> block by copying the IDs verbatim from the appropriate list in <PROPERTIES_HINTS> (choose "nearby" for requests about nearby/closest/others-like-these; otherwise choose "search"). Otherwise, do not include any <PROPERTIES_JSON> block.',
        });
      }

      let aiResponse: string;

      if (hasInlineFile) {
        // Multimodal: image or PDF
        const parsed = tagMatch ? parseDataUrl(tagMatch[1]) : null;
        const mediaType = parsed?.mediaType || '';
        const bytes = parsed?.buffer?.byteLength || 0;

        // PDF
        if (parsed && mediaType.startsWith('application/pdf')) {
          const CONTRACT_SYSTEM =
            'You are a tenant-friendly contract and lease reviewer. You identify risky clauses, illegal terms (jurisdiction-aware at a high level), fees, early termination, maintenance, deposits, and notice periods. Provide brief, actionable advice and suggest questions to ask a landlord. Be concise.';
          const prior = toInferenceMessages(messages.slice(0, -1));
          const userText =
            (cleanedLastContent || '').slice(0, 2000) ||
            'Please review this lease/contract and advise.';
          let parsedText = '';
          try {
            parsedText = await pdfParse(parsed.buffer).then((result) => String(result.text || ''));
          } catch (error: unknown) {
            logger.info('PDF text extraction unavailable; sending the file through Oxy inference', {
              error: getErrorMessage(error),
            });
          }
          const content: InferenceContentPart[] = [
            { type: 'text', text: parsedText ? `${userText}\n\n${parsedText.slice(0, 120000)}` : userText },
          ];
          if (!parsedText) {
            content.push(inlineContent('file', mediaType, parsed.buffer, 'upload.pdf'));
          }
          aiResponse = await homiioInference.respondText({
            delegatedUserId: userId,
            feature: 'contract-review',
            messages: [
              textMessage('system', SINDI_SYSTEM_PROMPT),
              textMessage('system', CONTRACT_SYSTEM),
              ...prior,
              { role: 'user', content },
            ],
            maxOutputTokens: 700,
            temperature: 0.2,
          });
        } else if (!mediaType.startsWith('image/')) {
          aiResponse = `I can’t analyze ${mediaType || 'this file type'}. Please upload an image (PNG, JPEG, or WebP) or a PDF.`;
        } else if (bytes > IMAGE_MAX_INLINE_MB * 1024 * 1024) {
          aiResponse =
            'The image is larger than 20 MB. Please compress it or send a smaller, well-lit photo that clearly shows the housing issue.';
        } else if (parsed) {
          // Image analysis
          const prior = toInferenceMessages(messages.slice(0, -1));
          const promptText =
            (cleanedLastContent || '').slice(0, 2000) ||
            'Describe what this image shows that is relevant to a housing issue (e.g., damages, mold, notices). Be concise and helpful to a tenant.';
          const IMG_SYSTEM =
            'You analyze tenant-related images (e.g., damages, notices) and produce a brief, actionable summary. Be concise and specific. If the image is unclear, ask for one brief clarification question.';

          aiResponse = await homiioInference.respondText({
            delegatedUserId: userId,
            feature: 'housing-image-analysis',
            messages: [
              textMessage('system', SINDI_SYSTEM_PROMPT),
              textMessage('system', IMG_SYSTEM),
              ...prior,
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptText },
                  inlineContent('image', mediaType, parsed.buffer),
                ],
              },
            ],
            maxOutputTokens: 512,
            temperature: 0.2,
          });
        } else {
          aiResponse = 'I couldn’t read that attachment. Please upload it again.';
        }
      } else if (isAttachmentStub) {
        aiResponse = '';
      } else {
        aiResponse = await aliaChat.respondText({
          accessToken: userAccessToken,
          messages: enhanced
            .filter((message) => message.role !== 'tool')
            .map((message) => ({
              role: message.role as 'system' | 'user' | 'assistant',
              content: message.content,
            })),
        });
      }

      // Save last user message (strip inline base64)
      const lastUser = messages[messages.length - 1];
      const savedUserContent =
        conversation && lastUser?.role === 'user' && lastUser?.content
          ? hasInlineFile
            ? cleanedLastContent || 'Sent a file'
            : String(lastUser.content)
          : undefined;
      if (conversation && savedUserContent) {
        try {
          await appendMessages(db, conversation.id, [{ role: 'user', content: savedUserContent }]);
        } catch (error: unknown) {
          logger.warn('Failed to persist user message to conversation', { error: getErrorMessage(error) });
        }
      }

      const persisted = conversation;
      (async () => {
        try {
          // Always save assistant reply if we have one and the last turn was a user message
          if (isLastTurnUser && persisted && aiResponse.trim()) {
            await appendMessages(db, persisted.id, [
              { role: 'assistant', content: aiResponse.trim() },
            ]);

            // Name the conversation from its first user turn, which is what
            // Mongo's `pre('save')` hook did. The title is re-read from the
            // ROW rather than from the local copy: `persisted` was loaded
            // before the stream started and another turn may have renamed it
            // since, and the rename is scoped to the owner either way.
            const current = await findConversationForOwner(db, persisted.id, persisted.oxyUserId);
            const firstUser = current?.messages.find((m) => m.message.role === 'user')?.message
              .content;
            if (current?.conversation.title === PLACEHOLDER_CONVERSATION_TITLE && firstUser) {
              const generated = await generateAITitle(firstUser, persisted.oxyUserId);
              await renameConversation(
                db,
                persisted.id,
                persisted.oxyUserId,
                generated || titleFromFirstUserMessage(firstUser),
              );
            }
          }
        } catch (error: unknown) {
          logger.warn('Failed to persist assistant reply to conversation', { error: getErrorMessage(error) });
        }
      })();

      announceConversationId(res, conversation, conversationIsNew);

      onGracefulClose(req, res);
      pipeTextDataStream(res, aiResponse);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.error('AI stream failed', { error: message });
      if (res.headersSent) {
        try {
          res.end();
        } catch (endError) {
          logger.warn('Failed to end aborted AI stream response', { error: getErrorMessage(endError) });
        }
        return;
      }
      return error instanceof AliaChatError
        ? chatFailure(res, error)
        : inferenceFailure(res, error, 'Failed to generate response');
    }
  });

  // ---------- Analyze single uploaded file (JSON response) ----------
  router.post('/analyze-file', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return err(res, 401, 'Unauthorized');

      // The `Profile.findByOxyUserId` gate that stood here is GONE. It bound
      // `activeProfile` and never read it: the profile row scoped nothing, so
      // the only thing it did was 404 an authenticated caller who had never
      // opened the profile screen. Same removal, same reason, as in `/stream`
      // and `/history` — and the same reason `getUserId` above is the real gate.

      const file = req.file;
      if (!file?.buffer) return err(res, 400, 'file is required (multipart/form-data, key: file)');

      const mediaType = file.mimetype || 'application/octet-stream';
      const userTextRaw: string = typeof req.body?.text === 'string' ? req.body.text : '';
      const userText = userTextRaw.trim().slice(0, 2000);
      if (!mediaType.startsWith('application/pdf') && !mediaType.startsWith('image/')) {
        return err(res, 415, 'Unsupported media type. Please upload an image (png/jpeg/webp) or a PDF.');
      }
      const output = await analyzeHousingFile({
        buffer: file.buffer,
        mediaType,
        filename: file.originalname || 'upload',
        userText,
        oxyUserId: userId,
      });
      const fallback = mediaType.startsWith('application/pdf')
        ? 'I couldn’t read this PDF. Please share a text version or try an OCR scan, and I’ll review it.'
        : 'I couldn’t extract clear details from this image. Please try a clearer photo, or describe what you’d like me to look for.';
      return ok(res, {
        output: output.trim() || fallback,
        filename: file.originalname,
        mediaType,
      });
    } catch (error: unknown) {
      logger.error('AI analyze-file failed', { error: getErrorMessage(error) });
      return inferenceFailure(res, error, 'File analysis is unavailable');
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

      const userId = getUserId(req);
      if (!userId) return err(res, 401, 'Unauthorized');

      // The `Profile.findByOxyUserId` gate that stood here is GONE. It bound
      // `activeProfile` and never read it: the profile row scoped nothing, so
      // the only thing it did was 404 an authenticated caller who had never
      // opened the profile screen. Same removal, same reason, as in `/stream`
      // and `/history` — and the same reason `getUserId` above is the real gate.

      const file = req.file;
      if (!file?.buffer) return err(res, 400, 'file is required (multipart/form-data, key: file)');

      const mediaType = file.mimetype || 'application/octet-stream';
      const userTextRaw: string = typeof req.body?.text === 'string' ? req.body.text : '';
      const userText = userTextRaw.trim().slice(0, 2000);
      if (!mediaType.startsWith('application/pdf') && !mediaType.startsWith('image/')) {
        return err(res, 415, 'Unsupported media type. Please upload an image (png/jpeg/webp) or a PDF.');
      }
      const output = await analyzeHousingFile({
        buffer: file.buffer,
        mediaType,
        filename: file.originalname || 'upload',
        userText,
        oxyUserId: userId,
      });

      onGracefulClose(req, res);
      pipeTextDataStream(res, output);
    } catch (error: unknown) {
      logger.error('AI analyze-file stream failed', { error: getErrorMessage(error) });
      if (res.headersSent) {
        try {
          res.end();
        } catch (endError) {
          logger.warn('Failed to end aborted AI analyze-file stream response', { error: getErrorMessage(endError) });
        }
        return;
      }
      return inferenceFailure(res, error, 'File analysis is unavailable');
    }
  });

  // ---------- Health ----------
  router.get('/health', (_req, res) =>
    ok(res, {
      status: homiioInference.configurationFailure.length === 0 ? 'ok' : 'degraded',
      service: 'Oxy inference edge adapter',
      features: ['buffered-data-stream', 'image-input', 'pdf-file-input'],
      configured: homiioInference.configurationFailure.length === 0,
      timestamp: new Date().toISOString(),
    }),
  );

  // ---------- Legacy simple history on the profile ----------
  //
  // All three of these wrote `profile.chatHistory`, a path `ProfileSchema` does
  // not declare (the array lives at `personalProfile.chatHistory`), so strict
  // mode dropped it on every write and returned `undefined` on every read. The
  // ported versions use `profile_chat_messages` — see the file header.
  //
  // The 404 for a person with no profile row is gone with the same reasoning as
  // in `/stream`: the transcript belongs to an Oxy account, and creating the
  // empty sidecar row is cheaper than refusing the request.
  router.get('/history', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const db = getDb();
    const profile = await db.transaction((tx) => ensureProfile(tx, userId));
    const rows = await listProfileChatHistory(db, profile.profile.id);
    // Newest first, matching the Mongo handler's `[...].reverse()` on an
    // oldest-first array.
    const history = [...rows]
      .reverse()
      .map((row) => ({ id: row.id, role: row.role, content: row.content, timestamp: row.timestamp }));
    return ok(res, { success: true, history });
  });

  router.delete('/history', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const db = getDb();
    const profile = await db.transaction((tx) => ensureProfile(tx, userId));
    const cleared = await clearProfileChatHistory(db, profile.profile.id);
    return ok(res, { success: true, cleared });
  });

  router.post('/history', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const { userMessage, assistantMessage } = (req.body ?? {}) as {
      userMessage?: unknown;
      assistantMessage?: unknown;
    };
    if (typeof userMessage !== 'string' || typeof assistantMessage !== 'string') {
      return err(res, 400, 'Missing userMessage or assistantMessage');
    }

    // One transaction: the append locks the profile row, inserts both turns and
    // trims to the cap, and a partial application would leave the transcript
    // holding a question with no answer.
    await getDb().transaction(async (tx) => {
      const profile = await ensureProfile(tx, userId);
      await appendProfileChatTurn(tx, profile.profile.id, { userMessage, assistantMessage });
    });

    return ok(res, { success: true });
  });

  // ---------- Conversation CRUD ----------
  //
  // Every handler below is scoped by `oxy_user_id` IN THE PREDICATE, so a
  // conversation belonging to somebody else is indistinguishable from one that
  // does not exist — a 404 either way, and no second authorisation statement to
  // forget.
  router.get('/conversations', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const summaries = await listConversations(getDb(), userId);
    return ok(res, { success: true, conversations: summaries.map(toConversationSummaryDTO) });
  });

  router.post('/conversations', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const { title, initialMessage, messages } = (req.body ?? {}) as {
      title?: unknown;
      initialMessage?: unknown;
      messages?: unknown;
    };

    const opening = readMessageInputs(messages, initialMessage);
    const db = getDb();
    let hydrated = await db.transaction((tx) =>
      createConversation(tx, {
        oxyUserId: userId,
        title: typeof title === 'string' ? title : undefined,
        initialMessage: typeof initialMessage === 'string' ? initialMessage : undefined,
        messages: opening,
      }),
    );

    // Name it from the first user turn, as the Mongo handler did. The AI call
    // is deliberately OUTSIDE the transaction: it is a network round trip to
    // the Oxy inference edge, and holding a Postgres transaction open across
    // one is how a slow inference request turns into a connection-pool outage.
    const firstUser = hydrated.messages.find((m) => m.message.role === 'user')?.message.content;
    if (firstUser && hydrated.conversation.title === PLACEHOLDER_CONVERSATION_TITLE) {
      const generated = await generateAITitle(firstUser, userId);
      if (generated) {
        const renamed = await renameConversation(db, hydrated.conversation.id, userId, generated);
        if (renamed) hydrated = { conversation: renamed, messages: hydrated.messages };
      }
    }

    return ok(res, { success: true, conversation: toConversationDTO(hydrated) });
  });

  router.get('/conversations/:id', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const conversationId = String(req.params.id || '');
    if (!conversationId) return err(res, 400, 'Invalid conversation ID');

    const hydrated = await findConversationForOwner(getDb(), conversationId, userId);
    if (!hydrated) return err(res, 404, 'Conversation not found');

    return ok(res, { success: true, conversation: toConversationDTO(hydrated) });
  });

  router.put('/conversations/:id', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const conversationId = String(req.params.id || '');
    const { title, messages, status } = (req.body ?? {}) as {
      title?: unknown;
      messages?: unknown;
      status?: unknown;
    };

    const db = getDb();
    const hydrated = await db.transaction(async (tx) => {
      const existing = await findConversationForOwner(tx, conversationId, userId);
      if (!existing) return undefined;

      if (typeof title === 'string') {
        await renameConversation(tx, conversationId, userId, title);
      }
      if (isConversationStatus(status)) {
        await setConversationStatus(tx, conversationId, userId, status);
      }
      if (Array.isArray(messages)) {
        await replaceMessages(tx, conversationId, readMessageInputs(messages, undefined));
      }
      return findConversationForOwner(tx, conversationId, userId);
    });

    if (!hydrated) return err(res, 404, 'Conversation not found');
    return ok(res, { success: true, conversation: toConversationDTO(hydrated) });
  });

  router.post('/conversations/:id/messages', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const conversationId = String(req.params.id || '');
    const { role, content, attachments } = (req.body ?? {}) as {
      role?: unknown;
      content?: unknown;
      attachments?: unknown;
    };
    if (!isMessageRole(role) || typeof content !== 'string' || content === '') {
      return err(res, 400, 'Role and content are required');
    }

    const db = getDb();
    // Ownership is checked BEFORE the append rather than folded into it:
    // `appendMessages` works on a conversation id, and a stranger appending to
    // somebody else's transcript must not be able to write the row first and be
    // refused afterwards.
    const owned = await findConversationForOwner(db, conversationId, userId);
    if (!owned) return err(res, 404, 'Conversation not found');

    const [appended] = await appendMessages(db, conversationId, [
      { role, content, attachments: readAttachmentInputs(attachments) },
    ]);
    const hydrated = await findConversationForOwner(db, conversationId, userId);
    if (!hydrated) return err(res, 404, 'Conversation not found');

    const message = hydrated.messages.find((m) => m.message.id === appended.id);
    return ok(res, {
      success: true,
      message: message ? toMessageDTO(message) : null,
      conversation: toConversationDTO(hydrated),
    });
  });

  router.delete('/conversations/:id', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const deleted = await deleteConversation(getDb(), String(req.params.id || ''), userId);
    if (!deleted) return err(res, 404, 'Conversation not found');

    return ok(res, { success: true, message: 'Conversation deleted' });
  });

  router.post('/conversations/:id/share', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const shared = await shareConversation(getDb(), String(req.params.id || ''), userId);
    if (!shared) return err(res, 404, 'Conversation not found');

    return ok(res, {
      success: true,
      shareToken: shared.token,
      shareUrl: `/shared/${shared.token}`,
    });
  });

  return router;
}
