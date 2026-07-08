/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.rules.test.ts"],
  testTimeout: 20000,
  verbose: true,
  // The Rules test suites share a single Firestore emulator instance and
  // each suite calls clearFirestore in beforeEach. Running test files in
  // parallel would let one suite wipe another suite's seeded state
  // mid-test, so files must execute serially.
  maxWorkers: 1,
};
