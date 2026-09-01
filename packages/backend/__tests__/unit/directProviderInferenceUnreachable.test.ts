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
  'packages/backend/services/aliaChatService.ts',
  'packages/backend/services/oxy.ts',
  'packages/backend/services/oxyInferenceService.ts',
];

describe('Homiio never reaches an inference provider directly', () => {
  it.each(files)('%s contains no direct provider client or provider credential env', (file) => {
    const source = readFileSync(join(REPOSITORY_ROOT, file), 'utf8');
    expect(source).not.toMatch(/@ai-sdk\/openai|OPENAI_(?:API_KEY|ORG_ID|MODEL)/);
  });

  it('keeps interactive Sindi chat on the Alia product boundary', () => {
    const route = readFileSync(join(REPOSITORY_ROOT, 'packages/backend/routes/ai.ts'), 'utf8');
    const source = readFileSync(
      join(REPOSITORY_ROOT, 'packages/backend/services/aliaChatService.ts'),
      'utf8',
    );
    expect(route).toContain('aliaChat.respondText');
    expect(route).not.toMatch(/feature:\s*['"]sindi-chat['"]/);
    expect(source).toContain('/v1/chat/completions');
    expect(source).toContain('agentId: this.#agentId');
    expect(source).toContain('Authorization: `Bearer ${input.accessToken}`');
    expect(source).not.toMatch(/ALIA_API_KEY|OPENAI_API_KEY/);
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
