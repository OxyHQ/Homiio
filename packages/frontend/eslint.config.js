// Minimal ESLint: ONLY the rules Biome does not implement. Biome
// (`biome.jsonc` at the repo root) owns formatting and every other lint rule,
// including the ones eslint-config-expo used to supply. Run both with
// `bun run lint` at the root; `bun run lint` here runs this file alone.
//
// The script is `expo lint .`, not bare `expo lint`: bare `expo lint` only
// walks `app/`, `components/` and `src/`, so it never read `config.ts` (where
// the `EXPO_PUBLIC_*` reads live), `hooks/` or `context/`. A destructured env
// read planted in `config.ts` passed bare `expo lint` and fails `expo lint .`.
const { defineConfig } = require('eslint/config');
const tsParser = require('@typescript-eslint/parser');
const expo = require('eslint-plugin-expo');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = defineConfig([
  {
    // Standalone, so it is a GLOBAL ignore. Attached to a config object that
    // also carries `rules`, `ignores` only exempts those files from THAT
    // object. `dist/**` rather than `dist/*` for the same reason a single `*`
    // stops at one level.
    ignores: ['dist/**', 'android/app/build'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  },
  {
    plugins: { expo, 'react-hooks': reactHooks },
    rules: {
      // `EXPO_PUBLIC_*` reads Metro can only inline when written out in full
      // (`process.env.EXPO_PUBLIC_X`). A destructured or computed read is
      // silently `undefined` in the bundle. Biome has no equivalent.
      'expo/no-env-var-destructuring': 'error',
      'expo/no-dynamic-env-var': 'error',
      'expo/use-dom-exports': 'error',

      // eslint-plugin-react-hooks v7's recommended set, minus exhaustive-deps,
      // which Biome's `useExhaustiveDependencies` now owns. The React Compiler
      // rules (`set-state-in-effect`, `immutability`, `refs`, `purity`, …) have
      // no Biome equivalent; see docs/cold-start.md for which of them are
      // genuine findings in an app that does not run the compiler.
      //
      // `rules-of-hooks` stays HERE at error even though Biome has
      // `useHookAtTopLevel`: Biome's rule also treats any member call named
      // `use*` as a hook (`scope.useCurrentLocation()` inside a callback), so
      // it can only run at warn here without false errors. This one keeps the
      // guard armed.
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'off',
    },
  },
]);
