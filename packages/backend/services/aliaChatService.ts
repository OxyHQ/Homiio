import config from '../config';

export interface AliaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AliaChatCompletion {
  choices?: Array<{ message?: { content?: unknown } }>;
}

type FetchClient = typeof fetch;

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
    super('Sindi Alia agent is not configured');
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
  readonly #agentId: string | undefined;
  readonly #fetch: FetchClient;

  constructor(input: { apiUrl: string; agentId?: string; fetch?: FetchClient }) {
    this.#apiUrl = input.apiUrl.replace(/\/+$/, '');
    this.#agentId = input.agentId?.trim() || undefined;
    this.#fetch = input.fetch ?? fetch;
  }

  async respondText(input: {
    accessToken: string;
    messages: readonly AliaChatMessage[];
    signal?: AbortSignal;
  }): Promise<string> {
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
        stream: false,
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    if (!response.ok) throw new AliaChatError(response.status);

    const body = (await response.json()) as AliaChatCompletion;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new AliaChatError(502);
    return content;
  }
}

export const aliaChat = new AliaChatService({
  apiUrl: config.alia.apiUrl,
  agentId: config.alia.sindiAgentId,
});
