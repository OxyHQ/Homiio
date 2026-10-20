/**
 * The reconciliation inventory reaches the SDK no faster than Oxy's per-app
 * budget for reconciliation pages: one pacer slot per SDK page of items. A 429
 * mid-upload ends the whole session, so being refused is not an option.
 */

import { OxyCallPacer } from '../../services/files/oxyCallPacer';
import {
  OXY_RECONCILE_PAGES_PER_MINUTE_LIMIT,
  pacedInventory,
  RECONCILE_PAGES_PER_MINUTE,
} from '../../services/files/referenceReconcile';

async function* numbers(count: number): AsyncGenerator<number> {
  for (let n = 0; n < count; n += 1) yield n;
}

describe('pacedInventory', () => {
  it('waits for one slot per page of items, and passes every item through in order', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const pacer = new OxyCallPacer({
      perMinute: 60,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    const seen: number[] = [];
    for await (const n of pacedInventory(numbers(25), pacer, 10)) seen.push(n);

    expect(seen).toEqual([...Array(25).keys()]);
    // Pages start at items 0, 10 and 20: the first goes at once, each next one a
    // second (60 a minute) after the one before.
    expect(sleeps).toEqual([1000, 1000]);
    expect(clock).toBe(2000);
  });

  it("spends less than Oxy's budget", () => {
    expect(RECONCILE_PAGES_PER_MINUTE).toBeLessThan(OXY_RECONCILE_PAGES_PER_MINUTE_LIMIT);
  });
});
