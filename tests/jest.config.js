/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>'],
  // TheCycle tests run on node:test (npm run test:thecycle).
  testPathIgnorePatterns: ['/node_modules/', '/tests/thecycle-'],
  moduleFileExtensions: ['js', 'json'],
  setupFilesAfterEnv: ['<rootDir>/setupEnv.js']
};
