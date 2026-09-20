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

  it('NO LONGER sinks the ES portals behind every other provider', () => {
    // This assertion is inverted from what it used to be, deliberately.
    //
    // The old policy gave the ES portals a tier base of 1,000,000, so the FIRST
    // fotocasa fetch sorted after the LAST job of every other provider — not
    // "later" but "not until the others are empty". Measured consequence on
    // 2026-09-20: one discover pass enqueued 2,521 refs from two German
    // providers, and the database ended up holding 481 German listings against
    // 31 Spanish ones (Barcelona: 3). Spain was still being DISCOVERED the
    // whole time; its fetches never reached the head of the queue.
    //
    // A rank-0 ES job must now sort no later than a rank-0 job anywhere else.
    for (const portal of HIGH_VOLUME_PROVIDERS) {
      expect(fetchPriorityFor(portal, 0)).toBe(fetchPriorityFor('immobilienscout24', 0));
    }

    // And the specific shape of the old bug is gone: a deep normal-tier backlog
    // no longer outranks a fresh ES job.
    const deepBacklog = fetchPriorityFor('immobilienscout24', FETCH_RANK_CAP);
    expect(fetchPriorityFor('fotocasa', 0)).toBeLessThan(deepBacklog);
  });

  it('round-robins the ES portals with everyone else, in one band', () => {
    const everyone = [...HIGH_VOLUME_PROVIDERS, 'immobilienscout24', 'immoweb', 'otodom'];
    for (const rank of [0, 3, 200]) {
      const priorities = everyone.map((provider) => fetchPriorityFor(provider, rank));
      expect(new Set(priorities).size).toBe(1);
    }
    expect([...HIGH_VOLUME_PROVIDERS]).toEqual(
      expect.arrayContaining(['fotocasa', 'habitaclia', 'pisos', 'idealista']),
    );
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
