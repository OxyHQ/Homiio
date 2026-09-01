import {
  AliaChatConfigurationError,
  AliaChatError,
  AliaChatService,
} from '../../services/aliaChatService';

describe('AliaChatService', () => {
  const sindiAgentId = '0199a26f-71cc-7f21-8d5e-4b1ea9669222';

  it('keeps interactive chat on Alia and forwards only the user session', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Hola' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const service = new AliaChatService({
      apiUrl: 'https://api.alia.onl/',
      agentId: sindiAgentId,
      fetch: fetchClient,
    });

    await expect(
      service.respondText({
        accessToken: 'oxy-user-session',
        messages: [{ role: 'user', content: 'Hola' }],
      }),
    ).resolves.toBe('Hola');

    expect(fetchClient).toHaveBeenCalledWith(
      'https://api.alia.onl/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer oxy-user-session',
        },
      }),
    );
    const request = fetchClient.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      agentId: sindiAgentId,
      messages: [{ role: 'user', content: 'Hola' }],
      stream: false,
    });
  });

  it('fails closed before the network when the provisioned Sindi agent is absent', async () => {
    const fetchClient = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    const service = new AliaChatService({ apiUrl: 'https://api.alia.onl', fetch: fetchClient });

    await expect(
      service.respondText({
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
      service.respondText({
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
      .respondText({
        accessToken: 'oxy-user-session',
        messages: [{ role: 'user', content: 'Hola' }],
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AliaChatError);
    expect(error).toMatchObject({ status: 503, message: 'Alia chat request failed' });
    expect(String(error)).not.toContain('provider detail');
  });
});
