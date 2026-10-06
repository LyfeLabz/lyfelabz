/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
import * as path from "path";

const scripts = path.resolve(__dirname, "..", "..", "scripts");

const catalog = require(path.join(scripts, "curriculumCatalog.cjs")) as {
  BEGIN_MARKER: string;
  END_MARKER: string;
  renderCatalog(registryText?: string): string;
  extractCatalog(html: string): string;
  spliceCatalog(html: string, catalog?: string): string;
  readRootIndexHtml(): string;
};
const registry = require(path.join(scripts, "curriculumRegistry.cjs")) as {
  parseRegistryText(text: string): unknown;
  readRegistryText(): string;
};
const parser = require(path.join(scripts, "curriculumParser.cjs")) as {
  parseCurriculumFromIndexHtml(html: string): unknown;
};

type Json = Record<string, unknown>;

const registryText = registry.readRegistryText();
const rendered = catalog.renderCatalog(registryText);

describe("Homepage curriculum catalog generated from the registry", () => {
  test("rendering is deterministic", () => {
    expect(catalog.renderCatalog(registryText)).toBe(rendered);
    expect(catalog.renderCatalog()).toBe(rendered);
  });

  test("root index.html carries exactly the generated catalog", () => {
    const html = catalog.readRootIndexHtml();
    if (catalog.extractCatalog(html) !== rendered) {
      throw new Error(
        "Generated curriculum catalog drift in root index.html. Edit the registry and run `npm run curriculum:build` inside app/.",
      );
    }
    expect(catalog.spliceCatalog(html)).toBe(html);
  });

  test("the generated homepage parses back to exactly the registered curriculum", () => {
    expect(parser.parseCurriculumFromIndexHtml(catalog.readRootIndexHtml())).toEqual(
      registry.parseRegistryText(registryText),
    );
  });

  test("renders a representative lesson card with its child resource", () => {
    expect(rendered).toContain(
      [
        `          <div class="unit-card" id="unit-what-is-life">`,
        `            <div class="unit-top">`,
        `              <div class="unit-name">What Is Life?</div>`,
        `              <div class="unit-desc">What separates a living thing from a rock, a fire, or even a virus? Investigate the characteristics every organism shares, the discovery of cell theory, and why scientists still debate where the line of "alive" really falls.</div>`,
        `            </div>`,
        `            <div class="unit-links">`,
        `              <a href="lesson_what-is-life.html" class="ulink live">Lesson</a>`,
        `              <a href="investigation_gray-zone.html" class="ulink inv">The Gray Zone</a>`,
        `            </div>`,
        `          </div>`,
      ].join("\n"),
    );
  });

  test("child resources keep their ulink classes and labels", () => {
    expect(rendered).toContain(`<a href="simulation_floatlandia-fracture.html" class="ulink sim">Floatlandia Fracture</a>`);
    expect(rendered).toContain(`<a href="extension_body-systems.html" class="ulink ext">Medical Mysteries</a>`);
    expect(rendered).toContain(`<a href="challenge_welcome-to-floatia.html" class="ulink chal">Build-a-Boat</a>`);
  });

  test("topic groups, grade blocks, and units follow registry order", () => {
    const reg = JSON.parse(registryText) as {
      topicGroups: { topic: string; gated: boolean; gradeBlocks: { grade: string; units: { slug: string }[] }[] }[];
    };
    const groups = [...rendered.matchAll(/data-group="([^"]+)"/g)].map((m) => m[1]);
    expect(groups).toEqual(reg.topicGroups.map((g) => g.topic));
    const blocks = [...rendered.matchAll(/data-topic="([^"]+)" data-grades="([^"]+)"/g)].map((m) => `${m[1]}/${m[2]}`);
    expect(blocks).toEqual(reg.topicGroups.flatMap((g) => g.gradeBlocks.map((b) => `${g.topic}/${b.grade}`)));
    const ids = [...rendered.matchAll(/id="unit-([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(
      reg.topicGroups.filter((g) => !g.gated).flatMap((g) => g.gradeBlocks.flatMap((b) => b.units.map((u) => u.slug))),
    );
  });

  test("gated groups are locked, carry no unit ids, and render placeholder cards", () => {
    const start = rendered.indexOf(`data-group="behavioral-science"`);
    const gated = rendered.slice(start);
    expect(rendered).toContain(`<div class="topic-group tg-psych psych-locked" data-group="behavioral-science">`);
    expect(gated).not.toContain(`id="unit-`);
    expect(gated).toContain(`<a href="lesson_ragebaiting.html" class="ulink live">Lesson</a>`);
    expect(gated).toContain(
      `<div class="unit-name">Cognitive Biases</div>`,
    );
    expect(gated).toContain(`<div class="unit-name">Emotional Regulation &amp; Social Influence</div>`);
    expect(gated.match(/<div class="unit-links"><\/div>/g)).toHaveLength(2);
    expect(rendered.match(/psych-locked/g)).toHaveLength(1);
  });

  test("text is HTML-escaped and registry edits flow into the render", () => {
    const value = JSON.parse(registryText) as Json;
    const unit = (((value.topicGroups as Json[])[0].gradeBlocks as Json[])[0].units as Json[])[0];
    unit.title = "Cells <and> Life & More";
    const changed = catalog.renderCatalog(JSON.stringify(value));
    expect(changed).toContain(`<div class="unit-name">Cells &lt;and&gt; Life &amp; More</div>`);
    expect(changed).not.toContain(`<div class="unit-name">What Is Life?</div>`);
  });

  test("an invalid registry never renders", () => {
    const value = JSON.parse(registryText) as Json;
    (value.topicGroups as Json[])[0].topic = "astrology";
    expect(() => catalog.renderCatalog(JSON.stringify(value))).toThrow(/unknown canonical topic/);
  });

  test("splicing requires exactly one pair of markers and only touches the region", () => {
    const html = `<p>before</p>\n    ${catalog.BEGIN_MARKER}\n    old\n    ${catalog.END_MARKER}\n<p>after</p>\n`;
    const spliced = catalog.spliceCatalog(html, "    new\n");
    expect(spliced).toBe(`<p>before</p>\n    ${catalog.BEGIN_MARKER}\n    new\n    ${catalog.END_MARKER}\n<p>after</p>\n`);
    expect(catalog.extractCatalog(spliced)).toBe("    new\n");
    expect(() => catalog.spliceCatalog("<p>no markers</p>", "x")).toThrow(/missing/);
    expect(() => catalog.spliceCatalog(`${html}${html}`, "x")).toThrow(/duplicate/);
  });
});
