import { OfferingType } from '@homiio/shared-types';
import {
  buildSearchPlan,
  buildSort,
  FIELD_PRICE_ETHICS_FAIRNESS_SCORE,
  FIELD_PRICE_ETHICS_IS_FAIR_PRICE,
  SORT_FAIRNESS,
} from '../../controllers/property/searchQueryBuilder';

describe('buildSearchPlan fairPrice filter', () => {
  it('adds priceEthics.isFairPrice when fairPrice=true', () => {
    const { filter, params } = buildSearchPlan({ fairPrice: 'true' });

    expect(filter[FIELD_PRICE_ETHICS_IS_FAIR_PRICE]).toBe(true);
    expect(params.fairPrice).toBe(true);
  });

  it('ignores fairPrice when not explicitly true', () => {
    const { filter, params } = buildSearchPlan({ fairPrice: 'false' });

    expect(filter[FIELD_PRICE_ETHICS_IS_FAIR_PRICE]).toBeUndefined();
    expect(params.fairPrice).toBeUndefined();
  });
});

describe('buildSort fairness', () => {
  it('sorts by priceEthics.fairnessScore with createdAt tie-breaker', () => {
    const { params } = buildSearchPlan({ sortBy: 'fairness', sortOrder: 'desc' });

    expect(params.sortField).toBe(SORT_FAIRNESS);
    expect(buildSort(params, false)).toEqual({
      [FIELD_PRICE_ETHICS_FAIRNESS_SCORE]: -1,
      createdAt: -1,
    });
  });

  it('honours ascending fairness sort', () => {
    const { params } = buildSearchPlan({
      sortBy: 'fairness',
      sortOrder: 'asc',
      offering: OfferingType.LONG_TERM_RENT,
    });

    expect(buildSort(params, false)).toEqual({
      [FIELD_PRICE_ETHICS_FAIRNESS_SCORE]: 1,
      createdAt: -1,
    });
  });
});
