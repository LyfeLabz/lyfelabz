import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

import {
  ASSIGNMENT_RESOURCE_TYPES,
  DEFAULT_ASSIGNMENT_RESOURCE_TYPE,
  RESERVED_ACTIVITY_ID_PREFIXES,
  assertActivityIdMatchesResourceType,
  assertAssignableActivity,
  isResourceTypeAssignable,
  parseAssignmentResourceType,
  reservedResourceTypeForActivityId,
} from "./activity-identifiers";
import type { AssignmentResourceType } from "./types/assignment";

// Resource Expansion Phase 1 - the activity-identifier contract. The
// build-side mapping (app/scripts/activityIdentifiers.cjs, dependency-free)
// and the generated curriculum manifest are loaded directly so the server
// verifier cannot drift from the registry it verifies.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

type Tooling = {
  ACTIVITY_RESOURCE_TYPES: readonly string[];
  RESERVED_ACTIVITY_ID_PREFIXES: Readonly<Record<string, string>>;
  activityIdForResource(type: string, filename: string): string | null;
  reservedTypeForActivityId(activityId: string): string | null;
};

type ManifestResource = { readonly type: string; readonly filename: string };
type Manifest = {
  readonly topicGroups: ReadonlyArray<{
    readonly units: ReadonlyArray<{
      readonly slug: string;
      readonly resources: ReadonlyArray<ManifestResource>;
    }>;
  }>;
};

function loadTooling(): Tooling {
  const req = createRequire(__filename);
  return req(path.join(REPO_ROOT, "app", "scripts", "activityIdentifiers.cjs")) as Tooling;
}

function readJson<T>(...segments: string[]): T {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...segments), "utf8")) as T;
}

function code(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

describe("activity identifiers: resourceType", () => {
  it('defaults a missing resourceType to "lesson"', () => {
    expect(DEFAULT_ASSIGNMENT_RESOURCE_TYPE).toBe("lesson");
    expect(parseAssignmentResourceType(undefined)).toBe("lesson");
  });

  it("accepts every supported type and rejects anything else", () => {
    for (const t of ASSIGNMENT_RESOURCE_TYPES) expect(parseAssignmentResourceType(t)).toBe(t);
    for (const bad of ["game", "tool", "activity", "LESSON", "", null, 1, {}, "__proto__"]) {
      expect(code(() => parseAssignmentResourceType(bad))).toBe("assignments.invalidResourceType");
    }
  });

  it("only lessons are assignable", () => {
    expect(ASSIGNMENT_RESOURCE_TYPES.filter(isResourceTypeAssignable)).toEqual(["lesson"]);
  });
});

describe("activity identifiers: grammar", () => {
  it("existing lesson slugs (including legacy-shaped ones) remain valid lessons", () => {
    for (const slug of ["gravity", "what-is-life", "earths-layers", "lesson_g7_earths-layers", "staging-cert-fixture"]) {
      expect(code(() => assertAssignableActivity(slug, "lesson"))).toBeUndefined();
    }
  });

  it("accepts well-formed resource identifiers for their own type", () => {
    const cases: Array<[string, AssignmentResourceType]> = [
      ["simulation-gravity-wells", "simulation"],
      ["investigation-protein-pathway", "investigation"],
      ["investigation-amplitude-challenge", "investigation"],
      ["extension-fossil-hunt", "extension"],
      ["challenge-welcome-to-floatia", "challenge"],
      ["simulation-3d", "simulation"],
    ];
    for (const [id, type] of cases) {
      expect(reservedResourceTypeForActivityId(id)).toBe(type);
      expect(code(() => assertActivityIdMatchesResourceType(id, type))).toBeUndefined();
    }
  });

  it("rejects malformed resource identifiers", () => {
    for (const id of [
      "simulation-",
      "simulation-Gravity",
      "simulation-gravity_wells",
      "simulation-gravity--wells",
      "simulation-gravity-",
      "simulation-gravity.wells",
      `simulation-${"a".repeat(118)}`,
    ]) {
      expect(code(() => assertActivityIdMatchesResourceType(id, "simulation"))).toBe(
        "assignments.invalidLessonSlug",
      );
    }
    expect(code(() => assertActivityIdMatchesResourceType(`simulation-${"a".repeat(117)}`, "simulation"))).toBeUndefined();
  });

  it("rejects every type/identifier disagreement", () => {
    expect(code(() => assertActivityIdMatchesResourceType("simulation-gravity-wells", "lesson"))).toBe(
      "assignments.resourceTypeMismatch",
    );
    expect(code(() => assertActivityIdMatchesResourceType("gravity", "simulation"))).toBe(
      "assignments.resourceTypeMismatch",
    );
    expect(code(() => assertActivityIdMatchesResourceType("investigation-protein-pathway", "simulation"))).toBe(
      "assignments.resourceTypeMismatch",
    );
    // A bare type word is not a reserved prefix use; it is a lesson slug.
    expect(reservedResourceTypeForActivityId("simulation")).toBeUndefined();
    expect(code(() => assertActivityIdMatchesResourceType("simulation", "simulation"))).toBe(
      "assignments.resourceTypeMismatch",
    );
  });

  it("keeps a consistent non-lesson activity unassignable", () => {
    expect(code(() => assertAssignableActivity("simulation-gravity-wells", "simulation"))).toBe(
      "assignments.resourceTypeNotAssignable",
    );
  });
});

describe("activity identifiers: build tooling and curriculum parity", () => {
  const tooling = loadTooling();
  const manifest = readJson<Manifest>("app", "src", "curriculum", "curriculum.manifest.json");
  const policy = readJson<{ types: Record<string, unknown> }>(
    "app", "src", "curriculum", "curriculum.resource-types.json",
  );

  it("declares the same resource types and reserved prefixes as the build tooling", () => {
    expect([...tooling.ACTIVITY_RESOURCE_TYPES]).toEqual([...ASSIGNMENT_RESOURCE_TYPES]);
    expect({ ...tooling.RESERVED_ACTIVITY_ID_PREFIXES }).toEqual({ ...RESERVED_ACTIVITY_ID_PREFIXES });
    for (const t of ASSIGNMENT_RESOURCE_TYPES) expect(Object.keys(policy.types)).toContain(t);
  });

  it("agrees with the build tooling on identifier classification", () => {
    for (const id of ["gravity", "simulation-x", "investigation-x", "extension-x", "challenge-x", "simulation", "sim-x", "lesson-x"]) {
      expect(tooling.reservedTypeForActivityId(id) ?? undefined).toBe(reservedResourceTypeForActivityId(id));
    }
  });

  it("maps every registry activity to a unique identifier the server verifies as its own type", () => {
    const seen = new Map<string, string>();
    const counts: Record<string, number> = {};
    for (const group of manifest.topicGroups) {
      for (const unit of group.units) {
        expect(reservedResourceTypeForActivityId(unit.slug)).toBeUndefined();
        for (const r of unit.resources) {
          if (!(ASSIGNMENT_RESOURCE_TYPES as readonly string[]).includes(r.type)) continue;
          const type = r.type as AssignmentResourceType;
          const id = tooling.activityIdForResource(type, r.filename);
          expect(id).not.toBeNull();
          const activityId = id as string;
          if (type === "lesson") expect(activityId).toBe(unit.slug);
          expect(code(() => assertActivityIdMatchesResourceType(activityId, type))).toBeUndefined();
          for (const other of ASSIGNMENT_RESOURCE_TYPES) {
            if (other === type) continue;
            expect(code(() => assertActivityIdMatchesResourceType(activityId, other))).toBe(
              "assignments.resourceTypeMismatch",
            );
          }
          expect(seen.get(activityId)).toBeUndefined();
          seen.set(activityId, r.filename);
          counts[type] = (counts[type] ?? 0) + 1;
        }
      }
    }
    expect(counts.lesson).toBe(50);
    expect(seen.get("simulation-gravity-wells")).toBe("simulation_gravity-wells.html");
    expect(seen.get("investigation-protein-pathway")).toBe("investigation_protein-pathway.html");
  });

  it("the build mapping refuses filenames that cannot yield an identifier", () => {
    expect(tooling.activityIdForResource("simulation", "simulation_gravity_wells.html")).toBeNull();
    expect(tooling.activityIdForResource("simulation", "lesson_gravity.html")).toBeNull();
    expect(tooling.activityIdForResource("lesson", "lesson_simulation-x.html")).toBeNull();
    expect(tooling.activityIdForResource("game", "game_x.html")).toBeNull();
    expect(tooling.activityIdForResource("lesson", "lesson_gravity.html")).toBe("gravity");
  });
});
