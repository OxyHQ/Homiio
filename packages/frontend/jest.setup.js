/**
 * Global Jest setup (runs after the test framework is installed).
 *
 * React Native Reanimated 4 + Worklets need to be mocked under Jest: their
 * real modules call into a native Worklets runtime that doesn't exist in the
 * Node test environment. We use Reanimated's own official Jest mock and its
 * `setUpTests()` helper (which installs the animated-style matchers). Paired
 * with `resolver: 'react-native-worklets/jest/resolver.js'` in jest.config.js
 * — which strips the `.native` extension so Worklets resolves its mockable
 * build — this lets any component that transitively imports Reanimated (most of
 * the app, via Bloom's dialog/bottom-sheet) render in tests.
 */
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

require('react-native-reanimated').setUpTests();

/**
 * @react-native-async-storage/async-storage requires a native module that does
 * not exist in the Node/Jest environment. Use the official in-memory mock so
 * any module that transitively imports AsyncStorage (e.g. @oxyhq/core's
 * platformCrypto on the react-native code path) does not throw at load time.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

/**
 * Report fonts as already loaded so components that mount Bloom typography
 * (everything under BloomThemeProvider) don't trigger expo-font's async
 * `loadAsync().then(setLoaded)` after the synchronous test render — which would
 * otherwise log an "update was not wrapped in act(...)" warning. We keep every
 * other expo-font export intact and only stub the `useFonts` hook.
 */
jest.mock('expo-font', () => {
  const actual = jest.requireActual('expo-font');
  return {
    ...actual,
    useFonts: () => [true, null],
  };
});
