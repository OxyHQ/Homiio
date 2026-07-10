/**
 * ImmobilienScout24 provider (Germany) — mobile JSON API first.
 *
 * Acquisition:
 *   1. Discover: POST `api.mobile.immobilienscout24.de/search/list` (JSON).
 *   2. Fetch: GET `api.mobile.immobilienscout24.de/expose/{id}` (JSON).
 *   3. Contact: best-effort from expose `contact` (phone / agencyName).
 *
 * Official partner REST API remains gated (`hasOfficialApi`). Registered OFF
 * by default (`PROVIDER_IMMOBILIENSCOUT24_ENABLED`).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { is24PublicUrl, is24SourceIdFromUrl, parseIs24Expose, parseIs24Search } from './parse';
export interface ImmobilienScout24ProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class ImmobilienScout24Provider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["DE"];
    readonly hasOfficialApi = true;
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    constructor(options?: ImmobilienScout24ProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    /**
     * Mobile search is POST-only. The shared {@link FetchRuntime.fetchHttp} is
     * GET-only; the mobile API accepts cold POSTs without a browser session, so
     * we POST here with the same headers the app uses.
     */
    private postSearch;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { is24SourceIdFromUrl, is24PublicUrl, parseIs24Search, parseIs24Expose };
