/**
 * Exactly one legitimate production Hosting path.
 *
 * Production Hosting deploys only from the repository-root `firebase.json`,
 * whose two targets publish the curated artifacts (`app`: `dist/app-hosting`,
 * `marketing`: `dist/marketing`) built together by
 * `scripts/hosting-release/build-pair.cjs`. `platform/firebase/firebase.json` keeps a
 * Hosting block solely for the local UX-review emulator
 * (`scripts/ux-review/start.sh`), which serves the repository root. That block
 * must never be deployable: its Hosting `predeploy` hook refuses, and
 * firebase-tools runs every Hosting predeploy (for `deploy --only hosting` and
 * `hosting:channel:deploy`) before preparing, uploading, or releasing
 * anything. Emulators never run predeploy hooks.
 */

import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const FIREBASE_DIR = path.join(__dirname, "..");
const REPO_ROOT = path.join(FIREBASE_DIR, "..", "..");

type HostingConfig = {
  public?: string;
  predeploy?: string[];
  rewrites?: Array<{ source: string; destination: string }>;
  site?: string;
  target?: string;
};

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const platformConfig = readJson(path.join(FIREBASE_DIR, "firebase.json"));
const rootConfig = readJson(path.join(REPO_ROOT, "firebase.json"));

describe("platform/firebase/firebase.json Hosting is emulator-only", () => {
  const hosting: HostingConfig = platformConfig.hosting;

  test("firebase-tools' real Hosting predeploy lifecycle refuses this config", () => {
    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, "support", "hosting-predeploy-sim.cjs"), FIREBASE_DIR],
      { cwd: FIREBASE_DIR, encoding: "utf8" },
    );
    expect(JSON.parse(out).refused).toBe(true);
  });

  test("the predeploy guard refuses on its own, independent of the CLI's path checks", () => {
    expect(hosting.predeploy).toHaveLength(1);
    const result = spawnSync(hosting.predeploy?.[0] ?? "", { cwd: FIREBASE_DIR, shell: true, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("REFUSED");
    expect(result.stderr).toContain("repository-root firebase.json curated artifact");
  });

  test("keeps the local UX-review emulator behavior and names no deploy site or target", () => {
    expect(hosting.public).toBe("../..");
    expect(hosting.rewrites).toEqual([{ source: "/app/**", destination: "/app/index.html" }]);
    expect(hosting.site).toBeUndefined();
    expect(hosting.target).toBeUndefined();
  });
});

describe("the repository-root firebase.json is the one production Hosting path", () => {
  test("publishes only the two curated artifacts, built together by the pair build", () => {
    const hosting: HostingConfig[] = rootConfig.hosting;
    expect(hosting.map((entry) => entry.target)).toEqual(["app", "marketing"]);
    expect(hosting.map((entry) => entry.public)).toEqual(["dist/app-hosting", "dist/marketing"]);
    for (const entry of hosting) {
      expect(entry.site).toBeUndefined();
      expect(entry.predeploy).toEqual(["node scripts/hosting-release/build-pair.cjs"]);
    }
    expect(fs.existsSync(path.join(REPO_ROOT, "firebase.marketing.json"))).toBe(false);
  });

  test("both configs share the one Firestore indexes declaration", () => {
    expect(platformConfig.firestore.indexes).toBe("firestore.indexes.json");
    expect(rootConfig.firestore.indexes).toBe("platform/firebase/firestore.indexes.json");
  });
});
