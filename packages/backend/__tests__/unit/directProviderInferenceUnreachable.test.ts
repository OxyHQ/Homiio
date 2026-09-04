import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const fixedFiles = [
  'package.json',
  '.env.example',
  '.github/workflows/deploy-aws.yml',
  'packages/backend/.env.example',
  'packages/backend/package.json',
  'packages/frontend/.env.example',
  'packages/frontend/package.json',
];

function runtimeSources(relativeDirectory: string): string[] {
  const absoluteDirectory = join(REPOSITORY_ROOT, relativeDirectory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (['__tests__', 'dist', 'node_modules'].includes(entry.name)) return [];
      return runtimeSources(relativePath);
    }
    return /\.(?:c|m)?(?:j|t)sx?$/.test(entry.name) ? [relativePath] : [];
  });
}

const files = [
  ...fixedFiles.filter((file) => existsSync(join(REPOSITORY_ROOT, file))),
  ...runtimeSources('packages/backend'),
  ...runtimeSources('packages/frontend'),
];

const directProviderPatterns = [
  /(?:from\s+|require\(\s*|import\(\s*)['"](?:@ai-sdk\/(?:openai|anthropic|groq|xai|cerebras|openai-compatible)|openai|anthropic|@anthropic-ai\/sdk|groq-sdk|@openrouter\/[^'"]+|@xai\/[^'"]+|@cerebras\/cerebras_cloud_sdk|cerebras-cloud-sdk|@oxyhq\/relay|relay-sdk|xai)['"]\s*\)?/i,
  /"(?:@ai-sdk\/(?:openai|anthropic|groq|xai|cerebras|openai-compatible)|openai|anthropic|@anthropic-ai\/sdk|groq-sdk|@openrouter\/[^'"]+|@xai\/[^'"]+|@cerebras\/cerebras_cloud_sdk|cerebras-cloud-sdk|@oxyhq\/relay|relay-sdk|xai)"\s*:\s*"[~^]?\d/i,
  /(?:VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_|PUBLIC_)?(?:OPENAI|ANTHROPIC|GROQ|OPENROUTER|XAI|X_AI|CEREBRAS|RELAY)_(?:API_?KEYS?|SECRET|TOKEN|BASE_?URL|ORG_ID|MODEL(?:S|_ID)?)/,
  /ALIA_(?:API_KEY|PROVIDER_[A-Z0-9_]+|RELAY_[A-Z0-9_]+)/,
  /https:\/\/(?:api\.openai\.com|api\.anthropic\.com|api\.groq\.com|openrouter\.ai\/api|api\.x\.ai|api\.cerebras\.ai|relay\.oxy\.so|kaana\.oxy\.so)(?:[/'"]|$)/i,
] as const;

function directProviderMatches(source: string): boolean {
  return directProviderPatterns.some((pattern) => pattern.test(source));
}

describe('Homiio never reaches an inference provider directly', () => {
  it('contains no direct provider client, endpoint or provider credential env', () => {
    const violations = files.filter((file) => {
      const source = readFileSync(join(REPOSITORY_ROOT, file), 'utf8');
      return directProviderMatches(source);
    });
    expect(violations).toEqual([]);
  });

  it.each([
    "import OpenAI from 'openai'",
    "import Anthropic from '@anthropic-ai/sdk'",
    "const groq = require('groq-sdk')",
    "import('@openrouter/ai-sdk-provider')",
    "import { xai } from '@ai-sdk/xai'",
    "import { cerebras } from '@ai-sdk/cerebras'",
    "import Cerebras from '@cerebras/cerebras_cloud_sdk'",
    "import Relay from '@oxyhq/relay'",
    'EXPO_PUBLIC_OPENAI_API_KEY=secret',
    'ANTHROPIC_APIKEY=secret',
    'GROQ_TOKEN=secret',
    'OPENROUTER_BASE_URL=https://example.test',
    'XAI_MODEL=grok',
    'CEREBRAS_API_KEYS=secret',
    'RELAY_API_KEY=secret',
    'ALIA_PROVIDER_OPENAI_API_KEY=secret',
    'ALIA_RELAY_URL=https://relay.example.test',
    'https://api.openai.com/v1/chat/completions',
    'https://api.anthropic.com/v1/messages',
    'https://api.groq.com/openai/v1',
    'https://openrouter.ai/api/v1',
    'https://api.x.ai/v1',
    'https://api.cerebras.ai/v1',
    'https://relay.oxy.so/v1',
    'https://kaana.oxy.so/v1',
  ])('mutation gate catches direct provider/Relay variant: %s', (source) => {
    expect(directProviderMatches(source)).toBe(true);
  });

  it('keeps interactive Sindi chat on the Alia product boundary', () => {
    const route = readFileSync(join(REPOSITORY_ROOT, 'packages/backend/routes/ai.ts'), 'utf8');
    const source = readFileSync(
      join(REPOSITORY_ROOT, 'packages/backend/services/aliaChatService.ts'),
      'utf8',
    );
    expect(route).toContain('aliaChat.streamText');
    expect(route).toContain('for await (const text of stream)');
    expect(route).toContain('signal: upstreamAbort.signal');
    expect(route).toContain("req.once('aborted', abortUpstream)");
    expect(route).not.toMatch(/feature:\s*['"]sindi-chat['"]/);
    expect(source).toContain('/v1/chat/completions');
    expect(source).toContain('agentId: this.#agentId');
    expect(source).toContain('stream: true');
    expect(source).toContain('Authorization: `Bearer ${serviceToken}`');
    expect(source).toContain("'X-Oxy-User-Id': input.delegatedUserId");
    expect(source).not.toContain('input.accessToken');
    expect(route).not.toContain('getUserAccessToken');
    expect(route).toContain(
      "message.role === 'user' || message.role === 'assistant'",
    );
    expect(route).not.toContain(
      "const enhanced: ChatMessage[] = [{ role: 'system', content: SINDI_SYSTEM_PROMPT }",
    );
    expect(source).not.toMatch(
      /ALIA_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GROQ_API_KEY|OPENROUTER_API_KEY|XAI_API_KEY|CEREBRAS_API_KEY|RELAY_API_KEY/,
    );
  });

  it('never constructs the Kaana-only authorizedRoutes envelope', () => {
    const source = readFileSync(
      join(REPOSITORY_ROOT, 'packages/backend/services/oxyInferenceService.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/^\s*authorizedRoutes\s*:/m);
    expect(source).toContain('routingProfileId: this.#routingProfileId');
    expect(source).not.toMatch(/^\s*routingProfile\s*:/m);
  });
});
