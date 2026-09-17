import config from '../config';
import {
  getCanonicalSindiServiceToken,
  mintSindiRequesterAssertion,
  SindiRequesterAssertionError,
} from './oxy';

export interface AliaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type FetchClient = typeof fetch;

declare const aliaAgentIdBrand: unique symbol;
type AliaAgentId = string & { readonly [aliaAgentIdBrand]: true };

export const CANONICAL_SINDI_ALIA_AGENT_ID =
  '01a0646a-078f-7514-9800-9f43ceed7df8' as AliaAgentId;

function parseAliaAgentId(value: string | undefined): AliaAgentId | undefined {
  return value === CANONICAL_SINDI_ALIA_AGENT_ID ? CANONICAL_SINDI_ALIA_AGENT_ID : undefined;
}

export class AliaChatError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('Alia chat request failed');
    this.name = 'AliaChatError';
    this.status = status;
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
  status: 401 | 503;
  body: {
    error: string;
    code: 'chat_auth_required' | 'chat_unavailable';
  };
}

/**
 * The client-facing answer for a failed chat turn.
 *
 * Chat NEVER asks for consent: the person is signed in and present, and ADR
 * 0025 (OxyHQServices) admits them through a requester assertion rather than
 * an `acting-as:offline` grant. The frontend's consent banner remains for
 * future absent-user features and is unreachable from this route.
 */
export function aliaChatHttpFailure(error: AliaChatError): AliaChatHttpFailure {
  const isAuthenticationFailure = error.status === 401 || error.status === 403;
  return {
    status: isAuthenticationFailure ? 401 : 503,
    body: {
      error: 'Sindi chat is temporarily unavailable',
      code: isAuthenticationFailure ? 'chat_auth_required' : 'chat_unavailable',
    },
  };
}

/** The person this turn is for, as the incoming request VERIFIED them. */
export interface AliaChatRequester {
  /** `getOxyUserId(req)` — the account Homiio's auth middleware validated. */
  accountId: string;
  /**
   * That request's own Oxy access token. It is sent to OXY ONLY, to mint the
   * requester assertion, and never to Alia.
   */
  accessToken: string;
}

export type RequesterAssertionMinter = (input: {
  subjectToken: string;
  requesterAccountId: string;
  agentId: string;
}) => Promise<string>;

/**
 * Product chat goes through Alia, which owns chat, tools and memory.
 *
 * Alia receives exactly two credentials: Homiio's verified Sindi service token
 * as the bearer (so Oxy bills the Homiio application, ADR 0007) and a one-use
 * requester assertion Oxy minted for the signed-in person (ADR 0025). The
 * person's own bearer and `X-Oxy-User-Id` are never sent. The assertion is
 * minted per turn and not cached, because Oxy consumes it on first use.
 */
export class AliaChatService {
  readonly #apiUrl: string;
  readonly #agentId: AliaAgentId | undefined;
  readonly #fetch: FetchClient;
  readonly #serviceToken: () => Promise<string>;
  readonly #requesterAssertion: RequesterAssertionMinter;

  constructor(input: {
    apiUrl: string;
    agentId?: string;
    serviceToken: () => Promise<string>;
    requesterAssertion: RequesterAssertionMinter;
    fetch?: FetchClient;
  }) {
    this.#apiUrl = input.apiUrl.replace(/\/+$/, '');
    this.#agentId = parseAliaAgentId(input.agentId);
    this.#fetch = input.fetch ?? fetch;
    this.#serviceToken = input.serviceToken;
    this.#requesterAssertion = input.requesterAssertion;
  }

  async streamText(input: {
    requester: AliaChatRequester;
    messages: readonly AliaChatMessage[];
    signal?: AbortSignal;
  }): Promise<AsyncIterable<string>> {
    const agentId = this.#agentId;
    if (!agentId) throw new AliaChatConfigurationError();
    if (input.requester.accountId === '' || input.requester.accessToken === '') {
      throw new AliaChatError(401);
    }

    const [serviceToken, assertion] = await Promise.all([
      this.#serviceToken(),
      this.#requesterAssertion({
        subjectToken: input.requester.accessToken,
        requesterAccountId: input.requester.accountId,
        agentId,
      }).catch((error: unknown) => {
        if (error instanceof SindiRequesterAssertionError && error.kind === 'refused') {
          throw new AliaChatError(401);
        }
        throw new AliaChatError(503);
      }),
    ]);

    const response = await this.#fetch(`${this.#apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceToken}`,
        'X-Oxy-Requester-Assertion': assertion,
      },
      body: JSON.stringify({
        agentId,
        messages: input.messages,
        stream: true,
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    if (!response.ok) {
      // The body is not read: nothing upstream decides what Homiio tells the
      // person beyond the status class.
      await response.body?.cancel().catch(() => undefined);
      throw new AliaChatError(response.status);
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
  requesterAssertion: mintSindiRequesterAssertion,
});
