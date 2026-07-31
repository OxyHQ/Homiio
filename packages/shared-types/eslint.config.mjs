import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  {
    /** Generated output — see the same block in listing-providers for why `src` is listed. */
    ignores: ['dist/**', 'src/**/*.js', 'src/**/*.d.ts'],
  },
  js.configs.recommended,
  /**
   * Turns off the base rules TypeScript owns (`no-undef`, `no-redeclare`, …) for
   * TypeScript files only, so the rule keeps reporting on plain JavaScript where
   * nothing else does. This package is clean either way today; it is here so the
   * three near-identical configs stop drifting — one of them missing this line
   * is exactly why `no-undef` was reporting `RequestInit` as an undefined global
   * in listing-providers.
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
