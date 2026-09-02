import config from '../config';
import { isLiveEntityId } from '../db/ids';

export interface AliaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type FetchClient = typeof fetch;

declare const aliaAgentIdBrand: unique symbol;
type AliaAgentId = string & { readonly [aliaAgentIdBrand]: true };

function parseAliaAgentId(value: string | undefined): AliaAgentId | undefined {
  const candidate = value?.trim();
  return candidate && isLiveEntityId(candidate) ? (candidate as AliaAgentId) : undefined;
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

/**
 * Product chat goes through Alia, which owns chat, tools and memory. Homiio
 * forwards the already-validated Oxy user token; this adapter stores no Alia or
 * provider credential and never learns which Kaana provider served the turn.
 */
export class AliaChatService {
  readonly #apiUrl: string;
  readonly #agentId: AliaAgentId | undefined;
  readonly #fetch: FetchClient;

  constructor(input: { apiUrl: string; agentId?: string; fetch?: FetchClient }) {
    this.#apiUrl = input.apiUrl.replace(/\/+$/, '');
    this.#agentId = parseAliaAgentId(input.agentId);
    this.#fetch = input.fetch ?? fetch;
  }

  async streamText(input: {
    accessToken: string;
    messages: readonly AliaChatMessage[];
    signal?: AbortSignal;
  }): Promise<AsyncIterable<string>> {
    if (!this.#agentId) throw new AliaChatConfigurationError();

    const response = await this.#fetch(`${this.#apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({
        agentId: this.#agentId,
        messages: input.messages,
        stream: true,
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    if (!response.ok) throw new AliaChatError(response.status);
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
});
