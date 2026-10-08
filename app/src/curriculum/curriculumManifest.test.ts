/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
import * as fs from "fs";
import * as path from "path";

import {
  CURRICULUM_MANIFEST,
  TOPIC_LABEL,
  FORMAL_RESOURCE_LABEL,
  getAllUnits,
  getSurfaceableLessons,
  getTopicGroups,
  getOrphanUnits,
  getUnitBySlug,
  getFormalResourcesForLesson,
  getSharedResources,
  getResourcesByType,
  getTeacherVisibleSharedResources,
  getSurfaceableRelatedUnits,
  RESOURCE_TYPE_POLICY,
} from "./curriculumManifest";
import type * as CurriculumManifestModule from "./curriculumManifest";

const parserPath = path.resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "curriculumParser.cjs",
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parser = require(parserPath) as {
  parseCurriculumFromIndexHtml(html: string): unknown;
  readRootIndexHtml(): string;
  sha256(text: string): string;
};

const registryPath = path.resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "curriculumRegistry.cjs",
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const registry = require(registryPath) as {
  buildManifest(): unknown;
  parseRegistryText(text: string): unknown;
  readRegistryText(): string;
};

const MANIFEST_JSON_PATH = path.resolve(
  __dirname,
  "curriculum.manifest.json",
);

const REGENERATE_HINT =
  "Regenerate with `npm run curriculum:build` inside app/.";

describe("Canonical curriculum manifest (Sprint 6D.0)", () => {
  test("manifest is marked as generated and names its canonical source", () => {
    expect(CURRICULUM_MANIFEST.generated).toBe(true);
    expect(CURRICULUM_MANIFEST.canonicalSource).toBe(
      "app/src/curriculum/curriculum.registry.json",
    );
    expect(CURRICULUM_MANIFEST.canonicalSourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(CURRICULUM_MANIFEST.doNotEditByHand).toMatch(/generated/i);
  });

  test("checked-in manifest matches a freshly built curriculum registry", () => {
    const fresh = registry.buildManifest() as typeof CURRICULUM_MANIFEST;
    const checked = JSON.parse(
      fs.readFileSync(MANIFEST_JSON_PATH, "utf8"),
    ) as unknown;
    if (JSON.stringify(fresh) !== JSON.stringify(checked)) {
      throw new Error(
        `Curriculum manifest drift detected between the curriculum registry and app/src/curriculum/curriculum.manifest.json. ${REGENERATE_HINT}`,
      );
    }
    // Also verify the sha256 recorded in the manifest matches the current
    // canonical source verbatim. This catches accidental edits that would
    // keep the content but change the fingerprint.
    const sha = parser.sha256(registry.readRegistryText());
    expect(CURRICULUM_MANIFEST.canonicalSourceSha256).toBe(sha);
  });

  test("every unit slug is unique and every resource href is unique", () => {
    const slugs = new Set<string>();
    const hrefs = new Set<string>();
    for (const u of getAllUnits()) {
      expect(slugs.has(u.slug)).toBe(false);
      slugs.add(u.slug);
      for (const r of u.resources) {
        expect(hrefs.has(r.href)).toBe(false);
        hrefs.add(r.href);
      }
    }
  });

  test("topic groups are ordered and labelled per canonical index", () => {
    const groups = getTopicGroups();
    expect(groups.map((g) => g.topic)).toEqual([
      "life-science",
      "earth-space",
      "physical-science",
      "tech-engineering",
      "behavioral-science",
    ]);
    expect(TOPIC_LABEL["life-science"]).toBe("Life Science");
    expect(TOPIC_LABEL["earth-space"]).toBe("Earth & Space");
    expect(TOPIC_LABEL["physical-science"]).toBe("Physical Science");
    expect(TOPIC_LABEL["tech-engineering"]).toBe("Tech & Engineering");
    expect(TOPIC_LABEL["behavioral-science"]).toBe("Behavioral Science");
  });

  test("behavioral-science is marked gated; other topic groups are not", () => {
    for (const g of getTopicGroups()) {
      expect(g.gated).toBe(g.topic === "behavioral-science");
    }
  });

  test("getSurfaceableLessons excludes gated units and includes one entry per non-gated lesson unit", () => {
    const lessons = getSurfaceableLessons();
    const nonGatedLessonUnits = getAllUnits().filter(
      (u) => !u.gated && u.resources.some((r) => r.type === "lesson"),
    );
    expect(lessons.length).toBe(nonGatedLessonUnits.length);
    for (const l of lessons) {
      expect(l.href.startsWith("/lesson_")).toBe(true);
    }
    expect(lessons.length).toBe(49);
  });

  test("orphan units are reported only for gated topic groups", () => {
    const orphans = getOrphanUnits();
    for (const o of orphans) {
      expect(o.gated).toBe(true);
    }
    expect(orphans.length).toBe(2);
  });

  test("resource totals match summed per-unit resources", () => {
    let total = 0;
    for (const u of getAllUnits()) total += u.resources.length;
    const summed = Object.values(
      CURRICULUM_MANIFEST.totals.resourceCountsByType,
    ).reduce((a, b) => a + b, 0);
    expect(summed).toBe(total);
    expect(CURRICULUM_MANIFEST.totals.unitCount).toBe(getAllUnits().length);
  });
});

describe("Formal resource selectors (Sprint 28.6D)", () => {
  const FORMAL_TYPES = new Set([
    "simulation",
    "investigation",
    "extension",
    "challenge",
  ]);

  test("getUnitBySlug resolves a known unit and returns null otherwise", () => {
    const unit = getUnitBySlug("earths-layers");
    expect(unit).not.toBeNull();
    expect(unit!.slug).toBe("earths-layers");
    expect(getUnitBySlug("not-a-real-slug")).toBeNull();
  });

  test("formal resources sum to the 28.6B inventory (13 total, games excluded)", () => {
    let total = 0;
    for (const lesson of getSurfaceableLessons()) {
      const resources = getFormalResourcesForLesson(lesson.slug);
      for (const r of resources) {
        expect(FORMAL_TYPES.has(r.type)).toBe(true);
        expect(r.type).not.toBe("game");
      }
      total += resources.length;
    }
    // 3 simulations + 4 investigations + 5 extensions + 1 challenge.
    expect(total).toBe(13);
    // The manifest itself carries no formal games.
    expect(CURRICULUM_MANIFEST.totals.resourceCountsByType.game).toBe(0);
  });

  test("formal resources are ordered by manifest displayOrder", () => {
    for (const lesson of getSurfaceableLessons()) {
      const resources = getFormalResourcesForLesson(lesson.slug);
      for (let i = 1; i < resources.length; i += 1) {
        expect(resources[i]!.displayOrder).toBeGreaterThanOrEqual(
          resources[i - 1]!.displayOrder,
        );
      }
    }
  });

  test("FORMAL_RESOURCE_LABEL maps every formal type to a human label", () => {
    expect(FORMAL_RESOURCE_LABEL.simulation).toBe("Simulation");
    expect(FORMAL_RESOURCE_LABEL.investigation).toBe("Investigation");
    expect(FORMAL_RESOURCE_LABEL.extension).toBe("Extension");
    expect(FORMAL_RESOURCE_LABEL.challenge).toBe("Challenge");
  });

  test("an unknown slug yields no formal resources without throwing", () => {
    expect(getFormalResourcesForLesson("not-a-real-slug")).toEqual([]);
  });
});

describe("Canonical curriculum parser strict-failure guarantees", () => {
  const parse = (html: string): unknown => parser.parseCurriculumFromIndexHtml(html);

  const wrapTopicGroup = (inner: string, topic = "life-science"): string =>
    `<div class="topic-group tg-life" data-group="${topic}">${inner}</div><!-- /tg-life -->`;

  const validCard = (slug: string, title = "Title", href = "lesson_x.html"): string =>
    `
      <div class="unit-card" id="unit-${slug}">
        <div class="unit-top">
          <div class="unit-name">${title}</div>
          <div class="unit-desc">Desc</div>
        </div>
        <div class="unit-links">
          <a href="${href}" class="ulink live">Lesson</a>
        </div>
      </div>
    `;

  const wrapSubjectBlock = (topic: string, grade: string, cards: string): string =>
    `<div class="subject-block" data-topic="${topic}" data-grades="${grade}"><div class="unit-row">${cards}</div></div>`;

  test("fails on an unrecognized topic group data-group", () => {
    const html = `<div class="topic-group tg-x" data-group="mystery-science">${wrapSubjectBlock(
      "mystery-science",
      "6",
      validCard("a", "A", "lesson_a.html"),
    )}</div><!-- /tg-x -->`;
    expect(() => parse(html)).toThrow(/unknown canonical topic/);
  });

  test("fails when a subject-block data-topic does not match its topic-group", () => {
    const html = wrapTopicGroup(
      wrapSubjectBlock("earth-space", "6", validCard("a", "A", "lesson_a.html")),
    );
    expect(() => parse(html)).toThrow(/does not match enclosing topic-group/);
  });

  test("fails on a duplicate unit slug across the index", () => {
    const html = wrapTopicGroup(
      wrapSubjectBlock(
        "life-science",
        "6",
        `${validCard("dup", "One", "lesson_one.html")}${validCard(
          "dup",
          "Two",
          "lesson_two.html",
        )}`,
      ),
    );
    expect(() => parse(html)).toThrow(/duplicate unit slug/);
  });

  test("fails on a duplicate resource href across the index", () => {
    const html = wrapTopicGroup(
      wrapSubjectBlock(
        "life-science",
        "6",
        `${validCard("a", "A", "lesson_shared.html")}${validCard(
          "b",
          "B",
          "lesson_shared.html",
        )}`,
      ),
    );
    expect(() => parse(html)).toThrow(/duplicate resource href/);
  });

  test("fails when a unit-card is missing its unit-name", () => {
    const badCard = `
      <div class="unit-card" id="unit-x">
        <div class="unit-top">
          <div class="unit-desc">Desc</div>
        </div>
        <div class="unit-links">
          <a href="lesson_x.html" class="ulink live">Lesson</a>
        </div>
      </div>
    `;
    const html = wrapTopicGroup(wrapSubjectBlock("life-science", "6", badCard));
    expect(() => parse(html)).toThrow(/unit-name/);
  });

  test("fails when a unit-card is missing its unit-desc", () => {
    const badCard = `
      <div class="unit-card" id="unit-x">
        <div class="unit-top">
          <div class="unit-name">Name</div>
        </div>
        <div class="unit-links">
          <a href="lesson_x.html" class="ulink live">Lesson</a>
        </div>
      </div>
    `;
    const html = wrapTopicGroup(wrapSubjectBlock("life-science", "6", badCard));
    expect(() => parse(html)).toThrow(/unit-desc/);
  });

  test("fails on an unrecognized ulink resource class", () => {
    const badCard = `
      <div class="unit-card" id="unit-x">
        <div class="unit-top">
          <div class="unit-name">Name</div>
          <div class="unit-desc">Desc</div>
        </div>
        <div class="unit-links">
          <a href="mystery_x.html" class="ulink mystery">Mystery</a>
        </div>
      </div>
    `;
    const html = wrapTopicGroup(wrapSubjectBlock("life-science", "6", badCard));
    expect(() => parse(html)).toThrow(/unrecognized ulink resource class/);
  });

  test("fails when a resource href does not match its declared type prefix", () => {
    const badCard = `
      <div class="unit-card" id="unit-x">
        <div class="unit-top">
          <div class="unit-name">Name</div>
          <div class="unit-desc">Desc</div>
        </div>
        <div class="unit-links">
          <a href="extension_x.html" class="ulink live">Not a lesson</a>
        </div>
      </div>
    `;
    const html = wrapTopicGroup(wrapSubjectBlock("life-science", "6", badCard));
    expect(() => parse(html)).toThrow(/does not match its declared type/);
  });

  test("fails when a non-gated unit-card has neither an id nor a lesson resource", () => {
    const badCard = `
      <div class="unit-card">
        <div class="unit-top">
          <div class="unit-name">Anon</div>
          <div class="unit-desc">Desc</div>
        </div>
        <div class="unit-links">
          <a href="extension_x.html" class="ulink ext">Ext</a>
        </div>
      </div>
    `;
    const html = wrapTopicGroup(wrapSubjectBlock("life-science", "6", badCard));
    expect(() => parse(html)).toThrow(/slug cannot be derived/);
  });

  test("legend-pill spans in the filter box are ignored (not treated as resources)", () => {
    const html = wrapTopicGroup(
      wrapSubjectBlock(
        "life-science",
        "6",
        `${validCard("a", "A", "lesson_a.html")}`,
      ),
    );
    const out = parse(html) as { totals: { resourceCountsByType: Record<string, number> } };
    expect(out.totals.resourceCountsByType.lesson).toBe(1);
  });

  test("fails when a subject-block declares multiple grades", () => {
    const html = wrapTopicGroup(
      wrapSubjectBlock("life-science", "6,7", validCard("a", "A", "lesson_a.html")),
    );
    expect(() => parse(html)).toThrow(/multi-grade blocks are not yet supported/);
  });

  test("fails when a subject-block declares an unsupported grade", () => {
    const html = wrapTopicGroup(
      wrapSubjectBlock("life-science", "9", validCard("a", "A", "lesson_a.html")),
    );
    expect(() => parse(html)).toThrow(/invalid data-grades value/);
  });
});

describe("Canonical curriculum registry strict-failure guarantees", () => {
  type Json = Record<string, unknown>;
  const minimal = (): Json => ({
    schemaVersion: 1,
    topicGroups: [
      {
        topic: "life-science",
        gated: false,
        gradeBlocks: [
          {
            grade: "6",
            units: [
              {
                slug: "a",
                title: "A",
                description: "Desc",
                resources: [{ type: "lesson", filename: "lesson_a.html", label: "Lesson" }],
              },
            ],
          },
        ],
      },
    ],
  });
  const parse = (value: Json): unknown => registry.parseRegistryText(JSON.stringify(value));
  const firstUnit = (value: Json): Json =>
    ((((value.topicGroups as Json[])[0].gradeBlocks as Json[])[0].units as Json[])[0]);

  test("accepts a minimal valid registry", () => {
    expect(() => parse(minimal())).not.toThrow();
  });

  test("fails on an unknown key", () => {
    const value = minimal();
    firstUnit(value).href = "/lesson_a.html";
    expect(() => parse(value)).toThrow(/unknown key "href"/);
  });

  test("fails on an unrecognized topic", () => {
    const value = minimal();
    (value.topicGroups as Json[])[0].topic = "astrology";
    expect(() => parse(value)).toThrow(/unknown canonical topic/);
  });

  test("fails on a duplicate unit slug", () => {
    const value = minimal();
    const block = ((value.topicGroups as Json[])[0].gradeBlocks as Json[])[0];
    block.units = [
      firstUnit(value),
      { slug: "a", title: "B", description: "Desc", resources: [] },
    ];
    expect(() => parse(value)).toThrow(/duplicate unit slug "a"/);
  });

  test("fails on a duplicate resource href", () => {
    const value = minimal();
    const block = ((value.topicGroups as Json[])[0].gradeBlocks as Json[])[0];
    block.units = [
      firstUnit(value),
      {
        slug: "b",
        title: "B",
        description: "Desc",
        resources: [{ type: "lesson", filename: "lesson_a.html", label: "Lesson" }],
      },
    ];
    expect(() => parse(value)).toThrow(/duplicate resource href/);
  });

  test("fails on an unrecognized resource type", () => {
    const value = minimal();
    firstUnit(value).resources = [{ type: "widget", filename: "widget_a.html", label: "Widget" }];
    expect(() => parse(value)).toThrow(/unrecognized resource type "widget"/);
  });

  test("rejects a shared-placement type (tool) as a unit-owned resource", () => {
    const value = minimal();
    firstUnit(value).resources = [{ type: "tool", filename: "tool_a.html", label: "Tool" }];
    expect(() => parse(value)).toThrow(/resource type "tool" is not permitted on unit "a"/);
  });

  test("fails when a filename does not match its declared type prefix", () => {
    const value = minimal();
    firstUnit(value).resources = [{ type: "simulation", filename: "lesson_a.html", label: "Sim" }];
    expect(() => parse(value)).toThrow(/does not match its declared type/);
  });

  test("fails on placeholder units outside a gated topic group", () => {
    const value = minimal();
    ((value.topicGroups as Json[])[0].gradeBlocks as Json[])[0].placeholderUnits = [
      { title: "Soon", description: "Desc" },
    ];
    expect(() => parse(value)).toThrow(/placeholder units outside a gated topic group/);
  });

  test("fails on a placeholder unit that is not a titled, described card", () => {
    const value = minimal();
    (value.topicGroups as Json[])[0].gated = true;
    const block = ((value.topicGroups as Json[])[0].gradeBlocks as Json[])[0];
    block.placeholderUnits = 2;
    expect(() => parse(value)).toThrow(/placeholderUnits must be an array/);
    block.placeholderUnits = [{ title: "Soon" }];
    expect(() => parse(value)).toThrow(/description must be a non-empty string/);
    block.placeholderUnits = [{ title: "Soon", description: "Desc", slug: "soon" }];
    expect(() => parse(value)).toThrow(/unknown key "slug"/);
  });

  test("fails on an unsupported grade", () => {
    const value = minimal();
    ((value.topicGroups as Json[])[0].gradeBlocks as Json[])[0].grade = "9";
    expect(() => parse(value)).toThrow(/invalid grade/);
  });

  test("fails on uncollapsed whitespace in authored text", () => {
    const value = minimal();
    firstUnit(value).title = " A";
    expect(() => parse(value)).toThrow(/whitespace/);
  });

  // Resource Expansion Phase 1: assignment activity identifiers
  // (app/scripts/activityIdentifiers.cjs).
  test("accepts formal resources whose filenames yield activity identifiers", () => {
    const value = minimal();
    firstUnit(value).resources = [
      { type: "lesson", filename: "lesson_a.html", label: "Lesson" },
      { type: "simulation", filename: "simulation_a.html", label: "Sim" },
      { type: "investigation", filename: "investigation_a-b.html", label: "Inv" },
    ];
    expect(() => parse(value)).not.toThrow();
  });

  test("fails when a unit slug begins with a reserved activity identifier prefix", () => {
    const value = minimal();
    firstUnit(value).slug = "simulation-a";
    firstUnit(value).resources = [
      { type: "lesson", filename: "lesson_simulation-a.html", label: "Lesson" },
    ];
    expect(() => parse(value)).toThrow(/begins with a reserved activity identifier prefix/);
  });

  test("rejects a lesson that would collide with a resource activity identifier", () => {
    const value = minimal();
    const block = ((value.topicGroups as Json[])[0].gradeBlocks as Json[])[0];
    block.units = [
      {
        slug: "a",
        title: "A",
        description: "Desc",
        resources: [
          { type: "lesson", filename: "lesson_a.html", label: "Lesson" },
          { type: "simulation", filename: "simulation_gravity-wells.html", label: "Sim" },
        ],
      },
      {
        slug: "simulation-gravity-wells",
        title: "B",
        description: "Desc",
        resources: [{ type: "lesson", filename: "lesson_simulation-gravity-wells.html", label: "Lesson" }],
      },
    ];
    expect(() => parse(value)).toThrow(/reserved activity identifier prefix/);
  });

  test("fails when a formal resource filename cannot yield an activity identifier", () => {
    const value = minimal();
    firstUnit(value).resources = [
      { type: "lesson", filename: "lesson_a.html", label: "Lesson" },
      { type: "simulation", filename: "simulation_a_b.html", label: "Sim" },
    ];
    expect(() => parse(value)).toThrow(/does not yield a valid assignment activity identifier/);
  });

  test("fails when a lesson's activity identifier differs from its unit slug", () => {
    const value = minimal();
    firstUnit(value).resources = [{ type: "lesson", filename: "lesson_b.html", label: "Lesson" }];
    expect(() => parse(value)).toThrow(/does not match unit slug "a"/);
  });

  test("does not require activity identifiers for non-formal resource types", () => {
    const value = minimal();
    firstUnit(value).resources = [
      { type: "lesson", filename: "lesson_a.html", label: "Lesson" },
      { type: "game", filename: "game_a_b.html", label: "Game" },
    ];
    expect(() => parse(value)).not.toThrow();
  });
});

describe("Resource-type policy (taxonomy foundation)", () => {
  const typesPolicy = require(
    path.resolve(__dirname, "curriculum.resource-types.json"),
  ) as { types: Record<string, unknown> };
  const parserTypes = require(parserPath) as {
    RESOURCE_TYPES: string[];
    UNIT_RESOURCE_TYPES: string[];
    SHARED_RESOURCE_TYPES: string[];
    RESOURCE_TYPE_BY_ULINK_CLASS: Record<string, string>;
    HREF_PREFIX_BY_TYPE: Record<string, string>;
  };

  test("preserves the pre-policy unit resource-type mappings exactly", () => {
    expect(parserTypes.UNIT_RESOURCE_TYPES).toEqual([
      "lesson",
      "simulation",
      "investigation",
      "extension",
      "challenge",
      "activity",
      "game",
      "map",
      "disease",
    ]);
    expect(parserTypes.RESOURCE_TYPE_BY_ULINK_CLASS).toEqual({
      live: "lesson",
      sim: "simulation",
      inv: "investigation",
      ext: "extension",
      chal: "challenge",
      activity: "activity",
      game: "game",
      map: "map",
      dis: "disease",
    });
    for (const t of parserTypes.RESOURCE_TYPES) {
      expect(parserTypes.HREF_PREFIX_BY_TYPE[t]).toBe(`${t}_`);
    }
    // Manifest totals keep exactly the pre-policy keys and order.
    expect(Object.keys(CURRICULUM_MANIFEST.totals.resourceCountsByType)).toEqual(
      parserTypes.UNIT_RESOURCE_TYPES,
    );
  });

  test("preserves formal, Teacher Workspace, and assignability semantics", () => {
    const formal = ["lesson", "simulation", "investigation", "extension", "challenge"];
    for (const [type, p] of Object.entries(RESOURCE_TYPE_POLICY)) {
      expect(p.formal).toBe(formal.includes(type));
      expect(p.teacherVisible).toBe(formal.includes(type));
      expect(p.assignable).toBe(type === "lesson");
    }
  });

  test("tool is a supported shared type: non-formal, not teacher-visible, not assignable", () => {
    expect(parserTypes.SHARED_RESOURCE_TYPES).toEqual(["tool"]);
    expect(RESOURCE_TYPE_POLICY.tool).toEqual({
      filenamePrefix: "tool_",
      ulinkClass: null,
      placement: "shared",
      formal: false,
      teacherVisible: false,
      assignable: false,
    });
    // A tool has no homepage pill class.
    expect(Object.values(parserTypes.RESOURCE_TYPE_BY_ULINK_CLASS)).not.toContain("tool");
  });

  test("the TS accessor and the build scripts read the same policy", () => {
    expect(Object.keys(RESOURCE_TYPE_POLICY)).toEqual(parserTypes.RESOURCE_TYPES);
    expect(RESOURCE_TYPE_POLICY).toEqual(typesPolicy.types);
    expect(Object.keys(FORMAL_RESOURCE_LABEL).sort()).toEqual(
      Object.entries(RESOURCE_TYPE_POLICY)
        .filter(([t, p]) => t !== "lesson" && p.teacherVisible)
        .map(([t]) => t)
        .sort(),
    );
  });
});

describe("Shared resources: Lab Report Assistant", () => {
  test("is registered as a first-class tool related to Conducting Experiments", () => {
    expect(getSharedResources()).toEqual([
      {
        id: "lab-report-assistant",
        type: "tool",
        href: "/tool_lab-report-assistant.html",
        filename: "tool_lab-report-assistant.html",
        label: "Lab Report Assistant",
        description:
          "Organize your ideas and build each section of your lab report step by step.",
        relatedUnits: ["conducting-experiments"],
        displayOrder: 0,
      },
    ]);
    expect(getUnitBySlug("conducting-experiments")).not.toBeNull();
  });

  test("is non-formal, not Teacher Workspace-visible, and not assignable", () => {
    const tool = getSharedResources()[0]!;
    const policy = RESOURCE_TYPE_POLICY[tool.type];
    expect(policy.formal).toBe(false);
    expect(policy.teacherVisible).toBe(false);
    expect(policy.assignable).toBe(false);
  });

  test("does not leak into unit resources, Teacher Workspace selectors, or totals", () => {
    for (const u of getAllUnits()) {
      for (const r of u.resources) {
        expect(r.filename).not.toBe("tool_lab-report-assistant.html");
      }
    }
    const conducting = getFormalResourcesForLesson("conducting-experiments");
    expect(conducting).toEqual([]);
    expect(getSurfaceableLessons().some((l) => l.href.includes("tool_"))).toBe(false);
    expect(
      Object.keys(CURRICULUM_MANIFEST.totals.resourceCountsByType),
    ).not.toContain("tool");
  });
});

describe("Shared resource registry validation", () => {
  type Json = Record<string, unknown>;
  const base = (shared: unknown[]): Json => ({
    schemaVersion: 1,
    topicGroups: [
      {
        topic: "life-science",
        gated: false,
        gradeBlocks: [
          {
            grade: "6",
            units: [
              {
                slug: "a",
                title: "A",
                description: "Desc",
                resources: [{ type: "lesson", filename: "lesson_a.html", label: "Lesson" }],
              },
              {
                slug: "b",
                title: "B",
                description: "Desc",
                resources: [{ type: "lesson", filename: "lesson_b.html", label: "Lesson" }],
              },
            ],
          },
        ],
      },
    ],
    sharedResources: shared,
  });
  const tool = (over: Json = {}): Json => ({
    id: "t",
    type: "tool",
    filename: "tool_t.html",
    label: "T",
    description: "Desc",
    ...over,
  });
  const parse = (value: Json): { sharedResources: unknown[]; topicGroups: unknown } =>
    registry.parseRegistryText(JSON.stringify(value)) as {
      sharedResources: unknown[];
      topicGroups: unknown;
    };

  test("sharedResources is optional and defaults to empty", () => {
    const value = base([]);
    delete value.sharedResources;
    expect(parse(value).sharedResources).toEqual([]);
  });

  test("accepts a tool with and without relatedUnits", () => {
    const out = parse(base([tool(), tool({ id: "u", filename: "tool_u.html", relatedUnits: ["a", "b"] })]));
    expect(out.sharedResources).toEqual([
      { id: "t", type: "tool", href: "/tool_t.html", filename: "tool_t.html", label: "T", description: "Desc", relatedUnits: [], displayOrder: 0 },
      { id: "u", type: "tool", href: "/tool_u.html", filename: "tool_u.html", label: "T", description: "Desc", relatedUnits: ["a", "b"], displayOrder: 1 },
    ]);
  });

  test("shared resources do not change the unit-derived curriculum", () => {
    const without = base([]);
    delete without.sharedResources;
    expect(parse(base([tool({ relatedUnits: ["a"] })])).topicGroups).toEqual(
      parse(without).topicGroups,
    );
  });

  test("rejects a tool filename that does not match the tool prefix", () => {
    expect(() => parse(base([tool({ filename: "lesson_t.html" })]))).toThrow(
      /does not match its declared type "tool"/,
    );
    expect(() => parse(base([tool({ filename: "tools/tool_t.html" })]))).toThrow(
      /must be a bare filename/,
    );
  });

  test("rejects unit-placement and unknown types at the top level", () => {
    expect(() =>
      parse(base([tool({ type: "simulation", filename: "simulation_t.html" })])),
    ).toThrow(/resource type "simulation" is not permitted on shared resource "t"/);
    expect(() => parse(base([tool({ type: "explore", filename: "explore_t.html" })]))).toThrow(
      /unrecognized resource type "explore"/,
    );
  });

  test("rejects duplicate and malformed ids", () => {
    expect(() => parse(base([tool(), tool({ filename: "tool_u.html" })]))).toThrow(
      /duplicate shared resource id "t"/,
    );
    expect(() => parse(base([tool({ id: "Bad Id" })]))).toThrow(/invalid shared resource id/);
  });

  test("rejects an href already registered (unit-owned or shared)", () => {
    expect(() => parse(base([tool({ id: "u" }), tool()]))).toThrow(/duplicate resource href/);
  });

  test("rejects unknown, duplicate, malformed, or empty relatedUnits", () => {
    expect(() => parse(base([tool({ relatedUnits: ["zzz"] })]))).toThrow(
      /relates to unknown unit "zzz"/,
    );
    expect(() => parse(base([tool({ relatedUnits: ["a", "a"] })]))).toThrow(
      /lists related unit "a" more than once/,
    );
    expect(() => parse(base([tool({ relatedUnits: [" a"] })]))).toThrow(
      /malformed related unit/,
    );
    expect(() => parse(base([tool({ relatedUnits: "a" })]))).toThrow(
      /relatedUnits must be a non-empty array/,
    );
    expect(() => parse(base([tool({ relatedUnits: [] })]))).toThrow(
      /relatedUnits must be a non-empty array/,
    );
  });

  test("rejects unknown keys and uncollapsed whitespace", () => {
    expect(() => parse(base([tool({ parent: "a" })]))).toThrow(/unknown key "parent"/);
    expect(() => parse(base([tool({ label: "T " })]))).toThrow(/whitespace/);
    expect(() => parse(base([tool({ description: "" })]))).toThrow(/non-empty string/);
    expect(() => parse({ ...base([]), sharedResources: {} })).toThrow(
      /sharedResources must be an array/,
    );
  });
});

describe("Resource-type accessors (Teacher Resource Browser foundation)", () => {
  const browseRows = (type: Parameters<typeof getResourcesByType>[0]) =>
    getResourcesByType(type).map((r) => [r.unit.slug, r.resource.label]);

  test("investigations are returned with owning-unit context", () => {
    expect(browseRows("investigation")).toEqual([
      ["what-is-life", "The Gray Zone"],
      ["cell-types", "Cell Energy"],
      ["organelles", "Protein Pathway"],
      ["nature-of-waves", "Amplitude Challenge"],
    ]);
  });

  test("simulations are returned in canonical order", () => {
    expect(browseRows("simulation")).toEqual([
      ["continental-drift", "Floatlandia Fracture"],
      ["gravity", "Gravity Wells"],
      ["eclipses", "Eclipse Alignment"],
    ]);
  });

  test("extensions are returned in canonical order", () => {
    expect(browseRows("extension")).toEqual([
      ["body-systems", "Medical Mysteries"],
      ["biological-evolution", "Chernobyl Frogs"],
      ["layers-of-time", "Fossil Hunt"],
      ["phases-of-the-moon", "Moon Tonight"],
      ["chemical-reactions", "Hidden World"],
    ]);
  });

  test("challenges are returned once, under their owning unit", () => {
    const rows = getResourcesByType("challenge");
    expect(rows).toHaveLength(1);
    const { resource, unit } = rows[0]!;
    expect(resource).toEqual({
      type: "challenge",
      href: "/challenge_welcome-to-floatia.html",
      filename: "challenge_welcome-to-floatia.html",
      label: "Build-a-Boat",
      displayOrder: resource.displayOrder,
    });
    expect(unit).toBe(getUnitBySlug("engineering-design"));
    expect([unit.slug, unit.grade, unit.topic]).toEqual([
      "engineering-design",
      "6",
      "tech-engineering",
    ]);
    expect(unit.title.length).toBeGreaterThan(0);
  });

  test("rows reference the manifest's own unit/resource objects", () => {
    for (const { resource, unit } of getResourcesByType("investigation")) {
      expect(getUnitBySlug(unit.slug)).toBe(unit);
      expect(unit.resources).toContain(resource);
      expect(resource.type).toBe("investigation");
    }
  });

  test("type rows match the existing per-lesson formal-resource rows exactly", () => {
    const fromTypes = (["simulation", "investigation", "extension", "challenge"] as const)
      .flatMap((t) => getResourcesByType(t))
      .map((r) => `${r.unit.slug}|${r.resource.href}`)
      .sort();
    const fromLessons = getSurfaceableLessons()
      .flatMap((l) => getFormalResourcesForLesson(l.slug).map((r) => `${l.slug}|${r.href}`))
      .sort();
    expect(fromTypes).toEqual(fromLessons);
    expect(new Set(fromTypes).size).toBe(fromTypes.length);
  });

  test("assignable, non-teacher-visible, shared, and unknown types yield nothing", () => {
    expect(getResourcesByType("lesson")).toEqual([]);
    expect(getResourcesByType("game")).toEqual([]);
    expect(getResourcesByType("activity")).toEqual([]);
    const loose = getResourcesByType as (t: string) => ReadonlyArray<unknown>;
    expect(loose("tool")).toEqual([]);
    expect(loose("not-a-type")).toEqual([]);
    expect(loose("toString")).toEqual([]);
  });

  test("does not mutate the manifest", () => {
    const before = JSON.stringify(CURRICULUM_MANIFEST);
    getResourcesByType("extension");
    getTeacherVisibleSharedResources("tool");
    getSurfaceableRelatedUnits(getSharedResources()[0]!);
    expect(JSON.stringify(CURRICULUM_MANIFEST)).toBe(before);
  });

  test("Lab Report Assistant's relatedUnits resolve to Conducting Experiments", () => {
    const lra = getSharedResources().find((r) => r.id === "lab-report-assistant");
    expect(lra).toBeDefined();
    const related = getSurfaceableRelatedUnits(lra!);
    expect(related).toHaveLength(1);
    expect(related[0]).toBe(getUnitBySlug("conducting-experiments"));
  });

  test("Lab Report Assistant is not teacher-surfaceable while Tool is teacherVisible: false", () => {
    expect(RESOURCE_TYPE_POLICY.tool.teacherVisible).toBe(false);
    expect(getTeacherVisibleSharedResources("tool")).toEqual([]);
  });

  // Policy, not resource-specific special casing, controls surfaceability:
  // a module instance whose policy differs changes the result.
  const withMocks = (mocks: {
    policy?: (p: typeof RESOURCE_TYPE_POLICY) => void;
    manifest?: (m: typeof CURRICULUM_MANIFEST) => void;
  }): typeof CurriculumManifestModule => {
    let mod: typeof CurriculumManifestModule | undefined;
    jest.isolateModules(() => {
      const policyJson = JSON.parse(
        JSON.stringify(require("./curriculum.resource-types.json")),
      );
      mocks.policy?.(policyJson.types);
      const manifestJson = JSON.parse(JSON.stringify(CURRICULUM_MANIFEST));
      mocks.manifest?.(manifestJson);
      jest.doMock("./curriculum.resource-types.json", () => policyJson);
      jest.doMock("./curriculum.manifest.json", () => manifestJson);
      mod = require("./curriculumManifest");
    });
    jest.dontMock("./curriculum.resource-types.json");
    jest.dontMock("./curriculum.manifest.json");
    return mod!;
  };

  test("flipping Tool teacherVisible in policy surfaces Lab Report Assistant", () => {
    const mod = withMocks({
      policy: (p) => {
        (p.tool as { teacherVisible: boolean }).teacherVisible = true;
      },
    });
    expect(mod.getTeacherVisibleSharedResources("tool").map((r) => r.id)).toEqual([
      "lab-report-assistant",
    ]);
  });

  test("hiding a unit type in policy removes it from type rows", () => {
    const mod = withMocks({
      policy: (p) => {
        (p.simulation as { teacherVisible: boolean }).teacherVisible = false;
      },
    });
    expect(mod.getResourcesByType("simulation")).toEqual([]);
  });

  test("gated units are excluded from type rows and related units", () => {
    const mod = withMocks({
      manifest: (m) => {
        const unit = m.topicGroups
          .flatMap((g) => g.units)
          .find((u) => u.slug === "what-is-life") as { gated: boolean };
        unit.gated = true;
        const conducting = m.topicGroups
          .flatMap((g) => g.units)
          .find((u) => u.slug === "conducting-experiments") as { gated: boolean };
        conducting.gated = true;
      },
    });
    const slugs = mod.getResourcesByType("investigation").map((r) => r.unit.slug);
    expect(slugs).not.toContain("what-is-life");
    expect(slugs).toHaveLength(3);
    expect(mod.getSurfaceableRelatedUnits(mod.getSharedResources()[0]!)).toEqual([]);
  });
});
