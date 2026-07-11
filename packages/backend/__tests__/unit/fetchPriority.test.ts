/**
 * Round-robin fetch-priority policy (services/ingestion/queues.ts).
 *
 * These are the fairness guarantees the worker relies on so every registered
 * provider makes progress instead of the highest-volume one starving the rest.
 * Pure function — no Redis, no BullMQ runtime.
 */

import {
  fetchPriorityFor,
  FETCH_RANK_CAP,
  HIGH_VOLUME_PROVIDERS,
} from '../../services/ingestion/queues';

// BullMQ rejects any priority above 2^21 (Job.PRIORITY_LIMIT); every value we
// emit must stay comfortably under it.
const BULLMQ_PRIORITY_LIMIT = 2 ** 21;

describe('fetchPriorityFor', () => {
  it('maps a normal provider rank to tier-base + rank + 1', () => {
    expect(fetchPriorityFor('immobilienscout24', 0)).toBe(1);
    expect(fetchPriorityFor('immobilienscout24', 1)).toBe(2);
    expect(fetchPriorityFor('immoweb', 5)).toBe(6);
  });

  it('never returns 0, so jobs stay out of BullMQ’s unprioritised wait lane', () => {
    for (const rank of [0, 1, 42, FETCH_RANK_CAP, FETCH_RANK_CAP * 10]) {
      expect(fetchPriorityFor('otodom', rank)).toBeGreaterThanOrEqual(1);
      expect(fetchPriorityFor('habitaclia', rank)).toBeGreaterThanOrEqual(1);
    }
  });

  it('aligns every provider at the same rank (round-robin interleave)', () => {
    // The core fairness property: provider A's Nth job and provider B's Nth job
    // share a priority, so BullMQ processes A0,B0,C0,A1,B1,C1,… not A0..An,B0…
    const smalls = ['immobilienscout24', 'immoweb', 'blueground', 'mercadolibre_ar', 'otodom'];
    for (const rank of [0, 1, 7, 500]) {
      const priorities = smalls.map((provider) => fetchPriorityFor(provider, rank));
      expect(new Set(priorities).size).toBe(1);
    }
  });

  it('increases strictly with rank within a provider', () => {
    let previous = -Infinity;
    for (let rank = 0; rank < 50; rank += 1) {
      const priority = fetchPriorityFor('immoweb', rank);
      expect(priority).toBeGreaterThan(previous);
      previous = priority;
    }
  });

  it('places high-volume ES portals in a strictly later tier than normal providers', () => {
    // Even the FIRST high-volume job must sort after the LAST normal-tier job so
    // the small providers drain before the big ES portals begin.
    const worstNormal = fetchPriorityFor('immobilienscout24', FETCH_RANK_CAP);
    const bestHighVolume = fetchPriorityFor('habitaclia', 0);
    expect(bestHighVolume).toBeGreaterThan(worstNormal);
  });

  it('round-robins within the high-volume tier too', () => {
    const highVolume = [...HIGH_VOLUME_PROVIDERS];
    for (const rank of [0, 3, 200]) {
      const priorities = highVolume.map((provider) => fetchPriorityFor(provider, rank));
      expect(new Set(priorities).size).toBe(1);
    }
    // Each of fotocasa/habitaclia/pisos/idealista rides the high-volume tier.
    expect(highVolume).toEqual(expect.arrayContaining(['fotocasa', 'habitaclia', 'pisos', 'idealista']));
  });

  it('clamps pathological ranks so priority never approaches PRIORITY_LIMIT', () => {
    const capped = fetchPriorityFor('immobilienscout24', FETCH_RANK_CAP);
    expect(fetchPriorityFor('immobilienscout24', FETCH_RANK_CAP + 1)).toBe(capped);
    expect(fetchPriorityFor('immobilienscout24', 5_000_000)).toBe(capped);
    expect(fetchPriorityFor('habitaclia', Number.MAX_SAFE_INTEGER)).toBeLessThan(BULLMQ_PRIORITY_LIMIT);
  });

  it('defends against negative and fractional ranks', () => {
    expect(fetchPriorityFor('otodom', -5)).toBe(fetchPriorityFor('otodom', 0));
    expect(fetchPriorityFor('otodom', 3.9)).toBe(fetchPriorityFor('otodom', 3));
  });
});
