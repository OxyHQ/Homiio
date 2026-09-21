/**
 * A slow scope must give up its turn, not the whole rotation.
 *
 * Discovery runs 224 scopes on a six-hour schedule, three at a time, and a deep
 * city walk can hold a slot for tens of minutes. Measured on 2026-09-21: **17
 * discover jobs started in 14 hours**, and on the live task 5 started with only
 * 2 finishing. A full pass at that pace takes days, so the scopes at the back
 * of the list never ran at all — `rightmove`, `onthemarket` and `blueground`
 * were enabled, registered, healthy, and had produced **zero** listings in
 * twelve hours. Not failing. Never reached.
 *
 * That is the same family as everything else this week: a component reporting
 * success while doing nothing. The difference is that here nothing was even
 * wrong with the provider.
 *
 * The budget turns rotation from a hope into a property. What these tests pin
 * is the part that is easy to get wrong: a timed-out scope must KEEP what it
 * found. Throwing away 300 real homes to signal "incomplete" would trade
 * inventory for tidiness.
 */

/**
 * The budgeted collection loop, extracted to exactly the shape `worker.ts`
 * runs it in. The worker module itself starts a process on import, so the loop
 * is mirrored rather than imported — and mirrored deliberately thin, so there
 * is no logic here that could pass while the real one fails.
 */
async function collectUnderBudget(
  source: AsyncIterable<string>,
  budgetMs: number,
): Promise<{ refs: string[]; timedOut: boolean }> {
  const refs: string[] = [];
  const controller = new AbortController();
  const deadline = budgetMs > 0 ? setTimeout(() => controller.abort(), budgetMs) : undefined;

  try {
    for await (const ref of source) {
      refs.push(ref);
      if (controller.signal.aborted) break;
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    if (deadline) clearTimeout(deadline);
  }

  return { refs, timedOut: controller.signal.aborted };
}

/** A scope that yields for ever, like a 100-page city walk that never ends. */
async function* endlessScope(intervalMs: number): AsyncGenerator<string> {
  for (let index = 0; ; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    yield `listing-${index}`;
  }
}

/** A scope that finishes on its own well inside the budget. */
async function* shortScope(count: number): AsyncGenerator<string> {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    yield `listing-${index}`;
  }
}

describe('discover job budget', () => {
  it('stops an endless scope and keeps everything it found', async () => {
    // The property that matters. Before the budget this loop never returned,
    // and the slot it held was one of three.
    const { refs, timedOut } = await collectUnderBudget(endlessScope(5), 120);

    expect(timedOut).toBe(true);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]).toBe('listing-0');
  });

  it('leaves a scope that finishes in time completely untouched', async () => {
    const { refs, timedOut } = await collectUnderBudget(shortScope(20), 5_000);

    expect(timedOut).toBe(false);
    expect(refs).toHaveLength(20);
  });

  it('returns promptly rather than running to the end of the walk', async () => {
    // A budget that is honoured only after the iterable finishes would pass
    // "did it time out?" and still hold the slot for an hour.
    const started = Date.now();
    await collectUnderBudget(endlessScope(5), 100);

    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it('still raises a real error, so a broken provider is not silently empty', async () => {
    // Only an ABORT is swallowed. A provider that throws for its own reasons
    // must keep failing loudly — a scope that dies quietly and reports zero is
    // the exact shape that hid a rebuilt portal for weeks.
    async function* broken(): AsyncGenerator<string> {
      yield 'listing-0';
      throw new Error('portal returned 500');
    }

    await expect(collectUnderBudget(broken(), 5_000)).rejects.toThrow('portal returned 500');
  });

  it('treats a zero budget as no budget at all', async () => {
    const { refs, timedOut } = await collectUnderBudget(shortScope(5), 0);

    expect(timedOut).toBe(false);
    expect(refs).toHaveLength(5);
  });
});
