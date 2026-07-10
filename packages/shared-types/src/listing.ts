/**
 * Listing-provider ingestion types shared across the Homiio backend and the
 * `@homiio/listing-providers` package.
 *
 * A provider plugin turns a portal listing (Idealista, Fotocasa, …) into a
 * {@link NormalizedListing} — a provider-agnostic, first-party DTO. The backend
 * `IngestionService` validates it, resolves the canonical Address, upserts a
 * Property (`isExternal: true`, `status: 'published'`, always `sourceUrl`) and
 * ingests each `remoteImages` entry through the Sharp/S3 pipeline into `Image`
 * documents — so the runtime NEVER hotlinks a portal CDN.
 *
 * This is a pure data contract: no runtime scraping, HTTP or DB logic lives
 * here, and nothing in this file imports a Node-only dependency.
 */

import type { OfferingType, PropertyType } from './common';
import type { LongTermRent, ShortTermRent, PropertySale } from './property';

/**
 * The markets a provider can serve. Drives discover scheduling (which cities /
 * bounding boxes a provider is asked to enumerate).
 */
export type ListingMarket =
  | 'ES'
  | 'US'
  | 'IT'
  | 'GB'
  | 'DE'
  | 'RO'
  | 'FR'
  | 'AR'
  | 'EC'
  | 'MX'
  | 'CO'
  | 'CL'
  | 'PE'
  | 'PT'
  | 'CA'
  | 'AU'
  | 'AE'
  | 'IE'
  | 'BE'
  | 'PL'
  | 'NL';

/**
 * Stable identifier for a listing provider. New portals are added here as their
 * plugins land; `fixture` is the Phase-0 local-JSON provider used to exercise
 * the ingest path end to end without touching a real portal.
 */
export type ProviderId =
  | 'fixture'
  | 'idealista'
  | 'fotocasa'
  | 'habitaclia'
  | 'blueground'
  | 'apartments_com'
  | 'zillow'
  | 'realtor_com'
  | 'hotpads'
  | 'redfin'
  | 'pisos'
  | 'milanuncios'
  | 'yaencontre'
  | 'indomio'
  | 'idealista_it'
  | 'immobiliare'
  | 'casa_it'
  | 'subito'
  | 'rightmove'
  | 'zoopla'
  | 'onthemarket'
  | 'openrent'
  | 'immobilienscout24'
  | 'immowelt'
  | 'kleinanzeigen'
  | 'storia'
  | 'imobiliare_ro'
  | 'olx_ro'
  | 'bienici'
  | 'leboncoin'
  | 'seloger'
  | 'properati_ec'
  | 'zonaprop'
  | 'argenprop'
  | 'mercadolibre_ar'
  | 'properati'
  | 'plusvalia'
  | 'mercadolibre_ec'
  | 'propiedades'
  | 'vivanuncios'
  | 'lamudi'
  | 'inmuebles24'
  | 'mercadolibre_co'
  | 'mercadolibre_cl'
  | 'mercadolibre_pe'
  | 'mercadolibre_mx'
  | 'idealista_pt'
  | 'metrocuadrado'
  | 'realestate_com_au'
  | 'realtor_ca'
  | 'bayut'
  | 'daft'
  | 'immoweb'
  | 'otodom'
  | 'funda';

/**
 * Best-effort owner/agent contact captured from a portal when an endpoint
 * exposes it. Missing fields are omitted — ingest must NOT fail when contact
 * fetch 403s or the portal hides the number behind a form. Homiio prefers these
 * for direct contact UI (call / WhatsApp / email) over opening `sourceUrl` alone.
 */
export interface NormalizedListingContact {
  phone?: string;
  email?: string;
  /** WhatsApp number digits (no wa.me URL). */
  whatsapp?: string;
  /** Person or agency display name when the portal exposes one. */
  name?: string;
  agencyName?: string;
  /** Whether the contact is a private owner or an agency (when known). */
  kind?: 'owner' | 'agency' | 'private' | 'unknown';
}

/**
 * A remote source image for a listing, as reported by the provider. The `url`
 * points at the PORTAL's CDN and is used ONCE at ingest time to fetch the bytes
 * for the Sharp/S3 pipeline — it is NEVER persisted as a runtime `images[].url`.
 */
export interface NormalizedRemoteImage {
  /** Absolute URL of the source image on the portal's CDN. */
  url: string;
  /** Optional human caption. */
  caption?: string;
  /** Whether this is the listing's primary/cover image. */
  isPrimary?: boolean;
}

/**
 * The listing's address as reported by a provider. Carries human-readable place
 * NAMES plus coordinates; the backend resolves these to the canonical geo id
 * chain via `Address.findOrCreateCanonical` (names are never persisted as text).
 */
export interface NormalizedListingAddress {
  street: string;
  city: string;
  /** State / province / region name. */
  state?: string;
  /** Country name (defaults applied server-side when omitted). */
  country?: string;
  /** ISO-2 country code, when the provider knows it (aids geo resolution). */
  countryCode?: string;
  postalCode?: string;
  neighborhood?: string;
  /** Source coordinates. Preferred over name-only geocoding when present. */
  coordinates?: {
    lat: number;
    lng: number;
  };
}

/**
 * Provider-agnostic, first-party representation of one external listing, ready
 * for ingestion. Every provider's `normalize()` returns this shape so the ingest
 * path is identical regardless of the source portal.
 */
export interface NormalizedListing {
  /** Which provider produced this listing. */
  source: ProviderId;
  /** The listing's stable id ON the source portal (dedupe key with `source`). */
  sourceId: string;
  /** Canonical URL of the listing on the source portal (the CTA target). */
  sourceUrl: string;
  address: NormalizedListingAddress;
  type: PropertyType;
  /** How the listing is offered; must match exactly the present priced blocks. */
  offerings: OfferingType[];
  /** Monthly-rent pricing, present iff `offerings` includes `LONG_TERM_RENT`. */
  longTermRent?: LongTermRent;
  /** Per-night pricing, present iff `offerings` includes `SHORT_TERM_RENT`. */
  shortTermRent?: ShortTermRent;
  /** Sale pricing, present iff `offerings` includes `SALE`. */
  sale?: PropertySale;
  description?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  floor?: number;
  amenities?: string[];
  furnishedStatus?: 'furnished' | 'unfurnished' | 'partially_furnished' | 'not_specified';
  /** Source images fetched once at ingest and re-hosted; never hotlinked. */
  remoteImages: NormalizedRemoteImage[];
  /**
   * Best-effort advertiser contact from portal AJAX (phone / email / WhatsApp).
   * Optional — many portals keep this DataDome-gated; when present Homiio can
   * offer direct contact UI instead of only opening `sourceUrl`.
   */
  contact?: NormalizedListingContact;
  /**
   * Listing lifecycle status. External aggregator listings are always published
   * (visible in search) — the literal is fixed so a provider can't emit a
   * private/draft external listing.
   */
  status: 'published';
  /**
   * Optional override for how long (in days) the ingested Property should live
   * before its TTL sweep removes it. Falls back to the ingest default.
   */
  ttlDays?: number;
}
