/**
 * Kleinanzeigen provider (Germany) — immobilien section ONLY.
 *
 * General classifieds portal: `discover()` only hits housing category URLs
 * (Wohnung/Haus mieten/kaufen, WG-Zimmer). `normalize()` rejects any ad whose
 * category id is outside the housing allowlist. Prefer JSON when a session
 * unlocks it; otherwise parse housing HTML (og: + attributes) via the shared
 * ladder. Contact (tel / WhatsApp / email) is best-effort from the detail page.
 *
 * Registered OFF by default (`PROVIDER_KLEINANZEIGEN_ENABLED`).
 */
import { type NormalizedListing, type ProviderId } from '@homiio/shared-types';
import type { DiscoverJob, ExternalListingRef, FetchContext, FetchRuntime, ListingProvider, ProviderHealth, RawListing } from '../../../types';
import { type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { isKleinanzeigenHousingCategory, kleinanzeigenHousingSearchUrl, kleinanzeigenSourceIdFromUrl, parseKleinanzeigenDetail, parseKleinanzeigenSearch } from './parse';
export interface KleinanzeigenProviderOptions {
    runtime?: FetchRuntime;
    cities?: readonly string[];
    metrics?: ProviderMetricsSink & ProviderMetricsReader;
}
export declare class KleinanzeigenProvider implements ListingProvider {
    readonly id: ProviderId;
    readonly markets: readonly ["DE"];
    private readonly runtime;
    private readonly cities;
    private readonly metrics;
    constructor(options?: KleinanzeigenProviderOptions);
    discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
    fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
    normalize(raw: RawListing): NormalizedListing;
    health(): Promise<ProviderHealth>;
}
export { kleinanzeigenSourceIdFromUrl, kleinanzeigenHousingSearchUrl, parseKleinanzeigenSearch, parseKleinanzeigenDetail, isKleinanzeigenHousingCategory, };
