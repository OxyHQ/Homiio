/**
 * Idealista.it provider (Italy) — AJAX-with-Playwright-session pattern.
 *
 * Separate from ES `idealista` (different host, `/immobile/`, Italian paths).
 *
 * Discover: warm session → georeach AJAX → HTML search fallback.
 * Fetch: detail HTML JSON-LD + optional contact AJAX (phones / agency).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { idealistaItSourceIdFromUrl } from './parse';
export declare function isIdealistaItChallenge(html: string): boolean;
export interface IdealistaItProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class IdealistaItProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["IT"];
    readonly hasOfficialApi = true;
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    private stickyProxySessionId?;
    private stickyStorageState?;
    constructor(options?: IdealistaItProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private discoverCityViaGeoreach;
    private discoverCityViaHtml;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    private fetchDetailViaSession;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { idealistaItSourceIdFromUrl };
