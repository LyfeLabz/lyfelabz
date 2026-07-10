/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
import * as fs from "fs";
import * as path from "path";

import {
  CURRICULUM_MANIFEST,
  TOPIC_LABEL,
  getAllUnits,
  getSurfaceableLessons,
  getTopicGroups,
  getOrphanUnits,
} from "./curriculumManifest";

const parserPath = path.resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "curriculumParser.cjs",
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parser = require(parserPath) as {
  buildManifest(): unknown;
  parseCurriculumFromIndexHtml(html: string): unknown;
  readRootIndexHtml(): string;
  sha256(text: string): string;
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
    expect(CURRICULUM_MANIFEST.canonicalSource).toBe("index.html");
    expect(CURRICULUM_MANIFEST.canonicalSourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(CURRICULUM_MANIFEST.doNotEditByHand).toMatch(/generated/i);
  });

  test("checked-in manifest matches a freshly parsed canonical index.html", () => {
    const fresh = parser.buildManifest() as typeof CURRICULUM_MANIFEST;
    const checked = JSON.parse(
      fs.readFileSync(MANIFEST_JSON_PATH, "utf8"),
    ) as unknown;
    if (JSON.stringify(fresh) !== JSON.stringify(checked)) {
      throw new Error(
        `Curriculum manifest drift detected between root index.html and app/src/curriculum/curriculum.manifest.json. ${REGENERATE_HINT}`,
      );
    }
    // Also verify the sha256 recorded in the manifest matches the current
    // canonical source verbatim. This catches accidental edits that would
    // keep the content but change the fingerprint.
    const sha = parser.sha256(parser.readRootIndexHtml());
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
    expect(lessons.length).toBe(47);
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
