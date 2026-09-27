#!/usr/bin/env node
/*
 * Offline firebase-tools Hosting predeploy simulation (test support for
 * tests/firebase-config.rules.test.ts).
 *
 * Loads a Firebase config with firebase-tools' own Config loader and runs its
 * real Hosting "predeploy" lifecycle hook - the first step every
 * `firebase deploy --only hosting` and `firebase hosting:channel:deploy`
 * executes, before anything is prepared, uploaded, or released. No deploy
 * code, network, or credentials are involved.
 *
 * Input (argv[2]): directory containing firebase.json.
 * Output: JSON { refused: boolean, message: string }; exit 0 either way.
 */
"use strict";

const path = require("path");
const { Config } = require("firebase-tools/lib/config.js");
const { lifecycleHooks } = require("firebase-tools/lib/deploy/lifecycleHooks.js");

async function run() {
  const dir = path.resolve(process.argv[2]);
  const config = Config.load({ cwd: dir, configPath: "firebase.json" });
  const options = { config, cwd: dir, only: "hosting", project: "demo-guard-check", projectId: "demo-guard-check" };
  try {
    await lifecycleHooks("hosting", "predeploy")({}, options);
    process.stdout.write(JSON.stringify({ refused: false, message: "" }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ refused: true, message: String(err && err.message ? err.message : err) }));
  }
}

run().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err));
  process.exit(2);
});
