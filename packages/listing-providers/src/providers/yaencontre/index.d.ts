/**
 * yaencontre.com provider — JSON/AJAX via Playwright session; HTML last resort.
 * Registered OFF (`PROVIDER_YAENCONTRE_ENABLED`). Cloudflare currently blocks
 * cold + proxy sessions; keep OFF until managed tier or session clears.
 */
import type { NormalizedListing, ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../metrics';
export declare function isYaencontreChallenge(body: string): boolean;
export interface YaencontreProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class YaencontreProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["ES"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    constructor(options?: YaencontreProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
