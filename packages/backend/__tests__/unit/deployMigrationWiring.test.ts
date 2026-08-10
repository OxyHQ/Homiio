/**
 * The deploy applies migrations, on both sides of the rollout, from the right
 * lane — three facts that live only in workflow YAML and a shell script, and
 * that nothing else in this repository can observe.
 *
 * ## The defect this exists for
 *
 * `deploy-ecs-image.sh` defaults `RUN_MIGRATIONS` to `false`, and until
 * 2026-08-10 nothing set it to anything. Every deploy pushed an image, rolled it
 * out, and applied no migration at all. Nothing was red: CI passed, the deploy
 * passed, and `.github/scripts/check-migration-phases.mjs` — a real gate —
 * verified that every migration DECLARED which side of a deploy it belonged on,
 * while nothing consumed the declaration. Production ended four migrations
 * behind (0008 through 0011) and answered 500 on `/api/cities` and
 * `/api/home/sections` until a one-shot was run by hand.
 *
 * The lesson generalises past migrations: a gate on an input is not a gate on
 * the pipeline that reads it, and the two look identical from a green run.
 *
 * ## What this file owns, and what it does not
 *
 * `.github/scripts/test-deploy-ecs-image.sh` drives the real script with the
 * values read out of this same workflow and asserts the resulting AWS calls, so
 * it covers "does `RUN_MIGRATIONS=true` reach the API lane and not the worker".
 * What it cannot see is WHICH lane declares the post-deploy command, because by
 * the time the script runs it has been handed one value with no lane attached.
 *
 * That attribution is the whole safety argument for the `post` phase, so it is
 * asserted here: both services roll the SAME image, the worker rolls LAST, and a
 * `post` migration drops or narrows something. Declared on the API lane it would
 * run while the worker was still serving the previous image for the length of
 * its own rollout. Declared on the worker lane it runs once nothing old is left.
 *
 * These assertions are exact rather than semantic. Deciding "is this YAML
 * equivalent to that YAML" in general means reimplementing a parser and being
 * approximately right; requiring a deliberate edit here means a rewrite gets
 * read by a person first.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repository root — four levels above `packages/backend/__tests__/unit`. */
const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const workflow = readFileSync(
  join(REPOSITORY_ROOT, '.github', 'workflows', 'deploy-aws.yml'),
  'utf8',
);
const deployScript = readFileSync(
  join(REPOSITORY_ROOT, '.github', 'scripts', 'deploy-ecs-image.sh'),
  'utf8',
);

/** The name of each lane's step, in the order the job runs them. */
const API_STEP = 'Register immutable task definition and deploy (API)';
const WORKER_STEP = 'Register immutable task definition and deploy (listing worker)';

/**
 * A step's body: from its `- name:` line to the next step at the same
 * indentation, or the end of the file, with whole-line `#` comments removed.
 *
 * Scoping is the point. Both lanes bind `IMAGE_URI` and `DEPLOY_SHA`, so an
 * assertion that read the whole file would pass on the other lane's bindings —
 * which is precisely the mistake that would put the `post` migration on the API
 * lane and still look verified.
 *
 * The comments go because a step's slice runs up to the NEXT step's `- name:`,
 * which means it swallows the comment block explaining that next step. This
 * repository has already been bitten by the line-based version of that: a
 * component's own doc comment quoting a forbidden form made a grep report a
 * violation, and a gate that cries wolf gets switched off by whoever hits it
 * next. Here it would fail in the other direction — a lane could look like it
 * declared a binding that is only being DESCRIBED above the lane below it.
 */
const stepBody = (name: string): string => {
  const start = workflow.indexOf(`      - name: ${name}`);
  if (start === -1) return '';
  const rest = workflow.slice(start + 1);
  const end = rest.search(/^ {6}- name: /m);
  const body = end === -1 ? rest : rest.slice(0, end);
  return body
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
};

const apiStep = stepBody(API_STEP);
const workerStep = stepBody(WORKER_STEP);

/**
 * A workflow-LEVEL `env:` value, matched at exactly two spaces of indent.
 *
 * The indent carries the assertion: a step-level binding sits at ten, so an
 * unanchored match would read a value scoped to one step and report it as the
 * job-wide default. Returns null when absent, so "not declared" and "declared
 * empty" stay distinguishable.
 */
const workflowEnv = (key: string): string | null => {
  const matches = [...workflow.matchAll(new RegExp(`^ {2}${key}: (.*)$`, 'gm'))];
  if (matches.length !== 1) return null;
  return matches[0][1].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
};

/**
 * Every `["node", …]` command the deploy script or workflow runs the migrator
 * with.
 *
 * The character class excludes newlines as well as brackets, and that is not
 * tidiness: both files are full of `[[ … ]]` shell tests and YAML flow
 * sequences, so a class that could cross a line would happily match from one
 * unrelated bracket to another and hand `JSON.parse` a page of shell.
 */
const migratorCommands = (source: string): string[][] =>
  [...source.matchAll(/\[[^[\]\n]*dist\/db\/migrate\.js[^[\]\n]*\]/g)].map((match) =>
    (JSON.parse(match[0]) as string[]).map((argument) => argument.trim()),
  );

describe('the deploy applies migrations', () => {
  it('reads both lanes and the script at all', () => {
    // Vacuity floor. Every assertion below reads one of these; an empty string
    // would make several of them pass for the wrong reason, which is how a gate
    // stops gating without going red.
    expect(apiStep).not.toBe('');
    expect(workerStep).not.toBe('');
    expect(apiStep).toContain('bash .github/scripts/deploy-ecs-image.sh');
    expect(workerStep).toContain('bash .github/scripts/deploy-ecs-image.sh');
    expect(deployScript).toContain('MIGRATION_TASK_COMMANDS_JSON=');
  });

  it('turns migrations on, job-wide and unambiguously', () => {
    // The one-word edit that recreates the incident. `false`, absent, or a
    // spelling the script rejects all mean an image rolls out against whatever
    // schema production happens to have.
    expect(workflowEnv('RUN_MIGRATIONS')).toBe('true');
    // And the script must keep REFUSING anything else rather than treating an
    // unparseable value as off — a typo'd `True` silently skipping every
    // migration is the same failure with a different cause.
    expect(deployScript).toContain(
      "if [[ \"$RUN_MIGRATIONS\" != \"true\" && \"$RUN_MIGRATIONS\" != \"false\" ]]; then",
    );
  });

  it('gives the pre migrations to exactly one lane, the API one', () => {
    // Both services roll the same image through the same script, and the
    // migrator holds no cross-process lock, so a job-wide `RUN_MIGRATIONS`
    // is only safe because MIGRATION_SERVICE names one lane. The worker lane
    // derives its own APP by suffixing, which is why this compares against the
    // workflow's APP rather than a literal.
    expect(workflowEnv('MIGRATION_SERVICE')).toBe(workflowEnv('APP'));
    expect(workerStep).toContain('export APP="${APP}-worker"');
    // Neither lane may override the flag or the owner locally: a step-level
    // binding would silently win over the job-wide values asserted above.
    expect(apiStep).not.toContain('RUN_MIGRATIONS:');
    expect(workerStep).not.toContain('RUN_MIGRATIONS:');
    expect(apiStep).not.toContain('MIGRATION_SERVICE:');
    expect(workerStep).not.toContain('MIGRATION_SERVICE:');
  });

  it('runs the post phase on the WORKER lane, which rolls last', () => {
    // THE LANE IS THE SAFETY ARGUMENT. `post` drops and narrows, so it is only
    // correct once no old image is serving; the worker rolls after the API, so
    // that moment arrives at the end of the worker's rollout and not the API's.
    expect(workerStep).toContain('POST_DEPLOY_TASK_COMMAND_JSON:');
    expect(apiStep).not.toContain('POST_DEPLOY_TASK_COMMAND_JSON:');
    // Ordering, read off the file rather than assumed from the two assertions
    // above: swapping the steps would leave both of them true and the guarantee
    // false.
    expect(workflow.indexOf(`- name: ${API_STEP}`)).toBeLessThan(
      workflow.indexOf(`- name: ${WORKER_STEP}`),
    );
  });

  it('runs pre before the rollout and post after it, against one database', () => {
    const pre = migratorCommands(deployScript);
    const post = migratorCommands(workerStep);
    expect(pre).toHaveLength(1);
    expect(post).toHaveLength(1);
    expect(pre[0]).toContain('--phase=pre');
    expect(post[0]).toContain('--phase=post');

    // `node`, not `bun`: the runtime image installs production dependencies
    // only and its CMD is node. The path this replaced named a file that has
    // never existed here, which is why `RUN_MIGRATIONS=true` could not have
    // worked even had something set it.
    for (const command of [pre[0], post[0]]) {
      expect(command[0]).toBe('node');
      expect(command[1]).toBe('packages/backend/dist/db/migrate.js');
    }

    // Both phases must name the SAME database, and name one at all. The
    // migrator requires `--target-database` because a run pointed at the wrong
    // database fails SUCCESS-SHAPED: it finds an empty ledger, applies the whole
    // journal, and logs `Applied N migration(s)`.
    const target = (command: string[]): string =>
      command.find((argument) => argument.startsWith('--target-database=')) ?? '';
    expect(target(pre[0])).toBe('--target-database=homiio');
    expect(target(post[0])).toBe(target(pre[0]));
  });

  it('keeps the post phase unconditional, so it cannot rot until it matters', () => {
    // Sibling repos gate the post task on grepping the release for a post-phase
    // marker, to save a Fargate task on a release that has none. A wrong grep
    // there reads as "no post migration in this release" and skips the drop
    // silently — the same shape as the defect this file exists for — while a
    // wrong COMMAND fails loudly on the first release that needs one.
    //
    // So the invariant is that the worker lane carries no step-level condition.
    // Asserted as the absence of an `if:` key rather than as the absence of the
    // marker TEXT: the marker is a legitimate thing for a comment here to
    // mention, and a gate that reds on its own documentation gets switched off.
    expect(workerStep).not.toMatch(/^ {8}if:/m);
  });
});
