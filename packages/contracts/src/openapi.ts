import { z } from 'zod';
import {
  apiErrorSchema,
  publicCaseBatchRequestSchema,
  publicCaseBatchResponseSchema,
} from './index';

export const schemas = {
  PublicCaseBatchRequest: publicCaseBatchRequestSchema,
  PublicCaseBatchResponse: publicCaseBatchResponseSchema,
  ApiError: apiErrorSchema,
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
] as const;
export function generateOpenApi() {
  const paths = Object.fromEntries(
    routes.map((route) => [
      route.path,
      {
        [route.method]: {
          operationId: route.operationId,
          description:
            'Resolve 1–50 case references. Duplicate IDs are collapsed. Missing, archived and held cases are unavailable. Responses are not cacheable.',
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
    info: { title: 'Homiio public API', version: '0.1.0' },
    servers: [{ url: 'https://api.homiio.com/api/v1' }],
    paths,
    components: {
      schemas: Object.fromEntries(
        Object.entries(schemas).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema, { unrepresentable: 'any' }),
        ]),
      ),
    },
  };
}
