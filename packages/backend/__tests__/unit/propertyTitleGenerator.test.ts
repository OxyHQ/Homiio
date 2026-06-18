const {
  generatePropertyTitle,
  generateShortPropertyTitle,
  generateLargePropertyTitle,
  generateDetailedPropertyTitle,
} = require('../../utils/propertyTitleGenerator');

describe('generateShortPropertyTitle', () => {
  it('uses the resolved geo neighborhood when available', () => {
    const title = generateShortPropertyTitle({
      type: 'room',
      address: { street: 'Carrer de Mallorca 15' },
      geo: { city: 'Barcelona', region: 'Catalonia', neighborhood: 'Sant Andreu' },
    });
    expect(title).toBe('Room in Sant Andreu');
  });

  it('extracts a neighborhood-like name from the street when geo has none', () => {
    const title = generateShortPropertyTitle({
      type: 'apartment',
      bedrooms: 2,
      address: { street: 'Carrer de Mallorca 15' },
      geo: { city: 'Barcelona' },
    });
    expect(title).toBe('Apartment in Mallorca');
  });

  it('labels a single-bedroom apartment as a Studio', () => {
    const title = generateShortPropertyTitle({
      type: 'apartment',
      bedrooms: 1,
      address: {},
      geo: { city: 'Madrid' },
    });
    expect(title).toBe('Studio in Madrid');
  });

  it('falls back to city, then region, then a TBD placeholder', () => {
    expect(
      generateShortPropertyTitle({ type: 'house', bedrooms: 3, address: {}, geo: { city: 'Girona' } }),
    ).toBe('House in Girona');
    expect(
      generateShortPropertyTitle({ type: 'house', bedrooms: 3, address: {}, geo: { region: 'Catalonia' } }),
    ).toBe('House in Catalonia');
    expect(
      generateShortPropertyTitle({ type: 'house', bedrooms: 3, address: {}, geo: null }),
    ).toBe('House in Location TBD');
  });

  it('labels unknown property types as Property', () => {
    const title = generateShortPropertyTitle({
      type: 'castle',
      address: {},
      geo: { city: 'Lisbon' },
    });
    expect(title).toBe('Property in Lisbon');
  });

  it('caps the title at 100 characters', () => {
    const longNeighborhood = 'N'.repeat(150);
    const title = generateShortPropertyTitle({
      type: 'studio',
      address: {},
      geo: { neighborhood: longNeighborhood },
    });
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title.startsWith('Studio in N')).toBe(true);
  });
});

describe('generateLargePropertyTitle', () => {
  it('builds a full street + city + region title', () => {
    const title = generateLargePropertyTitle({
      type: 'apartment',
      bedrooms: 2,
      address: { street: "Carrer D'alí Bei 27" },
      geo: { city: 'Barcelona', region: 'Catalonia' },
    });
    expect(title).toBe("Apartment for rent in Carrer D'alí Bei 27, Barcelona, Catalonia");
  });

  it('falls back to city and region when no street is present', () => {
    const title = generateLargePropertyTitle({
      type: 'penthouse',
      address: {},
      geo: { city: 'Valencia', region: 'Valencian Community' },
    });
    expect(title).toBe('Penthouse for rent in Valencia, Valencian Community');
  });
});

describe('generatePropertyTitle', () => {
  it('routes the large format and defaults to the short format', () => {
    const data = {
      type: 'room',
      address: { street: 'Gran Via 1' },
      geo: { city: 'Madrid', neighborhood: 'Sol' },
    };
    expect(generatePropertyTitle(data)).toBe('Room in Sol');
    expect(generatePropertyTitle(data, 'large')).toBe('Room for rent in Gran Via 1, Madrid');
  });
});

describe('generateDetailedPropertyTitle', () => {
  it('appends bed/bath details when requested', () => {
    const data = {
      type: 'house',
      bedrooms: 3,
      bathrooms: 2,
      address: {},
      geo: { city: 'Seville' },
    };
    expect(generateDetailedPropertyTitle(data, true)).toBe('House in Seville - 3 beds, 2 baths');
    expect(generateDetailedPropertyTitle(data, false)).toBe('House in Seville');
  });
});
