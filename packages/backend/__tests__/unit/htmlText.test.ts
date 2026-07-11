/**
 * HTML → plain-text sanitizer for external listing copy fields.
 */

import {
  sanitizeNormalizedListingTextFields,
  stripHtmlToPlainText,
  validateNormalizedListing,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType, type NormalizedListing } from '@homiio/shared-types';

describe('stripHtmlToPlainText', () => {
  it('returns undefined for empty or undefined input', () => {
    expect(stripHtmlToPlainText(undefined)).toBeUndefined();
    expect(stripHtmlToPlainText('')).toBeUndefined();
    expect(stripHtmlToPlainText('   ')).toBeUndefined();
  });

  it('strips tags, decodes entities, and preserves line breaks from br/p', () => {
    const html =
      '<b>Council Tax Band:</b> E<br /><br /><i>Information contained within this listing is for guidance only...</i><br /><br />';
    expect(stripHtmlToPlainText(html)).toBe(
      'Council Tax Band: E\n\nInformation contained within this listing is for guidance only...',
    );
  });

  it('decodes named and numeric entities', () => {
    expect(stripHtmlToPlainText('Rent &amp; bills &#xA3;1,200')).toBe('Rent & bills £1,200');
  });

  it('handles nested tags', () => {
    expect(stripHtmlToPlainText('<p><strong>Hello</strong> <span>world</span></p>')).toBe(
      'Hello world',
    );
  });
});

describe('sanitizeNormalizedListingTextFields', () => {
  const baseListing = (): NormalizedListing => ({
    source: 'rightmove',
    sourceId: '90551949',
    sourceUrl: 'https://www.rightmove.co.uk/properties/90551949',
    address: {
      street: 'Holland Street',
      city: 'London',
      postalCode: 'SE1 9JF',
      countryCode: 'GB',
    },
    type: PropertyType.APARTMENT,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 3400, currency: 'GBP' },
    remoteImages: [{ url: 'https://example.com/a.jpg', caption: '<b>Living</b> room' }],
    status: 'published',
  });

  it('sanitizes description, amenities, contact, captions, and address text', () => {
    const listing = baseListing();
    listing.description =
      '<b>Council Tax Band:</b> E<br /><br /><i>Guidance only</i>';
    listing.amenities = ['<li>Garden</li>', '  ', '<em>Parking</em>'];
    listing.contact = {
      name: '<b>Jane</b> Doe',
      agencyName: 'Savills &amp; Co',
      phone: '+442038724805',
    };
    listing.address.neighborhood = '<span>Battersea</span>';

    sanitizeNormalizedListingTextFields(listing);

    expect(listing.description).toBe('Council Tax Band: E\n\nGuidance only');
    // HTML-stripped, then canonicalized onto the shared amenity vocabulary.
    expect(listing.amenities).toEqual(['garden', 'parking']);
    expect(listing.contact?.name).toBe('Jane Doe');
    expect(listing.contact?.agencyName).toBe('Savills & Co');
    expect(listing.remoteImages[0]?.caption).toBe('Living room');
    expect(listing.address.neighborhood).toBe('Battersea');
  });

  it('runs automatically inside validateNormalizedListing', () => {
    const listing = baseListing();
    listing.description = '<p>Clean <strong>copy</strong></p>';

    validateNormalizedListing(listing);

    expect(listing.description).toBe('Clean copy');
  });
});
