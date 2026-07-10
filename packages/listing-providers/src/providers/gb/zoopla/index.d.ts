/**
 * Zoopla provider (United Kingdom).
 *
 * Cloudflare blocks cold HTTP (403). Prefer warmed Playwright session, then
 * parse `__NEXT_DATA__` listing JSON (contact from branch/agent). HTML link
 * scrape is the discover fallback. Housing-only.
 *
 * Registered OFF by default (`PROVIDER_ZOOPLA_ENABLED`) — enable once a
 * residential proxy + browser tier clears Cloudflare in the worker.
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { zooplaSourceIdFromUrl } from './parse';
export declare function isZooplaChallenge(html: string): boolean;
export interface ZooplaProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class ZooplaProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["GB"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    private stickyProxySessionId?;
    private stickyStorageState?;
    constructor(options?: ZooplaProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    private fetchHtmlViaSession;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { zooplaSourceIdFromUrl };
