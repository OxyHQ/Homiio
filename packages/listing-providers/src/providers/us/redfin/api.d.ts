/**
 * Redfin Stingray API helpers (pure URL building + JSON parsing).
 */
import { type RedfinHomeFixture } from './fixtures';
/** Known Redfin `region_id` values for default US discover cities. */
export declare const REDFIN_CITY_REGIONS: Readonly<Record<string, {
    regionId: number;
    path: string;
}>>;
export type RedfinKind = 'rent' | 'sale';
export declare function redfinWarmUrl(citySlug: string): string;
export declare function redfinGisUrl(regionId: number, pageNumber: number, numHomes: number): string;
export declare function redfinInitialInfoUrl(homePath: string): string;
export declare function redfinSourceUrl(homePath: string): string;
export declare function redfinSourceId(propertyId: number): string;
/** Parse one Stingray home row into {@link RedfinHomeFixture}. */
export declare function parseRedfinHomeNode(home: unknown): RedfinHomeFixture | undefined;
export declare function redfinKindFromHome(home: Record<string, unknown>): RedfinKind;
export interface RedfinSearchRef {
    sourceId: string;
    url: string;
    kind: RedfinKind;
    homePath: string;
}
/** Parse a Stingray GIS body into listing refs. */
export declare function parseRedfinGisResponse(body: string): RedfinSearchRef[];
/** Parse initialInfo / GIS single-home payload. */
export declare function parseRedfinDetailResponse(body: string): RedfinHomeFixture | undefined;
export declare function isRedfinStingrayChallenge(body: string): boolean;
/** CSS selector for Redfin city search warm-up. */
export declare const REDFIN_CONTENT_SELECTOR = "#results-display, .HomeCardsContainer, .MapAndListViewSection";
