import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const files = [
  'bun.lock',
  'docs/architecture.mdx',
  'docs/deployment.mdx',
  'docs/getting-started.mdx',
  'docs/index.mdx',
  'packages/backend/.env.example',
  'packages/backend/README.md',
  'packages/backend/package.json',
  'packages/backend/config.ts',
  'packages/backend/routes/ai.ts',
  'packages/backend/services/oxy.ts',
  'packages/backend/services/oxyInferenceService.ts',
];

describe('Sindi reaches providers only through the Oxy inference edge', () => {
  it.each(files)('%s contains no direct provider client or provider credential env', (file) => {
    const source = readFileSync(join(REPOSITORY_ROOT, file), 'utf8');
    expect(source).not.toMatch(/@ai-sdk\/openai|OPENAI_(?:API_KEY|ORG_ID|MODEL)/);
  });

  it('never constructs the Kaana-only authorizedRoutes envelope', () => {
    const source = readFileSync(
      join(REPOSITORY_ROOT, 'packages/backend/services/oxyInferenceService.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/^\s*authorizedRoutes\s*:/m);
    expect(source).toContain('routingProfile: this.#routingProfile');
  });
});
