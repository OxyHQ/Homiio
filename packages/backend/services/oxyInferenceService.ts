import {
  OxyInferenceClient,
  type OxyInferenceRequestOptions,
  type OxyInferenceResponse,
  type OxyResponsesRequest,
} from '@oxyhq/core';
import type { InferenceMessage, ResponseFormat } from '@oxyhq/contracts';
import config from '../config';
import { oxyService } from './oxy';

type InferenceClient = Pick<OxyInferenceClient, 'respond'>;

export interface HomiioInferenceInput {
  messages: readonly InferenceMessage[];
  delegatedUserId: string;
  feature: string;
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: ResponseFormat;
  signal?: AbortSignal;
}

export class HomiioInferenceConfigurationError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`Homiio inference is not configured: ${missing.join(', ')}`);
    this.name = 'HomiioInferenceConfigurationError';
    this.missing = missing;
  }
}

export class HomiioInferenceService {
  readonly #client: InferenceClient;
  readonly #routingProfileId: string | undefined;
  readonly #missingConfiguration: readonly string[];

  constructor(input: {
    client: InferenceClient;
    routingProfileId?: string;
    missingConfiguration?: readonly string[];
  }) {
    this.#client = input.client;
    this.#routingProfileId = input.routingProfileId;
    this.#missingConfiguration = input.missingConfiguration ?? [];
  }

  get configurationFailure(): readonly string[] {
    const missing = [...this.#missingConfiguration];
    if (this.#routingProfileId === undefined || this.#routingProfileId.length === 0) {
      missing.push('OXY_INFERENCE_ROUTING_PROFILE_ID');
    }
    return missing;
  }

  async respondText(input: HomiioInferenceInput): Promise<string> {
    const missing = this.configurationFailure;
    if (missing.length > 0) throw new HomiioInferenceConfigurationError(missing);

    const request: OxyResponsesRequest = {
      routingProfileId: this.#routingProfileId,
      input: input.messages,
      labels: { product: 'homiio', feature: input.feature },
      ...(input.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: input.maxOutputTokens }),
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      ...(input.responseFormat === undefined ? {} : { responseFormat: input.responseFormat }),
    };
    const options: OxyInferenceRequestOptions = {
      delegatedUserId: input.delegatedUserId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    const response = await this.#client.respond(request, options);
    return textFromInferenceResponse(response);
  }
}

export function textMessage(role: InferenceMessage['role'], text: string): InferenceMessage {
  return { role, content: [{ type: 'text', text }] };
}

export function textFromInferenceResponse(response: OxyInferenceResponse): string {
  return response.output
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.content)
    .filter((part) => part.type === 'text' || part.type === 'refusal')
    .map((part) => part.text)
    .join('');
}

const missingConfiguration = [
  config.oxy.serviceApiKey ? null : 'OXY_SERVICE_API_KEY',
  config.oxy.serviceApiSecret ? null : 'OXY_SERVICE_API_SECRET',
].filter((name): name is string => name !== null);

export const homiioInference = new HomiioInferenceService({
  client: new OxyInferenceClient({
    baseURL: config.oxy.baseURL,
    credential: () => oxyService.getServiceToken(),
  }),
  routingProfileId: config.oxy.inferenceRoutingProfileId,
  missingConfiguration,
});
