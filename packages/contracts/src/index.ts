import { z } from 'zod';

export const MAX_PUBLIC_CASE_BATCH = 50;
export const caseIdSchema = z.string().min(1).max(200);
export const caseStatusSchema = z.enum([
  'upcoming',
  'stopped',
  'postponed',
  'executed',
  'cancelled',
]);
export const publicCaseSchema = z.strictObject({
  id: caseIdSchema,
  title: z.string().min(1),
  area: z.strictObject({ label: z.string().min(1), precision: z.literal('area') }),
  scheduledAt: z.iso.datetime(),
  status: caseStatusSchema,
  url: z.url(),
});
export const publicCaseBatchRequestSchema = z.strictObject({
  ids: z.array(caseIdSchema).min(1).max(MAX_PUBLIC_CASE_BATCH),
});
export const publicCaseBatchResponseSchema = z.strictObject({
  items: z.array(publicCaseSchema).max(MAX_PUBLIC_CASE_BATCH),
  unavailableIds: z.array(caseIdSchema).max(MAX_PUBLIC_CASE_BATCH),
});
export const errorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'unknown_route',
  'gone',
  'conflict',
  'validation_failed',
  'rate_limited',
  'internal_error',
  'service_unavailable',
]);
export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string(),
    details: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional(),
  }),
});
export type PublicCase = z.infer<typeof publicCaseSchema>;
export type PublicCaseBatchResponse = z.infer<typeof publicCaseBatchResponseSchema>;
export type ApiErrorCode = z.infer<typeof errorCodeSchema>;

export function getHomiioCaseUrl(id: string): string {
  return `https://homiio.com/evictions/${encodeURIComponent(caseIdSchema.parse(id))}`;
}
export function parseHomiioCaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://homiio.com' || url.username || url.password) return null;
    const match = /^\/evictions\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return null;
    const parsed = caseIdSchema.safeParse(decodeURIComponent(match[1]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function getMentionShareUrl(id: string): string {
  return `https://mention.earth/compose?homiioCaseId=${encodeURIComponent(caseIdSchema.parse(id))}`;
}

export const HOMIIO_TEAM_OPERATION_HEADER = 'x-homiio-team-operation';
export const teamOperationActionSchema = z.enum(['open', 'add', 'remove']);
export const beginTeamOperationSchema = z.strictObject({
  action: teamOperationActionSchema, oxyUserId: caseIdSchema.optional(),
  acknowledgeExactLocationAccess: z.boolean().optional(),
});
export const teamOperationSchema = z.strictObject({
  id: caseIdSchema, caseId: caseIdSchema, ownerAccountId: caseIdSchema,
  action: teamOperationActionSchema, targetAccountIds: z.array(caseIdSchema),
  teamReferenceHash: z.string().length(64), finalized: z.boolean(),
});
export const privateTeamOperationSchema = z.strictObject({
  operation: teamOperationSchema, capability: z.string(), teamReference: z.string(),
});
export const teamOperationIdRequestSchema = z.strictObject({ operationId: caseIdSchema });
export type TeamOperation = z.infer<typeof teamOperationSchema>;
export type PrivateTeamOperation = z.infer<typeof privateTeamOperationSchema>;
export type BeginTeamOperation = z.infer<typeof beginTeamOperationSchema>;
