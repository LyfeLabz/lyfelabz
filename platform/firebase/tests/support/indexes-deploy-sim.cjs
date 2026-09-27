#!/usr/bin/env node
/*
 * Offline firebase-tools Firestore index deploy simulation (test support for
 * tests/firestore-indexes.rules.test.ts).
 *
 * Runs the repository's own firebase-tools `FirestoreApi.deploy` decision
 * logic with every network client call stubbed to RECORD instead of execute,
 * against caller-supplied production-shaped field overrides. It runs in plain
 * Node (firebase-tools' dependency graph does not load under Jest's module
 * system). Nothing is ever sent to Firebase.
 *
 * Input (argv[2]): JSON { specPath, project, force, existingFields }.
 * Output (stdout): JSON { valid: true, calls: ["PATCH <url>", ...] }.
 */
"use strict";

const fs = require("fs");
const { FirestoreApi } = require("firebase-tools/lib/firestore/api.js");
const utils = require("firebase-tools/lib/utils.js");

async function run() {
  const input = JSON.parse(process.argv[2]);
  const api = new FirestoreApi();
  const calls = [];
  const record = (method) => async (url) => {
    calls.push(`${method} ${url}`);
    return { body: {} };
  };
  api.apiClient = {
    patch: record("PATCH"),
    delete: record("DELETE"),
    post: record("POST"),
    get: async () => {
      throw new Error("network access is not allowed in this simulation");
    },
  };
  api.getDatabase = async () => ({ databaseEdition: "STANDARD" });
  api.listIndexes = async () => [];
  api.listFieldOverrides = async () => input.existingFields;
  utils.logLabeledBullet = () => undefined;
  utils.logBullet = () => undefined;

  const spec = api.upgradeOldSpec(JSON.parse(fs.readFileSync(input.specPath, "utf8")));
  api.validateSpec(spec);
  await api.deploy(
    { project: input.project, nonInteractive: true, force: input.force },
    spec.indexes,
    spec.fieldOverrides,
  );
  process.stdout.write(JSON.stringify({ valid: true, calls }));
}

run().catch((err) => {
  process.stderr.write(String(err && err.message ? err.message : err));
  process.exit(1);
});
