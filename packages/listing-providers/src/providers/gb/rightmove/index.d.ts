/**
 * Rightmove provider (United Kingdom).
 *
 * Acquisition order (JSON-first):
 *   1. Typeahead JSON (`los.rightmove.co.uk/typeahead`) → locationIdentifier
 *   2. Warm Playwright session on city search (optional) OR ladder HTML
 *   3. Parse `__NEXT_DATA__.searchResults.properties` JSON (housing-only)
 *   4. Detail: parse `window.__PAGE_MODEL` compressed JSON (contact + images)
 *
 * Registered OFF by default (`PROVIDER_RIGHTMOVE_ENABLED`).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { rightmoveSourceIdFromUrl } from './parse';
export declare function isRightmoveChallenge(html: string): boolean;
export interface RightmoveProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class RightmoveProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["GB"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    private stickyProxySessionId?;
    private stickyStorageState?;
    private locationCache;
    constructor(options?: RightmoveProviderOptions);
    private resolveLocationId;
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private fetchSearchViaSession;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    private fetchDetailViaSession;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { rightmoveSourceIdFromUrl };
