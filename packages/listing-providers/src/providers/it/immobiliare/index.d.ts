/**
 * Immobiliare.it provider (Italy) — JSON/AJAX first via search-list API + `__NEXT_DATA__`.
 *
 * Discover: warm session → search-list AJAX → `__NEXT_DATA__` / HTML link fallback.
 * Fetch: detail `__NEXT_DATA__` (includes advertiser contact when present).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { immobiliareSourceIdFromUrl } from './parse';
export declare function isImmobiliareChallenge(html: string): boolean;
export interface ImmobiliareProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class ImmobiliareProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["IT"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    private stickyProxySessionId?;
    private stickyStorageState?;
    constructor(options?: ImmobiliareProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private discoverCityViaAjax;
    private discoverCityViaHtml;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    private fetchDetailViaSession;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { immobiliareSourceIdFromUrl };
