import type {
  OxyInferenceRequestOptions,
  OxyInferenceResponse,
  OxyResponsesRequest,
} from '@oxyhq/core';
import {
  HomiioInferenceService,
  textMessage,
  textFromInferenceResponse,
} from '../../services/oxyInferenceService';

const response = (text: string): OxyInferenceResponse => ({
  schemaVersion: 1,
  requestId: 'req-homiio-test',
  generationId: 'gen-homiio-test',
  model: 'publisher/model@revision',
  servingProvider: 'provider',
  finishReason: 'stop',
  output: [{ role: 'assistant', content: [{ type: 'text', text }] }],
  usage: [
    { unit: 'input_tokens', quantity: 4 },
    { unit: 'output_tokens', quantity: 2 },
  ],
  routingPolicy: { routingPolicyId: 'policy-homiio', policyVersion: 1 },
  latencyMs: 12,
});

describe('HomiioInferenceService', () => {
  it('selects only the configured Oxy routing profile and delegates attribution', async () => {
    const respond = jest.fn<
      Promise<OxyInferenceResponse>,
      [OxyResponsesRequest, OxyInferenceRequestOptions?]
    >().mockResolvedValue(response('hello'));
    const service = new HomiioInferenceService({
      client: { respond },
      routingProfile: 'sindi-balanced',
    });

    await expect(
      service.respondText({
        delegatedUserId: 'oxy-user-1',
        feature: 'conversation-title',
        messages: [textMessage('user', 'hello')],
        maxOutputTokens: 128,
        temperature: 0.2,
      }),
    ).resolves.toBe('hello');

    const [request, options] = respond.mock.calls[0];
    expect(request).toMatchObject({
      routingProfile: 'sindi-balanced',
      labels: { product: 'homiio', feature: 'conversation-title' },
      maxOutputTokens: 128,
      temperature: 0.2,
    });
    expect(request).not.toHaveProperty('model');
    expect(request).not.toHaveProperty('authorizedRoutes');
    expect(options).toEqual({ delegatedUserId: 'oxy-user-1' });
  });

  it('fails before an edge call when service identity or routing is incomplete', async () => {
    const respond = jest.fn<
      Promise<OxyInferenceResponse>,
      [OxyResponsesRequest, OxyInferenceRequestOptions?]
    >();
    const service = new HomiioInferenceService({
      client: { respond },
      missingConfiguration: ['OXY_SERVICE_API_SECRET'],
    });

    await expect(
      service.respondText({
        delegatedUserId: 'oxy-user-1',
        feature: 'conversation-title',
        messages: [textMessage('user', 'hello')],
      }),
    ).rejects.toMatchObject({
      missing: ['OXY_SERVICE_API_SECRET', 'OXY_INFERENCE_ROUTING_PROFILE'],
    });
    expect(respond).not.toHaveBeenCalled();
  });

  it('renders explicit refusal text instead of dropping it', () => {
    const refused: OxyInferenceResponse = {
      ...response(''),
      finishReason: 'refusal',
      output: [
        {
          role: 'assistant',
          content: [{ type: 'refusal', text: 'I cannot help with that request.' }],
        },
      ],
    };

    expect(textFromInferenceResponse(refused)).toBe('I cannot help with that request.');
  });
});
