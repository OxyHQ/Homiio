/**
 * Recover the bucket key a stored document URL points at.
 *
 * ## Why a parser and not a column
 *
 * `tenant_application_documents.url` has always held an absolute URL, and there
 * are two shapes of it in the table: the delivery route
 * (`<publicUrl>/api/images/file/<key>`) that everything written since the
 * API-proxy fix carries, and a legacy virtual-hosted or path-style S3 URL from
 * before it. Both encode the same key, and the key is the only part the private
 * delivery route needs.
 *
 * Reading it back is therefore a pure function over a string Homiio itself
 * wrote, and adding a `storage_key` column would mean a migration that derived
 * it from exactly this parse — with the parse still needed for whatever the
 * backfill could not resolve. The column buys nothing the function does not.
 *
 * ## What it refuses
 *
 * Anything that is not one of those two shapes: an `http://evil/x.jpeg`, a
 * `file://`, a bare path. The URL is ours, but a row is still data, and a
 * parser that fell through to "treat the whole string as a key" would let a
 * bad row name any object in the bucket. `null` means "this row does not point
 * at an object we store", and the caller answers 404.
 */

const DELIVERY_PATH = '/api/images/file/';

export interface StoredDocumentKeyOptions {
  /** `config.s3.bucketName`; empty when object storage is unconfigured. */
  readonly bucketName: string;
  /** `config.s3.endpoint`; empty for native AWS S3. */
  readonly endpoint: string;
}

/**
 * The key a stored URL names, or `null` when it names nothing we store.
 *
 * The delivery-route shape is matched on the PATH, not on the host: `publicUrl`
 * differs between environments and has changed at least once, so a row written
 * against the old one would stop resolving if the host had to match. The path
 * is server-generated and constant.
 */
export function storedDocumentKey(
  url: string,
  options: StoredDocumentKeyOptions,
): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  // The delivery route. `pathname` is percent-ENCODED, and the key is what the
  // route's wildcard receives after Express decodes it, so decode once here —
  // the same once, so a `%252e%252e` cannot become `..` by being decoded twice.
  const marker = parsed.pathname.indexOf(DELIVERY_PATH);
  if (marker !== -1) {
    const encoded = parsed.pathname.slice(marker + DELIVERY_PATH.length);
    if (encoded.length === 0) return null;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }

  const bucket = options.bucketName;
  if (!bucket) return null;

  // Virtual-hosted: `https://<bucket>.s3.<region>.amazonaws.com/<key>`.
  if (parsed.hostname.startsWith(`${bucket}.s3.`)) {
    return decodedPath(parsed);
  }

  // Path-style against a custom endpoint: `<endpoint>/<bucket>/<key>`.
  if (options.endpoint) {
    let endpoint: URL;
    try {
      endpoint = new URL(options.endpoint);
    } catch {
      return null;
    }
    if (parsed.host === endpoint.host && parsed.pathname.startsWith(`/${bucket}/`)) {
      const encoded = parsed.pathname.slice(bucket.length + 2);
      if (encoded.length === 0) return null;
      try {
        return decodeURIComponent(encoded);
      } catch {
        return null;
      }
    }
  }

  return null;
}

function decodedPath(parsed: URL): string | null {
  const encoded = parsed.pathname.replace(/^\//, '');
  if (encoded.length === 0) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}
