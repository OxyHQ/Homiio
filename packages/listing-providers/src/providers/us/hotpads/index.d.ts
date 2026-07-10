/**
 * HotPads provider (United States).
 *
 * HotPads exposes a public JSON API (`hotpads-api-gke-prod-...hotpads.com`) that
 * powers its search UI — no auth, no PerimeterX on the API host. This plugin
 * uses direct HTTP JSON for discover + fetch. Registered OFF by default
 * (`PROVIDER_HOTPADS_ENABLED`).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { parseHotpadsArea, parseHotpadsListingById, parseHotpadsSearch } from './api';
import { type HotpadsListingFixture } from './fixtures';
export interface HotpadsRaw {
    sourceId: string;
    url: string;
    listing: HotpadsListingFixture;
}
export interface HotpadsProviderOptions {
    runtime?: FetchRuntime;
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
    cities?: readonly string[];
}
export declare class HotpadsProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["US"];
    private readonly runtime;
    private readonly metrics;
    private readonly cities;
    constructor(options?: HotpadsProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { parseHotpadsSearch, parseHotpadsListingById, parseHotpadsArea };
