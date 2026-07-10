/**
 * Subito.it provider (Italy) — housing-only classifieds.
 *
 * CRITICAL: never site-wide crawl. Discover uses `/affitto/appartamenti/` only;
 * `normalize()` rejects non-housing categories.
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { isSubitoHousingCategory, subitoSourceIdFromUrl } from './parse';
export declare function isSubitoChallenge(html: string): boolean;
export interface SubitoProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class SubitoProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["IT"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    private stickyProxySessionId?;
    private stickyStorageState?;
    constructor(options?: SubitoProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private discoverCityViaAjax;
    private discoverCityViaHtml;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { subitoSourceIdFromUrl, isSubitoHousingCategory };
