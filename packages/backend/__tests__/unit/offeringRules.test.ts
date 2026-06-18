import { OfferingType, ExchangeMode } from '@homiio/shared-types';
import {
  applyOfferingRulesForCreate,
  applyOfferingRulesForUpdate,
  OfferingValidationError,
  type OfferingBearingPayload,
} from '../../controllers/property/offeringRules';

describe('applyOfferingRulesForCreate', () => {
  it('accepts a coherent long-term-rent listing', () => {
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 1200 },
    };
    expect(() => applyOfferingRulesForCreate(data)).not.toThrow();
  });

  it('accepts a coherent multi-offering listing and de-duplicates offerings', () => {
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.SALE, OfferingType.SALE, OfferingType.EXCHANGE],
      sale: { price: 250000 },
      exchange: { mode: ExchangeMode.SWAP },
    };
    applyOfferingRulesForCreate(data);
    expect(data.offerings).toEqual([OfferingType.SALE, OfferingType.EXCHANGE]);
  });

  it('rejects a declared offering whose pricing block is missing', () => {
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.LONG_TERM_RENT],
    };
    expect(() => applyOfferingRulesForCreate(data)).toThrow(OfferingValidationError);
  });

  it('rejects a present pricing block whose offering is not declared', () => {
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.SALE],
      sale: { price: 100000 },
      longTermRent: { monthlyAmount: 800 },
    };
    expect(() => applyOfferingRulesForCreate(data)).toThrow(/not declared/);
  });

  it('rejects a non-positive price on a declared block', () => {
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 0 },
    };
    expect(() => applyOfferingRulesForCreate(data)).toThrow(/positive number/);
  });

  it('rejects an empty offerings list', () => {
    const data: OfferingBearingPayload = { offerings: [] };
    expect(() => applyOfferingRulesForCreate(data)).toThrow(/at least one offering/);
  });

  it('rejects a malformed offerings field', () => {
    const data: OfferingBearingPayload = {
      offerings: ['not_a_real_offering'] as unknown as OfferingType[],
    };
    expect(() => applyOfferingRulesForCreate(data)).toThrow(/valid offering types/);
  });

  it('rejects an exchange offering without a valid mode', () => {
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.EXCHANGE],
      exchange: { mode: 'teleport' as unknown as ExchangeMode },
    };
    expect(() => applyOfferingRulesForCreate(data)).toThrow(/valid exchange.mode/);
  });

  it('derives sale.pricePerSqm from price and squareFootage', () => {
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.SALE],
      sale: { price: 200000 },
      squareFootage: 80,
    };
    applyOfferingRulesForCreate(data);
    expect(data.sale?.pricePerSqm).toBe(2500);
  });

  it('does not derive pricePerSqm when squareFootage is absent', () => {
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.SALE],
      sale: { price: 200000 },
    };
    applyOfferingRulesForCreate(data);
    expect(data.sale?.pricePerSqm).toBeUndefined();
  });
});

describe('applyOfferingRulesForUpdate', () => {
  it('accepts a partial update that adds an offering plus its block', () => {
    const current = {
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 1000 },
      shortTermRent: null,
      sale: null,
      exchange: null,
    };
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.LONG_TERM_RENT, OfferingType.SHORT_TERM_RENT],
      shortTermRent: { nightlyRate: 90 },
    };
    expect(() => applyOfferingRulesForUpdate(data, current)).not.toThrow();
  });

  it('checks coherence on the effective (stored merged with body) document', () => {
    const current = {
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 1000 },
      shortTermRent: null,
      sale: null,
      exchange: null,
    };
    // Declares short-term but never supplies the block → effective doc is incoherent.
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.LONG_TERM_RENT, OfferingType.SHORT_TERM_RENT],
    };
    expect(() => applyOfferingRulesForUpdate(data, current)).toThrow(/pricing block is missing/);
  });

  it('allows dropping an offering by clearing both offering and block', () => {
    const current = {
      offerings: [OfferingType.LONG_TERM_RENT, OfferingType.SALE],
      longTermRent: { monthlyAmount: 1000 },
      shortTermRent: null,
      sale: { price: 300000 },
      exchange: null,
    };
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.LONG_TERM_RENT],
      sale: null,
    };
    expect(() => applyOfferingRulesForUpdate(data, current)).not.toThrow();
  });

  it('derives sale.pricePerSqm on update when price and area are supplied', () => {
    const current = {
      offerings: [OfferingType.SALE],
      longTermRent: null,
      shortTermRent: null,
      sale: { price: 100000 },
      exchange: null,
    };
    const data: OfferingBearingPayload = {
      offerings: [OfferingType.SALE],
      sale: { price: 360000 },
      squareFootage: 90,
    };
    applyOfferingRulesForUpdate(data, current);
    expect(data.sale?.pricePerSqm).toBe(4000);
  });
});
