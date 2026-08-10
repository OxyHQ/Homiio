/**
 * Tests for the shared percentage formatter (`format/percentage`).
 *
 * The one real decision is `input`, because Homiio stores percentages both as
 * fractions (`defaultDownPaymentFraction: 0.20`) and as percents
 * (`recommendationPercentage: 87`). The fixtures deliberately use values where
 * the two readings differ by 100×, so a call site holding the wrong one fails
 * loudly instead of rendering something plausible.
 */
import { formatPercentage } from '@homiio/shared-types';

describe('formatPercentage', () => {
  it('treats a bare number as a fraction, matching Intl style: percent', () => {
    expect(formatPercentage(0.2, 'en-US')).toBe('20%');
  });

  it('scales a value already expressed in percent', () => {
    expect(formatPercentage(87, 'en-US', { input: 'percent' })).toBe('87%');
  });

  it('reads the two inputs 100x apart, so a mismatch is impossible to miss', () => {
    expect(formatPercentage(87, 'en-US')).toContain('8,700');
    expect(formatPercentage(87, 'en-US', { input: 'percent' })).not.toContain('8,700');
  });

  it('follows the locale for the decimal separator and the space before the sign', () => {
    const us = formatPercentage(0.205, 'en-US');
    const es = formatPercentage(0.205, 'es-ES');
    expect(us).toContain('20.5');
    expect(es).toContain('20,5');
    expect(es).not.toBe(us);
  });

  it('rounds to one fraction digit by default and honours an override', () => {
    expect(formatPercentage(0.20549, 'en-US')).toBe('20.5%');
    expect(formatPercentage(0.20549, 'en-US', { maximumFractionDigits: 3 })).toBe('20.549%');
    expect(formatPercentage(0.2, 'en-US', { minimumFractionDigits: 2 })).toBe('20.00%');
  });

  it('renders a non-finite value as zero rather than NaN%', () => {
    expect(formatPercentage(Number.NaN, 'en-US')).toBe('0%');
  });

  it('does not throw on a malformed locale tag', () => {
    expect(() => formatPercentage(0.2, 'not a locale')).not.toThrow();
  });
});
