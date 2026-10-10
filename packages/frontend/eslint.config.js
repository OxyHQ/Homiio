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
  {
    /**
     * `react-hooks/immutability` off for this ONE file, because its premise is
     * not true here.
     *
     * The rule guards a React Compiler transformation. **This app does not run
     * the React Compiler** — there is no `experiments.reactCompiler` in
     * `app.config.js`, and the built web bundle contains no compiler output on
     * Homiio's own code (the only `useMemoCache` references in it are React's
     * internal `__COMPILER_RUNTIME` export and dispatcher table).
     * `eslint-plugin-react-hooks` v7 runs the rule statically either way.
     *
     * What it reports here is five `sharedValue.value = …` writes. A
     * `useSharedValue` handle is stable by design and mutating `.value` is
     * Reanimated's documented API — and specifically the form
     * `~/Oxy/AGENTS.md` PRESCRIBES: drive the shared value imperatively and let
     * `useAnimatedStyle` only READ it, because returning `withTiming` from a
     * mapper silently fails on web. Every shared-value write in this file (19 of
     * them, checked) is inside a `useEffect`, a `useCallback` or a
     * `useAnimatedScrollHandler` worklet; **none is during render**, and no
     * `useAnimatedStyle` in the file writes.
     *
     * What this exemption does NOT cover, measured rather than assumed: the rule
     * does not report render-phase shared-value writes in the first place. Its
     * subject is "a value used previously in an effect function or as an effect
     * dependency". A render-phase `sharedValue.value = …` added to this file
     * with the rule ON produced no new error, and the same probe in
     * `PageScrollView.tsx` produced none either. So switching it off here gives
     * up the five prescribed-pattern findings and nothing else — do not read it
     * as sanctioning a render-phase write, which no rule here is watching for.
     *
     * REVISIT IF THE COMPILER IS ENABLED. Turning on
     * `experiments.reactCompiler` flips the premise and this exemption has to be
     * re-argued from scratch — see the note beside `experiments` in
     * `app.config.js`. Note also that `~/AGENTS.md`'s compiler hazard is about
     * READING external mutable state from a memoized position, where the
     * compiler freezes the first value forever. That is a different failure from
     * writing, and this exemption must not be widened to cover it.
     */
    files: ['components/SindiExplanationBottomSheet.tsx'],
    rules: {
      'react-hooks/immutability': 'off',
    },
  },
]);
