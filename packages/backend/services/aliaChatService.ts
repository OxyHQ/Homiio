import config from '../config';
import { getCanonicalSindiServiceToken } from './oxy';

export interface AliaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type FetchClient = typeof fetch;

declare const aliaAgentIdBrand: unique symbol;
type AliaAgentId = string & { readonly [aliaAgentIdBrand]: true };

export const CANONICAL_SINDI_ALIA_AGENT_ID =
  '01a0646a-078f-7514-9800-9f43ceed7df8' as AliaAgentId;

export const SERVICE_ACTING_AS_UNAUTHORIZED = 'SERVICE_ACTING_AS_UNAUTHORIZED' as const;

type AliaChatErrorCode = typeof SERVICE_ACTING_AS_UNAUTHORIZED;
const MAX_ERROR_BODY_BYTES = 4096;

function parseAliaAgentId(value: string | undefined): AliaAgentId | undefined {
  return value === CANONICAL_SINDI_ALIA_AGENT_ID ? CANONICAL_SINDI_ALIA_AGENT_ID : undefined;
}

export class AliaChatError extends Error {
  readonly status: number;
  readonly code?: AliaChatErrorCode;

  constructor(status: number, code?: AliaChatErrorCode) {
    super('Alia chat request failed');
    this.name = 'AliaChatError';
    this.status = status;
    this.code = code;
  }
}

export class AliaChatConfigurationError extends Error {
  readonly missing = ['SINDI_ALIA_AGENT_ID'] as const;

  constructor() {
    super('Sindi Alia agent is missing or invalid');
    this.name = 'AliaChatConfigurationError';
  }
}

export interface AliaChatHttpFailure {
  status: 401 | 403 | 503;
  body: {
    error: string;
    code: 'chat_auth_required' | 'chat_unavailable' | typeof SERVICE_ACTING_AS_UNAUTHORIZED;
  };
}

/** Map only the explicit consent condition to a client-actionable response. */
export function aliaChatHttpFailure(error: AliaChatError): AliaChatHttpFailure {
  if (error.status === 403 && error.code === SERVICE_ACTING_AS_UNAUTHORIZED) {
    return {
      status: 403,
      body: {
        error: 'Sindi needs your permission to continue',
        code: SERVICE_ACTING_AS_UNAUTHORIZED,
      },
    };
  }
  const isAuthenticationFailure = error.status === 401 || error.status === 403;
  return {
    status: isAuthenticationFailure ? 401 : 503,
    body: {
      error: 'Sindi chat is temporarily unavailable',
      code: isAuthenticationFailure ? 'chat_auth_required' : 'chat_unavailable',
    },
  };
}

/**
 * Product chat goes through Alia, which owns chat, tools and memory. Homiio
 * authenticates with Homiio's verified Oxy service credential and delegates
 * the already-validated user id in a separate header. A human bearer is never
 * forwarded; this adapter stores no Alia or provider credential.
 */
export class AliaChatService {
  readonly #apiUrl: string;
  readonly #agentId: AliaAgentId | undefined;
  readonly #fetch: FetchClient;
  readonly #serviceToken: () => Promise<string>;

  constructor(input: {
    apiUrl: string;
    agentId?: string;
    serviceToken: () => Promise<string>;
    fetch?: FetchClient;
  }) {
    this.#apiUrl = input.apiUrl.replace(/\/+$/, '');
    this.#agentId = parseAliaAgentId(input.agentId);
    this.#fetch = input.fetch ?? fetch;
    this.#serviceToken = input.serviceToken;
  }

  async streamText(input: {
    delegatedUserId: string;
    messages: readonly AliaChatMessage[];
    signal?: AbortSignal;
  }): Promise<AsyncIterable<string>> {
    if (!this.#agentId) throw new AliaChatConfigurationError();
    const serviceToken = await this.#serviceToken();

    const response = await this.#fetch(`${this.#apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceToken}`,
        'X-Oxy-User-Id': input.delegatedUserId,
      },
      body: JSON.stringify({
        agentId: this.#agentId,
        messages: input.messages,
        stream: true,
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    if (!response.ok) {
      throw new AliaChatError(response.status, await readAllowlistedErrorCode(response));
    }
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      throw new AliaChatError(502);
    }
    if (!response.body) throw new AliaChatError(502);

    return readAliaTextStream(response.body);
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Preserve only the upstream condition Homiio can safely act on. */
async function readAllowlistedErrorCode(
  response: Response,
): Promise<AliaChatErrorCode | undefined> {
  if (response.status !== 403) return undefined;

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ERROR_BODY_BYTES) return undefined;

  let body: string;
  try {
    body = await response.text();
  } catch {
    return undefined;
  }
  if (new TextEncoder().encode(body).byteLength > MAX_ERROR_BODY_BYTES) return undefined;

  try {
    const value = JSON.parse(body) as unknown;
    return isRecord(value) && value.code === SERVICE_ACTING_AS_UNAUTHORIZED
      ? SERVICE_ACTING_AS_UNAUTHORIZED
      : undefined;
  } catch {
    return undefined;
  }
}

function textDeltaFromChunk(data: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    throw new AliaChatError(502);
  }

  if (!isRecord(value) || isRecord(value.error) || !Array.isArray(value.choices)) {
    throw new AliaChatError(502);
  }
  if (value.choices.length === 0) return undefined;

  const firstChoice = value.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) throw new AliaChatError(502);
  const content = firstChoice.delta.content;
  if (content === undefined || content === null) return undefined;
  if (typeof content !== 'string') throw new AliaChatError(502);
  return content;
}

/**
 * Parse Alia's OpenAI-compatible SSE without reassembling or interpreting the
 * assistant text. Yielding every content delta verbatim is load-bearing for
 * Sindi: property entity ids inside `<PROPERTIES_JSON>` must survive arbitrary
 * network and model chunk boundaries unchanged.
 */
async function* readAliaTextStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];
  let sawDone = false;

  const dispatch = (): string | undefined => {
    if (dataLines.length === 0) {
      eventName = '';
      return undefined;
    }

    const data = dataLines.join('\n');
    const namedEvent = eventName;
    eventName = '';
    dataLines = [];

    if (namedEvent !== '' && namedEvent !== 'message') return undefined;
    if (data === '[DONE]') {
      sawDone = true;
      return undefined;
    }
    if (sawDone) return undefined;
    return textDeltaFromChunk(data);
  };

  const processLine = (line: string): string | undefined => {
    if (line === '') return dispatch();
    if (line.startsWith(':')) return undefined;

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') eventName = value;
    if (field === 'data') dataLines.push(value);
    return undefined;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        const text = processLine(line);
        if (text !== undefined) yield text;
        newline = buffer.indexOf('\n');
      }

      if (done) break;
    }

    if (buffer !== '') {
      const text = processLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
      if (text !== undefined) yield text;
    }
    const finalText = dispatch();
    if (finalText !== undefined) yield finalText;
    if (!sawDone) throw new AliaChatError(502);
  } finally {
    reader.releaseLock();
  }
}

export const aliaChat = new AliaChatService({
  apiUrl: config.alia.apiUrl,
  agentId: config.alia.sindiAgentId,
  serviceToken: getCanonicalSindiServiceToken,
});
