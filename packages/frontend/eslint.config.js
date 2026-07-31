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
]);
