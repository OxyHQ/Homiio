/**
 * Redfin provider (United States).
 *
 * Redfin's Stingray JSON endpoints are CloudFront-gated on cold HTTP. This
 * plugin warms a Playwright session on a city search page, then calls
 * `/stingray/api/gis` and `/stingray/api/home/details/initialInfo` via
 * `session.request` (shared browser-session pattern). Registered OFF by default
 * (`PROVIDER_REDFIN_ENABLED`).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { parseRedfinDetailResponse, parseRedfinGisResponse, redfinKindFromHome, type RedfinKind } from './api';
import { type RedfinHomeFixture } from './fixtures';
export interface RedfinRaw {
    sourceId: string;
    url: string;
    kind: RedfinKind;
    home: RedfinHomeFixture;
}
export interface RedfinProviderOptions {
    runtime?: FetchRuntime;
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
    cities?: readonly string[];
}
export declare class RedfinProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["US"];
    private readonly runtime;
    private readonly metrics;
    private readonly cities;
    private stickyProxySessionId?;
    private stickyStorageState?;
    constructor(options?: RedfinProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private discoverCityViaStingray;
    private discoverCityViaHtml;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    private fetchViaStingray;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { parseRedfinGisResponse, parseRedfinDetailResponse, redfinKindFromHome };
