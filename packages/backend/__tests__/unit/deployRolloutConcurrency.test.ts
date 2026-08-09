/**
 * A production rollout is never cancelled — an invariant that lives in TWO
 * workflow files, and is stated in the one that cannot enforce it.
 *
 * ## The shape of the defect
 *
 * `deploy-aws.yml` declares `cancel-in-progress: false` on its own concurrency
 * group and says why directly above it: cancelling after `aws ecs
 * update-service` leaves an unmonitored deployment running in ECS. That
 * declaration is necessary and NOT sufficient. The workflow is `workflow_call`
 * only — `ci.yml`'s `deploy-backend` job invokes it — and a called workflow runs
 * inside the CALLER's run. Cancel the caller and the deploy job dies with it,
 * mid-`buildx`, mid-`update-service`, or mid-wait, whatever its own group says.
 *
 * `ci.yml` cancelled in progress on every ref until this gate landed, so the
 * guarantee was void for the whole time the comment asserted it. On 2026-08-09
 * runs `31300943279` and `31301131928` each had their deploy job cancelled by
 * the next merge to main, minutes apart. The first survived only by timing: its
 * API rollout had reached `rolloutState: COMPLETED` seconds before the cancel,
 * and its worker lane had not started.
 *
 * The quieter half is `deploy-frontends.yml`, which triggers on `workflow_run`
 * with `conclusion == 'success'`. A cancelled run is not a successful one, so a
 * cancel on main also skips the frontend deploy silently — the two halves of a
 * wire contract end up on different commits with no red job anywhere.
 *
 * ## Why a text gate, and why it is exact
 *
 * Nothing else can catch this. Both files are individually valid YAML, both
 * individually reasonable, and the defect exists only in their relationship —
 * which no linter, no typechecker and no run of either workflow observes. It is
 * also the failure mode that rots the fastest, because reverting `ci.yml` to a
 * bare `cancel-in-progress: true` is a one-word edit in a file whose own comment
 * used to ask for exactly that.
 *
 * The expression is matched EXACTLY rather than semantically. Evaluating
 * "does this expression exclude refs/heads/main" in general would mean
 * implementing GitHub's expression language a second time, and being
 * approximately right about it is worse than requiring a deliberate edit here:
 * a rewrite that is genuinely equivalent still has to be read by a person
 * before this file agrees to it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repository root — four levels above `packages/backend/__tests__/unit`. */
const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const workflowsDir = join(REPOSITORY_ROOT, '.github', 'workflows');
const read = (file: string): string => readFileSync(join(workflowsDir, file), 'utf8');

const ci = read('ci.yml');
const deployBackend = read('deploy-aws.yml');
const deployFrontends = read('deploy-frontends.yml');

/**
 * The top-level `concurrency:` block of a workflow — the key at column 0 and
 * every indented line under it. Scoping matters: a job-level `concurrency` would
 * otherwise satisfy an assertion meant for the workflow-level one.
 */
const topLevelConcurrency = (workflow: string): string => {
  const match = /^concurrency:\n((?: {2}.*\n|\n)*)/m.exec(workflow);
  return match?.[1] ?? '';
};

const ciConcurrency = topLevelConcurrency(ci);
const deployConcurrency = topLevelConcurrency(deployBackend);

/**
 * The contiguous run of `#` lines immediately above the top-level
 * `concurrency:` key — the comment a reader of that key actually sees.
 *
 * Deliberately NOT "everything before the key". That was the first version, and
 * mutation testing caught it: both files mention the other one in their FILE
 * HEADER for unrelated reasons, so a slice from index 0 passed the pointer
 * assertions even with the pointer deleted from the comment under test.
 */
const commentAboveConcurrency = (workflow: string): string => {
  const index = workflow.search(/^concurrency:$/m);
  if (index === -1) return '';
  const lines = workflow.slice(0, index).split('\n');
  const comment: string[] = [];
  for (let i = lines.length - 1; i >= 0 && (lines[i].startsWith('#') || lines[i] === ''); i -= 1) {
    if (lines[i] === '' && comment.length > 0) break;
    if (lines[i].startsWith('#')) comment.unshift(lines[i]);
  }
  return comment.join('\n');
};

/** The value of a key inside a concurrency block, trimmed of comments. */
const concurrencyValue = (block: string, key: string): string => {
  const match = new RegExp(`^ {2}${key}: (.*)$`, 'm').exec(block);
  return match?.[1]?.trim() ?? '';
};

describe('a production rollout is never cancelled', () => {
  it('reads both concurrency blocks at all', () => {
    // Vacuity floor. Every assertion below reads one of these two; an empty
    // block would make the value lookups return '' and several of the
    // assertions below pass for the wrong reason.
    expect(ciConcurrency).not.toBe('');
    expect(deployConcurrency).not.toBe('');
    expect(concurrencyValue(ciConcurrency, 'group')).toBe('ci-${{ github.ref }}');
    expect(concurrencyValue(deployConcurrency, 'group')).toBe('deploy-homiio-backend');
  });

  it('keeps the deploy workflow itself non-cancelling', () => {
    expect(concurrencyValue(deployConcurrency, 'cancel-in-progress')).toBe('false');
  });

  it('does not let CI cancel a run on main', () => {
    // The whole point. A bare `true` here re-breaks the deploy guarantee with a
    // one-word edit in a different file from the one that states it.
    expect(concurrencyValue(ciConcurrency, 'cancel-in-progress')).toBe(
      "${{ github.ref != 'refs/heads/main' }}",
    );
  });

  it('still cancels superseded pull-request runs', () => {
    // The other half of the trade: this must remain an expression that is TRUE
    // for a pull request, not a blanket `false`, or every PR queues behind its
    // own superseded runs. `github.ref` on a pull_request is `refs/pull/N/merge`,
    // so the inequality above holds — confirmed on real runs, since a mistyped
    // expression degrades to falsy silently rather than failing the run.
    const value = concurrencyValue(ciConcurrency, 'cancel-in-progress');
    expect(value.startsWith('${{')).toBe(true);
    expect(value).not.toBe('false');
  });

  it('is only load-bearing because CI calls the deploy, so the call is pinned too', () => {
    // If `deploy-backend` stopped calling the reusable workflow — moved back to
    // its own `push` or `workflow_run` trigger — the deploy would get its own
    // run, its own group would suffice, and the assertion above would be
    // protecting nothing while still passing. Pinning the coupling means that
    // change has to come here and be reasoned about.
    expect(ci).toContain('uses: ./.github/workflows/deploy-aws.yml');
    expect(deployBackend).toMatch(/^on:\n(?: {2}workflow_call:\n| {2}workflow_dispatch:\n)+/m);
    expect(deployBackend).toContain('workflow_call:');
    expect(deployBackend).not.toMatch(/^ {2}push:$/m);
  });

  it('pins the frontend deploy as the quieter victim of a cancel', () => {
    // A cancelled run is not a successful one, so this trigger is the reason a
    // cancel on main skips the frontend silently. If it ever stops depending on
    // CI's conclusion, the comment in ci.yml saying so becomes false.
    expect(deployFrontends).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it('states the cross-file coupling in both files, pointing at the other one', () => {
    // `docs` and comments are the one place a wrong statement survives
    // indefinitely — nothing executes them, so nobody trips over a stale claim.
    // deploy-aws.yml asserts a guarantee it cannot enforce alone; it has to name
    // where the other half lives, or the next edit to ci.yml removes it quietly.
    const deployComment = commentAboveConcurrency(deployBackend);
    const ciComment = commentAboveConcurrency(ci);
    // Vacuity floor: an empty comment satisfies nothing below, but an empty
    // STRING would satisfy `not.toBe('')` checks elsewhere by accident.
    expect(deployComment.length).toBeGreaterThan(200);
    expect(ciComment.length).toBeGreaterThan(200);
    expect(deployComment).toContain('ci.yml');
    expect(deployComment).toContain('refs/heads/main');
    expect(ciComment).toContain('deploy-aws.yml');
  });
});
