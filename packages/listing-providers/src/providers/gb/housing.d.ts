import { PropertyType } from '@homiio/shared-types';
/** True when a free-text property type / title looks like residential housing. */
export declare function isGbHousingType(raw: string | undefined): boolean;
/** True when an OnTheMarket propSubId is residential housing. */
export declare function isOtmHousingPropSubId(propSubId: string | undefined): boolean;
/** Map UK portal property-type strings onto Homiio PropertyType. */
export declare function resolveGbPropertyType(raw: string | undefined): PropertyType;
