/**
 * Address-related types shared across Homiio frontend and backend.
 *
 * An Address is a BUILDING-level record. Its administrative geo (country /
 * region / city / neighborhood) is NOT stored as free text — it is referenced
 * by id into the DB-owned geo collections (see `./geo`). Canonical names are
 * read via populate (`countryId`/`regionId`/`cityId`/`neighborhoodId` →
 * `Country`/`Region`/`City`/`Neighborhood`). The only denormalized location
 * field kept here is `countryCode` (ISO-2), for fast country filtering without
 * a join.
 */

import { GeoJSONPoint } from './common';
import { Country, Region, City, Neighborhood } from './geo';

export interface Address {
  // ---- Relational geo references (resolved from coordinates/names) ----
  /** Country document id (Country collection). */
  countryId: string;
  /** Region (province / state / autonomous community) document id. */
  regionId: string;
  /** City document id. */
  cityId: string;
  /** Neighborhood document id, when the address resolves to a known neighborhood. */
  neighborhoodId?: string;
  /** ISO-2 country code — the only denormalized geo field, kept for fast filtering. */
  countryCode: string;

  // ---- Building-level fields ----
  street: string;
  postal_code: string;
  number?: string;
  building_name?: string;
  block?: string;
  entrance?: string;
  floor?: string;
  unit?: string;
  subunit?: string;
  /** Borough/district label within a city (free-text building-level descriptor). */
  district?: string;
  address_lines?: string[];
  po_box?: string;
  reference?: string;

  // Land plot information
  land_plot?: {
    block?: string;
    lot?: string;
    parcel?: string;
  };

  // Flexible additional data
  extras?: Record<string, unknown>;

  // Coordinates
  coordinates?: GeoJSONPoint;
}

export interface AddressDocument extends Address {
  _id: string;
  id: string;
  normalizedKey: string;
  /** Populated when the country ref is expanded. */
  country?: Country;
  /** Populated when the region ref is expanded. */
  region?: Region;
  /** Populated when the city ref is expanded. */
  city?: City;
  /** Populated when the neighborhood ref is expanded. */
  neighborhood?: Neighborhood;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Resolved geo DISPLAY NAMES for an address, derived server-side from the
 * relational geo chain (Country / Region / City / Neighborhood docs) and
 * attached to the `address` of a serialized Property so list/detail/search
 * cards can render a location label without an N+1 lookup per card.
 *
 * These are DERIVED display strings — the canonical names still live once on the
 * geo docs, and the `countryId`/`regionId`/`cityId`/`neighborhoodId` references
 * remain the source of truth. Any field is absent when its ref is unresolved.
 */
export interface AddressGeoNames {
  /** Resolved City name (e.g. `Barcelona`). */
  cityName?: string;
  /** Resolved Region/province name (e.g. `Catalonia`). */
  regionName?: string;
  /** Resolved Country name (e.g. `Spain`). */
  countryName?: string;
  /** Resolved Neighborhood name, when the address references a known neighborhood. */
  neighborhoodName?: string;
  /**
   * Ready-to-render location label, the resolved names joined for display
   * (`City, Region, Country`). Present when at least the city resolves.
   */
  location?: string;
}

/**
 * The `address` shape as it appears on a SERIALIZED Property (the API renames
 * the populated `addressId` to `address`). It carries the building-level fields
 * and relational geo ids of an {@link Address}, plus the server-resolved geo
 * display names ({@link AddressGeoNames}) so consumers read location NAMES
 * directly. `_id`/`id` are present because the address is a persisted document.
 */
export interface PropertyAddress extends Address, AddressGeoNames {
  _id?: string;
  id?: string;
}

export interface AddressDetail extends Address {
  formattedAddress: string;
  /** Derived neighborhood insights for display (not the stored geo doc). */
  neighborhoodInsights?: {
    name: string;
    walkScore?: number;
    transitScore?: number;
    bikeScore?: number;
    crimeRate?: number;
    averageRent?: number;
  };
  nearbyAmenities?: Array<{
    name: string;
    type: 'restaurant' | 'grocery' | 'pharmacy' | 'school' | 'hospital' | 'park' | 'transit' | 'shopping';
    distance: number;
    rating?: number;
    address?: string;
    phone?: string;
  }>;
}

export interface AddressSuggestion {
  id: string;
  text: string;
  icon: string;
  lat?: number;
  lon?: number;
  address?: {
    street: string;
    city: string;
    state?: string;
    country: string;
    postcode: string;
    countryCode?: string;
  };
}

export interface AddressCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Input shape for address creation. Callers supply human-readable place NAMES
 * (city/state/country) and/or coordinates; the backend's geo-resolution service
 * turns them into the canonical `countryId`/`regionId`/`cityId`/`neighborhoodId`
 * references — names are never persisted on the Address itself. Legacy/locale
 * aliases are accepted for the building-level fields.
 */
export interface AddressInput {
  // Building-level (persisted)
  street: string;
  postal_code?: string;
  number?: string;
  building_name?: string;
  block?: string;
  entrance?: string;
  floor?: string;
  unit?: string;
  subunit?: string;
  district?: string;
  address_lines?: string[];
  po_box?: string;
  reference?: string;
  land_plot?: {
    block?: string;
    lot?: string;
    parcel?: string;
  };
  extras?: Record<string, unknown>;
  coordinates?: GeoJSONPoint;

  // Geo NAMES used only to RESOLVE the geo id chain (not persisted as text)
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  neighborhood?: string;

  // Legacy/alias fields for building-level data (backward compatibility)
  zipCode?: string;
  zip?: string;
  postcode?: string;
  codigo_postal?: string;
  puerta?: string;
  apartment?: string;
  suite?: string;
  apt?: string;
  piso?: string;
  bloque?: string;
  torre?: string;
  tower?: string;
  building?: string;
  planta?: string;
  nivel?: string;
  level?: string;
  line1?: string;
  line2?: string;
}
