/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  // Emulator-backed tests (`*.emulator.test.ts`) require the Firestore
  // emulator and are run separately via `npm run test:emulator`
  // (`firebase emulators:exec ... jest --config jest.emulator.config.cjs`).
  // They are excluded from the default unit run so `npm test` stays
  // hermetic and green without the emulator.
  testPathIgnorePatterns: ["/node_modules/", "\\.emulator\\.test\\.ts$"],
  testTimeout: 20000,
  // Compact success output: print a PASS line per suite plus the final
  // pass/fail summary, not a line per test. Failures still render the full
  // suite/test name, assertion diff, code frame, stack location, and a
  // nonzero exit code. Jest auto-enables per-test verbosity when a single
  // test file is run, so targeted debugging is unaffected.
  verbose: false,
};
