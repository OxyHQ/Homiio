/**
 * OpenRent provider (United Kingdom) — housing-native private lets.
 *
 * Discover pages `/properties-to-rent/<city>` for detail links. Detail parse is
 * title/og-image based (no public AJAX); contact captured when tel:/mailto
 * appear. Viable without a browser for many pages; session used when challenged.
 *
 * Registered OFF by default (`PROVIDER_OPENRENT_ENABLED`).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { openrentSourceIdFromUrl } from './parse';
export declare function isOpenRentChallenge(html: string): boolean;
export interface OpenRentProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class OpenRentProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["GB"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    private stickyProxySessionId?;
    private stickyStorageState?;
    constructor(options?: OpenRentProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private fetchHtmlViaSession;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { openrentSourceIdFromUrl };
