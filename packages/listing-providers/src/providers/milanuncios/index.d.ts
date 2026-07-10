/**
 * milanuncios.com provider (Spain) — general classifieds, REAL-ESTATE ONLY.
 *
 * Classifieds providers must scope discover to real-estate categories and reject
 * non-housing in normalize. Discover uses housing category URLs + AJAX list
 * endpoints from a warmed Playwright session (GeeTest blocks cold HTTP). HTML
 * scrape is last resort and still filtered by category allowlist.
 *
 * Registered OFF by default (`PROVIDER_MILANUNCIOS_ENABLED`). Do NOT enable in
 * prod until the housing filter is verified end-to-end.
 */
import type { NormalizedListing, ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../metrics';
import { milanunciosSourceIdFromUrl, normalizeMilanunciosRaw, parseMilanunciosAdvert } from './parse';
export declare function isMilanunciosChallenge(body: string): boolean;
export interface MilanunciosProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class MilanunciosProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["ES"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    constructor(options?: MilanunciosProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private discoverViaSession;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { milanunciosSourceIdFromUrl, normalizeMilanunciosRaw, parseMilanunciosAdvert };
