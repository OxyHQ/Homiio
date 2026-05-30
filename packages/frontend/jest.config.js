/**
 * Jest configuration for the Homiio frontend (Expo 56 / React Native 0.85 /
 * React 19). This is the single source of truth — there is intentionally no
 * `"jest"` key in package.json.
 *
 * We rely on the `jest-expo` preset to wire up the Babel (`babel-jest`)
 * transform, the React Native module mappings, asset stubs and the jsdom-free
 * RN test environment. We do NOT register a `ts-jest` transform: the project is
 * compiled with `babel-preset-expo` (see babel.config.js), so `babel-jest`
 * already understands TS/TSX, JSX, Flow-typed RN core, NativeWind's JSX runtime
 * and Reanimated worklets. Adding `ts-jest` here would shadow the preset's
 * Babel transform and break on the untyped RN/Flow sources.
 *
 * `transformIgnorePatterns` REPLACES (does not merge with) the preset's array,
 * so this list is a superset: it mirrors jest-expo's own defaults and then adds
 * the ESM-shipping packages this app depends on (the `@oxyhq/*` scope — whose
 * `react-native` export condition resolves to raw `.ts` source — plus
 * NativeWind, its css-interop runtime, the `sonner-native` ESM build, and the
 * `nanoid` ESM module pulled in transitively by Bloom).
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Strip the `.native` extension when resolving react-native-worklets so its
  // mockable (non-native) build loads — required for the Reanimated 4 Jest mock
  // wired up in jest.setup.js. Shipped by react-native-worklets for this purpose.
  resolver: 'react-native-worklets/jest/resolver.js',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Mirror jest-expo's default ignore list, then allow-list the extra ESM/raw
  // packages we import so Babel transforms them instead of choking on `import`.
  transformIgnorePatterns: [
    '/node_modules/(?!(' +
      [
        '.pnpm',
        '(jest-)?react-native',
        '@react-native',
        '@react-native-community',
        'expo',
        '@expo',
        '@expo-google-fonts',
        'react-navigation',
        '@react-navigation',
        '@sentry/react-native',
        'native-base',
        // App-specific ESM / raw-source packages:
        '@oxyhq',
        'nativewind',
        'react-native-css-interop',
        'sonner-native',
        // ESM-only transitive deps that surface through the above packages.
        'nanoid',
      ].join('|') +
      '))',
    // Keep these excluded exactly as jest-expo does — transforming them breaks
    // the Reanimated/RN Babel plugins (they are part of the transformer itself).
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Resolve the `@/...` path alias declared in tsconfig.json / babel.config.js.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Only pick up our own specs; never descend into build output.
  testMatch: ['<rootDir>/__tests__/**/*.(test|spec).(ts|tsx)'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.expo/'],
};
