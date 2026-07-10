import { OfferingType } from '@homiio/shared-types';
import {
  buildSearchPlan,
  buildSort,
  FIELD_HAS_IMAGES,
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
    // `hasImages: -1` is always the primary key so image-bearing listings rank
    // first, with the requested ordering applied within each group.
    expect(buildSort(params, false)).toEqual({
      [FIELD_HAS_IMAGES]: -1,
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
      [FIELD_HAS_IMAGES]: -1,
      [FIELD_PRICE_ETHICS_FAIRNESS_SCORE]: 1,
      createdAt: -1,
    });
  });
});

describe('buildSort image-first priority', () => {
  it('ranks image-bearing listings first for the default recency sort', () => {
    const { params } = buildSearchPlan({});
    const sort = buildSort(params, false);

    expect(sort[FIELD_HAS_IMAGES]).toBe(-1);
    // hasImages must be the FIRST key so it dominates the requested ordering.
    expect(Object.keys(sort)[0]).toBe(FIELD_HAS_IMAGES);
    expect(sort.createdAt).toBe(-1);
  });

  it('ranks image-bearing listings first when sorting by price', () => {
    const { params } = buildSearchPlan({
      sortBy: 'price',
      sortOrder: 'asc',
      offering: OfferingType.LONG_TERM_RENT,
    });
    const sort = buildSort(params, false);

    expect(Object.keys(sort)[0]).toBe(FIELD_HAS_IMAGES);
    expect(sort[FIELD_HAS_IMAGES]).toBe(-1);
    expect(sort['longTermRent.monthlyAmount']).toBe(1);
  });

  it('ranks image-bearing listings first even ahead of text relevance', () => {
    const { params } = buildSearchPlan({ sortBy: 'relevance', q: 'barcelona' });
    const sort = buildSort(params, true);

    expect(Object.keys(sort)[0]).toBe(FIELD_HAS_IMAGES);
    expect(sort[FIELD_HAS_IMAGES]).toBe(-1);
    expect(sort.score).toEqual({ $meta: 'textScore' });
  });
});
