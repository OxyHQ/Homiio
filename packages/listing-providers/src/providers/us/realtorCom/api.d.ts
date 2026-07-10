/**
 * realtor.com GraphQL API helpers (pure URL + response parsing).
 */
import type { RecordedRealtorListing } from './fixtures';
export declare const REALTOR_GRAPHQL_URL = "https://www.realtor.com/frontdoor/graphql?client_id=rdc-x&schema=vesta";
export declare const REALTOR_GRAPHQL_HEADERS: Readonly<Record<string, string>>;
export type RealtorKind = 'rent' | 'sale';
export declare function realtorKindFromStatus(status: string): RealtorKind;
export declare function realtorSourceUrl(permalink: string): string;
export declare function realtorSearchBody(city: string, kind: RealtorKind, offset: number, limit: number): string;
export declare function realtorDetailBody(propertyId: string): string;
/** Narrow a GraphQL home node into {@link RecordedRealtorListing}. */
export declare function parseRealtorListingNode(node: unknown): RecordedRealtorListing | undefined;
export interface RealtorSearchRefs {
    sourceId: string;
    url: string;
    kind: RealtorKind;
}
/** Parse a ConsumerSearchMainQuery JSON body into listing refs. */
export declare function parseRealtorSearchResponse(body: string): RealtorSearchRefs[];
/** Parse a HomeDetails JSON body into a listing node. */
export declare function parseRealtorDetailResponse(body: string): RecordedRealtorListing | undefined;
/** GraphQL error / rate-limit bodies served as JSON. */
export declare function isRealtorGraphqlChallenge(body: string): boolean;
