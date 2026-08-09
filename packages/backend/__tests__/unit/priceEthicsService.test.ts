import { OfferingType, PropertyType } from '@homiio/shared-types';
import type { IProperty } from '../../models/documentTypes';
import { computePriceEthics } from '../../services/priceEthicsService';
import {
  computeMarketVerdictForProperty,
  type MarketVerdictResult,
} from '../../services/areaPriceComparison';

jest.mock('../../services/areaPriceComparison', () => {
  const actual = jest.requireActual('../../services/areaPriceComparison');
  return {
    ...actual,
    computeMarketVerdictForProperty: jest.fn(),
  };
});

const mockMarketVerdict = computeMarketVerdictForProperty as jest.MockedFunction<
  typeof computeMarketVerdictForProperty
>;

function baseProperty(overrides: Partial<IProperty> = {}): IProperty {
  return {
    offerings: [OfferingType.LONG_TERM_RENT],
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 130, currency: 'EUR' },
    bedrooms: 2,
    bathrooms: 1,
    squareFootage: 70,
    amenities: [],
    isExternal: false,
    ...overrides,
  } as IProperty;
}

function marketResult(
  verdict: 'good_deal' | 'below_average' | 'average' | 'above_average',
  percentDiff = 0,
): MarketVerdictResult {
  return {
    hasMarketData: true,
    marketVerdict: verdict,
    percentDiffFromAvg: percentDiff,
    sampleSize: 12,
  };
}

/** What the real comparison returns when it finds no comparables to average. */
const noMarketData: MarketVerdictResult = { hasMarketData: false, sampleSize: 0 };

describe('computePriceEthics fairnessScore', () => {
  beforeEach(() => {
    mockMarketVerdict.mockReset();
  });

  it('adds within-ethical bonus when rent is within the ethical max', async () => {
    mockMarketVerdict.mockResolvedValue(null);

    const result = await computePriceEthics(baseProperty({ longTermRent: { monthlyAmount: 130, currency: 'EUR' } }));

    expect(result?.withinEthical).toBe(true);
    expect(result?.fairnessScore).toBe(70);
  });

  it('applies the above-ethical penalty when rent exceeds the ethical max', async () => {
    mockMarketVerdict.mockResolvedValue(null);

    const result = await computePriceEthics(baseProperty({ longTermRent: { monthlyAmount: 5000, currency: 'EUR' } }));

    expect(result?.withinEthical).toBe(false);
    expect(result?.fairnessScore).toBe(25);
  });

  it('combines market verdict bonuses with ethical adjustments', async () => {
    mockMarketVerdict.mockResolvedValue(marketResult('good_deal', -12));

    const result = await computePriceEthics(baseProperty({ longTermRent: { monthlyAmount: 130, currency: 'EUR' } }));

    expect(result?.marketVerdict).toBe('good_deal');
    expect(result?.fairnessScore).toBe(100);
  });

  it('uses base score when market data is absent', async () => {
    mockMarketVerdict.mockResolvedValue(noMarketData);

    const result = await computePriceEthics(baseProperty());

    expect(result?.marketVerdict).toBeUndefined();
    expect(result?.fairnessScore).toBe(70);
  });

  it('maps above_average market verdict without an ethical bonus beyond base', async () => {
    mockMarketVerdict.mockResolvedValue(marketResult('above_average', 8));

    const result = await computePriceEthics(baseProperty({ longTermRent: { monthlyAmount: 130, currency: 'EUR' } }));

    expect(result?.fairnessScore).toBe(70);
  });

  it('returns null when the listing has no scorable price', async () => {
    const result = await computePriceEthics(baseProperty({ longTermRent: undefined, sale: undefined }));

    expect(result).toBeNull();
    expect(mockMarketVerdict).not.toHaveBeenCalled();
  });
});

describe('computePriceEthics isFairPrice', () => {
  beforeEach(() => {
    mockMarketVerdict.mockReset();
  });

  it('marks Homiio listings fair when within ethical bounds and market is not above average', async () => {
    mockMarketVerdict.mockResolvedValue(marketResult('average', 1));

    const result = await computePriceEthics(baseProperty({ longTermRent: { monthlyAmount: 130, currency: 'EUR' } }));

    expect(result?.isFairPrice).toBe(true);
  });

  it('rejects Homiio listings above the ethical max even with a good market verdict', async () => {
    mockMarketVerdict.mockResolvedValue(marketResult('good_deal', -10));

    const result = await computePriceEthics(baseProperty({ longTermRent: { monthlyAmount: 5000, currency: 'EUR' } }));

    expect(result?.isFairPrice).toBe(false);
  });

  it('rejects Homiio listings within ethical bounds but above market average', async () => {
    mockMarketVerdict.mockResolvedValue(marketResult('above_average', 10));

    const result = await computePriceEthics(baseProperty({ longTermRent: { monthlyAmount: 130, currency: 'EUR' } }));

    expect(result?.isFairPrice).toBe(false);
  });

  it('allows Homiio listings within ethical bounds when market data is unavailable', async () => {
    mockMarketVerdict.mockResolvedValue(noMarketData);

    const result = await computePriceEthics(baseProperty({ longTermRent: { monthlyAmount: 130, currency: 'EUR' } }));

    expect(result?.isFairPrice).toBe(true);
  });

  it('marks external listings fair from market verdict alone', async () => {
    mockMarketVerdict.mockResolvedValue(marketResult('below_average', -4));

    const result = await computePriceEthics(
      baseProperty({ isExternal: true, longTermRent: { monthlyAmount: 1200, currency: 'EUR' } }),
    );

    expect(result?.withinEthical).toBeUndefined();
    expect(result?.isFairPrice).toBe(true);
  });

  it('rejects external listings above market average', async () => {
    mockMarketVerdict.mockResolvedValue(marketResult('above_average', 12));

    const result = await computePriceEthics(
      baseProperty({ isExternal: true, longTermRent: { monthlyAmount: 1200, currency: 'EUR' } }),
    );

    expect(result?.isFairPrice).toBe(false);
  });

  it('rejects external listings without market comparables', async () => {
    mockMarketVerdict.mockResolvedValue(noMarketData);

    const result = await computePriceEthics(
      baseProperty({ isExternal: true, longTermRent: { monthlyAmount: 1200, currency: 'EUR' } }),
    );

    expect(result?.isFairPrice).toBe(false);
  });
});
