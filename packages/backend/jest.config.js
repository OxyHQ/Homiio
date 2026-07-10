/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/__tests__/jest.setup.ts'],
  moduleNameMapper: {
    '^@homiio/shared-types$': '<rootDir>/../shared-types/src',
    '^@homiio/shared-types/(.*)$': '<rootDir>/../shared-types/src/$1',
    '^@homiio/listing-providers$': '<rootDir>/../listing-providers/src',
    '^@homiio/listing-providers/(.*)$': '<rootDir>/../listing-providers/src/$1',
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
  collectCoverageFrom: [
    'controllers/**/*.ts',
    'services/**/*.ts',
    'utils/**/*.ts',
    '!**/*.d.ts',
  ],
};
