/**
 * @jest-environment jsdom
 */

// F5.3 Slice 9D (addendum 21.4): runtime assessment-revision integrity.
// The server's frozen revision (returned by begin) is authority; the page's
// declaration (canonical) or assessment-presentation binding (AP-bound
// variant) only verifies it. On any disagreement nothing is autosaved or
// finalized. Exercised on the real lesson adapter over the real orchestrator
// with fake callables, and on the REAL committed Earth's Layers artifacts.

jest.mock("firebase/app", () => ({ getApps: () => [], initializeApp: jest.fn() }));
jest.mock("firebase/auth", () => ({
  connectAuthEmulator: jest.fn(),
  getAuth: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));
jest.mock("firebase/functions", () => ({
  connectFunctionsEmulator: jest.fn(),
  getFunctions: jest.fn(),
  httpsCallable: () => async () => ({ data: {} }),
}));

import * as fs from "fs";
import * as path from "path";

import { __internal } from "./entry";
import { ASSESSMENT_REVISION_MISMATCH_MESSAGE, createAssessmentRuntime } from "./orchestrator";
import type { FinalizeResult, RuntimeCallables, SessionResponse } from "./types";

const EL = "earths-layers";
const R1 = `assessment_${EL}__r1`;
const R2 = `assessment_${EL}__r2`;
const AP = `ap${"a".repeat(64)}`;
const REPO = path.resolve(__dirname, "..", "..", "..");
const { readPageAssessmentRevision: read, verifyPageAssessmentRevision: verify } = __internal;

const FINALIZE_RESULT: FinalizeResult = {
  attemptId: "a1__s1__a1", attemptNumber: 1, score: 1, maxScore: 1, percentage: 100, itemResults: [], replay: false,
};

function page(html: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><head>${html}</head><body></body></html>`, "text/html");
}
const declaration = (value: unknown, attrs = 'type="application/json"') =>
  `<script ${attrs} id="lyfelabz-assessment-revision">${typeof value === "string" ? value : JSON.stringify(value)}</script>`;
const decl = (lessonSlug: string, assessmentRevisionId: string) => declaration({ schemaVersion: 1, lessonSlug, assessmentRevisionId });
const apBlock = (lessonSlug: string, assessmentRevisionId: string) =>
  `<script type="application/json" id="lyfelabz-assessment-presentation">${JSON.stringify({
    schemaVersion: 1, lessonSlug, assessmentRevisionId, assessmentPresentationRevisionId: AP,
    items: [{ itemId: "q1", optionIds: ["C", "A", "D"] }],
  })}</script>`;
const check = (html: string, server: string | undefined) => verify(read(page(html)), server);

describe("page revision vs the server's frozen revision", () => {
  test.each([
    ["canonical r1 page, session r1", decl(EL, R1), R1, true],
    ["canonical r2 page, session r2", decl(EL, R2), R2, true],
    ["canonical r1 page, session r2", decl(EL, R1), R2, false],
    ["canonical r2 page, session r1", decl(EL, R2), R1, false],
    ["AP-bound r1 page, session r1", apBlock(EL, R1), R1, true],
    ["AP-bound r1 page, session r2", apBlock(EL, R1), R2, false],
    ["AP-bound page of another lesson", apBlock("water-cycle", "assessment_water-cycle__r1"), R1, false],
    ["declaration of another lesson", decl("water-cycle", "assessment_water-cycle__r1"), R1, false],
    ["legacy page (no declaration), session r1", "", R1, true],
    ["legacy page (no declaration), session r2", "", R2, false],
    ["malformed JSON declaration", declaration("{nope"), R1, false],
    ["declaration with an extra field", declaration({ schemaVersion: 1, lessonSlug: EL, assessmentRevisionId: R1, correct: 2 }), R1, false],
    ["declaration whose revision belongs to another lesson", declaration({ schemaVersion: 1, lessonSlug: EL, assessmentRevisionId: "assessment_water-cycle__r1" }), R1, false],
    ["non-JSON declaration element", declaration({ schemaVersion: 1, lessonSlug: EL, assessmentRevisionId: R1 }, 'type="text/javascript"'), R1, false],
    ["two declarations", decl(EL, R1) + decl(EL, R1), R1, false],
    ["declaration and AP block that disagree", decl(EL, R1) + apBlock(EL, R2), R1, false],
    ["declaration and AP block that agree", decl(EL, R1) + apBlock(EL, R1), R1, true],
    ["session without a revision", decl(EL, R1), undefined, false],
    ["session with a malformed revision", decl(EL, R1), "r1", false],
  ])("%s", (_label, html, server, ok) => {
    expect(check(html, server).ok).toBe(ok);
  });
});

describe("the real committed Earth's Layers artifacts", () => {
  const artifact = (rel: string) => new DOMParser().parseFromString(fs.readFileSync(path.join(REPO, rel), "utf8"), "text/html");
  test("the canonical v2 and v1 pages verify for r1 only", () => {
    for (const rel of ["app/lessons/lesson_earths-layers.html", "lesson_earths-layers.html"]) {
      expect(verify(read(artifact(rel)), R1)).toEqual({ ok: true });
      expect(verify(read(artifact(rel)), R2).ok).toBe(false);
    }
  });
  test("pr90f... (AP-bound, no canonical declaration) verifies for r1 only", () => {
    const doc = artifact("app/lessons/variants/lesson_earths-layers__pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189.html");
    expect(read(doc)).toEqual({ kind: "declared", lessonSlug: EL, assessmentRevisionId: R1 });
    expect(verify(read(doc), R2).ok).toBe(false);
  });
  test("historical prff01... (no declaration, no AP block) is accepted only for r1", () => {
    const doc = artifact("app/lessons/variants/lesson_earths-layers__prff01d9d2cf71210c491afc60cf98cd3d69b91d5c64cae51aff2463b50892375c.html");
    expect(read(doc)).toEqual({ kind: "none" });
    expect(verify(read(doc), R1)).toEqual({ ok: true });
    expect(verify(read(doc), R2).ok).toBe(false);
  });
});

describe("no response is sent before integrity succeeds", () => {
  function install(serverRevision: string | undefined): {
    quiz: { autosave: (s: ReadonlyArray<number | null>) => Promise<unknown>; finalize: (s: ReadonlyArray<number | null>) => Promise<unknown> };
    begins: () => number;
    sent: Array<readonly SessionResponse[]>;
    finalizes: () => number;
  } {
    let begins = 0;
    let finalizes = 0;
    const sent: Array<readonly SessionResponse[]> = [];
    const callables: RuntimeCallables = {
      begin: async () => {
        begins += 1;
        return { sessionId: "s1", alreadyLive: false, ...(serverRevision !== undefined ? { assessmentRevisionId: serverRevision } : {}) };
      },
      autosave: async (_id, responses) => {
        sent.push(responses);
        return { persisted: true };
      },
      finalize: async () => {
        finalizes += 1;
        return FINALIZE_RESULT;
      },
      getAttempt: async () => {
        throw new Error("unused");
      },
    };
    const runtime = createAssessmentRuntime({
      version: "test",
      assignmentId: "a1",
      callables,
      env: { randomId: () => "idk" },
      verifyAssessmentRevision: (server) => verify(read(document), server),
    });
    __internal.installLessonQuiz(window as unknown as Parameters<typeof __internal.installLessonQuiz>[0], runtime, true);
    const quiz = (window as unknown as { lyfelabz: { lessonQuiz: ReturnType<typeof install>["quiz"] } }).lyfelabz.lessonQuiz;
    return { quiz, begins: () => begins, sent, finalizes: () => finalizes };
  }

  afterEach(() => {
    delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  test("a matching page autosaves and finalizes exactly as before", async () => {
    document.head.innerHTML = decl(EL, R1);
    const h = install(R1);
    await h.quiz.autosave([0]);
    expect(h.sent).toEqual([[{ itemId: "q1", response: "A" }]]);
    expect(await h.quiz.finalize([1])).toMatchObject({ ok: true });
    expect(h.finalizes()).toBe(1);
  });

  test("a mismatched page sends no autosave and no finalize, with a plain message and no internal ids", async () => {
    document.head.innerHTML = decl(EL, R1);
    const h = install(R2);
    expect(await h.quiz.autosave([0])).toBeNull();
    const result = (await h.quiz.finalize([1])) as { ok: boolean; message: string; recoverable: boolean };
    expect(result).toEqual({ ok: false, message: ASSESSMENT_REVISION_MISMATCH_MESSAGE, recoverable: false });
    expect(result.message).not.toMatch(/assessment_|__r\d|ap[0-9a-f]{8}|sess|Firestore/i);
    // Retrying never re-begins, autosaves, or finalizes: recovery is a fresh launch.
    expect(await h.quiz.autosave([2])).toBeNull();
    expect(await h.quiz.finalize([2])).toMatchObject({ ok: false, message: ASSESSMENT_REVISION_MISMATCH_MESSAGE });
    expect(h.sent).toEqual([]);
    expect(h.finalizes()).toBe(0);
    expect(h.begins()).toBe(1);
  });

  test("a session without a revision (pre-9C-1 server) fails closed", async () => {
    document.head.innerHTML = decl(EL, R1);
    const h = install(undefined);
    await h.quiz.autosave([0]);
    expect(h.sent).toEqual([]);
  });

  test("an AP-bound page mapped to another revision fails closed before its first response", async () => {
    document.body.innerHTML = apBlock(EL, R1);
    const h = install(R2);
    await h.quiz.autosave([0]);
    expect(h.sent).toEqual([]);
  });
});
