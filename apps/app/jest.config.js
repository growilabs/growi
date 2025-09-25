// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

const MODULE_NAME_MAPPING = {
  '^\\^/(.+)$': '<rootDir>/$1',
  '^~/(.+)$': '<rootDir>/src/$1',
};

module.exports = {
  // Indicates whether each individual test should be reported during the run
  verbose: true,

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],

  projects: [
    {
      displayName: 'server',

      transform: {
        '^.+\\.(t|j)sx?$': '@swc-node/jest',
      },

      rootDir: '.',
      roots: ['<rootDir>'],
      testMatch: [
        '<rootDir>/test/integration/**/*.test.ts',
        '<rootDir>/test/integration/**/*.test.js',
      ],
      // https://regex101.com/r/jTaxYS/1
      modulePathIgnorePatterns: [
        '<rootDir>/test/integration/*.*/v5(..*)*.[t|j]s',
      ],
      testEnvironment: 'node',
      globalSetup: '<rootDir>/test/integration/global-setup.js',
      globalTeardown: '<rootDir>/test/integration/global-teardown.js',
      setupFilesAfterEnv: ['<rootDir>/test/integration/setup.js'],

      // Automatically clear mock calls and instances between every test
      clearMocks: true,
      moduleNameMapper: MODULE_NAME_MAPPING,
    },
    {
      displayName: 'server-v5',

      transform: {
        '^.+\\.(t|j)sx?$': '@swc-node/jest',
      },

      rootDir: '.',
      roots: ['<rootDir>'],
      testMatch: [
        '<rootDir>/test/integration/**/v5.*.test.ts',
        '<rootDir>/test/integration/**/v5.*.test.js',
      ],

      testEnvironment: 'node',
      globalSetup: '<rootDir>/test/integration/global-setup.js',
      globalTeardown: '<rootDir>/test/integration/global-teardown.js',
      setupFilesAfterEnv: ['<rootDir>/test/integration/setup.js'],

      // Automatically clear mock calls and instances between every test
      clearMocks: true,
      moduleNameMapper: MODULE_NAME_MAPPING,
    },
  ],

  // Automatically clear mock calls and instances between every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: true,

  // An array of glob patterns indicating a set of files for which coverage information should be collected
  // collectCoverageFrom: undefined,

  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',

  // An array of regexp pattern strings used to skip coverage collection
  coveragePathIgnorePatterns: [
    'index.ts',
    '/config/',
    '/resource/',
    '/node_modules/',
  ],
};
