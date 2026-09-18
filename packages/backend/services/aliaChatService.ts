import {
  AliaRequestError,
  AliaServerClient,
  AliaStreamError,
  type AliaStreamEvent,
} from '@alia.onl/server';
import config from '../config';
import { logger } from '../middlewares/logging';
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
 *
 * The allowlist is the whole point. Upstream codes — `SERVICE_ACTING_AS_UNAUTHORIZED`
 * and every agent-side failure code Alia now hands back by name — are LOGGED,
 * never mapped through to the person: exactly two answers leave this module,
 * and both are Homiio's own words.
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
 * Report a turn Alia could not finish, without quoting anybody.
 *
 * A 502 from here used to be indistinguishable from every other 502 in the log,
 * which is the hole that left "Sindi could not finish this response"
 * unexplained: Alia logged no error, Kaana served the completion, and the bytes
 * that broke the read were dropped. There are now two distinct reports, because
 * they have two distinct causes and two different people fix them.
 *
 * Neither carries content. The assistant's text and the person's prompt never
 * appear in either — `AliaStreamError.shape` is keys, types and markers by
 * construction (`@alia.onl/server`), and an in-stream error is reported by its
 * CODE, never by its message, which is Alia's prose and not Homiio's to log.
 */
function reportUnreadableStream(error: AliaStreamError): void {
  logger.error('Alia stream could not be read', { reason: error.failure, ...error.shape });
}

function reportStreamError(code: string | null): void {
  logger.error('Alia ended the stream with an error', { code: code ?? 'unspecified' });
}

/**
 * Product chat goes through Alia, which owns chat, tools and memory.
 *
 * Alia receives exactly two credentials: Homiio's verified Sindi service token
 * as the bearer (so Oxy bills the Homiio application, ADR 0007) and a one-use
 * requester assertion Oxy minted for the signed-in person (ADR 0025). The
 * person's own bearer and `X-Oxy-User-Id` are never sent. The assertion is
 * minted per turn and not cached, because Oxy consumes it on first use.
 *
 * The SSE parsing this file used to do by hand is `@alia.onl/server`'s, published
 * from Alia's own repository against Alia's own writers. That is not a tidying:
 * the hand-rolled reader had no branch for the error Alia writes INTO the
 * stream, so `{"error":{"code":"agent_unavailable"}}` arrived as an unreadable
 * chunk and a bare 502, and the code Alia had already named was dropped on the
 * floor for hours. What the client cannot do is silently skip a frame.
 */
export class AliaChatService {
  readonly #agentId: AliaAgentId | undefined;
  readonly #client: AliaServerClient;
  readonly #serviceToken: () => Promise<string>;
  readonly #requesterAssertion: RequesterAssertionMinter;

  constructor(input: {
    apiUrl: string;
    agentId?: string;
    serviceToken: () => Promise<string>;
    requesterAssertion: RequesterAssertionMinter;
    fetch?: FetchClient;
  }) {
    this.#agentId = parseAliaAgentId(input.agentId);
    this.#serviceToken = input.serviceToken;
    this.#requesterAssertion = input.requesterAssertion;
    this.#client = new AliaServerClient({
      baseUrl: input.apiUrl,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    });
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

    const stream = await this.#client
      .stream(
        { agentId, messages: input.messages },
        {
          token: serviceToken,
          headers: { 'X-Oxy-Requester-Assertion': assertion },
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
      )
      .catch((error: unknown) => {
        throw toAliaChatError(error);
      });

    return textOf(stream);
  }
}

/**
 * Nothing upstream decides what Homiio tells the person beyond the status
 * class. `AliaRequestError.code` is read only to be LOGGED — mapping it through
 * would put an upstream vocabulary in a Homiio response, which is the thing
 * `aliaChatHttpFailure`'s allowlist exists to prevent.
 */
function toAliaChatError(error: unknown): unknown {
  if (error instanceof AliaRequestError) {
    if (error.code !== null) logger.error('Alia refused the turn', { status: error.status, code: error.code });
    return new AliaChatError(error.status);
  }
  if (error instanceof AliaStreamError) {
    reportUnreadableStream(error);
    return new AliaChatError(502);
  }
  return error;
}

/**
 * The assistant's text, and only that.
 *
 * Every delta is yielded VERBATIM: property entity ids inside
 * `<PROPERTIES_JSON>` must survive arbitrary network and model chunk boundaries
 * unchanged, so nothing here reassembles, trims or re-chunks. Reasoning deltas,
 * named `alia.*` events and the finish frame are Alia's product surface and
 * Sindi renders none of them today; they are dropped deliberately, by a branch
 * that exists, rather than by a parser that never saw them.
 */
async function* textOf(stream: AsyncIterable<AliaStreamEvent>): AsyncGenerator<string> {
  try {
    for await (const event of stream) {
      switch (event.type) {
        case 'text':
          yield event.text;
          break;
        case 'error':
          // Alia said why. This is the case that was invisible: the turn failed
          // with a named cause and the person was told nothing had happened.
          reportStreamError(event.code);
          throw new AliaChatError(503);
        case 'reasoning':
        case 'event':
        case 'finish':
        case 'done':
          break;
        default: {
          // `AliaStreamEvent` is a closed union, so a kind Alia adds later is a
          // COMPILE error here rather than a frame this loop quietly drops.
          const unreachable: never = event;
          void unreachable;
        }
      }
    }
  } catch (error: unknown) {
    throw toAliaChatError(error);
  }
}

export const aliaChat = new AliaChatService({
  apiUrl: config.alia.apiUrl,
  agentId: config.alia.sindiAgentId,
  serviceToken: getCanonicalSindiServiceToken,
  requesterAssertion: mintSindiRequesterAssertion,
});
