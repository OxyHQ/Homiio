/**
 * The pacing every bulk move into Oxy Files goes through: evenly spaced calls,
 * a 429 waited out and the SAME call sent again (never a row's outcome), and a
 * transport failure retried a few times before it is the caller's.
 */

import { OxyCallPacer, retryAfterMs } from '../../services/files/oxyCallPacer';

function oxyError(status: number, details?: Record<string, unknown>) {
  return Object.assign(new Error(`${status}`), { status, ...(details ? { details } : {}) });
}

/** A clock that only moves when the pacer sleeps. */
function virtualClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
    elapsed: () => now,
  };
}

describe('OxyCallPacer', () => {
  it('starts at most perMinute calls a minute, evenly spaced', async () => {
    const clock = virtualClock();
    const pacer = new OxyCallPacer({ perMinute: 20, now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      await pacer.run(async () => {
        starts.push(clock.now());
      });
    }
    expect(starts).toEqual([0, 3000, 6000, 9000]);
  });

  it('waits out a 429 for as long as Oxy says and sends the same call again', async () => {
    const clock = virtualClock();
    const waits: number[] = [];
    const pacer = new OxyCallPacer({
      perMinute: 30,
      now: clock.now,
      sleep: clock.sleep,
      onRateLimited: (ms) => waits.push(ms),
    });
    let calls = 0;
    const answer = await pacer.run(async () => {
      calls += 1;
      if (calls <= 2) throw oxyError(429, { retryAfterSeconds: 42 });
      return 'stored';
    });
    expect(answer).toBe('stored');
    expect(calls).toBe(3);
    expect(waits).toEqual([42_000, 42_000]);
    expect(pacer.rateLimited).toBe(2);
    expect(clock.elapsed()).toBeGreaterThanOrEqual(84_000);
  });

  it('holds back every later call while the rate limit lasts, not only the refused one', async () => {
    const clock = virtualClock();
    const pacer = new OxyCallPacer({ perMinute: 60, now: clock.now, sleep: clock.sleep });
    let refused = false;
    await pacer.run(async () => {
      if (!refused) {
        refused = true;
        throw oxyError(429, { retryAfterSeconds: 30 });
      }
    });
    const next = clock.now();
    let startedAt = -1;
    await pacer.run(async () => {
      startedAt = clock.now();
    });
    expect(next).toBeGreaterThanOrEqual(30_000);
    expect(startedAt).toBeGreaterThanOrEqual(next + 1000);
  });

  it('retries a transport failure or a 5xx, then hands the error over', async () => {
    const clock = virtualClock();
    const pacer = new OxyCallPacer({ perMinute: 60, now: clock.now, sleep: clock.sleep });
    let calls = 0;
    expect(
      await pacer.run(async () => {
        calls += 1;
        if (calls === 1) throw new Error('socket hang up');
        if (calls === 2) throw oxyError(503);
        return 'ok';
      }),
    ).toBe('ok');

    let always = 0;
    await expect(
      pacer.run(async () => {
        always += 1;
        throw oxyError(502);
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(always).toBe(4);
  });

  it('never retries a refusal that is the caller’s to handle', async () => {
    const pacer = new OxyCallPacer({ perMinute: 60, sleep: async () => undefined });
    let calls = 0;
    await expect(
      pacer.run(async () => {
        calls += 1;
        throw oxyError(403);
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(1);
  });

  it('reads Retry-After from the error, with a bounded default', () => {
    expect(retryAfterMs(oxyError(429, { retryAfterSeconds: 7 }))).toBe(7000);
    expect(retryAfterMs(oxyError(429))).toBe(60_000);
    expect(retryAfterMs(oxyError(429, { retryAfterSeconds: 99_999 }))).toBe(300_000);
  });
});
