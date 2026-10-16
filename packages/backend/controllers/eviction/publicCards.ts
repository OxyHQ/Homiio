import {
  getHomiioCaseUrl,
  publicCaseBatchRequestSchema,
  publicCaseBatchResponseSchema,
} from '@oxy.so/homiio-contracts';
import type { Request, Response } from 'express';
import { listPublicCaseCards } from '../../db/evictions/publicCaseRepository';
import { sanitizePublicText } from '../../domain/evictions/sanitizePublicText';

// Legacy titles predate write-side sanitization. Reduce them at this boundary,
// including number-first English addresses, rather than forwarding raw prose.
function publicCardText(value: string): string {
  return sanitizePublicText(value).text.replace(
    /\b\d{1,6}[A-Za-z]?[ \t]{1,4}([A-Za-z][A-Za-z .'-]{0,60}\b(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|way|court|ct|boulevard|blvd)\b)/gi,
    '$1',
  );
}

export async function getPublicCaseCards(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  const parsed = publicCaseBatchRequestSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(req.query).length) {
    const tooLarge = parsed.error?.issues.some((issue) => issue.code === 'too_big');
    return res.status(tooLarge ? 422 : 400).json({
      error: {
        code: tooLarge ? 'validation_failed' : 'bad_request',
        message: 'Provide between 1 and 50 case IDs.',
      },
    });
  }
  try {
    const ids = [...new Set(parsed.data.ids)];
    const rows = await listPublicCaseCards(ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      return [
        {
          id: row.id,
          title: publicCardText(row.title) || 'Housing case',
          area: {
            label:
              publicCardText(row.locationCity ?? '') ||
              (/^[A-Z]{2}$/.test(row.locationCountryCode ?? '') ? row.locationCountryCode : null) ||
              'Area unavailable',
            precision: 'area' as const,
          },
          scheduledAt: row.scheduledAt.toISOString(),
          status: row.status,
          url: getHomiioCaseUrl(row.id),
        },
      ];
    });
    return res.json(
      publicCaseBatchResponseSchema.parse({
        items,
        unavailableIds: ids.filter((id) => !byId.has(id)),
      }),
    );
  } catch {
    return res
      .status(500)
      .json({ error: { code: 'internal_error', message: 'Unable to resolve cases.' } });
  }
}
