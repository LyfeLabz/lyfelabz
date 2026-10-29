/**
 * Performance Operation 1 (production-compatible integration): Student
 * Support V1 exclusion guard.
 *
 * The nonblocking assignment-registry hydration was first certified on top of
 * Student Support Workspace V1. This branch carries the optimization onto the
 * production baseline WITHOUT V1, whose backend (support grants, the
 * student-scoped attempts read, question review text) is not deployed there.
 * These source pins fail if any V1 module, seam, Classes state, or Student
 * Detail mode enters the application through this integration.
 *
 * The patterns are deliberately specific: production already uses the word
 * "shared" (curriculum `placement: "shared"`, `./shared/` helper modules) and
 * already has an attempts-list-for-student read for the student results page.
 * The last describe block proves the guard leaves those alone.
 *
 * When Student Support is intentionally released to production, this guard is
 * retired in that same reviewed change.
 */
import * as fs from "fs";
import * as path from "path";

const srcRoot = path.resolve(__dirname, "../..");
const appRoot = path.resolve(srcRoot, "..");

const read = (rel: string): string => fs.readFileSync(path.join(srcRoot, rel), "utf8");

const listSourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...listSourceFiles(full));
    } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

// Student Support V1-only modules (Add Student Support Workspace V1).
const V1_ONLY_FILES = [
  "supportAccess/session.ts",
  "supportAccess/types.ts",
  "supportAccess/wire.ts",
  "shell/surfaces/classSupportAccess.ts",
  "shell/surfaces/studentDetailQuestionReview.ts",
];

// Identifiers and import specifiers that exist only in V1.
const V1_ONLY_SOURCE_PATTERNS: ReadonlyArray<RegExp> = [
  /from\s+["'][./]*(?:[\w-]+\/)*supportAccess\/[\w-]+["']/,
  /from\s+["'][./]*(?:[\w-]+\/)*classSupportAccess["']/,
  /from\s+["'][./]*(?:[\w-]+\/)*studentDetailQuestionReview["']/,
  /\binstallStudentSupportSeam\b/,
  /\bcreateStudentSupportSeam\b/,
  /\breadStudentSupportSeam\b/,
  /\bStudentSupportSeam\b/,
  /\bSharedStudent\b/,
  /\bappendQuestionReview\b/,
  /\bopenSharedStudent\b/,
  /\bcloseSharedStudent\b/,
  /\bsharedStudents\b/,
  /\bstudentSupportGrants?\b/,
];

// Classes-only V1 shapes: the "shared" workspace state and the read-only /
// question-review Student Detail mode.
const V1_ONLY_CLASSES_PATTERNS: ReadonlyArray<RegExp> = [
  /kind\s*===?\s*"shared"/,
  /kind\s*!==?\s*"shared"/,
  /kind:\s*"shared"/,
  /\brevisionContent\b/,
  /\bAssessmentRevisionContentReader\b/,
  /\breadOnly\s*=\s*false\b/,
  /student-detail-shared-context/,
  /student-detail-review-/,
];

const V1_ONLY_CSS = [
  ".shell-classes-shared",
  ".shell-classes-settings-support",
  ".shell-student-detail-review",
];

const matches = (text: string, patterns: ReadonlyArray<RegExp>): string[] =>
  patterns.filter((p) => p.test(text)).map((p) => p.source);

describe("Student Support V1 is excluded from the production-compatible integration", () => {
  test("no V1-only module exists", () => {
    for (const rel of V1_ONLY_FILES) {
      expect({ rel, exists: fs.existsSync(path.join(srcRoot, rel)) }).toEqual({ rel, exists: false });
    }
  });

  test("no application source imports or names a V1-only seam", () => {
    const offenders: Array<{ file: string; hits: string[] }> = [];
    for (const file of listSourceFiles(srcRoot)) {
      const hits = matches(fs.readFileSync(file, "utf8"), V1_ONLY_SOURCE_PATTERNS);
      if (hits.length > 0) offenders.push({ file: path.relative(srcRoot, file), hits });
    }
    expect(offenders).toEqual([]);
  });

  test("Classes has no shared-student state or read-only/question-review Student Detail mode", () => {
    expect(matches(read("shell/surfaces/classes.ts"), V1_ONLY_CLASSES_PATTERNS)).toEqual([]);
  });

  test("the entry point installs only production seams", () => {
    const index = read("index.ts");
    expect(index).toMatch(/installGradeImprovementsSeam\(/);
    expect(index).not.toMatch(/StudentSupport/);
  });

  test("the app shell carries no V1-only styles", () => {
    const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
    for (const selector of V1_ONLY_CSS) {
      expect({ selector, present: html.includes(selector) }).toEqual({ selector, present: false });
    }
  });
});

describe("the guard does not reject unrelated production functionality", () => {
  test("curriculum `placement: \"shared\"`, ./shared/ helpers, and the student attempts read pass", () => {
    const productionSamples = [
      read("curriculum/curriculumManifest.ts"),
      read("shell/surfaces/curriculum.ts"),
      read("assignments/studentResults/wire.ts"),
      read("index.ts"),
      read("shell/surfaces/classes.ts"),
    ];
    for (const text of productionSamples) {
      expect(matches(text, V1_ONLY_SOURCE_PATTERNS)).toEqual([]);
    }
    // Sanity: those samples really do contain the look-alikes.
    expect(read("curriculum/curriculumManifest.ts")).toMatch(/placement[^\n]*"shared"/);
    expect(read("shell/surfaces/classes.ts")).toMatch(/from "\.\/shared\/registryReadiness"/);
    expect(read("index.ts")).toMatch(/createAttemptsListForStudentCallable\(/);
    expect(read("shell/surfaces/classes.ts")).toMatch(/student-detail-thinking-toggle/);
    expect(read("shell/surfaces/classes.ts")).toMatch(/readGradeImprovementsSeam\(\)/);
  });

  test("each pattern does catch the V1 shape it targets", () => {
    const v1Samples = [
      'import { readStudentSupportSeam } from "../../supportAccess/session";',
      'import { appendQuestionReview } from "./studentDetailQuestionReview";',
      'import { renderSupportAccess } from "./classSupportAccess";',
      "installStudentSupportSeam(null);",
      "const shared = sharedStudents.find((s) => s.classId === classId);",
    ];
    for (const sample of v1Samples) {
      expect({ sample, hit: matches(sample, V1_ONLY_SOURCE_PATTERNS).length > 0 }).toEqual({ sample, hit: true });
    }
    for (const sample of ['if (state.kind === "shared") {', 'state = { kind: "shared", classes };', "revisionContent,"]) {
      expect({ sample, hit: matches(sample, V1_ONLY_CLASSES_PATTERNS).length > 0 }).toEqual({ sample, hit: true });
    }
  });
});
