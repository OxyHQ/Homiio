// DEV-MOCK — local preview data for the home screen. Never committed.
// Enabled with EXPO_PUBLIC_HOME_MOCK=1. Built from real api.homiio.com listings;
// production has no short-term or exchange listings yet, so those two modes
// reuse the rentals with a derived nightly rate / swap terms.
import type { HomeSection, HomeSectionId, HomeSectionSource, Property } from '@homiio/shared-types';
import rentals from './homeMockProperties.json';
import sales from './homeMockSale.json';

type Listing = Property & Record<string, unknown>;

const SECTIONS: Record<string, [HomeSectionId, HomeSectionSource][]> = {
  long_term_rent: [
    ['new_in_area', 'listing_created_at'],
    ['no_agency_fee', 'listing_agency_fee_flag'],
    ['transparent_total_cost', 'listing_cost_fields'],
    ['with_resident_reviews', 'resident_reviews'],
  ],
  short_term_rent: [
    ['new_in_area', 'listing_created_at'],
    ['transparent_total_cost', 'listing_cost_fields'],
    ['with_resident_reviews', 'resident_reviews'],
  ],
  sale: [
    ['new_in_area', 'listing_created_at'],
    ['price_reduced', 'listing_sale_price_reduced_flag'],
    ['no_longer_available', 'listing_status'],
  ],
  exchange: [
    ['new_in_area', 'listing_created_at'],
    ['with_resident_reviews', 'resident_reviews'],
  ],
};

function listingsFor(offering: string): Property[] {
  const base = (offering === 'sale' ? sales : rentals) as unknown as Listing[];
  if (offering === 'short_term_rent') {
    return base.map((p) => {
      const rent = (p.longTermRent as { monthlyAmount: number; currency: string }) ?? null;
      return {
        ...p,
        id: `${p.id}-stay`,
        offerings: ['short_term_rent'],
        longTermRent: undefined,
        shortTermRent: {
          nightlyRate: Math.round((rent?.monthlyAmount ?? 3000) / 25),
          currency: rent?.currency ?? 'EUR',
        },
      } as unknown as Property;
    });
  }
  if (offering === 'exchange') {
    return base.map(
      (p) =>
        ({
          ...p,
          id: `${p.id}-swap`,
          offerings: ['exchange'],
          longTermRent: undefined,
          exchange: { mode: 'swap', availabilityWindows: [] },
        }) as unknown as Property,
    );
  }
  return base;
}

const location = { status: 'resolved', key: 'here:25000', radiusMeters: 25000 } as never;
const generatedAt = new Date().toISOString();

export const HOME_MOCK =
  process.env.EXPO_PUBLIC_HOME_MOCK === '1'
    ? (offering: string) => {
        const listings = listingsFor(offering);
        const slice = (from: number, count: number) => listings.slice(from, from + count);
        return {
          sections: (SECTIONS[offering] ?? SECTIONS.long_term_rent).map(
            ([id, source], index): HomeSection<Property> => ({
              id,
              reason: `home.sections.${id}.reason`,
              source,
              location,
              generatedAt,
              items: slice(index * 8, 8),
            }),
          ),
          recentlyViewed: slice(40, 8),
          saved: slice(48, 8),
        };
      }
    : null;
