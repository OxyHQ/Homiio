/**
 * Eviction contact phones round-trip through Bloom's `PhoneInput` without
 * rewriting stored data.
 *
 * The defect this guards: a legacy number stored without `+` was shown under a
 * default country and, on re-save, came back with that country's dial code
 * prepended — silently turning a Portuguese or French contact into a Spanish
 * one. Only a number the user actually typed may gain a dial code.
 */
import {
  FALLBACK_PHONE_COUNTRY,
  countryCodeFromPlace,
  emptyEvictionPhone,
  joinEvictionPhone,
  regionFromLocaleTag,
  resolveDefaultPhoneCountry,
  splitEvictionPhone,
  withPhoneCountry,
  withPhoneNumber,
} from '@/components/evictions/evictionPhone';

describe('an existing case re-saved without touching its phone fields', () => {
  it.each([
    ['a legacy number without +', '600 000 000'],
    ['a legacy number with a 00 prefix', '0033 6 12 34 56 78'],
    ['a value with odd spacing', '  612-345-678 '],
    ['a +number with no known dial code', '+999 123'],
    ['a parseable international number, unformatted', '+34600000000'],
  ])('keeps %s byte for byte', (_label, stored) => {
    for (const defaultCountry of ['ES', 'PT', 'US']) {
      const field = splitEvictionPhone(stored, defaultCountry);
      expect(joinEvictionPhone(field)).toBe(stored);
    }
  });

  it('stores nothing for a field that was empty', () => {
    expect(joinEvictionPhone(splitEvictionPhone(undefined, 'ES'))).toBeUndefined();
    expect(joinEvictionPhone(splitEvictionPhone('   ', 'ES'))).toBeUndefined();
  });
});

describe('a number the user types', () => {
  it('gets the selected country dial code', () => {
    const typed = withPhoneNumber(emptyEvictionPhone('PT'), '912 345 678');
    expect(joinEvictionPhone(typed)).toBe('+351 912 345 678');
  });

  it('follows a country the user picked', () => {
    const field = withPhoneCountry(withPhoneNumber(emptyEvictionPhone('ES'), '6 12 34 56 78'), 'FR');
    expect(joinEvictionPhone(field)).toBe('+33 6 12 34 56 78');
  });

  it('keeps its own + prefix as typed', () => {
    const typed = withPhoneNumber(emptyEvictionPhone('ES'), '+44 7700 900123');
    expect(joinEvictionPhone(typed)).toBe('+44 7700 900123');
  });

  it('edits of a legacy number are what gain the dial code', () => {
    const legacy = splitEvictionPhone('600 000 000', 'ES');
    expect(joinEvictionPhone(withPhoneNumber(legacy, '600 000 001'))).toBe('+34 600 000 001');
  });

  it('clearing the field stores nothing', () => {
    const legacy = splitEvictionPhone('600 000 000', 'ES');
    expect(joinEvictionPhone(withPhoneNumber(legacy, ''))).toBeUndefined();
  });
});

describe('splitting a stored international number', () => {
  it('shows the country and the national part', () => {
    const field = splitEvictionPhone('+351 912 345 678', 'ES');
    expect(field.country).toBe('PT');
    expect(field.number).toBe('912 345 678');
  });

  it('prefers the default country on a shared dial code', () => {
    expect(splitEvictionPhone('+1 415 555 0100', 'CA').country).toBe('CA');
  });
});

describe('the default country', () => {
  it("comes from the case's own location first", () => {
    expect(
      resolveDefaultPhoneCountry({ caseCountryCode: 'pt', deviceRegion: 'ES', localeTag: 'es-ES' }),
    ).toBe('PT');
  });

  it('then a geocoded country name', () => {
    expect(resolveDefaultPhoneCountry({ addressCountry: 'France', deviceRegion: 'ES' })).toBe('FR');
  });

  it('then the device region, then the locale tag', () => {
    expect(resolveDefaultPhoneCountry({ deviceRegion: 'MX', localeTag: 'es-ES' })).toBe('MX');
    expect(resolveDefaultPhoneCountry({ localeTag: 'pt-BR' })).toBe('BR');
  });

  it('is never a hardcoded market when nothing is known', () => {
    expect(resolveDefaultPhoneCountry({ localeTag: 'es' })).toBe(FALLBACK_PHONE_COUNTRY);
  });

  it('ignores places it cannot identify', () => {
    expect(countryCodeFromPlace('Atlantis')).toBeUndefined();
    expect(regionFromLocaleTag('en')).toBeUndefined();
  });
});
