import {
  CANONICAL_SINDI_ALIA_AGENT_ID,
  AliaChatConfigurationError,
  AliaChatError,
  AliaChatService,
  aliaChatHttpFailure,
} from '../../services/aliaChatService';
import { SindiRequesterAssertionError } from '../../services/oxy';

/** The person's own Oxy bearer, as Homiio's auth middleware verified it. */
const HUMAN_BEARER = 'human-oxy-access-token-must-never-reach-alia';
const REQUESTER = { accountId: 'oxy-user-id', accessToken: HUMAN_BEARER };
const ASSERTION = 'requester.assertion.minted-by-oxy';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function sseResponse(chunks: readonly string[], contentType = 'text/event-stream; charset=utf-8'): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': contentType } },
  );
}

function chatChunk(content?: string): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: content === undefined ? {} : { content }, finish_reason: null }],
  });
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

function createService(
  input: Omit<ConstructorParameters<typeof AliaChatService>[0], 'serviceToken' | 'requesterAssertion'> & {
    requesterAssertion?: ConstructorParameters<typeof AliaChatService>[0]['requesterAssertion'];
  },
): AliaChatService {
  return new AliaChatService({
    requesterAssertion: async () => ASSERTION,
    ...input,
    serviceToken: async () => 'oxy-homiio-service-token',
  });
}

describe('AliaChatService', () => {
  const sindiAgentId = CANONICAL_SINDI_ALIA_AGENT_ID;

  it('never answers a chat failure with a consent request', () => {
    for (const status of [401, 403]) {
      expect(aliaChatHttpFailure(new AliaChatError(status))).toEqual({
        status: 401,
        body: { error: 'Sindi chat is temporarily unavailable', code: 'chat_auth_required' },
      });
    }
    expect(aliaChatHttpFailure(new AliaChatError(503))).toEqual({
      status: 503,
      body: { error: 'Sindi chat is temporarily unavailable', code: 'chat_unavailable' },
    });
    expect(JSON.stringify(aliaChatHttpFailure(new AliaChatError(403)))).not.toMatch(/SERVICE_ACTING_AS|permission/i);
  });

  it('streams the exact Alia agent with the Sindi service token and a requester assertion', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      sseResponse([
        ': keep-alive\n\n',
        `data: ${chatChunk('Ho')}\n\n`,
        `data: ${chatChunk('la')}\n\n`,
        `data: ${chatChunk()}\n\ndata: [DONE]\n\n`,
      ]),
    );
    const service = createService({
      apiUrl: 'https://api.alia.onl/',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    const controller = new AbortController();
    const stream = await service.streamText({
      requester: REQUESTER,
      messages: [{ role: 'user', content: 'Hola' }],
      signal: controller.signal,
    });

    await expect(collect(stream)).resolves.toBe('Hola');
    expect(fetchClient).toHaveBeenCalledWith(
      'https://api.alia.onl/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer oxy-homiio-service-token',
          'X-Oxy-Requester-Assertion': ASSERTION,
        },
        signal: controller.signal,
      }),
    );
    const request = fetchClient.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      agentId: sindiAgentId,
      messages: [{ role: 'user', content: 'Hola' }],
      stream: true,
    });
  });

  it('preserves property ids verbatim across arbitrary SSE and content boundaries', async () => {
    const propertyId = '0199bb4e-0341-725e-a905-11001c3659b4';
    const firstEvent = `data: ${chatChunk('Aquí tienes. <PROPERTIES_JSON>["0199bb4e-')}\r\n\r\n`;
    const secondEvent = `data: ${chatChunk('0341-725e-a905-11001c3659b4"]</PROPERTIES_JSON>')}\r\n\r\n`;
    const wire = `${firstEvent}${secondEvent}data: [DONE]\r\n\r\n`;
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      sseResponse([wire.slice(0, 7), wire.slice(7, 41), wire.slice(41, 113), wire.slice(113)]),
    );
    const service = createService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    const text = await collect(await service.streamText({
      requester: REQUESTER,
      messages: [{ role: 'user', content: 'Enséñame pisos' }],
    }));

    expect(text).toBe(`Aquí tienes. <PROPERTIES_JSON>["${propertyId}"]</PROPERTIES_JSON>`);
  });

  it('ignores Alia named events and consumes the response through EOF after DONE', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      sseResponse([
        'event: alia.reasoning\ndata: {"eventVersion":1,"content":"private"}\n\n',
        `event: message\ndata: ${chatChunk('visible')}\n\n`,
        'data: [DONE]\n\n',
        'event: alia.title\ndata: {"eventVersion":1,"title":"A title"}\n\n',
      ]),
    );
    const service = createService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    await expect(collect(await service.streamText({
      requester: REQUESTER,
      messages: [{ role: 'user', content: 'Hola' }],
    }))).resolves.toBe('visible');
  });

  it('fails a truncated stream that reaches EOF without DONE', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      sseResponse([`data: ${chatChunk('partial')}\n\n`]),
    );
    const service = createService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    await expect(collect(await service.streamText({
      requester: REQUESTER,
      messages: [{ role: 'user', content: 'Hola' }],
    }))).rejects.toMatchObject({ name: 'AliaChatError', status: 502 });
  });

  it('fails closed before the network when the provisioned Sindi agent is absent', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    const service = createService({ apiUrl: 'https://api.alia.onl', fetch: fetchClient });

    await expect(
      service.streamText({
        requester: REQUESTER,
        messages: [{ role: 'user', content: 'Hola' }],
      }),
    ).rejects.toBeInstanceOf(AliaChatConfigurationError);
    expect(fetchClient).not.toHaveBeenCalled();
  });

  it.each([
    'agent-sindi',
    '01a0646a-078f-7514-9800-9f43ceed7df9',
    ` ${CANONICAL_SINDI_ALIA_AGENT_ID}`,
    `${CANONICAL_SINDI_ALIA_AGENT_ID} `,
    CANONICAL_SINDI_ALIA_AGENT_ID.toUpperCase(),
  ])('fails closed before the network when the configured agent id is not the exact reserved PK: %s', async (agentId) => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    const service = createService({
      apiUrl: 'https://api.alia.onl',
      agentId,
      fetch: fetchClient,
    });

    await expect(
      service.streamText({
        requester: REQUESTER,
        messages: [{ role: 'user', content: 'Hola' }],
      }),
    ).rejects.toBeInstanceOf(AliaChatConfigurationError);
    expect(fetchClient).not.toHaveBeenCalled();
  });

  it('does not expose an upstream response body on failure', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      new Response('provider detail must stay private', { status: 503 }),
    );
    const service = createService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    const error = await service
      .streamText({
        requester: REQUESTER,
        messages: [{ role: 'user', content: 'Hola' }],
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AliaChatError);
    expect(error).toMatchObject({ status: 503, message: 'Alia chat request failed' });
    expect(String(error)).not.toContain('provider detail');
  });

  it('sends no human bearer and no delegated user id to Alia, anywhere in the request', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      sseResponse([`data: ${chatChunk('ok')}\n\ndata: [DONE]\n\n`]),
    );
    const minted: unknown[] = [];
    const service = createService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
      requesterAssertion: async (input) => {
        minted.push(input);
        return ASSERTION;
      },
    });

    await collect(await service.streamText({ requester: REQUESTER, messages: [{ role: 'user', content: 'Hola' }] }));

    // The bearer went to the Oxy mint, and only there.
    expect(minted).toEqual([{ subjectToken: HUMAN_BEARER, requesterAccountId: 'oxy-user-id', agentId: sindiAgentId }]);
    expect(fetchClient).toHaveBeenCalledTimes(1);
    const [url, init] = fetchClient.mock.calls[0] ?? [];
    const wire = JSON.stringify({ url, headers: init?.headers, body: init?.body });
    expect(wire).not.toContain(HUMAN_BEARER);
    const headerNames = Object.keys((init?.headers ?? {}) as Record<string, string>).map((name) => name.toLowerCase());
    expect(headerNames).not.toContain('x-oxy-user-id');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer oxy-homiio-service-token');
  });

  it('mints a fresh assertion for every turn, because Oxy consumes each one', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(async () => sseResponse([`data: ${chatChunk('ok')}\n\ndata: [DONE]\n\n`]));
    let counter = 0;
    const service = createService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
      requesterAssertion: async () => `assertion-${(counter += 1)}`,
    });
    for (let turn = 0; turn < 2; turn += 1) {
      await collect(await service.streamText({ requester: REQUESTER, messages: [{ role: 'user', content: 'Hola' }] }));
    }
    const sent = fetchClient.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['X-Oxy-Requester-Assertion']);
    expect(sent).toEqual(['assertion-1', 'assertion-2']);
  });

  it.each([
    ['Oxy refuses the requester (signed out, revoked, other app)', new SindiRequesterAssertionError('refused'), 401],
    ['Oxy cannot mint right now', new SindiRequesterAssertionError('unavailable'), 503],
    ['the minted assertion fails the identity canary', new Error('Oxy minted a requester assertion for an unexpected Sindi identity'), 503],
  ])('does not call Alia when %s', async (_label, failure, status) => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    const service = createService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
      requesterAssertion: async () => { throw failure; },
    });
    await expect(service.streamText({ requester: REQUESTER, messages: [{ role: 'user', content: 'Hola' }] }))
      .rejects.toMatchObject({ name: 'AliaChatError', status });
    expect(fetchClient).not.toHaveBeenCalled();
  });

  it('refuses a turn with no verified person or bearer before minting anything', async () => {
    const minter = jest.fn(async () => ASSERTION);
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    const service = createService({ apiUrl: 'https://api.alia.onl', agentId: sindiAgentId, fetch: fetchClient, requesterAssertion: minter });
    for (const requester of [{ accountId: 'oxy-user-id', accessToken: '' }, { accountId: '', accessToken: HUMAN_BEARER }]) {
      await expect(service.streamText({ requester, messages: [{ role: 'user', content: 'Hola' }] }))
        .rejects.toMatchObject({ status: 401 });
    }
    expect(minter).not.toHaveBeenCalled();
    expect(fetchClient).not.toHaveBeenCalled();
  });

  it('turns an upstream acting-as refusal into a plain auth failure, never consent', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      Response.json({ code: 'SERVICE_ACTING_AS_UNAUTHORIZED', message: 'private upstream detail' }, { status: 403 }),
    );
    const service = createService({ apiUrl: 'https://api.alia.onl', agentId: sindiAgentId, fetch: fetchClient });
    const error = await service
      .streamText({ requester: REQUESTER, messages: [{ role: 'user', content: 'Hola' }] })
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({ name: 'AliaChatError', status: 403 });
    expect(aliaChatHttpFailure(error as AliaChatError).body.code).toBe('chat_auth_required');
    expect(String(error)).not.toContain('private upstream detail');
  });

  it('rejects a successful non-SSE response instead of buffering a fallback shape', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      sseResponse(['{}'], 'application/json'),
    );
    const service = createService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    await expect(service.streamText({
      requester: REQUESTER,
      messages: [{ role: 'user', content: 'Hola' }],
    })).rejects.toMatchObject({ name: 'AliaChatError', status: 502 });
  });
});
