/**
 * Immowelt provider (Germany) — JSON-first via SERP init data.
 *
 * Acquisition order (discover):
 *   1. Warm Playwright session → POST `/classified-search-service/v1/searches`
 *      when the session pool is available (DataDome-gated cold).
 *   2. Fall back to search HTML → LZ-decompress `classified-serp-init-data`
 *      (structured JSON cards — preferred over link scraping).
 *   3. UUID `/expose/{uuid}` link scrape as last resort.
 *
 * Fetch prefers the card JSON (hints) or re-parses search/detail HTML JSON.
 * Contact (phone / email / agency) is taken from the card `provider` block.
 *
 * Registered OFF by default (`PROVIDER_IMMOWELT_ENABLED`).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { immoweltExposeUrl, immoweltSourceIdFromUrl, parseImmoweltDetail, parseImmoweltSearch } from './parse';
export interface ImmoweltProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class ImmoweltProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["DE"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    private stickyProxySessionId?;
    private stickyStorageState?;
    constructor(options?: ImmoweltProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private discoverViaSession;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    private fetchViaSession;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { immoweltSourceIdFromUrl, immoweltExposeUrl, parseImmoweltSearch, parseImmoweltDetail };
