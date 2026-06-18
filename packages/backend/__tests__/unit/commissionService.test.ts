import { COMMISSION_CONFIG } from '@homiio/shared-types';
import { computeCommission } from '../../services/commissionService';

describe('computeCommission', () => {
  it('computes a rent payout as 3% of the monthly rent', () => {
    const result = computeCommission('rent', 1200);
    expect(result.currency).toBe(COMMISSION_CONFIG.currency);
    expect(result.amount).toBe(36);
    expect(result.basis).toEqual({
      offering: 'rent',
      dealValue: 1200,
      kind: 'percentOfMonthlyRent',
      rate: 0.03,
    });
  });

  it('rounds the rent payout to two decimal places', () => {
    const result = computeCommission('rent', 999.99);
    expect(result.amount).toBe(30);
  });

  it('returns the flat sale reward independent of the deal value', () => {
    const result = computeCommission('sale', 500000);
    expect(result.amount).toBe(150);
    expect(result.basis).toEqual({
      offering: 'sale',
      dealValue: 500000,
      kind: 'flat',
      flat: 150,
    });
  });

  it('returns the flat exchange reward with a zero deal value', () => {
    const result = computeCommission('exchange', 0);
    expect(result.amount).toBe(15);
    expect(result.basis).toEqual({
      offering: 'exchange',
      dealValue: 0,
      kind: 'flat',
      flat: 15,
    });
  });

  it('sanitises a negative or non-finite deal value to zero', () => {
    expect(computeCommission('rent', -100).amount).toBe(0);
    expect(computeCommission('rent', Number.NaN).basis.dealValue).toBe(0);
  });
});
