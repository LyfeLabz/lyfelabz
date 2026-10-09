/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
import * as fs from "fs";
import * as path from "path";

import {
  CURRICULUM_MANIFEST,
  getFormalResourcesForLesson,
  getResourcesByType,
  getSharedResources,
  getSurfaceableLessons,
  type FormalResourceType,
} from "./curriculumManifest";
import type * as ResourceProjectionModule from "./resourceProjection";
import {
  getFlatResourceById,
  getFlatResources,
  type FlatResource,
} from "./resourceProjection";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const activityIds = require(path.join(repoRoot, "app", "scripts", "activityIdentifiers.cjs")) as {
  ACTIVITY_RESOURCE_TYPES: readonly string[];
  activityIdForResource(type: string, filename: string): string | null;
};

type RegistryResource = { type: string; filename: string; label: string };
type RegistryUnit = {
  slug: string;
  title: string;
  description: string;
  resources: RegistryResource[];
};
type Registry = {
  topicGroups: {
    topic: string;
    gated?: boolean;
    gradeBlocks: { grade: string; units: RegistryUnit[] }[];
  }[];
  sharedResources?: {
    id: string;
    type: string;
    filename: string;
    label: string;
    description: string;
    relatedUnits?: string[];
  }[];
};

// The authored registry, read independently of the generated manifest.
const registry = JSON.parse(
  fs.readFileSync(path.join(__dirname, "curriculum.registry.json"), "utf8"),
) as Registry;

type Expected = {
  id: string;
  type: string;
  title: string;
  grade: string | null;
  topic: string | null;
  gated: boolean;
  openHref: string;
};

const expectedFromRegistry: Expected[] = [];
for (const g of registry.topicGroups) {
  for (const b of g.gradeBlocks) {
    for (const u of b.units) {
      for (const r of u.resources) {
        expectedFromRegistry.push({
          id: activityIds.activityIdForResource(r.type, r.filename) ?? `<none:${r.filename}>`,
          type: r.type,
          title: r.type === "lesson" ? u.title : r.label,
          grade: b.grade,
          topic: g.topic,
          gated: g.gated === true,
          openHref: `/${r.filename}`,
        });
      }
    }
  }
}
for (const s of registry.sharedResources ?? []) {
  expectedFromRegistry.push({
    id: s.id,
    type: s.type,
    title: s.label,
    grade: null,
    topic: null,
    gated: false,
    openHref: `/${s.filename}`,
  });
}

const all = getFlatResources();
const byId = (id: string): FlatResource => {
  const r = getFlatResourceById(id);
  if (r === null) throw new Error(`missing ${id}`);
  return r;
};

describe("Flat resource projection: derived from the canonical registry", () => {
  test("projects every registry resource, in registry order, with identity, title, grade, topic, and route", () => {
    expect(
      all.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        grade: r.grade,
        topic: r.topic,
        gated: r.gated,
        openHref: r.openHref,
      })),
    ).toEqual(expectedFromRegistry);
  });

  test("every unit-owned id equals the activity identifier from activityIdentifiers.cjs", () => {
    for (const g of CURRICULUM_MANIFEST.topicGroups) {
      for (const u of g.units) {
        for (const r of u.resources) {
          const id = activityIds.activityIdForResource(r.type, r.filename);
          expect(id).not.toBeNull();
          expect(byId(id!).openHref).toBe(r.href);
        }
      }
    }
  });

  test("identified unit types match the activity-identifier grammar's types", () => {
    const unitTypes = new Set(all.filter((r) => r.kind === "instructional").map((r) => r.type));
    for (const t of unitTypes) expect(activityIds.ACTIVITY_RESOURCE_TYPES).toContain(t);
  });

  test("ids are unique across lessons, resources, and tools", () => {
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
  });

  test("count equals the manifest's resource totals plus shared resources", () => {
    const unitTotal = Object.values(CURRICULUM_MANIFEST.totals.resourceCountsByType).reduce(
      (a, b) => a + b,
      0,
    );
    expect(all).toHaveLength(unitTotal + getSharedResources().length);
  });

  test("lesson descriptions come from the unit; other unit resources have none", () => {
    for (const g of registry.topicGroups) {
      for (const b of g.gradeBlocks) {
        for (const u of b.units) {
          expect(byId(u.slug).description).toBe(u.description);
        }
      }
    }
    for (const r of all.filter((x) => x.kind === "instructional" && x.type !== "lesson")) {
      expect(r.description).toBeNull();
    }
  });

  test("every open route names an existing public file", () => {
    for (const r of all) {
      expect(fs.existsSync(path.join(repoRoot, r.openHref.slice(1)))).toBe(true);
    }
  });

  test("returns the same frozen array each call", () => {
    expect(getFlatResources()).toBe(all);
    expect(Object.isFrozen(all)).toBe(true);
    for (const r of all) expect(Object.isFrozen(r)).toBe(true);
    expect(getFlatResourceById("no-such-resource")).toBeNull();
  });
});

describe("Flat resource projection: placement and assignment are independent", () => {
  test("Gravity Wells keeps its identity and route, is placeable, and is not assignable", () => {
    const gw = byId("simulation-gravity-wells");
    expect(gw.type).toBe("simulation");
    expect(gw.kind).toBe("instructional");
    expect(gw.title).toBe("Gravity Wells");
    expect(gw.openHref).toBe("/simulation_gravity-wells.html");
    expect(gw.grade).toBe("6");
    expect(gw.catalogLessonId).toBe("gravity");
    expect(gw.unitPlaceable).toBe(true);
    expect(gw.capabilities).toEqual({
      authenticatedAssignment: false,
      serverScoredAssessment: false,
      platformEvidence: false,
    });
  });

  test("Gravity Wells stays discoverable through the existing Curriculum selectors", () => {
    expect(getResourcesByType("simulation").map((e) => e.resource.href)).toContain(
      "/simulation_gravity-wells.html",
    );
    expect(getFormalResourcesForLesson("gravity").map((r) => r.href)).toEqual([
      "/simulation_gravity-wells.html",
    ]);
  });

  test("placeable resources include unassignable ones", () => {
    const placeableUnassignable = all.filter(
      (r) => r.unitPlaceable && !r.capabilities.authenticatedAssignment,
    );
    expect(placeableUnassignable.length).toBeGreaterThan(0);
    expect(placeableUnassignable.every((r) => r.type !== "lesson")).toBe(true);
  });

  test("assignable resources are exactly the existing assignable lessons, in order", () => {
    expect(
      all.filter((r) => r.capabilities.authenticatedAssignment).map((r) => [r.id, r.openHref]),
    ).toEqual(getSurfaceableLessons().map((l) => [l.slug, l.href]));
    // 50 registered lessons, one in a gated unit.
    expect(getSurfaceableLessons()).toHaveLength(49);
  });

  test("no non-lesson resource is assignable or advertises authenticated delivery", () => {
    for (const r of all.filter((x) => x.type !== "lesson")) {
      expect(r.capabilities).toEqual({
        authenticatedAssignment: false,
        serverScoredAssessment: false,
        platformEvidence: false,
      });
    }
  });

  test("assignable types stay within the server allowlist", () => {
    const serverSource = fs.readFileSync(
      path.join(repoRoot, "platform", "functions", "src", "shared", "activity-identifiers.ts"),
      "utf8",
    );
    const match = /ASSIGNABLE_RESOURCE_TYPES[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(serverSource);
    expect(match).not.toBeNull();
    const serverAssignable = match![1]!
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter((s) => s.length > 0);
    expect(serverAssignable).toEqual(["lesson"]);
    const projected = new Set(
      all.filter((r) => r.capabilities.authenticatedAssignment).map((r) => r.type),
    );
    for (const t of projected) expect(serverAssignable).toContain(t);
  });

  test("placeable non-lesson resources match the existing Curriculum resource tabs", () => {
    const tabTypes: FormalResourceType[] = ["investigation", "simulation", "extension", "challenge"];
    const fromSelectors = new Set(
      tabTypes.flatMap((t) => getResourcesByType(t).map((e) => e.resource.href)),
    );
    const fromProjection = new Set(
      all.filter((r) => r.unitPlaceable && r.type !== "lesson").map((r) => r.openHref),
    );
    expect(fromProjection).toEqual(fromSelectors);
  });

  test("the gated lesson is neither placeable nor assignable", () => {
    const gated = all.filter((r) => r.gated);
    expect(gated.map((r) => r.id)).toEqual(["ragebaiting"]);
    expect(gated[0]!.unitPlaceable).toBe(false);
    expect(gated[0]!.capabilities.authenticatedAssignment).toBe(false);
  });
});

describe("Flat resource projection: reusable tools", () => {
  test("Lab Report Assistant is a tool, not unit-placeable, with no assignment or assessment", () => {
    const lra = byId("lab-report-assistant");
    expect(lra.type).toBe("tool");
    expect(lra.kind).toBe("tool");
    expect(lra.unitPlaceable).toBe(false);
    expect(lra.openHref).toBe("/tool_lab-report-assistant.html");
    expect(lra.catalogLessonId).toBeNull();
    expect(lra.relatedLessonIds).toEqual(["conducting-experiments"]);
    expect(lra.grade).toBeNull();
    expect(lra.topic).toBeNull();
    expect(lra.capabilities.authenticatedAssignment).toBe(false);
    expect(lra.capabilities.serverScoredAssessment).toBe(false);
  });

  test("every shared resource projects as a non-placeable tool", () => {
    const tools = all.filter((r) => r.kind === "tool");
    expect(tools.map((r) => r.id)).toEqual(getSharedResources().map((s) => s.id));
    expect(tools.every((r) => !r.unitPlaceable)).toBe(true);
  });
});

describe("Flat resource projection: contract shape", () => {
  const ALLOWED_KEYS = [
    "id",
    "type",
    "kind",
    "title",
    "description",
    "grade",
    "topic",
    "formal",
    "gated",
    "catalogLessonId",
    "relatedLessonIds",
    "openHref",
    "unitPlaceable",
    "capabilities",
  ].sort();

  test("carries no teacher, unit-membership, class, assignment, or question-count state", () => {
    for (const r of all) {
      expect(Object.keys(r).sort()).toEqual(ALLOWED_KEYS);
      expect(Object.keys(r.capabilities).sort()).toEqual(
        ["authenticatedAssignment", "platformEvidence", "serverScoredAssessment"],
      );
    }
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/teacher|classId|unitId|assignmentId|questionCount/i);
  });
});

describe("Flat resource projection: policy and incomplete metadata", () => {
  const withMocks = (mocks: {
    policy?: (p: Record<string, Record<string, unknown>>) => void;
    manifest?: (m: Record<string, unknown>) => void;
  }): typeof ResourceProjectionModule => {
    let mod: typeof ResourceProjectionModule | undefined;
    jest.isolateModules(() => {
      const policyJson = JSON.parse(
        JSON.stringify(require("./curriculum.resource-types.json")),
      );
      mocks.policy?.(policyJson.types);
      const manifestJson = JSON.parse(JSON.stringify(CURRICULUM_MANIFEST));
      mocks.manifest?.(manifestJson);
      jest.doMock("./curriculum.resource-types.json", () => policyJson);
      jest.doMock("./curriculum.manifest.json", () => manifestJson);
      mod = require("./resourceProjection");
    });
    jest.dontMock("./curriculum.resource-types.json");
    jest.dontMock("./curriculum.manifest.json");
    return mod!;
  };

  test("assignment follows policy; placement does not depend on it", () => {
    const mod = withMocks({
      policy: (p) => {
        p.lesson!.assignable = false;
      },
    });
    const lesson = mod.getFlatResourceById("gravity")!;
    expect(lesson.capabilities.authenticatedAssignment).toBe(false);
    expect(lesson.unitPlaceable).toBe(true);
    expect(mod.getFlatResourceById("simulation-gravity-wells")!.unitPlaceable).toBe(true);
  });

  test("an unidentified unit type (game) is left out rather than given an invented id", () => {
    const mod = withMocks({
      manifest: (m) => {
        const groups = m.topicGroups as { units: { slug: string; resources: unknown[] }[] }[];
        const unit = groups.flatMap((g) => g.units).find((u) => u.slug === "gravity")!;
        unit.resources.push({
          type: "game",
          href: "/game_orbit.html",
          filename: "game_orbit.html",
          label: "Orbit",
          displayOrder: 2,
        });
      },
    });
    expect(mod.getFlatResources()).toHaveLength(all.length);
    expect(mod.getFlatResources().some((r) => r.openHref === "/game_orbit.html")).toBe(false);
  });

  const withToolId = (id: string): typeof ResourceProjectionModule =>
    withMocks({
      manifest: (m) => {
        (m.sharedResources as { id: string }[])[0]!.id = id;
      },
    });

  test.each([
    ["gravity", "/lesson_gravity.html \\(lesson\\)"],
    ["simulation-gravity-wells", "/simulation_gravity-wells.html \\(simulation\\)"],
  ])("a tool id colliding with %s is refused, never masked by lookup", (id, instructional) => {
    const mod = withToolId(id);
    const expected = new RegExp(
      `Duplicate canonical resource id "${id}": ${instructional} and /tool_lab-report-assistant.html \\(tool\\)`,
    );
    expect(() => mod.getFlatResources()).toThrow(expected);
    expect(() => mod.getFlatResourceById(id)).toThrow(expected);
    // An unrelated lookup also refuses: the whole projection is invalid.
    expect(() => mod.getFlatResourceById("photosynthesis")).toThrow(expected);
    // Refusal is not cached away on a later call.
    expect(() => mod.getFlatResources()).toThrow(expected);
  });

  test("a non-colliding tool id still projects", () => {
    const mod = withToolId("lab-report-helper");
    expect(mod.getFlatResourceById("lab-report-helper")!.kind).toBe("tool");
    expect(mod.getFlatResources()).toHaveLength(all.length);
  });

  test("a registry without shared resources projects no tools", () => {
    const mod = withMocks({
      manifest: (m) => {
        m.sharedResources = [];
      },
    });
    expect(mod.getFlatResources().filter((r) => r.kind === "tool")).toEqual([]);
    expect(mod.getFlatResourceById("lab-report-assistant")).toBeNull();
  });
});
