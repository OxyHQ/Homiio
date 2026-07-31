import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  {
    /**
     * Compiled output, not source.
     *
     * This package lints `.` rather than `src`, and eslint 9's flat config does
     * NOT skip `dist/` on its own. Without this the same commit reports 344
     * errors on a clean tree and 606 after `bun run build` — 262 of them inside
     * emitted `.js`/`.d.ts` that no one wrote. A gate whose verdict depends on
     * whether somebody happened to build is a gate that gets switched off.
     *
     * Hand-written declarations under `types/` are deliberately NOT ignored;
     * only generated output is.
     */
    ignores: ['dist/**'],
  },
  js.configs.recommended,
  /**
   * Turns OFF the base rules TypeScript itself owns — `no-undef`, `no-redeclare`
   * and friends — for TypeScript files only.
   *
   * `no-undef` cannot see a type, so it reports `RequestInfo`, `RequestInit`,
   * `NodeJS` and the `Express` namespace as undefined globals. Scoping matters
   * here and is the whole point: `scripts/migrate-addresses.js` has four
   * genuinely undefined `Property` references, and this config leaves the rule
   * fully armed on plain JavaScript so those stay reported. Switching `no-undef`
   * off outright would have silenced them.
   */
  typescript.configs['flat/eslint-recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      ...typescript.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    /**
     * Jest's globals, in the only place they exist.
     *
     * Without this every `describe`, `it`, `expect` and `jest` in the suite is a
     * `no-undef` error — hundreds of them, all false, drowning the real findings
     * in the same output. The rule is right and the config was simply never told
     * where the tests are.
     */
    files: ['**/__tests__/**/*.ts', '**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];
