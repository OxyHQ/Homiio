/**
 * The size contract of every upload to `api.homiio.com`, shared so the client
 * that splits a set of files and the server that refuses an oversized request
 * read the same numbers.
 *
 * ## Why there is a per-request budget at all
 *
 * The API sits behind a proxy that refuses any request body over 100 MB, and
 * the multi-file routes accepted ten 10 MB files in ONE multipart request —
 * 100 MB of files before the multipart envelope. So no request may carry more
 * than {@link UPLOAD_REQUEST_MAX_BYTES}: the server answers a bigger one 413,
 * and a client with more files than fit sends them in several requests,
 * planned by {@link planUploadBatches}.
 *
 * The per-file and per-set limits (ten photos, ten documents, 10 MB each) are
 * unchanged; only how many of them travel together is.
 */

const MIB = 1024 * 1024;

/** The most one request to the API may carry, envelope included. */
export const UPLOAD_REQUEST_MAX_BYTES = 64 * MIB;

/**
 * What a batch leaves for the multipart envelope — boundaries, part headers
 * and the text fields that travel with the files (an application's notes and
 * references). The FILES of one batch total at most
 * `UPLOAD_REQUEST_MAX_BYTES - UPLOAD_REQUEST_ENVELOPE_BYTES`.
 */
export const UPLOAD_REQUEST_ENVELOPE_BYTES = 1 * MIB;

/** The most one photo may weigh (`/api/images/upload[-multiple]`). */
export const IMAGE_UPLOAD_MAX_FILE_BYTES = 10 * MIB;

/** The most photos one `/api/images/upload-multiple` request may carry. */
export const IMAGE_UPLOAD_MAX_FILES_PER_REQUEST = 10;

/** The most one application document may weigh. */
export const APPLICATION_DOCUMENT_MAX_BYTES = 10 * MIB;

/** The most documents one application may hold, across all its requests. */
export const APPLICATION_DOCUMENT_MAX_COUNT = 10;

export interface UploadBatchLimits {
  /**
   * The per-file cap the server enforces. A file whose size the client cannot
   * read is planned AT this size: the server refuses anything bigger, so it is
   * the most the file can weigh in a request that is accepted.
   */
  readonly maxFileBytes: number;
  /** The most files one request may carry. */
  readonly maxFilesPerRequest: number;
}

/**
 * Split `items` into consecutive batches, each one request, keeping their
 * order: a batch closes when the next file would push its files past the
 * request budget or its count past `maxFilesPerRequest`.
 *
 * Every batch holds at least one file, so a single file larger than the budget
 * (which the per-file cap already refuses) travels alone and is refused on its
 * own, rather than taking its neighbours with it.
 */
export function planUploadBatches<T>(
  items: readonly T[],
  sizeOf: (item: T) => number | null | undefined,
  limits: UploadBatchLimits,
): T[][] {
  const budget = UPLOAD_REQUEST_MAX_BYTES - UPLOAD_REQUEST_ENVELOPE_BYTES;
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const item of items) {
    const known = sizeOf(item);
    const bytes =
      typeof known === 'number' && Number.isFinite(known) && known >= 0
        ? known
        : limits.maxFileBytes;
    const full =
      current.length >= limits.maxFilesPerRequest ||
      (current.length > 0 && currentBytes + bytes > budget);
    if (full) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
