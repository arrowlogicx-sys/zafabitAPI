module.exports = {
  testEnvironment: 'node',
  verbose: true,
  testTimeout: 30000,
  moduleNameMapper: {
    '^uuid$': '<rootDir>/src/tests/mocks/uuid.js',
  },
};
