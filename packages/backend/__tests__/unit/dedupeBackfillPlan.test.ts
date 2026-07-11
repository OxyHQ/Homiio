/**
 * Backfill grouping (`planDeduplication`): the pure core of the one-off script.
 * Verifies grouping, deterministic keeper selection, transitive components,
 * and idempotency — with no DB.
 */

import { PropertyType } from '@homiio/shared-types';
import { toDedupComparable, type DedupListingInput } from '../../services/ingestion/dedupeFingerprint';
import { planDeduplication, type Row } from '../../scripts/dedupeExternalListings';

let seq = 0;
function words(n: number, extra: string[] = []): string {
  const base = Array.from({ length: n }, (_, i) => `comun${String(i).padStart(3, '0')}`);
  return [...base, ...extra].join(' ');
}

const LISTING: DedupListingInput = {
  type: PropertyType.APARTMENT,
  cityId: 'city-a',
  bedrooms: 2,
  squareFootage: 63,
  longTermRent: { monthlyAmount: 1750, currency: 'EUR' },
  description: words(60),
};

function row(overrides: Partial<Row> & { listing?: Partial<DedupListingInput> } = {}): Row {
  const comparable = toDedupComparable({ ...LISTING, ...overrides.listing });
  if (!comparable) throw new Error('test row must be an eligible comparable');
  seq += 1;
  return {
    id: overrides.id ?? `id-${seq}`,
    source: overrides.source ?? 'pisos',
    sourceId: overrides.sourceId ?? `s-${seq}`,
    sourceUrl: overrides.sourceUrl ?? 'https://www.pisos.com/x',
    imageCount: overrides.imageCount ?? 1,
    createdAt: overrides.createdAt ?? 1_000,
    comparable,
  };
}

describe('planDeduplication', () => {
  it('groups two near-identical re-lists and keeps the one with more images', () => {
    const rich = row({ id: 'rich', imageCount: 20, listing: { description: words(60, ['a']) } });
    const poor = row({ id: 'poor', imageCount: 3, listing: { description: words(60, ['b']) } });
    const groups = planDeduplication([poor, rich]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.id).toBe('rich');
    expect(groups[0].archive.map((r) => r.id)).toEqual(['poor']);
  });

  it('breaks image ties by longer description, then older createdAt', () => {
    const older = row({ id: 'older', imageCount: 5, createdAt: 1, listing: { description: words(60, ['x']) } });
    const newer = row({ id: 'newer', imageCount: 5, createdAt: 9, listing: { description: words(60, ['y']) } });
    const [group] = planDeduplication([newer, older]);
    expect(group.keep.id).toBe('older');
  });

  it('collapses a transitive 3-way component into one keeper + two archived', () => {
    const a = row({ id: 'a', imageCount: 9, listing: { description: words(60, ['one']) } });
    const b = row({ id: 'b', imageCount: 4, listing: { description: words(60, ['two']) } });
    const c = row({ id: 'c', imageCount: 2, listing: { description: words(60, ['three']) } });
    const [group] = planDeduplication([a, b, c]);
    expect(group.keep.id).toBe('a');
    expect(group.archive.map((r) => r.id).sort()).toEqual(['b', 'c']);
  });

  it('does not group templated different units below the Jaccard floor', () => {
    const a = row({ listing: { description: words(60, ['unoaa', 'dosaa', 'tresaa', 'cuatroaa', 'cincoaa']) } });
    const b = row({ listing: { description: words(60, ['unobb', 'dosbb', 'tresbb', 'cuatrobb', 'cincobb']) } });
    expect(planDeduplication([a, b])).toHaveLength(0);
  });

  it('does not group listings in different cities', () => {
    const a = row({ listing: { description: words(60, ['a']) } });
    const b = row({ listing: { cityId: 'city-b', description: words(60, ['a']) } });
    expect(planDeduplication([a, b])).toHaveLength(0);
  });

  it('does not group listings with different prices', () => {
    const a = row();
    const b = row({ listing: { longTermRent: { monthlyAmount: 1800, currency: 'EUR' } } });
    expect(planDeduplication([a, b])).toHaveLength(0);
  });

  it('is idempotent: re-running on the surviving keepers finds nothing', () => {
    const a = row({ id: 'a', imageCount: 9, listing: { description: words(60, ['one']) } });
    const b = row({ id: 'b', imageCount: 4, listing: { description: words(60, ['two']) } });
    const first = planDeduplication([a, b]);
    const archivedIds = new Set(first.flatMap((g) => g.archive.map((r) => r.id)));
    const survivors = [a, b].filter((r) => !archivedIds.has(r.id));
    expect(planDeduplication(survivors)).toHaveLength(0);
  });
});
