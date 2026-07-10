/**
 * HotPads public JSON API helpers (pure URL building + response parsing).
 */
import { type HotpadsListingFixture } from './fixtures';
export interface HotpadsArea {
    id: string;
    resourceId: string;
    name: string;
    state: string;
    city: string;
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
}
export interface HotpadsSearchRef {
    sourceId: string;
    url: string;
    lotIdEncoded: string;
}
export declare function hotpadsAreaUrl(resourceId: string): string;
export declare function hotpadsListingsUrl(area: HotpadsArea, limit?: number): string;
export declare function hotpadsSourceUrl(uriMalone: string): string;
/** Parse area/byResourceId JSON into a {@link HotpadsArea}. */
export declare function parseHotpadsArea(body: string): HotpadsArea | undefined;
/** Parse byCoordsV2 JSON into listing refs. */
export declare function parseHotpadsSearch(body: string): HotpadsSearchRef[];
/** Find one listing node in a byCoordsV2 body by alias/source id. */
export declare function parseHotpadsListingById(body: string, sourceId: string): HotpadsListingFixture | undefined;
export declare function isHotpadsApiChallenge(body: string): boolean;
