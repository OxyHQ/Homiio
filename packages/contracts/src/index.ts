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
