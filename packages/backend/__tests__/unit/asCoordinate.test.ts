/**
 * Regression: EU price-style number parsing must NOT be used for lat/lng.
 * "43.541" must stay 43.541 (Barreiros), not become 43541.
 */

import { asCoordinate, asNumberEu } from '@homiio/listing-providers';

describe('asCoordinate (listing-providers)', () => {
  it('keeps decimal degrees', () => {
    expect(asCoordinate('43.541')).toBe(43.541);
    expect(asCoordinate(43.541)).toBe(43.541);
  });

  it('accepts comma decimals', () => {
    expect(asCoordinate('43,541')).toBe(43.541);
  });

  it('differs from asNumberEu which mangles three-digit groups', () => {
    expect(asNumberEu('43.541')).toBe(43541);
    expect(asCoordinate('43.541')).toBe(43.541);
  });
});
