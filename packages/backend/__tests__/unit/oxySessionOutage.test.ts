import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

it('fails protected requests during an issuer outage and accepts the same session after recovery', () => {
  const result = spawnSync(
    'bun',
    ['--no-env-file', resolve('__tests__/fixtures/oxy-session-outage-probe.ts')],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
      },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Oxy session probe failed: ${result.error?.message ?? result.stderr}`);
  }
  expect(result.error).toBeUndefined();
  const receipt = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as {
    controls: number;
    validations: number;
    admitted: number;
    nonLoopbackRequests: number;
  };
  expect(receipt.controls).toBe(4);
  expect(receipt.validations).toBeGreaterThanOrEqual(7);
  expect(receipt.admitted).toBe(4);
  expect(receipt.nonLoopbackRequests).toBe(0);
}, 45000);
