/**
 * No workflow ships a runtime secret: SSM is the only copy.
 *
 * ## The rule
 *
 * Runtime secrets live ONLY in SSM `/oxy/homiio/*` (SecureString) and the
 * oxy-infra-owned `/oxy/_shared/*` (oxy-infra runbooks 45 and 46). Both task
 * definitions read them at task start; a value is set or rotated with
 * `aws ssm put-parameter --overwrite`, and a NEW one is written before a task
 * definition names it. GitHub holds only what CI itself spends.
 *
 * ## What it replaced, and why
 *
 * Until 2026-10-10 the deploy copied `DATABASE_URL`, `JWT_SECRET`,
 * `JWT_REFRESH_SECRET` and `LISTING_RESIDENTIAL_PROXY_URL` from repo secrets
 * into SSM on every run. That made GitHub a second, overriding source of every
 * production credential, and an explicit allowlist had its own quiet failure:
 * a secret the task definitions read but the list omitted was never written,
 * and the deploy stayed green (`DATABASE_URL`, 2026-08-09). Earlier still, the
 * step expanded the whole `secrets` context, which GitHub holds as an
 * exfiltration payload (`action_required`, zero jobs) — #283.
 *
 * ## What these assertions are worth
 *
 * They read every workflow, with comment lines dropped so the rule can be
 * explained where it applies. They cannot check that the parameters the task
 * definitions name EXIST — that needs AWS, which this suite has no credentials
 * for and should not.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repository root — four levels above `packages/backend/__tests__/unit`. */
const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const WORKFLOWS_DIR = join(REPOSITORY_ROOT, '.github', 'workflows');

/** The only repo secrets a workflow may read: what CI itself spends. */
const CI_ONLY_SECRETS = new Set([
  'GITHUB_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'NPM_TOKEN',
  'ADD_TO_PROJECT_TOKEN',
]);

const directivesOnly = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

const workflows = readdirSync(WORKFLOWS_DIR)
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => {
    const raw = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
    return { file, raw, directives: directivesOnly(raw) };
  });

const deployWorkflow = workflows.find(({ file }) => file === 'deploy-aws.yml');

describe('the deploy holds no runtime secret', () => {
  it('reads the real workflows', () => {
    // Vacuity floor: every assertion below is a negative one over this list.
    expect(workflows.length).toBeGreaterThan(3);
    expect(deployWorkflow?.directives).toContain('bash .github/scripts/deploy-ecs-image.sh');
  });

  it('no workflow writes SSM', () => {
    const writers = workflows
      .filter(({ directives }) =>
        // `put-secure-parameter` is the stdin helper the old sync step called.
        /\bssm\s+(put-parameter|delete-parameters?|label-parameter-version)\b|put-secure-parameter/i.test(
          directives,
        ),
      )
      .map(({ file }) => file);
    expect(writers).toEqual([]);
    expect(deployWorkflow?.raw).not.toMatch(/- name: Sync GitHub secrets/);
  });

  it('no workflow reads a repo secret beyond the CI-only allow-list', () => {
    const runtime = workflows.flatMap(({ file, directives }) =>
      [...directives.matchAll(/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g)]
        .map((match) => match[1])
        .filter((name) => !CI_ONLY_SECRETS.has(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(runtime).toEqual([]);
  });

  it('never enumerates the whole secrets context', () => {
    // Matched as an EXPRESSION, not as prose, so an explanation never trips it.
    for (const { raw } of workflows) {
      expect(raw).not.toMatch(/\$\{\{[^}]*toJSON\s*\(\s*secrets\s*\)/i);
    }
  });

  it('never writes a /oxy/_shared/ parameter, which oxy-infra owns', () => {
    // A task-definition ARN (`parameter/oxy/_shared/...`) is a READ and is
    // allowed. Several app deploys each copied their own value into
    // `/oxy/_shared/REDIS_URL` and every deploy flipped it (incident 2026-09-27).
    for (const { directives } of workflows) {
      const lines = directives.split('\n');
      expect(lines.filter((line) => /(?<!parameter)\/oxy\/_shared\//.test(line))).toEqual([]);
    }
  });

  it('never decrypts a parameter', () => {
    for (const { directives } of workflows) {
      expect(directives).not.toContain('--with-decryption');
    }
  });
});
