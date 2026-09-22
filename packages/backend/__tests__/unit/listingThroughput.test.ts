/**
 * The pipeline completed TWO jobs per minute, with 64,411 queued.
 *
 * Measured on production on 2026-09-22, an hour after the worker was restarted
 * with the queue fixes in place:
 *
 *     listing-fetch:    prioritized 64,413 -> 64,411 over 60s, active 6
 *     listing-discover: prioritized  1,012 -> unchanged,       active 6
 *     worker task:      2 vCPU / 8GB, at 17% CPU and 11% memory
 *
 * Twelve queue consumers shared **two** browser slots
 * (`LISTING_BROWSER_MAX_CONCURRENCY=2`), and a browser fetch runs up to
 * `LISTING_BROWSER_TIMEOUT_MS` (45s). Two slots x 45s is about 2.7 fetches a
 * minute, which is the number that was observed. Draining the backlog at that
 * rate takes 22 days, on a box that was 89% idle.
 *
 * ## Why this is two files
 *
 * The browser pool's default lives in `browser.ts`; the worker task definition
 * PINS `LISTING_BROWSER_MAX_CONCURRENCY=2` and `LISTING_FETCH_CONCURRENCY=6`
 * on top of it. Raising a default while the environment still pins the old
 * value does nothing, and unpinning while the default is unchanged does
 * nothing either. Neither half is a fix alone, so both are asserted here.
 *
 * And the pin could not simply be edited in terraform: `deploy-ecs-image.sh`
 * renders each revision from the LIVE one, so the only thing that removes a
 * variable from the running service is the deploy's own removal list. That is
 * the defect `deployTaskEnvCleanup.test.ts` exists for; this change is its
 * first non-cleanup use.
 *
 * ## The cost, stated
 *
 * More browser slots means proportionally more metered residential proxy
 * traffic. An exhausted Evomi balance is what emptied the database on
 * 2026-09-20. This is a deliberate trade.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MAX_CONCURRENCY } from '@homiio/listing-providers';

const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const workflow = readFileSync(join(REPOSITORY_ROOT, '.github/workflows/deploy-aws.yml'), 'utf8');
const worker = readFileSync(join(REPOSITORY_ROOT, 'packages/backend/worker.ts'), 'utf8');

/** The worker lane's removal list — the one carrying the dead provider flags. */
function workerRemovals(): string[] {
  for (const match of workflow.matchAll(/TASK_CONFIGURATION_REMOVALS_JSON:\s*'(\[[^']*\])'/g)) {
    const list: string[] = JSON.parse(match[1]);
    if (list.some((name) => name.startsWith('PROVIDER_'))) return list;
  }
  throw new Error('no lane removes the PROVIDER_* flags');
}

describe('browser slots are the ceiling, and both halves have to move', () => {
  it('raises the pool above the two slots that produced 2 jobs/minute', () => {
    expect(DEFAULT_MAX_CONCURRENCY).toBeGreaterThan(2);
  });

  it('unpins the variable that would otherwise keep it at 2', () => {
    // Without this the constant above is decoration: the task definition wins.
    expect(workerRemovals()).toContain('LISTING_BROWSER_MAX_CONCURRENCY');
  });

  it('leaves enough consumers to keep the slots fed', () => {
    const match = worker.match(/LISTING_FETCH_CONCURRENCY \|\| '(\d+)'/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(DEFAULT_MAX_CONCURRENCY);
  });

  it('unpins the fetch concurrency too', () => {
    expect(workerRemovals()).toContain('LISTING_FETCH_CONCURRENCY');
  });

  it('stays within what 2 vCPU and 8GB can hold', () => {
    // The pool is ONE Chromium with a context per fetch, and asset loading is
    // blocked, so a slot costs tens of megabytes against ~7GB idle. The bound
    // is CPU, not memory — this is a guard against someone reading "it was
    // underused" as "set it to fifty".
    expect(DEFAULT_MAX_CONCURRENCY).toBeLessThanOrEqual(8);
  });
});
