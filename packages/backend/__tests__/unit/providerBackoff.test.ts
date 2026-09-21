/**
 * The thing that makes "every provider on" affordable.
 *
 * Turning the registry on by default is right — 44 implemented, 13 running was
 * a fleet quietly deciding its own size. But several portals are hard-blocked
 * today (Akamai, PerimeterX, Cloudflare) and will fail every time they are
 * asked, and every attempt spends metered residential bandwidth. An exhausted
 * balance is exactly what took the pipeline down on 2026-09-20.
 *
 * So the fleet rests what cannot work instead of a human maintaining a list.
 * The tests below are about the two ways that idea goes wrong: resting a
 * provider that was merely having a bad minute, and never waking one whose
 * block has lifted.
 */

import { ProviderBackoff } from '../../services/ingestion/providerBackoff';

function backoffAt(clock: { now: number }) {
  return new ProviderBackoff({
    failuresBeforeRest: 3,
    restMs: 60_000,
    now: () => clock.now,
  });
}

describe('ProviderBackoff', () => {
  it('asks a provider it knows nothing about', () => {
    const backoff = backoffAt({ now: 0 });
    expect(backoff.restingUntil('zillow')).toBeUndefined();
  });

  it('tolerates a bad pass without resting the provider', () => {
    // One empty discovery is ordinary: a small city can genuinely be exhausted,
    // a request can time out. Resting on the first miss would take working
    // portals offline for an hour at a time.
    const clock = { now: 0 };
    const backoff = backoffAt(clock);

    backoff.recordFailure('fotocasa');
    backoff.recordFailure('fotocasa');

    expect(backoff.restingUntil('fotocasa')).toBeUndefined();
  });

  it('rests a provider once it has failed the threshold in a row', () => {
    const clock = { now: 0 };
    const backoff = backoffAt(clock);

    expect(backoff.recordFailure('zillow')).toBeUndefined();
    expect(backoff.recordFailure('zillow')).toBeUndefined();
    const restsUntil = backoff.recordFailure('zillow');

    expect(restsUntil).toBe(60_000);
    expect(backoff.restingUntil('zillow')).toBe(60_000);
  });

  it('wakes the provider when the rest is over', () => {
    // The half that is easy to forget. A portal whose block lifts, or whose
    // parser gets fixed, must come back WITHOUT anyone editing anything —
    // otherwise this is just the old flag list with extra steps.
    const clock = { now: 0 };
    const backoff = backoffAt(clock);

    backoff.recordFailure('zillow');
    backoff.recordFailure('zillow');
    backoff.recordFailure('zillow');
    expect(backoff.restingUntil('zillow')).toBe(60_000);

    clock.now = 60_001;
    expect(backoff.restingUntil('zillow')).toBeUndefined();
  });

  it('clears the streak outright on one good pass', () => {
    // Not decremented. A provider recovering from a lifted block should not
    // have to earn back three turns before a single success counts.
    const clock = { now: 0 };
    const backoff = backoffAt(clock);

    backoff.recordFailure('otodom');
    backoff.recordFailure('otodom');
    backoff.recordSuccess('otodom');
    backoff.recordFailure('otodom');
    backoff.recordFailure('otodom');

    expect(backoff.restingUntil('otodom')).toBeUndefined();
  });

  it('reports the rest deadline only once, not on every later failure', () => {
    // The caller logs on this return value. Returning it repeatedly would
    // produce an hourly wall of identical warnings for every dead portal, which
    // is how a real signal gets tuned out.
    const clock = { now: 0 };
    const backoff = backoffAt(clock);

    backoff.recordFailure('daft');
    backoff.recordFailure('daft');
    expect(backoff.recordFailure('daft')).toBe(60_000);

    clock.now = 1_000;
    expect(backoff.recordFailure('daft')).toBeUndefined();
    expect(backoff.recordFailure('daft')).toBeUndefined();
  });

  it('keeps providers independent', () => {
    const clock = { now: 0 };
    const backoff = backoffAt(clock);

    for (let i = 0; i < 3; i += 1) backoff.recordFailure('zillow');

    expect(backoff.restingUntil('zillow')).toBe(60_000);
    expect(backoff.restingUntil('habitaclia')).toBeUndefined();
  });

  it('rests again if the provider is still broken after waking', () => {
    const clock = { now: 0 };
    const backoff = backoffAt(clock);

    for (let i = 0; i < 3; i += 1) backoff.recordFailure('funda');
    clock.now = 60_001;
    expect(backoff.restingUntil('funda')).toBeUndefined();

    for (let i = 0; i < 3; i += 1) backoff.recordFailure('funda');
    expect(backoff.restingUntil('funda')).toBe(120_001);
  });
});
