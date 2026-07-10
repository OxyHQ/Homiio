/**
 * OnTheMarket provider (United Kingdom).
 *
 * JSON-first: detail pages expose listing + agent contact in
 * `__NEXT_DATA__.props.initialReduxState.property`. Discover pages search HTML
 * for `/details/<id>` and rejects non-housing (garages/parking) at normalize.
 *
 * Registered OFF by default (`PROVIDER_ONTHEMARKET_ENABLED`).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { onthemarketSourceIdFromUrl } from './parse';
export declare function isOnTheMarketChallenge(html: string): boolean;
export interface OnTheMarketProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class OnTheMarketProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["GB"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    private stickyProxySessionId?;
    private stickyStorageState?;
    constructor(options?: OnTheMarketProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private fetchHtmlViaSession;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { onthemarketSourceIdFromUrl };
