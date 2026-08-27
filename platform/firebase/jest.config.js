/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.rules.test.ts"],
  testTimeout: 20000,
  // Compact success output: print a PASS line per suite plus the final
  // pass/fail summary, not a line per test. Failures still render the full
  // suite/test name, assertion diff, code frame, stack location, and a
  // nonzero exit code. Jest auto-enables per-test verbosity when a single
  // test file is run, so targeted debugging is unaffected.
  verbose: false,
  // The Rules test suites share a single Firestore emulator instance and
  // each suite calls clearFirestore in beforeEach. Running test files in
  // parallel would let one suite wipe another suite's seeded state
  // mid-test, so files must execute serially.
  maxWorkers: 1,
};
