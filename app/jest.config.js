/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src", "<rootDir>/scripts"],
  testMatch: ["**/*.test.ts", "**/*.test.js"],
  testTimeout: 20000,
  setupFilesAfterEnv: ["<rootDir>/scripts/teacher-units-test-setup.js"],
  // Compact success output: print a PASS line per suite plus the final
  // pass/fail summary, not a line per test. Failures still render the full
  // suite/test name, assertion diff, code frame, stack location, and a
  // nonzero exit code. Jest auto-enables per-test verbosity when a single
  // test file is run, so targeted debugging is unaffected.
  verbose: false,
  // Local resource cap. Jest's default (CPU cores - 1) launched 9 workers per
  // run on a 16 GB laptop and, with a second suite running, froze the
  // machine. Two workers bounds memory for every caller (humans, agents, CI);
  // an explicit `--maxWorkers` on the command line still overrides it.
  maxWorkers: 2,
};
