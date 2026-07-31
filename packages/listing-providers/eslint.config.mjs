import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  {
    /**
     * Generated output, never source.
     *
     * `tsc` emits this package to `dist/`, but a misconfigured project elsewhere
     * in the workspace can pull `src/*.ts` into ITS program and, being unable to
     * map those files under its own `rootDir`, emit them right back next to the
     * sources. That has happened often enough for `.gitignore` to carry an entry
     * for it (see "Accidental tsc emit alongside listing-providers sources").
     *
     * Linting the result is never a real finding, and it makes the verdict
     * depend on whether somebody happened to build: the same commit measured 15
     * errors on a clean tree and 4,679 with those artifacts present. A gate that
     * swings by three orders of magnitude on build state is a gate nobody
     * believes.
     */
    ignores: ['dist/**', 'src/**/*.js', 'src/**/*.d.ts'],
  },
  js.configs.recommended,
  /**
   * Turns OFF the base rules TypeScript itself owns — `no-undef`, `no-redeclare`,
   * `no-dupe-class-members` and friends — and only for TypeScript files.
   *
   * Without it, `no-undef` from `js.configs.recommended` reports TYPES as
   * undefined globals: `RequestInit` and `RequestInfo` in `proxy.ts` and
   * `runtime.ts` accounted for 6 of this package's 15 errors, every one of them
   * false. Turning the rule off wholesale would have been the wrong fix — this
   * config is scoped to TypeScript files, so `no-undef` stays fully armed on
   * plain JavaScript, where nothing else checks for an undefined name.
   */
  typescript.configs['flat/eslint-recommended'],
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
];
