/**
 * @jest-environment node
 */
import * as fs from "fs";
import * as path from "path";

import { getFlatResources } from "./resourceProjection";

// U1B drift guard. The `teacherUnitsSetResources` callable validates
// membership against a server copy of the RA-1 `unitPlaceable` ids
// (platform/functions/src/teacherUnits/unit-placeable-resources.json),
// because Functions cannot import the client curriculum. This test keeps
// that copy identical to the live projection, order included, so a
// registry change that alters placement fails `npm run verify` until the
// server copy is regenerated. Contract: docs/platform/TEACHER_UNITS.md.

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const serverManifestPath = path.join(
  repoRoot,
  "platform",
  "functions",
  "src",
  "teacherUnits",
  "unit-placeable-resources.json",
);

type ServerManifest = { description: string; resourceIds: string[] };

function readServerManifest(): ServerManifest {
  return JSON.parse(fs.readFileSync(serverManifestPath, "utf8")) as ServerManifest;
}

describe("U1B server unit-placeable manifest", () => {
  it("equals the RA-1 unitPlaceable projection, in canonical order", () => {
    const expected = getFlatResources()
      .filter((r) => r.unitPlaceable)
      .map((r) => r.id);
    const actual = readServerManifest().resourceIds;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `unit-placeable-resources.json is out of date with the RA-1 projection. Replace its "resourceIds" with:\n${JSON.stringify(expected, null, 2)}`,
      );
    }
  });

  it("keeps the approved placement decisions", () => {
    const ids = new Set(readServerManifest().resourceIds);
    // Placeable but not assignable.
    expect(ids.has("simulation-gravity-wells")).toBe(true);
    // Reusable tools and gated resources are never placeable.
    for (const r of getFlatResources()) {
      if (r.kind === "tool" || r.gated) expect(ids.has(r.id)).toBe(false);
    }
  });
});
