/**
 * Local fixture dataset for the Phase-0 `fixture` provider.
 *
 * These are hand-authored, portal-shaped raw payloads (NOT real listings) used
 * to exercise the full discover → fetch → normalize → ingest path without ever
 * touching a real portal. Each carries FULL place names (city/state/country +
 * countryCode) AND coordinates so `Address.findOrCreateCanonical` resolves the
 * geo chain locally, with zero geocoder network calls.
 *
 * `images[].url` point at example CDN hosts; the ingest pipeline fetches those
 * bytes ONCE and re-hosts them via the Sharp/S3 pipeline — they are never used
 * as runtime image URLs.
 */

/** Raw fixture image entry (portal-shaped). */
export interface FixtureRawImage {
  url: string;
  caption?: string;
  isPrimary?: boolean;
}

/** Raw fixture listing payload (portal-shaped, pre-normalization). */
export interface FixtureRawListing {
  id: string;
  url: string;
  propertyType: string;
  address: {
    street: string;
    city: string;
    state: string;
    country: string;
    countryCode: string;
    postalCode?: string;
    neighborhood?: string;
    lat: number;
    lng: number;
  };
  monthlyRent: number;
  currency: string;
  description?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  floor?: number;
  furnished?: boolean;
  amenities?: string[];
  images: FixtureRawImage[];
}

/**
 * The bundled fixture listings. Kept intentionally small (two Barcelona flats)
 * — enough to prove the ingest path, upsert dedup and multi-image handling.
 */
export const FIXTURE_LISTINGS: readonly FixtureRawListing[] = [
  {
    id: 'fixture-bcn-0001',
    url: 'https://fixtures.homiio.com/es/barcelona/fixture-bcn-0001',
    propertyType: 'apartment',
    address: {
      street: 'Carrer de Mallorca 250',
      city: 'Barcelona',
      state: 'Catalonia',
      country: 'Spain',
      countryCode: 'ES',
      postalCode: '08008',
      neighborhood: "L'Antiga Esquerra de l'Eixample",
      lat: 41.3947,
      lng: 2.1636,
    },
    monthlyRent: 1450,
    currency: 'EUR',
    description: 'Bright two-bedroom flat in the Eixample with a balcony and lift.',
    bedrooms: 2,
    bathrooms: 1,
    squareMeters: 78,
    floor: 3,
    furnished: true,
    amenities: ['balcony', 'elevator', 'air_conditioning', 'heating'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1280&q=80',
        caption: 'Living room',
        isPrimary: true,
      },
      {
        url: 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=1280&q=80',
        caption: 'Bedroom',
      },
    ],
  },
  {
    id: 'fixture-bcn-0002',
    url: 'https://fixtures.homiio.com/es/barcelona/fixture-bcn-0002',
    propertyType: 'apartment',
    address: {
      street: 'Carrer de Girona 112',
      city: 'Barcelona',
      state: 'Catalonia',
      country: 'Spain',
      countryCode: 'ES',
      postalCode: '08009',
      neighborhood: 'La Dreta de l\'Eixample',
      lat: 41.3985,
      lng: 2.1686,
    },
    monthlyRent: 1200,
    currency: 'EUR',
    description: 'Cozy one-bedroom apartment close to Sagrada Família.',
    bedrooms: 1,
    bathrooms: 1,
    squareMeters: 55,
    floor: 2,
    furnished: false,
    amenities: ['heating', 'elevator'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1280&q=80',
        caption: 'Interior',
        isPrimary: true,
      },
    ],
  },
];
