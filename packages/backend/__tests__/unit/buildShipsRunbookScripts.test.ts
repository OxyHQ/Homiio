/**
 * Every CLI the Oxy Files runbook tells an operator to run must be in the
 * production image.
 *
 * `tsconfig.build.json` drops `scripts/` from `dist` and lists the few CLIs
 * that ship, and the runbook runs them as one-off ECS tasks of the API image
 * (`docs/oxy-files.md` § Rollout). `migratePrivateDocumentsToOxy.ts` was
 * written, tested and documented, and left off that list — so the step of the
 * rollout that runs it could only have died with "Module not found" in
 * production. This reads the runbook, not a second list.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

const backend = path.join(__dirname, '..', '..');

function shippedFiles(): string[] {
  const text = readFileSync(path.join(backend, 'tsconfig.build.json'), 'utf8');
  const parsed = ts.parseConfigFileTextToJson('tsconfig.build.json', text);
  if (parsed.error) throw new Error('tsconfig.build.json does not parse');
  return (parsed.config as { files?: string[] }).files ?? [];
}

function runbookScripts(): string[] {
  const runbook = readFileSync(path.join(backend, '..', '..', 'docs', 'oxy-files.md'), 'utf8');
  const named = new Set<string>();
  for (const match of runbook.matchAll(/scripts\/([A-Za-z0-9]+)\.ts/g)) {
    named.add(`scripts/${match[1]}.ts`);
  }
  return [...named].sort();
}

describe('the production build ships every Oxy Files runbook CLI', () => {
  it('names at least the bucket-move CLIs (the runbook still says what it runs)', () => {
    expect(runbookScripts()).toEqual(
      expect.arrayContaining([
        'scripts/cleanOrphanImages.ts',
        'scripts/migrateImagesToOxy.ts',
        'scripts/migratePrivateDocumentsToOxy.ts',
        'scripts/oxyFilesStatus.ts',
        'scripts/reconcileFileReferences.ts',
      ]),
    );
  });

  it.each(runbookScripts())('%s is compiled into dist', (script) => {
    expect(shippedFiles()).toContain(script);
  });
});
