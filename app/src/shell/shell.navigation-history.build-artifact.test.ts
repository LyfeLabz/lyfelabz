/**
 * @jest-environment node
 *
 * Human-acceptance regression. Chris's real-browser Back/Forward test
 * FAILED even though every jsdom test for this feature passed, and a
 * from-scratch real-browser reproduction of the exact source in
 * shell.ts/classes.ts (bundled standalone with esbuild and driven in an
 * actual Chromium tab) then confirmed the push/popstate logic itself
 * works correctly. The gap is architectural, not logical: this repo has
 * no dev server or watch mode - `npm --prefix app run build` is a
 * manual, one-shot esbuild step (see app/package.json) that regenerates
 * `dist/bundle.js`, and nothing in `npm run verify` runs it. A real
 * browser only ever executes whatever is currently sitting in
 * `dist/bundle.js`; every jsdom test in this suite imports `shell.ts`
 * SOURCE directly and therefore cannot detect a stale or never-rebuilt
 * bundle. This is the same class of gap `curriculum.assign-toast-css.test.ts`
 * ("B6") closed for CSS - jsdom tests asserted the DOM class was applied
 * and passed the whole time the browser showed nothing, because jsdom
 * never loads app/index.html's real CSS. The fix there, and here, is to
 * stop asserting only on source and start asserting on the artifact a
 * real browser actually loads.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const APP_ROOT = path.resolve(__dirname, "../..");
const BUNDLE_PATH = path.join(APP_ROOT, "dist", "bundle.js");

describe("Browser Back/Forward: the built bundle a real browser loads actually carries this feature", () => {
  beforeAll(() => {
    // Runs the exact command a human (or CI) uses to produce what
    // `app/index.html` serves (`<script type="module" src="/app/dist/bundle.js">`).
    // If this step is ever skipped before a human acceptance test, that is
    // precisely the failure mode this file exists to catch - so the test
    // does the build itself rather than trusting a pre-existing artifact.
    execSync("npm run build", { cwd: APP_ROOT, stdio: "pipe" });
  }, 60000);

  test("the built bundle contains all three history-state kinds", () => {
    const bundle = fs.readFileSync(BUNDLE_PATH, "utf8");
    expect(bundle).toContain("shell-surface");
    expect(bundle).toContain("shell-classes-workspace");
    expect(bundle).toContain("shell-student-detail");
  });

  test("the built bundle registers a popstate listener", () => {
    const bundle = fs.readFileSync(BUNDLE_PATH, "utf8");
    expect(bundle).toContain("popstate");
  });

  test("the built bundle never calls history.back()/forward()/go() for this feature", () => {
    // Pins the explicit safety decision from shell.ts's design: Back to
    // Students and popstate restoration use replaceState/pushState only,
    // never a blind history.back() that could leave LyfeLabz. A future
    // edit that reintroduces one would be a real, shippable regression -
    // this must fail on the ARTIFACT, not just readable TS source.
    const bundle = fs.readFileSync(BUNDLE_PATH, "utf8");
    expect(bundle).not.toMatch(/\.history\.back\s*\(/);
    expect(bundle).not.toMatch(/history\.forward\s*\(/);
  });
});
