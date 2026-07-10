/**
 * Casa.it provider (Italy) — search AJAX first, JSON-LD detail + contact JSON.
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { casaItSourceIdFromUrl } from './parse';
export declare function isCasaItChallenge(html: string): boolean;
export interface CasaItProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class CasaItProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["IT"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    private stickyProxySessionId?;
    private stickyStorageState?;
    constructor(options?: CasaItProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private discoverCityViaAjax;
    private discoverCityViaHtml;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { casaItSourceIdFromUrl };
