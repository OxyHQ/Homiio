import {
  AliaChatConfigurationError,
  AliaChatError,
  AliaChatService,
} from '../../services/aliaChatService';

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

describe('AliaChatService', () => {
  const sindiAgentId = '0199a26f-71cc-7f21-8d5e-4b1ea9669222';

  it('streams the exact Alia agent with the exact user bearer and no identity fallback', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      sseResponse([
        ': keep-alive\n\n',
        `data: ${chatChunk('Ho')}\n\n`,
        `data: ${chatChunk('la')}\n\n`,
        `data: ${chatChunk()}\n\ndata: [DONE]\n\n`,
      ]),
    );
    const service = new AliaChatService({
      apiUrl: 'https://api.alia.onl/',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    const controller = new AbortController();
    const stream = await service.streamText({
      accessToken: 'oxy-user-session',
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
          Authorization: 'Bearer oxy-user-session',
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
    const service = new AliaChatService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    const text = await collect(await service.streamText({
      accessToken: 'oxy-user-session',
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
    const service = new AliaChatService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    await expect(collect(await service.streamText({
      accessToken: 'oxy-user-session',
      messages: [{ role: 'user', content: 'Hola' }],
    }))).resolves.toBe('visible');
  });

  it('fails a truncated stream that reaches EOF without DONE', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      sseResponse([`data: ${chatChunk('partial')}\n\n`]),
    );
    const service = new AliaChatService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    await expect(collect(await service.streamText({
      accessToken: 'oxy-user-session',
      messages: [{ role: 'user', content: 'Hola' }],
    }))).rejects.toMatchObject({ name: 'AliaChatError', status: 502 });
  });

  it('fails closed before the network when the provisioned Sindi agent is absent', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    const service = new AliaChatService({ apiUrl: 'https://api.alia.onl', fetch: fetchClient });

    await expect(
      service.streamText({
        accessToken: 'oxy-user-session',
        messages: [{ role: 'user', content: 'Hola' }],
      }),
    ).rejects.toBeInstanceOf(AliaChatConfigurationError);
    expect(fetchClient).not.toHaveBeenCalled();
  });

  it('fails closed before the network when the configured agent id is not an entity id', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    const service = new AliaChatService({
      apiUrl: 'https://api.alia.onl',
      agentId: 'agent-sindi',
      fetch: fetchClient,
    });

    await expect(
      service.streamText({
        accessToken: 'oxy-user-session',
        messages: [{ role: 'user', content: 'Hola' }],
      }),
    ).rejects.toBeInstanceOf(AliaChatConfigurationError);
    expect(fetchClient).not.toHaveBeenCalled();
  });

  it('does not expose an upstream response body on failure', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      new Response('provider detail must stay private', { status: 503 }),
    );
    const service = new AliaChatService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    const error = await service
      .streamText({
        accessToken: 'oxy-user-session',
        messages: [{ role: 'user', content: 'Hola' }],
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AliaChatError);
    expect(error).toMatchObject({ status: 503, message: 'Alia chat request failed' });
    expect(String(error)).not.toContain('provider detail');
  });

  it('rejects a successful non-SSE response instead of buffering a fallback shape', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      sseResponse(['{}'], 'application/json'),
    );
    const service = new AliaChatService({
      apiUrl: 'https://api.alia.onl',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    await expect(service.streamText({
      accessToken: 'oxy-user-session',
      messages: [{ role: 'user', content: 'Hola' }],
    })).rejects.toMatchObject({ name: 'AliaChatError', status: 502 });
  });
});
