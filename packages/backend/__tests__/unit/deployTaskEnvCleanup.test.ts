/**
 * Terraform deleted 22 variables and production kept all 22.
 *
 * oxy-infra #217 removed every `PROVIDER_*_ENABLED` from the worker task
 * definition. Measured on live revision 175, weeks later: **all 22 still
 * there**. `deploy-ecs-image.sh` renders each new revision from
 * `services[0].taskDefinition` — the revision that is LIVE — so a variable
 * terraform stops declaring is carried forward by the next deploy and every
 * deploy after it. Terraform describes the task definition; the deploy does
 * not read that description.
 *
 * That is the same shape as the `RUN_MIGRATIONS` defect
 * (`deployMigrationWiring.test.ts`): a change lands in the place that looks
 * authoritative, nothing consumes it, and every run is green.
 *
 * The escape hatch the script already provides is
 * `TASK_CONFIGURATION_REMOVALS_JSON`, and it had a cap of 20 while the cleanup
 * needs 31. A cap that silently refuses the list would leave the variables in
 * place and fail the deploy — so the cap and the list are asserted TOGETHER
 * here, because they are one mechanism split across two files.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const workflow = readFileSync(join(REPOSITORY_ROOT, '.github/workflows/deploy-aws.yml'), 'utf8');
const script = readFileSync(join(REPOSITORY_ROOT, '.github/scripts/deploy-ecs-image.sh'), 'utf8');

/** Every `TASK_CONFIGURATION_REMOVALS_JSON` list declared in the workflow. */
function removalLists(): string[][] {
  const lists: string[][] = [];
  const pattern = /TASK_CONFIGURATION_REMOVALS_JSON:\s*'(\[[^']*\])'/g;
  for (const match of workflow.matchAll(pattern)) lists.push(JSON.parse(match[1]));
  return lists;
}

/**
 * The `length <= N` bound the script applies to the removals array.
 *
 * Located by walking BACK from the here-string that feeds the guard, because
 * `length <= N` appears three times in the file — once per validated variable —
 * and anchoring on the first match reads the override maps' bound instead. The
 * first draft of this helper did exactly that and the test failed, which is the
 * only reason it is written this way.
 */
function removalCap(): number {
  const fedFrom = script.indexOf('<<<"$TASK_CONFIGURATION_REMOVALS_JSON"');
  if (fedFrom === -1) throw new Error('no guard reads TASK_CONFIGURATION_REMOVALS_JSON');
  const guard = script.slice(0, fedFrom);
  const bounds = [...guard.matchAll(/length <= (\d+)/g)];
  if (bounds.length === 0) throw new Error('the removals guard no longer declares a length bound');
  return Number(bounds[bounds.length - 1][1]);
}

/** The worker lane is the one that carried the provider flags. */
function workerRemovals(): string[] {
  const lists = removalLists();
  const worker = lists.find((list) => list.some((name) => name.startsWith('PROVIDER_')));
  if (!worker) throw new Error('no lane removes the PROVIDER_* flags');
  return worker;
}

describe('the worker task definition is cleaned of dead provider flags', () => {
  it('removes every PROVIDER_*_ENABLED that revision 175 carried', () => {
    // The exact 22 read off the live task definition on 2026-09-22. Named one
    // by one rather than matched by prefix: the removal list is literal, and a
    // prefix test here would pass against a list that had lost half of them.
    const expected = [
      'APARTMENTS_COM', 'BLUEGROUND', 'DAFT', 'FOTOCASA', 'HABITACLIA', 'IDEALISTA',
      'IMMOBILIENSCOUT24', 'IMMOWEB', 'IMMOWELT', 'INDOMIO', 'KLEINANZEIGEN',
      'MERCADOLIBRE_AR', 'MERCADOLIBRE_MX', 'MILANUNCIOS', 'ONTHEMARKET', 'OPENRENT',
      'OTODOM', 'PISOS', 'RIGHTMOVE', 'YAENCONTRE', 'ZILLOW', 'ZOOPLA',
    ].map((provider) => `PROVIDER_${provider}_ENABLED`);

    const removals = workerRemovals();
    for (const name of expected) expect(removals).toContain(name);
    expect(expected).toHaveLength(22);
  });

  it('keeps the removals it already had', () => {
    // The provider flags were APPENDED. Dropping one of the Oxy/Alia names
    // while adding them would leave a credential variable on a task definition
    // that has no business carrying it, and nothing else would notice.
    const removals = workerRemovals();
    for (const name of [
      'ALIA_API_URL', 'OXY_API_URL', 'OXY_SERVICE_API_KEY', 'OXY_SERVICE_API_SECRET',
      'SINDI_OXY_SERVICE_API_KEY', 'SINDI_OXY_SERVICE_API_SECRET',
      'OXY_INFERENCE_ROUTING_PROFILE', 'OXY_INFERENCE_ROUTING_PROFILE_ID',
      'SINDI_ALIA_AGENT_ID',
    ]) {
      expect(removals).toContain(name);
    }
  });

  it('fits the bound the script enforces, which is the half that fails at runtime', () => {
    // THE POINT OF THIS FILE. The list lives in YAML, the bound lives in a
    // shell script, and nothing but a real deploy puts them in the same room.
    // Over the bound, the script exits 1 with
    // `TASK_CONFIGURATION_REMOVALS_JSON must be an array of unique environment
    // variable names` — a message that names neither the length nor the cap.
    for (const list of removalLists()) {
      expect(list.length).toBeLessThanOrEqual(removalCap());
    }
  });

  it('declares no name twice, which the script also refuses', () => {
    for (const list of removalLists()) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('never removes a variable the same lane overrides', () => {
    // The script refuses this combination outright. Cheaper to catch here than
    // in the middle of a production rollout.
    const overridden = [...workflow.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*"?\$\{\{/gm)].map((m) => m[1]);
    for (const name of workerRemovals()) {
      if (name.startsWith('PROVIDER_')) expect(overridden).not.toContain(name);
    }
  });
});
