/**
 * A single discover scope may not enqueue the whole portal.
 *
 * `DiscoverJob.limit` is optional and providers read an absent one as
 * `Infinity`, and the worker's boot scopes set none — so a scope enumerated its
 * portal to the end. On 2026-09-21, hours after the fleet went from 13
 * providers to 55, one newly-enabled provider enqueued **20,519 fetch jobs in a
 * single pass**. Redis went 79% -> 100%, began refusing writes, and logged
 * **1.6 million** `OOM command not allowed` errors across allo, clarity, moovo,
 * noted, syra, oxy-api and alia. A listing queue took down six unrelated
 * services.
 *
 * Moving the queues to the dedicated node was the first fix and does not
 * address this: that node is the same instance class and sat at 82.8% the next
 * day. **The size of the burst is the defect, not its address** — pinned here
 * because the obvious reading of that incident is "wrong node", and the obvious
 * reading is incomplete.
 *
 * The cap lives in `services/ingestion/discoverScope.ts` rather than in
 * `worker.ts` so this file can IMPORT it. Importing `worker.ts` starts a worker
 * process, and the only way to "test" something defined there is to re-type it
 * below — a test that passes no matter what the shipped code does.
 */

import {
  DEFAULT_DISCOVER_SCOPE_LIMIT,
  discoverScopeLimit,
} from '../../services/ingestion/discoverScope';

describe('discoverScopeLimit', () => {
  it('caps a scope by default, rather than trusting providers to be modest', () => {
    expect(discoverScopeLimit({})).toBe(250);
    expect(DEFAULT_DISCOVER_SCOPE_LIMIT).toBe(250);
  });

  it('is far below the burst that caused the outage', () => {
    // Not an arbitrary number. 55 providers each taking one scope per round at
    // this cap is ~13,750 refs in the worst round, against a single provider's
    // 20,519 in one pass — and the round-robin interleave means providers do
    // not all peak together.
    expect(discoverScopeLimit({})! * 55).toBeLessThan(20_519 * 2);
    expect(discoverScopeLimit({})).toBeLessThan(20_519 / 50);
  });

  it('treats 0 as an explicit opt-out, not as "enqueue nothing"', () => {
    // A variable set to zero to REMOVE a limit must not silently stop the
    // pipeline. `undefined` is the pre-incident behaviour: no cap.
    expect(discoverScopeLimit({ LISTING_DISCOVER_SCOPE_LIMIT: '0' })).toBeUndefined();
  });

  it('falls back on anything that is not a whole non-negative number', () => {
    // Edited by hand in a task definition. A typo must not stop the worker
    // booting, and must not be read as a cap of NaN — which compares false
    // against everything and would behave as no cap at all.
    for (const raw of ['', '   ', 'abc', '-1', '2.5', 'Infinity', 'NaN', '1e999']) {
      expect(discoverScopeLimit({ LISTING_DISCOVER_SCOPE_LIMIT: raw })).toBe(250);
    }
  });

  it('honours a deliberate override, with the spacing a console leaves behind', () => {
    expect(discoverScopeLimit({ LISTING_DISCOVER_SCOPE_LIMIT: '1000' })).toBe(1000);
    expect(discoverScopeLimit({ LISTING_DISCOVER_SCOPE_LIMIT: '  40  ' })).toBe(40);
  });

  it('reads the real environment when none is passed', () => {
    // The worker calls it with no argument. A default parameter that pointed at
    // a snapshot would make every override above untestable in production.
    const original = process.env.LISTING_DISCOVER_SCOPE_LIMIT;
    try {
      process.env.LISTING_DISCOVER_SCOPE_LIMIT = '77';
      expect(discoverScopeLimit()).toBe(77);
    } finally {
      if (original === undefined) delete process.env.LISTING_DISCOVER_SCOPE_LIMIT;
      else process.env.LISTING_DISCOVER_SCOPE_LIMIT = original;
    }
  });
});
