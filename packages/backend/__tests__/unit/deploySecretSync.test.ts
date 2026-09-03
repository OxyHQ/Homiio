/**
 * The deploy workflow's SSM sync names every secret it copies, and the two
 * places it names them cannot drift apart.
 *
 * ## Two different failures, one step
 *
 * **The pattern.** `.github/workflows/deploy-aws.yml` used to expand the whole
 * `secrets` context with `toJSON(secrets)` and walk it into a shell loop. That
 * shape is indistinguishable from an exfiltration payload, so GitHub's
 * malicious-workflow detection holds every run of the workflow as
 * `action_required` with ZERO jobs until a human clicks "Approve and run" in the
 * UI — per run, and with no automatable escape (the REST approve endpoint only
 * serves fork pull requests). Measured across the org on 2026-08-08: every repo
 * carrying the pattern was held; the two using explicit allowlists never were.
 * Nothing in a normal CI run reports it, because the runs never start. #283
 * removed it here.
 *
 * **The half-edit.** An allowlist then has its own failure mode, and it is
 * quieter: the step reports success on the names it was given, so a secret the
 * task definition reads but the list omits is never written, and the deploy is
 * green. That happened. `DATABASE_URL` was added to the repository secrets and
 * to both task definitions during the Postgres cutover on 2026-08-09 and not
 * added to the list; `/oxy/homiio/DATABASE_URL` was set by hand and every
 * subsequent deploy synced the other six and said so.
 *
 * ## What these assertions are worth, and what they are not
 *
 * They are exact about the two spellings INSIDE the workflow — the `env:`
 * bindings and the `sync_secret` calls — because that is the drift that
 * actually happens and it is fully observable from the repository. A name bound
 * but never synced reaches nothing; a name synced from an unbound variable is
 * read as empty and skipped with a warning nobody sees until the deploy that
 * needed it; a name written to the wrong namespace is invisible to the
 * container, which reads the other one.
 *
 * They are NOT a check that the list matches the LIVE task definitions — that
 * needs AWS, which this suite has no credentials for and should not. What
 * `EXPECTED_SYNCED_SECRETS` buys instead is that widening the workflow forces a
 * deliberate edit here, in a file whose docblock says where the truth lives.
 * The derivation is in the workflow's own comment, next to the list.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repository root — four levels above `packages/backend/__tests__/unit`. */
const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const WORKFLOW_PATH = join(REPOSITORY_ROOT, '.github', 'workflows', 'deploy-aws.yml');
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

/**
 * Every parameter the two task definitions read as a `secret` after the Sindi
 * inference rollout. The seven pre-existing entries were re-derived from
 * `oxy-homiio:48` and `oxy-homiio-worker:55` on 2026-08-09; the two Oxy service
 * credential parameters are intentionally absent: Oxy's exact-ID provisioner
 * owns them and this deploy only verifies their SecureString type.
 *
 * `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `REDIS_URL` live under
 * `/oxy/_shared/`; the rest under `/oxy/homiio/`. The split is what the
 * `SHARED_` and `APP_` prefixes encode, and it matters because a shared value
 * written to the app namespace syncs successfully and reaches nothing.
 *
 * `MONGODB_URI` is GONE from this list, and the order of operations is the
 * point: it was deleted from SSM first and CAME BACK, because this sync
 * recreated it on the next deploy. Removing a value does not remove the thing
 * that produces it. Neither task definition carries it any more, so a sync
 * would now write a parameter nothing reads — and this list is what stops it
 * being re-added without somebody noticing.
 */
const EXPECTED_SYNCED_SECRETS = {
  APP: [
    'DATABASE_URL',
    'JWT_REFRESH_SECRET',
    'JWT_SECRET',
    'LISTING_RESIDENTIAL_PROXY_URL',
  ],
  SHARED: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'REDIS_URL'],
};

/**
 * The body of the sync step: from its `- name:` line to the next step at the
 * same indentation. Scoping matters — the workflow has other steps with `env:`
 * blocks, and assertions that read the whole file would pass on bindings that
 * belong to the build or the rollout.
 */
const syncStep = ((): string => {
  const start = workflow.indexOf('      - name: Sync GitHub secrets');
  if (start === -1) return '';
  const rest = workflow.slice(start + 1);
  const end = rest.search(/^ {6}- name: /m);
  return end === -1 ? rest : rest.slice(0, end);
})();

/** `PREFIX_NAME: ${{ secrets.NAME }}` bindings, as `[prefix, envName, secretName]`. */
const envBindings = [...syncStep.matchAll(/^ {10}(APP|SHARED)_([A-Z0-9_]+): \$\{\{ secrets\.([A-Z0-9_]+) \}\}$/gm)];

/** `sync_secret NAME "$VAR" "PATH"` calls, as `[name, variable, path]`. */
const syncCalls = [...syncStep.matchAll(/^ *sync_secret ([A-Z0-9_]+) "\$([A-Z0-9_]+)" "([^"]+)"$/gm)];

describe('the deploy workflow syncs an explicit allowlist', () => {
  it('has a sync step with bindings and calls at all', () => {
    // Vacuity floor. Every assertion below reads one of these three; an empty
    // step or a regex that stopped matching would make them all trivially true,
    // which is exactly how a gate stops gating without anyone noticing.
    // An empty string here means the step was renamed or removed.
    //
    // LOWERED FROM 8 TO 7 by the `MONGODB_URI` removal — deliberately, in the
    // same change that removes the secret, which is the only way a floor should
    // ever come down. It is a MINIMUM, so a secret ADDED to the task definitions
    // without being synced still has to raise it.
    expect(syncStep).not.toBe('');
    expect(syncStep).toContain('bash .github/scripts/put-secure-parameter.sh "$path"');
    expect(syncStep).not.toContain('aws ssm put-parameter');
    expect(syncStep).not.toContain('--value "$value"');
    expect(envBindings.length).toBeGreaterThanOrEqual(7);
    expect(syncCalls.length).toBeGreaterThanOrEqual(7);
  });

  it('never enumerates the whole secrets context', () => {
    // Matched as an EXPRESSION, not as prose: the step's own comment explains
    // the block by name, so a plain substring check would fail on the
    // explanation rather than on the payload — and would then be "fixed" by
    // deleting the explanation.
    expect(workflow).not.toMatch(/\$\{\{[^}]*toJSON\s*\(\s*secrets\s*\)/);
  });

  it('binds each secret under a prefix, and never under its own name', () => {
    // The prefix is not cosmetic. `aws-actions/configure-aws-credentials`
    // exports AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY into the job
    // environment, so a secret bound under its raw name shadows the assumed
    // OIDC role and fails this step with UnrecognizedClientException.
    const envBlock = syncStep.slice(syncStep.indexOf('env:'), syncStep.indexOf('run:'));
    for (const line of envBlock.split('\n')) {
      const binding = /^ {10}([A-Za-z0-9_]+):/.exec(line);
      if (binding) expect(binding[1]).toMatch(/^(APP|SHARED)_/);
    }
    // The variable must be named after the secret it carries, or the loop below
    // cannot tell which value a call is actually sending.
    for (const [, , envName, secretName] of envBindings) {
      expect(envName).toBe(secretName);
    }
  });

  it('syncs exactly the secrets it binds, from the variables it binds them to', () => {
    const bound = envBindings.map(([, prefix, name]) => `${prefix}_${name}`).sort();
    const consumed = syncCalls.map(([, , variable]) => variable).sort();
    expect(consumed).toEqual(bound);

    // Three independent spellings of one name per call — the label the warning
    // prints, the variable the value comes from, and the parameter SSM stores —
    // cross-checked against each other and against the namespace in the path.
    // A mismatch means a skipped secret is reported under another one's name, or
    // a shared value written where nothing reads it.
    for (const [, name, variable, path] of syncCalls) {
      const namespace = path.startsWith('/oxy/_shared/') ? 'SHARED' : 'APP';
      expect(variable).toBe(`${namespace}_${name}`);
      expect(path.split('/').pop()).toBe(name);
    }
  });

  it('routes the shared secrets to /oxy/_shared and the rest to the app namespace', () => {
    // A name with no call at all returns the empty string, which fails the
    // comparison naming the missing secret — the case this whole file exists for.
    const pathFor = (name: string): string =>
      syncCalls.find(([, candidate]) => candidate === name)?.[3] ?? '';
    for (const name of EXPECTED_SYNCED_SECRETS.SHARED) expect(pathFor(name)).toBe(`/oxy/_shared/${name}`);
    for (const name of EXPECTED_SYNCED_SECRETS.APP) expect(pathFor(name)).toBe(`/oxy/$APP/${name}`);
  });

  it('covers exactly the secrets required by the matching task definitions', () => {
    // Widening this list is the deliberate edit the workflow comment asks for.
    // Narrowing it means a container reads a parameter no deploy maintains.
    expect(syncCalls.map(([, name]) => name).sort()).toEqual(
      [...EXPECTED_SYNCED_SECRETS.APP, ...EXPECTED_SYNCED_SECRETS.SHARED].sort(),
    );
  });

  it('still refuses placeholders and a non-us-west-2 REDIS_URL', () => {
    // Both guards predate the allowlist. A secret left empty or set to a single
    // dash is a mistake, not an instruction to overwrite production with
    // garbage: skipping leaves whatever SSM already holds.
    expect(syncStep).toContain('[ "$value" = "-" ]');
    // The ESCAPED spelling, because the guard is a `grep` regex — asserting the
    // bare hostname passes on a workflow whose dots are unescaped wildcards.
    expect(syncStep).toContain(String.raw`'\.usw2\.cache\.amazonaws\.com'`);
  });

  it('does not source Oxy service credentials from GitHub and verifies exact SSM paths', () => {
    const executableSync = syncStep
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(syncStep).not.toMatch(/secrets\.OXY_SERVICE_API_(?:KEY|SECRET)/);
    expect(syncStep).not.toMatch(/sync_secret OXY_SERVICE_API_(?:KEY|SECRET)/);
    expect(syncStep).toContain('require_secure_string "/oxy/$APP/OXY_SERVICE_API_KEY"');
    expect(syncStep).toContain('require_secure_string "/oxy/$APP/OXY_SERVICE_API_SECRET"');
    expect(executableSync).not.toContain('--with-decryption');
  });
});
