/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src", "<rootDir>/scripts"],
  testMatch: ["**/*.test.ts", "**/*.test.js"],
  testTimeout: 20000,
  // Compact success output: print a PASS line per suite plus the final
  // pass/fail summary, not a line per test. Failures still render the full
  // suite/test name, assertion diff, code frame, stack location, and a
  // nonzero exit code. Jest auto-enables per-test verbosity when a single
  // test file is run, so targeted debugging is unaffected.
  verbose: false,
};
