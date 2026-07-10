import { isPlausibleCityName } from '../../utils/plausibleCityName';

describe('isPlausibleCityName', () => {
  it('accepts real city names', () => {
    expect(isPlausibleCityName('Madrid')).toBe(true);
    expect(isPlausibleCityName('Barcelona')).toBe(true);
    expect(isPlausibleCityName('New York')).toBe(true);
    expect(isPlausibleCityName('San Francisco')).toBe(true);
  });

  it('rejects empty, whitespace, and too-short names', () => {
    expect(isPlausibleCityName('')).toBe(false);
    expect(isPlausibleCityName('   ')).toBe(false);
    expect(isPlausibleCityName('A')).toBe(false);
    expect(isPlausibleCityName(null)).toBe(false);
    expect(isPlausibleCityName(undefined)).toBe(false);
  });

  it('rejects names containing digits', () => {
    expect(isPlausibleCityName('141 Chester Road')).toBe(false);
    expect(isPlausibleCityName('District 9')).toBe(false);
  });

  it('rejects street and building tokens', () => {
    expect(isPlausibleCityName('Penn Street')).toBe(false);
    expect(isPlausibleCityName('141 Chester Road')).toBe(false);
    expect(isPlausibleCityName('Albany House')).toBe(false);
    expect(isPlausibleCityName('Calle Mayor')).toBe(false);
    expect(isPlausibleCityName('Avenida Diagonal')).toBe(false);
    expect(isPlausibleCityName('Plaza Catalunya')).toBe(false);
  });
});
