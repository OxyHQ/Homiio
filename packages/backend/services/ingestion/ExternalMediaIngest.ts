/**
 * External media ingest.
 *
 * Promotes the `scripts/seedImages` pattern — "fetch a remote image URL →
 * Sharp → object storage → embed a `PropertyImageRef`" — into a production
 * service used when ingesting external (aggregator) listings. Each source image
 * URL is fetched ONCE here and re-hosted through the canonical Image pipeline;
 * the portal CDN URL is NEVER persisted as a runtime `images[].url`, so the
 * product has zero live dependency on a foreign image host.
 *
 * The remote-image fetcher is injectable so tests can supply bytes without any
 * network I/O; the default fetches over HTTP with a timeout and a descriptive
 * User-Agent (mirroring the seed helper).
 */

import type { NormalizedRemoteImage, PropertyImageRef } from '@homiio/shared-types';
import { mapWithConcurrency } from '../../utils/concurrency';
import {
  imageIngestConcurrencyFromEnv,
  maxImagesPerListingFromEnv,
} from '@homiio/listing-providers';
import {
  createProxiedFetch,
  residentialProxyFromEnv,
  type ResidentialProxyConfig,
} from '@homiio/listing-providers';
import imageUploadService, {
  ImageUploadService,
  type ImageBufferInput,
  type ImageDocument,
} from '../imageUploadService';
import { toPropertyImages } from '../imageSerializer';
import { Logger } from '../../utils/logger';
import { describeErrorForLog } from '../../middlewares/errorHandler';

/** Abort budget (ms) for fetching one remote source image. */
const FETCH_TIMEOUT_MS = 20_000;

/** Fallback MIME type when a fetched image omits a usable Content-Type. */
const DEFAULT_IMAGE_MIME = 'image/jpeg';

/** Descriptive User-Agent so source CDNs can identify Homiio's ingest fetches. */
const FETCH_USER_AGENT = 'Homiio-Listings/1.0 (+https://homiio.com)';

/**
 * Safety cap on how many images are ingested per listing.
 *
 * Read from `LISTING_MAX_IMAGES_PER_LISTING` (default 30, unchanged) so the
 * single most expensive number in the ingest can be turned down from the task
 * definition instead of requiring a deploy. Every image here is re-hosted —
 * downloaded, resized through Sharp, stored in S3 and served from it — so this
 * multiplies bandwidth, CPU and storage together. The providers that carry
 * image URLs through the queue read the SAME function, so nothing rides through
 * Redis only to be dropped on arrival.
 */

/** Fetches a remote image URL into a processable buffer + MIME type. */
export type RemoteImageFetcher = (url: string) => Promise<ImageBufferInput>;

/** Default HTTP fetcher: one GET with a timeout + descriptive User-Agent. */
export async function fetchRemoteImage(url: string): Promise<ImageBufferInput> {
  return fetchRemoteImageVia(url, fetch);
}

async function fetchRemoteImageVia(
  url: string,
  requestFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): Promise<ImageBufferInput> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await requestFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': FETCH_USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`Image fetch failed: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type');
    const mimetype =
      contentType && contentType.startsWith('image/') ? contentType : DEFAULT_IMAGE_MIME;
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimetype };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Direct fetch first; on failure, retry once through the residential proxy.
 * Used only when `LISTING_MEDIA_PROXY_FALLBACK=true` and proxy URL is configured.
 */
export async function fetchRemoteImageWithProxyFallback(
  url: string,
  proxy: ResidentialProxyConfig,
): Promise<ImageBufferInput> {
  try {
    return await fetchRemoteImage(url);
  } catch {
    const proxiedFetch = await createProxiedFetch(proxy);
    return fetchRemoteImageVia(url, proxiedFetch);
  }
}

/**
 * Build the default remote-image fetcher from env. Listing photos stay on a direct
 * fetch path unless `LISTING_MEDIA_PROXY_FALLBACK=true` (one proxy retry on failure).
 */
export function createRemoteImageFetcherFromEnv(): RemoteImageFetcher {
  const proxy = residentialProxyFromEnv();
  const fallbackEnabled = process.env.LISTING_MEDIA_PROXY_FALLBACK === 'true';
  if (!fallbackEnabled || !proxy) {
    return fetchRemoteImage;
  }
  return (url) => fetchRemoteImageWithProxyFallback(url, proxy);
}

export interface ExternalMediaIngestOptions {
  /** Image service to persist through (defaults to the shared singleton). */
  imageService?: ImageUploadService;
  /** Remote fetcher (defaults to {@link fetchRemoteImage}; overridden in tests). */
  fetchImage?: RemoteImageFetcher;
  /** Max images ingested per listing (defaults to {@link DEFAULT_MAX_IMAGES}). */
  maxImages?: number;
  /**
   * Images re-hosted concurrently per listing
   * (`LISTING_IMAGE_INGEST_CONCURRENCY`, default 6).
   */
  imageConcurrency?: number;
  logger?: Logger;
}

export class ExternalMediaIngest {
  private readonly imageService: ImageUploadService;
  private readonly fetchImage: RemoteImageFetcher;
  private readonly maxImages: number;
  /** How many of a listing's images are re-hosted at once. */
  private readonly imageConcurrency: number;
  private readonly logger: Logger;

  constructor(options: ExternalMediaIngestOptions = {}) {
    this.imageService = options.imageService ?? imageUploadService;
    this.fetchImage = options.fetchImage ?? createRemoteImageFetcherFromEnv();
    this.maxImages = options.maxImages ?? maxImagesPerListingFromEnv();
    this.imageConcurrency = options.imageConcurrency ?? imageIngestConcurrencyFromEnv();
    this.logger = options.logger ?? new Logger('ExternalMediaIngest');
  }

  /**
   * Ingest a listing's remote images for an already-persisted property. Fetches
   * each source image, runs it through the Sharp/object-storage pipeline as an
   * `Image` doc (`entityType: 'property'`), and returns the resolved
   * `PropertyImageRef[]` (ordered, exactly one primary) to embed on the Property.
   *
   * A single image that fails to fetch/process is logged and skipped — it never
   * fails the whole listing. When object storage is unconfigured, the images are
   * persisted to the self-hosted local store (opt-in, like the seed path).
   */
  async ingestForProperty(
    propertyId: string,
    remoteImages: readonly NormalizedRemoteImage[],
  ): Promise<PropertyImageRef[]> {
    const allowUnconfiguredStorage = !this.imageService.isStorageConfigured();
    const capped = remoteImages.slice(0, this.maxImages);

    // PARALLEL, BOUNDED, ORDER-PRESERVING. This loop used to be serial, which
    // made a listing cost up to 30 sequential fetch → Sharp → S3 round trips
    // (four variants each, so ~120 in all). Production measured 4.6 listings a
    // minute with a 9.5 s median gap — almost exactly 30 images at ~300 ms.
    //
    // The images of one listing are independent, and `isPrimary`/`order` come
    // from the INDEX rather than from insertion sequence, so running them
    // together changes the clock and nothing else. `mapWithConcurrency` keeps
    // the order so the cover photo stays the cover photo.
    const settled = await mapWithConcurrency(
      capped,
      this.imageConcurrency,
      async (remote, index) => {
        try {
          const input = await this.fetchImage(remote.url);
          return await this.imageService.createImageForEntity('property', propertyId, input, {
            isPrimary: remote.isPrimary ?? index === 0,
            order: index,
            caption: remote.caption,
            allowUnconfiguredStorage,
          });
        } catch (error) {
          // Per-image tolerance is unchanged and deliberate: one unreachable
          // photo must never cost the listing. Caught INSIDE the task so a
          // single failure cannot reject the batch.
          this.logger.warn('Skipping a remote image that failed to ingest', {
            propertyId: String(propertyId),
            url: remote.url,
            error: describeErrorForLog(error),
          });
          return undefined;
        }
      },
    );

    const created = settled.filter((image): image is ImageDocument => image !== undefined);
    return toPropertyImages(created);
  }
}
