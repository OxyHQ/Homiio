import { readFileSync, writeFileSync } from 'node:fs';
import { generateOpenApi } from '../packages/contracts/src/openapi';
const path = new URL('../docs/openapi.json', import.meta.url);
const generated = `${JSON.stringify(generateOpenApi(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== generated)
    throw new Error('OpenAPI is stale; run bun run generate:openapi');
} else writeFileSync(path, generated);
