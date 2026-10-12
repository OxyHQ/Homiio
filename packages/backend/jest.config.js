const { computeMaxWorkers } = require('./jest.workerCount.cjs');

// Global setup provisions exactly one throwaway Postgres database per worker, so
// this number and the one it computes must come from the same place — a worker
// jest forks past the end of the manifest would fail on a database that was
// never created. See jest.workerCount.cjs.
const MAX_WORKERS = computeMaxWorkers();

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  testTimeout: 30000,
  maxWorkers: MAX_WORKERS,
  workerIdleMemoryLimit: '512MB',
  // Provisions one throwaway, fully-migrated Postgres database per worker, then
  // drops them all. A reachable Postgres is a HARD prerequisite of this suite —
  // see jest.globalSetup.ts for why skipping is not an option.
  globalSetup: '<rootDir>/jest.globalSetup.ts',
  globalTeardown: '<rootDir>/jest.globalTeardown.ts',
  // jest.setupHostRealmSymbols.cjs: Node 22's Symbol.dispose is per-realm; see
  // that file for why undici's real fetch needs it inside the sandbox.
  setupFiles: [
    '<rootDir>/jest.setupHostRealmSymbols.cjs',
    '<rootDir>/jest.setupWorkerDatabase.cjs',
  ],
  setupFilesAfterEnv: ['<rootDir>/__tests__/jest.setup.ts'],
  moduleNameMapper: {
    '^@homiio/shared-types$': '<rootDir>/../shared-types/src',
    '^@homiio/shared-types/(.*)$': '<rootDir>/../shared-types/src/$1',
    '^@homiio/listing-providers$': '<rootDir>/../listing-providers/dist/index.js',
    '^@homiio/listing-providers/(.*)$': '<rootDir>/../listing-providers/dist/$1.js',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'bundler',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          resolveJsonModule: true,
          isolatedModules: true,
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
  collectCoverageFrom: ['controllers/**/*.ts', 'services/**/*.ts', 'utils/**/*.ts', '!**/*.d.ts'],
};
