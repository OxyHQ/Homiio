// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  {
    // Standalone, so it is a GLOBAL ignore. Attached to a config object that
    // also carries `rules`, `ignores` only exempts those files from THAT
    // object. `dist/**` rather than `dist/*` for the same reason a single `*`
    // stops at one level.
    ignores: ['dist/**'],
  },
  expoConfig,
  {
    plugins: {
      'unused-imports': require('eslint-plugin-unused-imports'),
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          vars: 'all',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    /**
     * Jest's globals, in the only place they exist.
     *
     * `jest.setup.js` and the suites use `jest`, `describe`, `it` and `expect`,
     * and nothing told eslint where the tests are — so `no-undef` reported six
     * of them as undefined globals. The rule is right; the config had simply
     * never been told. Same fix #249 applied to the backend.
     */
    files: ['jest.setup.js', '**/__tests__/**/*.{ts,tsx,js,jsx}', '**/*.test.{ts,tsx,js,jsx}'],
    languageOptions: {
      globals: require('globals').jest,
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
