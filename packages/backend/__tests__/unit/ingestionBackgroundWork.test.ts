/**
 * `IngestionService.whenIdle()` — the drain that makes a deliberately
 * fire-and-forget write testable.
 *
 * ## The bug this pins
 *
 * `ingest()` starts a city-cover fetch WITHOUT awaiting it, because that fetch
 * goes to Wikimedia and has no business on the critical path of every listing.
 * The promise used to be dropped on the floor (`void ensureCover(...)`), which
 * made the write unobservable: `integration/externalIngest` removed the local
 * image store in `afterAll` while the cover write was still in flight, the write
 * recreated a directory under it mid-removal, and `fs.rm`'s final `rmdir` failed
 * with `ENOTEMPTY`. That is a suite failing with **every one of its tests
 * passing**, which reads as a broken change rather than a teardown race, and it
 * cost three CI cycles.
 *
 * ## Why it is tested this way
 *
 * `ensureCover` is mocked with a promise this file resolves by hand. A test that
 * let the real fetch run could only observe the race by luck — and it did: ten
 * local runs of the real suite produced one leaked directory and no failure at
 * all, which is exactly the "green run that proves nothing" this repository
 * keeps finding. The deferred stub turns a timing-dependent flake into a
 * deterministic assertion: `whenIdle()` must not resolve while the background
 * task is pending, and must resolve once it settles.
 *
 * ## Mutation-tested, and the first attempt at both halves was wrong
 *
 * Deleting `this.background.add(settled)` from `startBackground` — the old
 * dropped-promise behaviour, isolated — turns two cases RED and the file green
 * again on restore.
 *
 * Two things that had to be fixed to get there, recorded because each produced a
 * confident wrong answer first. Dropping the promise ENTIRELY (`void task`) does
 * not make a usable mutation: the unhandled rejection in the last case kills the
 * jest worker, so the suite fails to run rather than failing an assertion, and
 * "0 tests" is not evidence about any assertion. And the first version of
 * {@link isPending} was vacuous — see the note on it; the mutation SURVIVED all
 * four cases, which is what exposed it.
 */
// Stubbed so constructing the service pulls in no geocoder, no Wikimedia client
// and no database. Nothing here calls it — the drain is driven directly — but
// without the stub the real module loads and this becomes an integration test.
jest.mock('../../services/cityCoverSyncService', () => ({
  ensureCover: jest.fn(),
}));

import { IngestionService } from '../../services/ingestion/IngestionService';

/** A promise plus the handles to settle it, so a test controls the timing. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Drive `startBackground` directly.
 *
 * Reaching it through `ingest()` would drag in Postgres, the media pipeline and
 * a fixture provider to test one promise-tracking rule. The private method is
 * addressed through a narrowly-typed view rather than `any`, which keeps the
 * cast honest about exactly what it assumes.
 */
interface BackgroundDriver {
  startBackground(task: Promise<unknown>, label: string): void;
  whenIdle(): Promise<void>;
}

/**
 * Whether `promise` is STILL PENDING after the microtask queue has drained.
 *
 * The obvious spelling — racing the promise against `Promise.resolve(marker)` —
 * is VACUOUS, and this comment is here because it shipped that way for one
 * commit and the mutation test below is what caught it. `.then()` costs a
 * microtask hop, so the already-resolved marker wins the race even when the
 * promise is settled; the helper answered "pending" for everything, the
 * assertion passed either way, and removing the tracking it was written to
 * verify left all four cases green.
 *
 * `setImmediate` is the fix: it fires on the next macrotask, after every pending
 * microtask has run, so a resolved promise has definitely flipped the flag.
 */
async function isPending(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return !settled;
}

describe('IngestionService background work', () => {
  let service: BackgroundDriver;

  beforeEach(() => {
    service = new IngestionService() as unknown as BackgroundDriver;
  });

  it('whenIdle() resolves immediately when nothing is outstanding', async () => {
    await expect(service.whenIdle()).resolves.toBeUndefined();
  });

  it('whenIdle() does NOT resolve while a background task is pending', async () => {
    const task = deferred();
    service.startBackground(task.promise, 'probe');

    // The assertion that fails if the promise is dropped rather than tracked.
    expect(await isPending(service.whenIdle())).toBe(true);

    task.resolve();
    await expect(service.whenIdle()).resolves.toBeUndefined();
  });

  it('whenIdle() resolves once every task settles, and forgets them', async () => {
    const first = deferred();
    const second = deferred();
    service.startBackground(first.promise, 'first');
    service.startBackground(second.promise, 'second');

    first.resolve();
    expect(await isPending(service.whenIdle())).toBe(true);

    second.resolve();
    await service.whenIdle();

    // A second drain on a settled service must be a no-op rather than hanging on
    // promises it already awaited.
    await expect(service.whenIdle()).resolves.toBeUndefined();
  });

  it('a REJECTED background task is handled, not left unhandled, and still drains', async () => {
    // A dropped rejection surfaces as an unhandled rejection in whichever test
    // happens to be running when it lands — a failure attributed to the wrong
    // file. `startBackground` attaches the handler, so this must not throw.
    const task = deferred();
    service.startBackground(task.promise, 'failing');
    task.reject(new Error('cover fetch failed'));

    await expect(service.whenIdle()).resolves.toBeUndefined();
  });
});
