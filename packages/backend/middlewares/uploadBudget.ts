/**
 * The per-request byte budget (`UPLOAD_REQUEST_MAX_BYTES` in `shared-types`),
 * enforced on the way in.
 *
 * The proxy in front of the API refuses any body over 100 MB, so a request
 * that would come near it is refused HERE first, with an answer the app can
 * read, rather than as the proxy's bare 413 page. The app never sends one: it
 * splits a set of files with `planUploadBatches` from the same module.
 *
 * Two checks, because a request can arrive two ways:
 *
 * - {@link rejectOversizedRequest} reads `Content-Length`, which bounds the
 *   body before a byte is buffered — every browser and React Native multipart
 *   upload carries one, and the HTTP parser will not read past it. Mounted once,
 *   for every route, in `server.ts`.
 * - {@link requireFilesWithinBudget} runs after multer on the multi-file
 *   routes and sums what was actually received, for a chunked body that
 *   declares no length. Multer's own `files` and `fileSize` limits bound what
 *   it buffers meanwhile.
 */

import type { NextFunction, Request, Response } from 'express';
import { UPLOAD_REQUEST_MAX_BYTES } from '@homiio/shared-types';

const MAX_MIB = Math.floor(UPLOAD_REQUEST_MAX_BYTES / (1024 * 1024));

/** The 413 answer, in the shape both `{ message }` and `{ error.code }` readers parse. */
function tooLarge(res: Response): void {
  const message = `Request too large. One request may carry at most ${MAX_MIB} MB; send the files in smaller batches.`;
  res.setHeader('Connection', 'close');
  res.status(413).json({
    success: false,
    message,
    error: { message, code: 'PAYLOAD_TOO_LARGE', statusCode: 413 },
  });
}

/** Refuse a request whose declared length is over the budget, before reading it. */
export function rejectOversizedRequest(req: Request, res: Response, next: NextFunction): void {
  const declared = req.headers['content-length'];
  if (declared !== undefined) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > UPLOAD_REQUEST_MAX_BYTES) {
      tooLarge(res);
      return;
    }
  }
  next();
}

/** After multer: refuse a request whose received files total over the budget. */
export function requireFilesWithinBudget(req: Request, res: Response, next: NextFunction): void {
  const files: readonly { size: number }[] = Array.isArray(req.files)
    ? req.files
    : req.files
      ? Object.values(req.files as Record<string, { size: number }[]>).flat()
      : req.file
        ? [req.file]
        : [];
  let total = 0;
  for (const file of files) total += file.size;
  if (total > UPLOAD_REQUEST_MAX_BYTES) {
    tooLarge(res);
    return;
  }
  next();
}
