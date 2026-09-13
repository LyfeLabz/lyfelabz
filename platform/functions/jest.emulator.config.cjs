/** @type {import('jest').Config} */
// Emulator-backed test config (Phase 8G.12A). Runs ONLY `*.emulator.test.ts`
// files, which exercise real firebase-admin Firestore transaction and
// concurrency semantics against the Firestore emulator. Launched via
// `npm run test:emulator`, which wraps this in `firebase emulators:exec` so
// FIRESTORE_EMULATOR_HOST is set. Run in-band so the shared admin app and
// emulator connection are deterministic.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.emulator.test.ts"],
  testTimeout: 30000,
  verbose: false,
};
