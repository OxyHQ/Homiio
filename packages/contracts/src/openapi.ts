import { z } from 'zod';
import {
  apiErrorSchema,
  beginTeamOperationSchema,
  privateTeamOperationSchema,
  teamOperationSchema,
  teamOperationIdRequestSchema,
  publicCaseBatchRequestSchema,
  publicCaseBatchResponseSchema,
} from './index';

/** The body `@oxy.so/core`'s service middleware answers a refused credential with. */
const oxyAuthErrorSchema = z.looseObject({
  error: z.string(),
  message: z.string(),
  code: z.string(),
});

export const schemas = {
  OxyAuthError: oxyAuthErrorSchema,
  PublicCaseBatchRequest: publicCaseBatchRequestSchema,
  PublicCaseBatchResponse: publicCaseBatchResponseSchema,
  ApiError: apiErrorSchema,
  BeginTeamOperation: beginTeamOperationSchema,
  PrivateTeamOperation: privateTeamOperationSchema,
  TeamOperation: teamOperationSchema,
  TeamOperationIdRequest: teamOperationIdRequestSchema,
};
export const routes = [
  {
    method: 'post',
    path: '/cases/batch',
    operationId: 'getPublicCases',
    body: 'PublicCaseBatchRequest',
    responses: {
      200: 'PublicCaseBatchResponse',
      400: 'ApiError',
      422: 'ApiError',
      429: 'ApiError',
      500: 'ApiError',
    },
  },
  {
    method: 'post',
    path: '/team-chat/operations/read',
    operationId: 'readTeamOperation',
    body: 'TeamOperationIdRequest',
    description:
      'Service read of one immutable operation: the caller sends its Oxy service token (minted for oxy-service:<Homiio application id> by @oxy.so/homiio-sdk/server) and the header-only capability. No message or housing content. 401: no, invalid or inactive service token; 403: the bearer is not a service token.',
    responses: {
      200: 'TeamOperation',
      400: 'ApiError',
      401: 'OxyAuthError',
      403: 'OxyAuthError',
      404: 'ApiError',
      503: 'ApiError',
    },
  },
  {
    method: 'post',
    path: '/evictions/{id}/team-chat/operations',
    operationId: 'beginTeamOperation',
    body: 'BeginTeamOperation',
    description:
      'Creator-only durable operation. Add requires acknowledging access to the exact address. Retries resume the pending operation.',
    baseUrl: 'https://api.homiio.com/api',
    responses: {
      200: 'PrivateTeamOperation',
      400: 'ApiError',
      401: 'ApiError',
      404: 'ApiError',
      409: 'ApiError',
      422: 'ApiError',
      503: 'ApiError',
    },
  },
  {
    method: 'post',
    path: '/team-chat/finalize',
    operationId: 'finalizeTeamOperation',
    body: 'TeamOperationIdRequest',
    description:
      'Creator-only finalization after Allo confirms the frozen exact account set. Replays return the finalized operation.',
    baseUrl: 'https://api.homiio.com/api',
    responses: {
      200: 'TeamOperation',
      400: 'ApiError',
      401: 'ApiError',
      404: 'ApiError',
      409: 'ApiError',
      503: 'ApiError',
    },
  },
] as const;
export function generateOpenApi() {
  const paths = Object.fromEntries(
    routes.map((route) => [
      route.path,
      {
        [route.method]: {
          operationId: route.operationId,
          ...('baseUrl' in route
            ? { servers: [{ url: route.baseUrl }], security: [{ OxySession: [] }] }
            : route.operationId === 'readTeamOperation'
              ? { security: [{ OxyServiceToken: [], TeamOperationCapability: [] }] }
              : {}),
          ...(route.path.includes('{id}')
            ? {
                parameters: [
                  { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                ],
              }
            : {}),
          description:
            'description' in route
              ? route.description
              : 'Resolve 1–50 case references. Duplicate IDs are collapsed. Missing, archived and held cases are unavailable. Responses are not cacheable.',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${route.body}` } },
            },
          },
          responses: Object.fromEntries(
            Object.entries(route.responses).map(([status, schema]) => [
              status,
              {
                description: status === '200' ? 'Current public cards' : 'API error',
                content: {
                  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
                },
              },
            ]),
          ),
        },
      },
    ]),
  );
  return {
    openapi: '3.1.0',
    info: { title: 'Homiio public API', version: '0.2.0' },
    servers: [{ url: 'https://api.homiio.com/api/v1' }],
    paths,
    components: {
      securitySchemes: {
        OxySession: { type: 'http', scheme: 'bearer' },
        OxyServiceToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        TeamOperationCapability: { type: 'apiKey', in: 'header', name: 'x-homiio-team-operation' },
      },
      schemas: Object.fromEntries(
        Object.entries(schemas).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema, { unrepresentable: 'any' }),
        ]),
      ),
    },
  };
}
