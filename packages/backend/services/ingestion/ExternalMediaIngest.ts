/**
 * External media ingest — a scraped listing's photos, into Oxy Files.
 *
 * Each source photo is imported ONCE by Oxy itself (ADR 0043 D7,
 * `importAppFiles`): Oxy fetches it with its own SSRF-safe fetcher, stores it
 * as a file owned by the HOMIIO APPLICATION (nobody uploaded it, so no person
 * owns it), registers this listing's use in the same request, and remembers
 * the source — so a re-sync of the same listing re-downloads nothing, and the
 * portal CDN URL is never persisted as a runtime photo URL. The product keeps
 * zero live dependency on a foreign image host.
 *
 * ## The residential proxy, kept as a fallback only
 *
 * Some portals refuse requests that do not come through the residential proxy
 * the scraper uses. When `LISTING_MEDIA_PROXY_FALLBACK=true` and a proxy is
 * configured, a photo Oxy could not fetch (502/504) is fetched here through the
 * proxy and uploaded as Homiio's file (`uploadApplicationImage`). That is the
 * only remaining place Homiio fetches a public photo itself, and it is off
 * unless both settings say otherwise.
 *
 * One photo that fails never fails the listing; it is logged (without its URL
 * in the error) and skipped. `isPrimary`/`order` come from the position, so the
 * cover photo stays the cover photo.
 */

import type { NormalizedRemoteImage, PropertyImageRef } from '@homiio/shared-types';
import {
  createProxiedFetch,
  maxImagesPerListingFromEnv,
  type ResidentialProxyConfig,
  residentialProxyFromEnv,
} from '@homiio/listing-providers';

import type { ImageRow } from '../../db/images/imageWrites';
import { describeErrorForLog } from '../../middlewares/errorHandler';
import { Logger } from '../../utils/logger';
import {
  type FileReferenceTarget,
  type ImportOutcome,
  importApplicationImages,
  insertOxyImage,
  type StoredPublicImage,
  uploadApplicationImage,
} from '../files/publicImages';
import { toPropertyImages } from '../imageSerializer';

/** Abort budget (ms) for fetching one photo through the proxy. */
const FETCH_TIMEOUT_MS = 20_000;

/** Fallback MIME type when a fetched image omits a usable Content-Type. */
const DEFAULT_IMAGE_MIME = 'image/jpeg';

/** Descriptive User-Agent so source CDNs can identify Homiio's fetches. */
const FETCH_USER_AGENT = 'Homiio-Listings/1.0 (+https://homiio.com)';

/** A photo's bytes, for the proxy fallback. */
export interface RemoteImageBytes {
  buffer: Buffer;
  mimetype: string;
}

/** Fetches a photo through the residential proxy. */
export type ProxyImageFetcher = (url: string) => Promise<RemoteImageBytes>;

/** How photos reach Oxy — the real calls, or a test's stand-in. */
export interface ApplicationImageStore {
  importImages(urls: readonly string[], reference: FileReferenceTarget): Promise<ImportOutcome[]>;
  uploadImage(input: RemoteImageBytes, reference: FileReferenceTarget): Promise<StoredPublicImage>;
}

const oxyApplicationImageStore: ApplicationImageStore = {
  importImages: importApplicationImages,
  uploadImage: uploadApplicationImage,
};

/** One GET through the residential proxy, with a timeout and a User-Agent. */
export async function fetchRemoteImageViaProxy(
  url: string,
  proxy: ResidentialProxyConfig,
): Promise<RemoteImageBytes> {
  const proxiedFetch = await createProxiedFetch(proxy);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await proxiedFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': FETCH_USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`Image fetch failed: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type');
    const mimetype =
      contentType && contentType.startsWith('image/') ? contentType : DEFAULT_IMAGE_MIME;
    return { buffer: Buffer.from(await response.arrayBuffer()), mimetype };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The proxy fallback from the environment, or null: only when
 * `LISTING_MEDIA_PROXY_FALLBACK=true` AND a residential proxy is configured.
 */
export function createProxyFallbackFromEnv(): ProxyImageFetcher | null {
  const proxy = residentialProxyFromEnv();
  if (process.env.LISTING_MEDIA_PROXY_FALLBACK !== 'true' || !proxy) return null;
  return (url) => fetchRemoteImageViaProxy(url, proxy);
}

/** The Oxy answers worth a proxy retry: the source could not be reached. */
const FETCH_FAILURES = new Set([502, 504]);

export interface ExternalMediaIngestOptions {
  /** Where photos go (defaults to Oxy Files). */
  store?: ApplicationImageStore;
  /** Proxy fallback (defaults to {@link createProxyFallbackFromEnv}); `null` disables it. */
  proxyFallback?: ProxyImageFetcher | null;
  /** Max photos per listing (`LISTING_MAX_IMAGES_PER_LISTING`, default 30). */
  maxImages?: number;
  logger?: Logger;
}

export class ExternalMediaIngest {
  private readonly store: ApplicationImageStore;
  private readonly proxyFallback: ProxyImageFetcher | null;
  private readonly maxImages: number;
  private readonly logger: Logger;

  constructor(options: ExternalMediaIngestOptions = {}) {
    this.store = options.store ?? oxyApplicationImageStore;
    this.proxyFallback =
      options.proxyFallback === undefined ? createProxyFallbackFromEnv() : options.proxyFallback;
    this.maxImages = options.maxImages ?? maxImagesPerListingFromEnv();
    this.logger = options.logger ?? new Logger('ExternalMediaIngest');
  }

  /**
   * Import a listing's remote photos for an already-persisted property, write
   * an `images` row for each, and return the `PropertyImageRef[]` (ordered,
   * exactly one primary) the caller attaches with `replacePropertyImages`.
   */
  async ingestForProperty(
    propertyId: string,
    remoteImages: readonly NormalizedRemoteImage[],
  ): Promise<PropertyImageRef[]> {
    const capped = remoteImages.slice(0, this.maxImages);
    if (capped.length === 0) return [];
    const reference: FileReferenceTarget = { entityType: 'property', entityId: propertyId };

    let outcomes: ImportOutcome[];
    try {
      outcomes = await this.store.importImages(
        capped.map((remote) => remote.url),
        reference,
      );
    } catch (error) {
      // The batch itself failed (Oxy unreachable): every photo is a fetch failure.
      this.logger.warn("Importing a listing's photos failed", {
        propertyId,
        error: describeErrorForLog(error),
      });
      outcomes = capped.map(() => ({ ok: false, status: 502, code: 'IMPORT_UNAVAILABLE' }));
    }

    const rows: ImageRow[] = [];
    for (const [index, remote] of capped.entries()) {
      const outcome = outcomes[index];
      let stored: StoredPublicImage | undefined = outcome?.ok ? outcome.image : undefined;
      if (
        !stored &&
        outcome &&
        !outcome.ok &&
        this.proxyFallback &&
        FETCH_FAILURES.has(outcome.status)
      ) {
        try {
          stored = await this.store.uploadImage(await this.proxyFallback(remote.url), reference);
        } catch (error) {
          this.logger.warn('Proxy fallback for a listing photo failed', {
            propertyId,
            index,
            error: describeErrorForLog(error),
          });
        }
      }
      if (!stored) {
        if (outcome && !outcome.ok) {
          this.logger.warn('Skipping a listing photo Oxy could not import', {
            propertyId,
            index,
            status: outcome.status,
            code: outcome.code,
          });
        }
        continue;
      }
      rows.push(
        await insertOxyImage('property', propertyId, stored, {
          isPrimary: remote.isPrimary ?? index === 0,
          order: index,
          caption: remote.caption,
        }),
      );
    }
    return toPropertyImages(rows);
  }
}
