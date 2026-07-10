/**
 * realtor.com provider (United States).
 *
 * realtor.com exposes an internal GraphQL API at `/frontdoor/graphql` that powers
 * search and detail pages. This plugin uses direct JSON POST (no HTML scrape) for
 * discover + fetch; the shared {@link FetchRuntime} supplies `fetchHttp` only.
 * Registered OFF by default (`PROVIDER_REALTOR_COM_ENABLED`).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { parseRealtorDetailResponse, parseRealtorListingNode, parseRealtorSearchResponse, type RealtorKind } from './api';
import { type RecordedRealtorListing } from './fixtures';
export interface RealtorComRaw {
    sourceId: string;
    url: string;
    kind: RealtorKind;
    listing: RecordedRealtorListing;
}
export interface RealtorComProviderOptions {
    runtime?: FetchRuntime;
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
    cities?: readonly string[];
}
export declare class RealtorComProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["US"];
    private readonly runtime;
    private readonly metrics;
    private readonly cities;
    constructor(options?: RealtorComProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { parseRealtorSearchResponse, parseRealtorDetailResponse, parseRealtorListingNode };
