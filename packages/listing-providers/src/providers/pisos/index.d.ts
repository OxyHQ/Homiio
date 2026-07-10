/**
 * pisos.com provider (Spain) — JSON-first.
 *
 * Acquisition:
 *   - `discover()`: city rental search pages → schema.org JSON-LD cards (structured
 *     listing refs). Optional Playwright session warm-up when the ladder challenges.
 *   - `fetch()`: detail page embedded JSON (`data-var` + tracking blob) for price /
 *     rooms / m² / phone; best-effort `/WebsiteUserInfo/GetNormalizedPhone` AJAX.
 *   - HTML is last-resort for title/images/description only.
 *
 * Registered OFF by default (`PROVIDER_PISOS_ENABLED`).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../metrics';
import { pisosSourceIdFromUrl } from './parse';
export declare function isPisosChallenge(html: string): boolean;
export interface PisosProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class PisosProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["ES"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    constructor(options?: PisosProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private fetchSearchViaSession;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { pisosSourceIdFromUrl };
