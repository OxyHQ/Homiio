/**
 * Geo hierarchy types shared across Homiio frontend and backend.
 *
 * The geo layer is DB-owned and fully relational. A property's location is NOT
 * stored as free text; it is resolved (once, via geocoding) into a canonical
 * chain of documents and referenced by id:
 *
 *   Country (ISO-2)  ──<  Region (province / state / autonomous community)
 *        │                     │
 *        └──────────<  City  >─┘
 *                       │
 *                       └──<  Neighborhood
 *
 *   Address  →  references countryId, regionId, cityId, neighborhoodId? by id.
 *
 * Canonical display names live ONCE, on the Country / Region / City /
 * Neighborhood documents. Consumers resolve names via populate, never by
 * duplicating strings onto the Address. The only denormalized field kept on the
 * Address is `countryCode` (ISO-2) for fast country filtering without a join.
 */

import { Coordinates } from './common';
import { Image } from './media';

/** ISO-4217-style currency code used across the geo + pricing layer. */
export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'FAIR';

/**
 * A geo entity's cover-image reference as serialized by the API: the bare Image
 * `_id` (string) when un-populated, or the populated {@link Image} document when
 * the endpoint expands it (the `/api/cities*` routes populate
 * `coverImageId` → `{ urls, caption, width, height }`). Same Mongoose field,
 * either form — consumers read `urls` off the populated shape.
 */
export type CoverImageRef = string | Image;

/**
 * A country. The canonical home of a country's display name and currency.
 * Keyed by its ISO-3166-1 alpha-2 code (e.g. `ES`, `US`, `GB`).
 */
export interface Country {
  _id: string;
  /** ISO-3166-1 alpha-2 code, uppercase (e.g. `ES`). Unique. */
  code: string;
  /** Canonical English display name (e.g. `Spain`). */
  name: string;
  /** Default ISO-4217 currency for the country (e.g. `EUR`). */
  currency: CurrencyCode;
  /** Optional emoji flag (e.g. `🇪🇸`). */
  flag?: string;
  /** Optional BCP-47 default locale (e.g. `es-ES`). */
  defaultLocale?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A first-level administrative division within a country: a province, state or
 * autonomous community (e.g. Catalonia, Community of Madrid). The canonical home
 * of the region's display name; references its country by id.
 */
export interface Region {
  _id: string;
  /** The owning country's `_id`. */
  countryId: string;
  /**
   * Region code where one is well-defined (e.g. ISO-3166-2 subdivision code
   * `ES-CT` for Catalonia). Optional because not every region has a stable code.
   */
  code?: string;
  /** Canonical display name (e.g. `Catalonia`). */
  name: string;
  /**
   * The region's cover photo: the `_id` of an {@link Image} with
   * `entityType: 'region'` and `entityId` equal to this region's `_id`.
   * Populated to the {@link Image} document when an endpoint expands it. See
   * {@link CoverImageRef}.
   */
  coverImageId?: CoverImageRef;
  /**
   * All of the region's photos, by `_id`, referencing {@link Image} documents
   * (`entityType: 'region'`, `entityId` = this region's `_id`).
   */
  imageIds?: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A city. References its country and region by id. Canonical country/region
 * NAMES live on the Country/Region docs (resolved via populate), NOT here.
 * `popularNeighborhoods` is derived from the Neighborhood collection, not a
 * free-text array.
 */
export interface City {
  _id: string;
  name: string;
  /**
   * The owning country's `_id`, or the populated {@link Country} document when an
   * endpoint expands it (the `/api/cities*` routes populate `countryId` →
   * `{ name, code, currency, flag }`).
   */
  countryId: string | Country;
  /**
   * The owning region's `_id`, or the populated {@link Region} document when an
   * endpoint expands it (the `/api/cities*` routes populate `regionId` →
   * `{ name, code }`).
   */
  regionId: string | Region;
  coordinates?: Coordinates;
  timezone?: string;
  population?: number;
  description?: string;
  averageRent?: number;
  currency: CurrencyCode;
  /**
   * The city's cover photo: the `_id` of an {@link Image} with
   * `entityType: 'city'` and `entityId` equal to this city's `_id`. Set once at
   * seed time (the curated city image is fetched, processed and stored in our own
   * object storage), so there is no live external image dependency at runtime.
   * Serialized as the populated {@link Image} (with `urls`) by the `/api/cities*`
   * routes; a bare id otherwise. See {@link CoverImageRef}.
   */
  coverImageId?: CoverImageRef;
  /**
   * All of the city's photos, by `_id`, referencing {@link Image} documents
   * (`entityType: 'city'`, `entityId` = this city's `_id`).
   */
  imageIds?: string[];
  isActive: boolean;
  /** Maintained from the count of published properties whose Address.cityId matches. */
  propertiesCount: number;
  lastUpdated: string;
  createdAt: string;
  updatedAt: string;
  /** Populated when the country ref is expanded. */
  country?: Country;
  /** Populated when the region ref is expanded. */
  region?: Region;
}

/**
 * A neighborhood (a.k.a. quarter / suburb / barrio) within a city. The
 * canonical home of the neighborhood's display name; references its city by id.
 * Optional bounding box / centroid support map framing and reverse lookups.
 */
export interface Neighborhood {
  _id: string;
  /** The owning city's `_id`. */
  cityId: string;
  name: string;
  /** Optional centroid for map framing. */
  centroid?: Coordinates;
  /**
   * Optional bounding box as GeoJSON-style [west, south, east, north]
   * (lng/lat degrees), populated from geocoding when available.
   */
  bbox?: [number, number, number, number];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
