/**
 * Round-robin discover-priority policy (services/ingestion/queues.ts).
 *
 * The discover queue must give every provider's city-0 a higher priority than
 * any provider's city-1, so the browser-heavy ES portals (~180 city scopes each)
 * can't starve the market-wide providers' 2-3 scopes. Pure function — no Redis,
 * no BullMQ runtime.
 */

import {
  discoverPriorityFor,
  fetchPriorityFor,
  FETCH_RANK_CAP,
  HIGH_VOLUME_PROVIDERS,
} from '../../services/ingestion/queues';

// BullMQ rejects any priority above 2^21 (Job.PRIORITY_LIMIT).
const BULLMQ_PRIORITY_LIMIT = 2 ** 21;

describe('discoverPriorityFor', () => {
  it('maps a scope rank to rank + 1', () => {
    expect(discoverPriorityFor('immobilienscout24', 0)).toBe(1);
    expect(discoverPriorityFor('fotocasa', 1)).toBe(2);
    expect(discoverPriorityFor('immoweb', 5)).toBe(6);
  });

  it('never returns 0, so discover jobs stay out of BullMQ’s unprioritised wait lane', () => {
    for (const rank of [0, 1, 42, FETCH_RANK_CAP, FETCH_RANK_CAP * 10]) {
      expect(discoverPriorityFor('otodom', rank)).toBeGreaterThanOrEqual(1);
      expect(discoverPriorityFor('habitaclia', rank)).toBeGreaterThanOrEqual(1);
    }
  });

  it('aligns every provider at the same rank (round-robin: city-0 before any city-1)', () => {
    const providers = ['immobilienscout24', 'immoweb', 'blueground', 'fotocasa', 'habitaclia', 'pisos'];
    for (const rank of [0, 1, 7, 137]) {
      const priorities = providers.map((provider) => discoverPriorityFor(provider, rank));
      expect(new Set(priorities).size).toBe(1);
    }
    // The core guarantee: every provider's city-0 outranks every provider's city-1.
    const anyCity0 = discoverPriorityFor('habitaclia', 0);
    const anyCity1 = discoverPriorityFor('immobilienscout24', 1);
    expect(anyCity0).toBeLessThan(anyCity1);
  });

  it('is SINGLE-tier — unlike fetch it does not sink ES portals into a later tier', () => {
    // fetch deprioritises the high-volume ES portals; discover intentionally does
    // not, so an ES portal and a market-wide provider share a rank's priority.
    for (const provider of HIGH_VOLUME_PROVIDERS) {
      expect(discoverPriorityFor(provider, 0)).toBe(discoverPriorityFor('immobilienscout24', 0));
      expect(fetchPriorityFor(provider, 0)).toBeGreaterThan(fetchPriorityFor('immobilienscout24', 0));
    }
  });

  it('increases strictly with rank', () => {
    let previous = -Infinity;
    for (let rank = 0; rank < 200; rank += 1) {
      const priority = discoverPriorityFor('fotocasa', rank);
      expect(priority).toBeGreaterThan(previous);
      previous = priority;
    }
  });

  it('clamps pathological ranks so priority never approaches PRIORITY_LIMIT', () => {
    const capped = discoverPriorityFor('fotocasa', FETCH_RANK_CAP);
    expect(discoverPriorityFor('fotocasa', FETCH_RANK_CAP + 1)).toBe(capped);
    expect(discoverPriorityFor('fotocasa', Number.MAX_SAFE_INTEGER)).toBeLessThan(BULLMQ_PRIORITY_LIMIT);
  });

  it('defends against negative and fractional ranks', () => {
    expect(discoverPriorityFor('otodom', -5)).toBe(discoverPriorityFor('otodom', 0));
    expect(discoverPriorityFor('otodom', 3.9)).toBe(discoverPriorityFor('otodom', 3));
  });
});
