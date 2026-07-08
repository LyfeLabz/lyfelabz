/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.rules.test.ts"],
  testTimeout: 20000,
  verbose: true,
};
