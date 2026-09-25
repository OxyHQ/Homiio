/**
 * The Homiio API's Sindi/Oxy runtime configuration must survive every deploy.
 *
 * The deploy renderer starts from the task definition the ECS service is
 * already running. Terraform can register a newer revision, but the generic
 * app module deliberately does not repoint the service and this script does not
 * derive from Terraform state. Therefore the two exact environment values and
 * two exact SSM references must be overrides on every API deployment. Merely
 * declaring them in oxy-infra is not enough.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const workflow = readFileSync(
  join(REPOSITORY_ROOT, '.github', 'workflows', 'deploy-aws.yml'),
  'utf8',
);
const deployScript = readFileSync(
  join(REPOSITORY_ROOT, '.github', 'scripts', 'deploy-ecs-image.sh'),
  'utf8',
);
const deployScriptTest = readFileSync(
  join(REPOSITORY_ROOT, '.github', 'scripts', 'test-deploy-ecs-image.sh'),
  'utf8',
);

const stepBody = (name: string): string => {
  const start = workflow.indexOf(`      - name: ${name}`);
  if (start === -1) return '';
  const rest = workflow.slice(start + 1);
  const end = rest.search(/^ {6}- name: /m);
  return (end === -1 ? rest : rest.slice(0, end))
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
};

const apiStep = stepBody('Register immutable task definition and deploy (API)');
const workerStep = stepBody(
  'Register immutable task definition and deploy (listing worker)',
);
const syncStep = stepBody('Sync GitHub secrets -> SSM (GitHub is the source of truth)');

const SERVICE_KEY_ARN =
  'arn:aws:ssm:us-west-2:237343248947:parameter/oxy/homiio/OXY_SERVICE_API_KEY';
const SERVICE_SECRET_ARN =
  'arn:aws:ssm:us-west-2:237343248947:parameter/oxy/homiio/OXY_SERVICE_API_SECRET';
const SINDI_SERVICE_KEY_ARN =
  'arn:aws:ssm:us-west-2:237343248947:parameter/oxy/homiio/SINDI_OXY_SERVICE_API_KEY';
const SINDI_SERVICE_SECRET_ARN =
  'arn:aws:ssm:us-west-2:237343248947:parameter/oxy/homiio/SINDI_OXY_SERVICE_API_SECRET';

describe('Homiio deployment preserves the exact inference runtime boundary', () => {
  it('reads all three load-bearing workflow steps', () => {
    expect(apiStep).not.toBe('');
    expect(workerStep).not.toBe('');
    expect(syncStep).not.toBe('');
    expect(apiStep).toContain('bash .github/scripts/deploy-ecs-image.sh');
    expect(workerStep).toContain('bash .github/scripts/deploy-ecs-image.sh');
  });

  it('takes exact non-secret identifiers from repository variables and validates them', () => {
    expect(apiStep).toContain(
      'HOMIIO_SINDI_ALIA_AGENT_ID: ${{ vars.SINDI_ALIA_AGENT_ID }}',
    );
    expect(apiStep).toContain(
      'HOMIIO_OXY_INFERENCE_ROUTING_PROFILE_ID: ${{ vars.OXY_INFERENCE_ROUTING_PROFILE_ID }}',
    );
    expect(apiStep).toContain(
      'SINDI_ALIA_AGENT_ID must equal the reserved Sindi Alia agent primary key',
    );
    expect(apiStep).toContain('01a0646a-078f-7514-9800-9f43ceed7df8');
    expect(apiStep).not.toContain('24-hex or UUIDv7');
    expect(apiStep).toContain('OXY_INFERENCE_ROUTING_PROFILE_ID must equal the reviewed');
    expect(apiStep).toContain('01a06477-94f5-74f0-bc25-4c5c13b93ccd');
    expect(apiStep).toContain('OXY_API_URL: "https://api.oxy.so"');
    expect(apiStep).toContain('ALIA_API_URL: "https://api.alia.onl"');
    expect(apiStep).toContain('SINDI_ALIA_AGENT_ID: $sindiAgentId');
    expect(apiStep).toContain('OXY_INFERENCE_ROUTING_PROFILE_ID: $routingProfileId');
    expect(apiStep).toContain(
      'TASK_CONFIGURATION_REMOVALS_JSON: \'["OXY_INFERENCE_ROUTING_PROFILE","OXY_SERVICE_API_KEY","OXY_SERVICE_API_SECRET"]\'',
    );
  });

  /**
   * Sindi's credential is not injected any more, and this is the assertion that
   * replaces the one demanding it.
   *
   * What the old name called "isolated" was accurate and is the reason it
   * survived the first migration: Sindi's identity is a dedicated agent service
   * credential that Alia verifies, not Homiio's own, so Homiio attesting its
   * task role did not replace it. What changed is the thing doing the verifying.
   * Alia checks the requester assertion Oxy mints, and Oxy refused to mint one
   * for an attested caller because `nativeProductAgentEntryPoint` matched an
   * exact (application, credential, agent) triple. oxy#1351 lets that entry
   * declare the WORKLOAD it admits as well, and Homiio's canary accepts either
   * id — so the isolation is now carried by the binding rather than by a secret.
   *
   * Measured against production before the pair came off, with a probe needing
   * no signed-in user: an attested token plus a junk subject token is refused
   * `subject_session_invalid`, where before it was `unknown_entry_point`.
   */
  it('injects no Sindi credential, and no longer requires one to exist', () => {
    expect(apiStep).not.toContain(SINDI_SERVICE_KEY_ARN);
    expect(apiStep).not.toContain(SINDI_SERVICE_SECRET_ARN);
    expect(apiStep).not.toContain('TASK_SECRET_OVERRIDES_JSON');
    expect(syncStep).not.toContain('require_secure_string "/oxy/$APP/SINDI_OXY_SERVICE_API_KEY"');
    expect(syncStep).not.toContain('require_secure_string "/oxy/$APP/SINDI_OXY_SERVICE_API_SECRET"');
    expect(syncStep).not.toContain('--with-decryption');
  });

  /**
   * The API attests its ECS task role, so the credential must LEAVE the running
   * revision — and only the removal list can make that happen.
   *
   * Every release renders from the task definition the service is running, so
   * dropping the two ARNs from `TASK_SECRET_OVERRIDES_JSON` would keep them on
   * the container forever: inherited, never re-declared, never taken away. The
   * two assertions are therefore a pair. Stop supplying them AND remove them, or
   * the migration silently does not happen.
   *
   * The SSM parameters themselves are out of scope here and untouched; this is
   * about the task definition's reference to them.
   */
  it('actively removes Homiio own Oxy service credential from the API revision', () => {
    const apiWithoutRemovalList = apiStep.replace(
      /^\s*TASK_CONFIGURATION_REMOVALS_JSON:.*$/m,
      '',
    );
    expect(apiWithoutRemovalList).not.toContain(SERVICE_KEY_ARN);
    expect(apiWithoutRemovalList).not.toContain(SERVICE_SECRET_ARN);
    // Anchored so `SINDI_OXY_SERVICE_API_KEY` — a different identity, still
    // injected — does not satisfy a bare substring search and hide a relapse.
    expect(apiWithoutRemovalList).not.toMatch(
      /(?<![A-Z_])OXY_SERVICE_API_(?:KEY|SECRET)/,
    );
  });

  it('actively removes inference configuration from the listing worker', () => {
    expect(workerStep).not.toContain('TASK_ENV_OVERRIDES_JSON');
    expect(workerStep).not.toContain('TASK_SECRET_OVERRIDES_JSON');
    // Asserted as MEMBERSHIP, not as the whole literal.
    //
    // This was an exact string match on the nine-name list, and it did its job:
    // appending the dead `PROVIDER_*_ENABLED` names to that list turned it red,
    // which is how the append got reviewed. But "these nine are removed" is the
    // property this file owns, and the list is shared with every other cleanup
    // the worker lane needs — pinning the literal makes an unrelated addition
    // look like an inference-boundary regression.
    //
    // Membership is also STRICTER than the substring match it replaces: it
    // parses the list, so a name that appeared only as a prefix of another
    // entry would no longer satisfy it.
    const removalMatch = workerStep.match(/TASK_CONFIGURATION_REMOVALS_JSON:\s*'(\[[^']*\])'/);
    expect(removalMatch).not.toBeNull();
    const removals: string[] = JSON.parse(removalMatch![1]);
    for (const name of [
      'ALIA_API_URL', 'OXY_API_URL', 'OXY_SERVICE_API_KEY', 'OXY_SERVICE_API_SECRET',
      'SINDI_OXY_SERVICE_API_KEY', 'SINDI_OXY_SERVICE_API_SECRET',
      'OXY_INFERENCE_ROUTING_PROFILE', 'OXY_INFERENCE_ROUTING_PROFILE_ID',
      'SINDI_ALIA_AGENT_ID',
    ]) {
      expect(removals).toContain(name);
    }

    // The names may occur only in the explicit removal list; they are never
    // supplied as environment values or SSM references to the worker.
    const workerWithoutRemovalList = workerStep.replace(
      /^\s*TASK_CONFIGURATION_REMOVALS_JSON:.*$/m,
      '',
    );
    for (const name of [
      'SINDI_ALIA_AGENT_ID',
      'ALIA_API_URL',
      'OXY_INFERENCE_ROUTING_PROFILE',
      'OXY_INFERENCE_ROUTING_PROFILE_ID',
      'OXY_SERVICE_API_KEY',
      'OXY_SERVICE_API_SECRET',
      'SINDI_OXY_SERVICE_API_KEY',
      'SINDI_OXY_SERVICE_API_SECRET',
      'OXY_API_URL',
    ]) {
      expect(workerWithoutRemovalList).not.toContain(name);
    }
  });

  it('merges environment and secret overrides into the inherited revision', () => {
    expect(deployScript).toContain('TASK_ENV_OVERRIDES_JSON="${TASK_ENV_OVERRIDES_JSON:-}"');
    expect(deployScript).toContain('--argjson taskEnvironmentOverrides');
    expect(deployScript).toContain('+ $taskEnvironmentOverrides');
    expect(deployScript).toContain('+ $taskSecretOverrides');
    expect(deployScript).toContain('TASK_CONFIGURATION_REMOVALS_JSON');

    // This drives the real renderer from a task carrying stale cross-channel
    // values and requires one exact env value plus one exact SSM reference.
    expect(deployScriptTest).toContain('run_release explicit-task-overrides');
    expect(deployScriptTest).toContain('task-env:value');
    expect(deployScriptTest).toContain('task-secret:arn');
    expect(deployScriptTest).toContain('task-removal:clean');
    expect(deployScriptTest).toContain('stale-plaintext');
  });

  it('does not introduce a direct upstream-provider credential', () => {
    const executableWorkflow = `${apiStep}\n${workerStep}`;
    expect(executableWorkflow).not.toMatch(
      /(?:OPENAI|ANTHROPIC|OPENROUTER|GROQ|CEREBRAS|XAI|ALIA)_API_KEY/,
    );
  });
});
