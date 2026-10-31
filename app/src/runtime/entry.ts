import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import type { Functions } from "firebase/functions";

import { createAssessmentRuntime, isRecoverableCallableError } from "./orchestrator";
import type { AssessmentRuntime } from "./orchestrator";
import { detectLaunchRef } from "./launchParams";
import { createSaveCoordinator } from "./saveCoordinator";
import type { SaveCoordinator, SaveStatus } from "./saveCoordinator";
import type {
  AttemptItemResult,
  AttemptSummary,
  FinalizeResult,
  PersistedSessionState,
  RuntimeCallables,
  SessionResponse,
} from "./types";

// Sprint 17 Slice 5 browser entry point for the certified assessment
// runtime. Bundled via esbuild into the single canonical asset served
// on every instructional page.
//
// This entry:
//   1. Detects the assignment context handed off by the certified
//      launcher (Sprint 17 Slice 4: `?assignment=<id>`; since the launch-URL
//      hardening, `#assignment=<id>` in the fragment, query still accepted).
//   2. In standalone mode (no assignment context), remains inert: no
//      Firebase initialization, no auth listener, no network traffic.
//   3. In assignment mode, initializes Firebase against the same
//      configuration the authenticated app shell uses, waits for the
//      Firebase Auth session that the certified sign-in flow (Slice 3)
//      already persisted, and installs the orchestrator on
//      window.lyfelabz.assessmentRuntime.
//
// The entry point never scores, never reads answer keys, never touches
// Firestore directly, never carries lesson-specific logic, and never
// exposes teacher-only data or backend identifiers beyond the minimum
// the certified callable responses already project.

const VERSION = "17.5.0";
const NAMESPACE = "lyfelabz";
const RUNTIME_KEY = "assessmentRuntime";
const LESSON_QUIZ_KEY = "lessonQuiz";
const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

// Family A lesson-quiz adapter surface. Every Family A lesson
// (single-choice quiz, index-based selection state, A/B/C/D letters) is
// wired to the certified backend through this narrow helper so lessons
// never duplicate the response-shape mapping or the hasAssignmentContext
// guard. The types are declared here (not in `types.ts`) because they
// are not part of the certified callable contract; they are the pilot
// pattern the pilot lesson and every Slice-6 rollout lesson consume.
type LessonAutosaveResult = { readonly persisted: boolean } | null;
// Sprint 30 Show Your Thinking. Optional second argument to `finalize`: the
// lesson hands over the student's written explanation (the same text the v1
// Sheets path posts as `thinking`). Unscored; persisted on the attempt.
type LessonFinalizeOptions = { readonly writtenResponse?: unknown };
type LessonFinalizeResult =
  | { readonly ok: true; readonly result: FinalizeResult }
  | { readonly ok: false; readonly message: string; readonly recoverable: boolean }
  | null;
type LessonQuizGlobal = {
  readonly version: string;
  readonly optionLetters: readonly string[];
  hasAssignmentContext(): boolean;
  mapIndexSelectionsToResponses(
    indexSelections: ReadonlyArray<number | null | undefined>,
  ): readonly SessionResponse[];
  autosave(
    indexSelections: ReadonlyArray<number | null | undefined>,
  ): Promise<LessonAutosaveResult>;
  finalize(
    indexSelections: ReadonlyArray<number | null | undefined>,
    options?: LessonFinalizeOptions,
  ): Promise<LessonFinalizeResult>;
};

import { getEmulatorEndpoints, getFirebaseClientConfig } from "../firebase-config";

// Sprint 17 Slice 6: the runtime consumes the same shared client config
// module as the authenticated app shell (app/src/firebase.ts). Emulator
// hosts continue to receive the emulator-friendly placeholder; production
// hosts receive the injected certified project configuration. Neither
// the API key nor any other secret is embedded in this bundle.

// Diagnostic envelope for the first non-recoverable rejection that
// transitions the orchestrator to `error`. Populated by the lessonQuiz
// adapter (which is the earliest observer of a swallowed autosave
// rejection) so a developer inspecting `window.lyfelabz.assessmentRuntime`
// after a failed submission can read the original Firebase error code
// and safe message that the orchestrator's generic
// "assessment runtime is in an error state" would otherwise mask.
// Contains no student PII, no auth token, no lesson answer state.
type RuntimeLastError = {
  readonly callable: "begin" | "autosave" | "finalize";
  readonly code: string | undefined;
  readonly message: string | undefined;
  readonly at: number;
};

type RuntimeGlobal = {
  version: string;
  mode: string;
  hasAssignmentContext: boolean;
  lastError: RuntimeLastError | null;
  begin: () => Promise<void>;
  autosave: (responses: readonly SessionResponse[]) => Promise<{ readonly persisted: boolean }>;
  finalize: (
    responses: readonly SessionResponse[],
    writtenResponse?: string,
  ) => Promise<FinalizeResult>;
  getAttempt: (attemptId?: string) => Promise<AttemptSummary>;
};

type WindowWithRuntime = Window & {
  [NAMESPACE]?: {
    [RUNTIME_KEY]?: RuntimeGlobal;
    [LESSON_QUIZ_KEY]?: LessonQuizGlobal;
    deliveryNavigation?: DeliveryNavigationState;
  };
};

function mapIndexSelectionsToResponses(
  indexSelections: ReadonlyArray<number | null | undefined>,
): readonly SessionResponse[] {
  if (!indexSelections || typeof indexSelections.length !== "number") return [];
  const out: SessionResponse[] = [];
  for (let qi = 0; qi < indexSelections.length; qi++) {
    const idx = indexSelections[qi];
    if (idx === null || idx === undefined) continue;
    if (typeof idx !== "number" || idx < 0 || idx >= OPTION_LETTERS.length) continue;
    out.push({ itemId: `q${qi + 1}`, response: OPTION_LETTERS[idx]! });
  }
  return out;
}

// F5.3 Slice 4 - assessment-presentation option identity.
//
// A lesson artifact rendered from a certified assessment presentation
// (app/scripts/lessonBuilder/assessmentPresentationRender.cjs) carries one
// non-executable block
//   <script type="application/json" id="lyfelabz-assessment-presentation">
// listing, per item in canonical order, the canonical itemId and the
// canonical optionId of every DISPLAYED choice in display order. On such a
// page the response is that optionId: the display index only says which
// displayed choice was picked, and the identity comes from the certified
// record, never from a letter or position formula. Displayed choices may be
// reordered or reduced (three of four) freely.
//
// The block carries no correctness and is not authoritative: the server
// validates every response against the frozen revision (F5.3 Slice 2). A page
// without the block is a canonical lesson and keeps the legacy mapping below,
// which is correct there because canonical option ids ARE positional letters
// (enforced by the assessment-fidelity contract). A page WITH a block that is
// malformed, or a selection that does not fit it, fails closed: nothing is
// sent, and there is never a fallback to positional letters.
const PRESENTATION_BINDING_ELEMENT_ID = "lyfelabz-assessment-presentation";
const PRESENTATION_UNAVAILABLE_MESSAGE =
  "This quiz could not be loaded correctly, so your answers were not submitted. Refresh the page and try again.";

type PresentationBindingItem = {
  readonly itemId: string;
  readonly optionIds: readonly string[];
};

type PresentationBinding =
  | { readonly kind: "none" }
  | {
      readonly kind: "bound";
      readonly items: readonly PresentationBindingItem[];
      // The certified presentation this page displays (root of the block).
      readonly assessmentPresentationRevisionId?: string;
    }
  | { readonly kind: "malformed"; readonly reason: string };

class PresentationBindingError extends Error {
  constructor(reason: string) {
    super(`assessment presentation binding refused: ${reason}`);
    this.name = "PresentationBindingError";
  }
}

const BINDING_TOKEN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;

function readPresentationBinding(doc: Document | undefined): PresentationBinding {
  if (!doc || typeof doc.getElementById !== "function") return { kind: "none" };
  const el = doc.getElementById(PRESENTATION_BINDING_ELEMENT_ID);
  if (el === null) return { kind: "none" };
  if (el.tagName !== "SCRIPT" || el.getAttribute("type") !== "application/json") {
    return { kind: "malformed", reason: "binding element is not a JSON script block" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(el.textContent ?? "");
  } catch {
    return { kind: "malformed", reason: "binding block is not valid JSON" };
  }
  const root = parsed as {
    schemaVersion?: unknown;
    items?: unknown;
    assessmentPresentationRevisionId?: unknown;
  };
  if (parsed === null || typeof parsed !== "object" || root.schemaVersion !== 1) {
    return { kind: "malformed", reason: "binding block has an unsupported schemaVersion" };
  }
  if (!Array.isArray(root.items) || root.items.length === 0) {
    return { kind: "malformed", reason: "binding block has no items" };
  }
  const items: PresentationBindingItem[] = [];
  const seenItems = new Set<string>();
  for (const raw of root.items as unknown[]) {
    const item = raw as { itemId?: unknown; optionIds?: unknown };
    if (raw === null || typeof raw !== "object" || Object.keys(raw).some((k) => k !== "itemId" && k !== "optionIds")) {
      return { kind: "malformed", reason: "binding item has an unexpected shape" };
    }
    if (typeof item.itemId !== "string" || !BINDING_TOKEN_RE.test(item.itemId) || seenItems.has(item.itemId)) {
      return { kind: "malformed", reason: "binding item has a missing, invalid, or duplicate itemId" };
    }
    seenItems.add(item.itemId);
    if (!Array.isArray(item.optionIds) || item.optionIds.length < 2) {
      return { kind: "malformed", reason: `item ${item.itemId} has no displayed option mapping` };
    }
    const optionIds = item.optionIds as unknown[];
    if (
      !optionIds.every((id) => typeof id === "string" && BINDING_TOKEN_RE.test(id)) ||
      new Set(optionIds).size !== optionIds.length
    ) {
      return { kind: "malformed", reason: `item ${item.itemId} has a missing, invalid, or duplicate optionId` };
    }
    items.push({ itemId: item.itemId, optionIds: optionIds as string[] });
  }
  const apId = root.assessmentPresentationRevisionId;
  return typeof apId === "string" && BINDING_TOKEN_RE.test(apId)
    ? { kind: "bound", items, assessmentPresentationRevisionId: apId }
    : { kind: "bound", items };
}

// Maps the lesson's per-question display-index selections to responses for
// the page's binding. Throws PresentationBindingError (never falls back) when
// the page is presentation-bound and the binding or a selection is invalid.
function mapSelectionsForBinding(
  indexSelections: ReadonlyArray<number | null | undefined>,
  binding: PresentationBinding,
): readonly SessionResponse[] {
  if (binding.kind === "none") return mapIndexSelectionsToResponses(indexSelections);
  if (binding.kind === "malformed") throw new PresentationBindingError(binding.reason);
  if (!indexSelections || typeof indexSelections.length !== "number") {
    throw new PresentationBindingError("selections are not an array");
  }
  if (indexSelections.length !== binding.items.length) {
    throw new PresentationBindingError(
      `lesson reports ${indexSelections.length} questions; the presentation has ${binding.items.length}`,
    );
  }
  const out: SessionResponse[] = [];
  for (let qi = 0; qi < indexSelections.length; qi++) {
    const idx = indexSelections[qi];
    if (idx === null || idx === undefined) continue;
    const item = binding.items[qi]!;
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= item.optionIds.length) {
      throw new PresentationBindingError(`selection for item ${item.itemId} is not a displayed choice`);
    }
    out.push({ itemId: item.itemId, response: item.optionIds[idx]! });
  }
  return out;
}

// Quiz session continuity - restoring persisted answers after a reload.
//
// The inverse of `mapSelectionsForBinding`: a persisted `{itemId, response}`
// is located on THIS page by stable identity (the binding's itemId and
// optionId on a presentation-bound page; the canonical `q<n>` item and
// positional letter on a canonical page, where option ids ARE the letters),
// never by a guessed position. A response this page does not display is not
// restorable. A page whose presentation is not the session's frozen
// presentation restores nothing at all.
type QuizSelection = { readonly qi: number; readonly oi: number };

const CANONICAL_ITEM_RE = /^q([1-9][0-9]{0,3})$/;

function locatePersistedResponse(
  response: SessionResponse,
  binding: PresentationBinding,
): QuizSelection | null {
  if (typeof response.response !== "string") return null;
  if (binding.kind === "malformed") return null;
  if (binding.kind === "bound") {
    const qi = binding.items.findIndex((item) => item.itemId === response.itemId);
    if (qi < 0) return null;
    const oi = binding.items[qi]!.optionIds.indexOf(response.response);
    return oi < 0 ? null : { qi, oi };
  }
  const match = CANONICAL_ITEM_RE.exec(response.itemId);
  if (match === null) return null;
  const oi = (OPTION_LETTERS as readonly string[]).indexOf(response.response);
  return oi < 0 ? null : { qi: Number(match[1]) - 1, oi };
}

function presentationMatchesSession(
  binding: PresentationBinding,
  state: PersistedSessionState,
): boolean {
  if (binding.kind === "malformed") return false;
  const page = binding.kind === "bound" ? binding.assessmentPresentationRevisionId : undefined;
  return (page ?? null) === (state.assessmentPresentationRevisionId ?? null);
}

// Every lesson quiz renders each choice as
//   <button class="quiz-option" onclick="<prefix>SelectAnswer(qi, oi)">
// (one shared pattern across every lesson source). Selecting through that
// button runs the lesson's own handler, so the lesson's state, progress bar,
// and submit gate update exactly as for a student's click.
const QUIZ_OPTION_ONCLICK_RE = /SelectAnswer\(\s*(\d+)\s*,\s*(\d+)\s*\)/;

function quizOptionButtons(doc: Document): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("button.quiz-option"))) {
    const match = QUIZ_OPTION_ONCLICK_RE.exec(el.getAttribute("onclick") ?? "");
    if (match !== null) out.set(`${match[1]}:${match[2]}`, el);
  }
  return out;
}

// While restoring, the lesson's own handler calls lessonQuiz.autosave with a
// partially rebuilt selection; those calls are suppressed (the server already
// holds every restored answer). A restored written response is likewise
// adopted as known text without a write. `onRestored` runs after the page
// shows answers or text the server confirmed it holds; `serverSelections`
// records which displayed choices ("qi:oi") the server holds.
type RestoreGuard = {
  restoring: boolean;
  onRestored?: () => void;
  serverSelections?: ReadonlySet<string>;
};

// Every lesson quiz section (`#quiz`) holds exactly one textarea: the Show
// Your Thinking explanation the lesson submits as `writtenResponse`. Any other
// shape is not recognized, and then no text is autosaved or restored.
function quizWrittenResponseInput(doc: Document | undefined): HTMLTextAreaElement | null {
  if (doc === undefined) return null;
  const quiz = doc.getElementById("quiz");
  if (quiz === null) return null;
  const inputs = quiz.querySelectorAll("textarea");
  return inputs.length === 1 ? (inputs[0] as HTMLTextAreaElement) : null;
}

function whenDocumentReady(doc: Document, fn: () => void): void {
  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

// Restores saved text only into an empty input (text the student already
// typed on this page wins). The input event lets the lesson's own submit gate
// see the text, exactly as if the student had typed it.
function applyRestoredWrittenResponse(
  doc: Document,
  text: string,
  guard: RestoreGuard,
): boolean {
  const input = quizWrittenResponseInput(doc);
  if (input === null || input.disabled) return false;
  // Text the student already has on this page wins, unless it is exactly
  // what the server holds (a browser restoring the form, say); then it is
  // adopted as saved.
  const current = input.value.trim();
  if (current.length > 0 && current !== text.trim()) return false;
  guard.restoring = true;
  try {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } finally {
    guard.restoring = false;
  }
  return true;
}

function applyRestoredSelections(
  doc: Document,
  selections: readonly QuizSelection[],
  guard: RestoreGuard,
): boolean {
  const buttons = quizOptionButtons(doc);
  let restored = false;
  guard.restoring = true;
  try {
    for (const { qi, oi } of selections) {
      // The student already chose for this question on this page: keep it.
      let alreadyChosen = false;
      for (const [key, el] of buttons) {
        if (key.startsWith(`${qi}:`) && el.classList.contains("selected")) {
          alreadyChosen = true;
          break;
        }
      }
      if (alreadyChosen) continue;
      const button = buttons.get(`${qi}:${oi}`);
      if (button === undefined || (button as HTMLButtonElement).disabled) continue;
      button.click();
      restored = true;
    }
  } finally {
    guard.restoring = false;
  }
  return restored;
}

// The displayed choices ("qi:oi") currently selected on the page.
function selectedChoiceKeys(doc: Document): string[] {
  const keys: string[] = [];
  for (const [key, el] of quizOptionButtons(doc)) {
    if (el.classList.contains("selected")) keys.push(key);
  }
  return keys;
}

// The orchestrator's `adoptPersisted` hook for a lesson page: answers which
// persisted responses this page can display (the autosave baseline) and
// restores them into the quiz UI.
function adoptPersistedForPage(
  win: Window,
  state: PersistedSessionState,
  guard: RestoreGuard,
): readonly SessionResponse[] {
  const doc = documentOf(win);
  if (doc === undefined) return [];
  const binding = readPresentationBinding(doc);
  if (!presentationMatchesSession(binding, state)) return [];
  const savedText = state.writtenResponse;
  const kept: SessionResponse[] = [];
  const selections: QuizSelection[] = [];
  for (const response of state.responses) {
    const located = locatePersistedResponse(response, binding);
    if (located === null) continue;
    kept.push(response);
    selections.push(located);
  }
  guard.serverSelections = new Set(selections.map(({ qi, oi }) => `${qi}:${oi}`));
  const hasText = typeof savedText === "string" && savedText.trim().length > 0;
  if (hasText || selections.length > 0) {
    whenDocumentReady(doc, () => {
      const textRestored = hasText && applyRestoredWrittenResponse(doc, savedText, guard);
      const answersRestored = applyRestoredSelections(doc, selections, guard);
      // Saved only when the page now shows exactly what the server holds:
      // an answer or text the student entered here first may not be saved.
      const server = guard.serverSelections ?? new Set<string>();
      const pageText = quizWrittenResponseInput(doc)?.value.trim() ?? "";
      const matchesServer =
        selectedChoiceKeys(doc).every((key) => server.has(key)) &&
        pageText === (hasText ? savedText.trim() : "");
      if ((textRestored || answersRestored) && matchesServer) guard.onRestored?.();
    });
  }
  return kept;
}

// F5.3 Slice 9D (addendum 21.4): the assessment revision a page DISPLAYS.
//
// A canonical page (and every rendition) declares it in the inert
//   <script type="application/json" id="lyfelabz-assessment-revision">
//   {"schemaVersion":1,"lessonSlug":"...","assessmentRevisionId":"..."}
// block (F5.3 Slice 9B). An AP-bound variant declares it in the root of its
// existing `lyfelabz-assessment-presentation` block. If both exist they must
// agree. A page with neither is a legacy pre-Slice-9 artifact (retained
// prff01d9...375c, or a canonical page cached from before 9B), which was
// built while r1 was the only revision; it is accepted ONLY when the server's
// frozen revision is r1 (a repository test proves every retained
// no-declaration artifact displays r1). Nothing here is authoritative: the
// server's revision decides, and this only verifies the page against it.
const REVISION_DECLARATION_ELEMENT_ID = "lyfelabz-assessment-revision";
const FROZEN_REVISION_RE = /^assessment_([a-z0-9]+(?:-[a-z0-9]+)*)__r([1-9][0-9]*)$/;

type PageAssessmentRevision =
  | { readonly kind: "none" }
  | { readonly kind: "declared"; readonly lessonSlug: string; readonly assessmentRevisionId: string }
  | { readonly kind: "malformed"; readonly reason: string };

function jsonBlock(doc: Document, id: string): { readonly present: false } | { readonly present: true; readonly value: unknown; readonly error?: string } {
  const matches = typeof doc.querySelectorAll === "function" ? doc.querySelectorAll(`[id="${id}"]`).length : 0;
  const el = doc.getElementById(id);
  if (el === null) return { present: false };
  if (matches > 1) return { present: true, value: null, error: `more than one ${id} block` };
  if (el.tagName !== "SCRIPT" || el.getAttribute("type") !== "application/json") {
    return { present: true, value: null, error: `${id} is not a JSON script block` };
  }
  try {
    return { present: true, value: JSON.parse(el.textContent ?? "") as unknown };
  } catch {
    return { present: true, value: null, error: `${id} is not valid JSON` };
  }
}

function identityOf(value: unknown, closed: boolean): { readonly lessonSlug: string; readonly assessmentRevisionId: string } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== 1) return null;
  if (closed && Object.keys(root).sort().join("|") !== "assessmentRevisionId|lessonSlug|schemaVersion") return null;
  const { lessonSlug, assessmentRevisionId } = root;
  if (typeof lessonSlug !== "string" || typeof assessmentRevisionId !== "string") return null;
  const match = FROZEN_REVISION_RE.exec(assessmentRevisionId);
  if (match === null || match[1] !== lessonSlug) return null;
  return { lessonSlug, assessmentRevisionId };
}

function readPageAssessmentRevision(doc: Document | undefined): PageAssessmentRevision {
  if (!doc || typeof doc.getElementById !== "function") return { kind: "none" };
  const declaration = jsonBlock(doc, REVISION_DECLARATION_ELEMENT_ID);
  const binding = jsonBlock(doc, PRESENTATION_BINDING_ELEMENT_ID);
  const found: Array<{ readonly lessonSlug: string; readonly assessmentRevisionId: string }> = [];
  for (const [block, closed, label] of [
    [declaration, true, "assessment revision declaration"],
    [binding, false, "assessment presentation binding"],
  ] as const) {
    if (!block.present) continue;
    if (block.error !== undefined) return { kind: "malformed", reason: block.error };
    const identity = identityOf(block.value, closed);
    if (identity === null) return { kind: "malformed", reason: `${label} does not name a lesson and an assessment revision of it` };
    found.push(identity);
  }
  if (found.length === 0) return { kind: "none" };
  if (found.length === 2 && (found[0]!.lessonSlug !== found[1]!.lessonSlug || found[0]!.assessmentRevisionId !== found[1]!.assessmentRevisionId)) {
    return { kind: "malformed", reason: "the page declares two different assessment revisions" };
  }
  return { kind: "declared", ...found[0]! };
}

// Pure comparison of the page with the server's frozen revision.
function verifyPageAssessmentRevision(
  page: PageAssessmentRevision,
  serverAssessmentRevisionId: string | undefined,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const server = typeof serverAssessmentRevisionId === "string" ? FROZEN_REVISION_RE.exec(serverAssessmentRevisionId) : null;
  if (server === null) return { ok: false, reason: "the session carries no usable assessment revision" };
  if (page.kind === "malformed") return { ok: false, reason: page.reason };
  if (page.kind === "none") {
    // Legacy pre-Slice-9 page: r1 only (never a guess of which revision to show).
    return server[2] === "1" ? { ok: true } : { ok: false, reason: "a page without a revision declaration can only display r1" };
  }
  if (page.lessonSlug !== server[1] || page.assessmentRevisionId !== serverAssessmentRevisionId) {
    return { ok: false, reason: "the page displays another assessment revision than the session" };
  }
  return { ok: true };
}

function documentOf(win: Window): Document | undefined {
  try {
    return win.document;
  } catch {
    return undefined;
  }
}

// Mirrors the server's WRITTEN_RESPONSE_MAX_LENGTH
// (platform/functions/src/shared/types/assessment-session.ts).
const WRITTEN_RESPONSE_MAX_LENGTH = 10000;

// Normalize the lesson-supplied Show Your Thinking text to the server
// contract: a trimmed string within the cap, or undefined (nothing sent).
// Over-cap text is truncated rather than sent, because the server refuses
// it and that refusal would otherwise fail the scored submission as well.
function normalizeWrittenResponse(options: unknown): string | undefined {
  if (options === null || typeof options !== "object") return undefined;
  const raw = (options as { writtenResponse?: unknown }).writtenResponse;
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  return text.length > WRITTEN_RESPONSE_MAX_LENGTH
    ? text.slice(0, WRITTEN_RESPONSE_MAX_LENGTH).trim()
    : text;
}

// The lesson helper is a thin normalizer: pure mapping + soft error
// envelope. Recoverable Firebase errors surface `{ok:false,recoverable:true}`
// so the lesson can prompt the student to retry without a full reload.
// Non-recoverable errors surface `{ok:false,recoverable:false}` so the
// lesson can move on. Neither branch throws; lessons never need try/catch.
function isRecoverableFirebaseError(err: unknown): boolean {
  return isRecoverableCallableError(err);
}

// The session this page was answering no longer accepts answers: another tab
// or window submitted it (a committed finalize deletes the session) or it is
// no longer Live. The platform code travels in `HttpsError.details.code`.
const STALE_SESSION_CODES: ReadonlySet<string> = new Set([
  "assessmentSessions.sessionNotFound",
  "assessmentSessions.sessionNotLive",
  "assessmentAttempts.sessionNotFound",
  "assessmentAttempts.sessionNotLive",
]);

const STALE_SESSION_MESSAGE =
  "This quiz was already submitted in another tab or window, so these answers were not submitted. Close the other tabs for this assignment, then go back to My Science and open the assignment again.";

function platformErrorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const details = (err as { details?: unknown }).details;
  if (details === null || typeof details !== "object") return undefined;
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function finalizeFailureMessage(err: unknown): string {
  const platformCode = platformErrorCode(err);
  if (platformCode !== undefined && STALE_SESSION_CODES.has(platformCode)) {
    return STALE_SESSION_MESSAGE;
  }
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "submission failed";
}

// Sentinel error surfaced to the lesson UI when the runtime is not yet
// wired (bootstrap awaiting Firebase Auth, or an authenticated user was
// never resolved). Returning `null` in this case is a production hazard:
// the pilot lesson UI awaits either `{ok:true}` or `{ok:false,message}`
// and has no branch for a null resolution, so a null leaves the student
// staring at "Submitting..." forever. See app/lessons/lesson_earths-layers.html
// finalize handler.
const NOT_READY_MESSAGE =
  "Your submission service isn't ready yet. Refresh the page and try again.";

// Extract a safe {code, message} envelope from an unknown rejection.
// Firebase FunctionsError carries a stable string `code` (e.g.
// "functions/internal", "functions/unauthenticated"); other rejections
// may only carry `message`. Never returns stack traces, request bodies,
// tokens, or callable-details payloads that could echo student answers.
function safeErrorEnvelope(err: unknown): {
  readonly code: string | undefined;
  readonly message: string | undefined;
} {
  if (err === null || typeof err !== "object") {
    return { code: undefined, message: typeof err === "string" ? err : undefined };
  }
  const code = (err as { code?: unknown }).code;
  const message = (err as { message?: unknown }).message;
  return {
    code: typeof code === "string" ? code : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

// Diagnostic sink for the earliest observable callable rejection. The
// orchestrator masks the underlying rejection behind a generic
// "assessment runtime is in an error state" once mode transitions to
// `error`; this helper captures the original safe envelope one level
// earlier so a developer can read it off `window.lyfelabz.assessmentRuntime.lastError`
// after a failed submission, and simultaneously emits a single
// console.warn so the rejection appears in DevTools even if the student
// never inspects the runtime object. Idempotent: only the first
// rejection is recorded (subsequent calls after the runtime is in error
// mode all surface the same generic guard error and would overwrite the
// diagnostically useful root event).
function recordLastError(
  win: WindowWithRuntime,
  callable: RuntimeLastError["callable"],
  err: unknown,
): void {
  try {
    const envelope = safeErrorEnvelope(err);
    const ns = win[NAMESPACE] ?? {};
    const runtime = ns[RUNTIME_KEY];
    if (runtime && runtime.lastError === null) {
      const entry: RuntimeLastError = {
        callable,
        code: envelope.code,
        message: envelope.message,
        at: Date.now(),
      };
      (runtime as { lastError: RuntimeLastError | null }).lastError = entry;
      try {
        // eslint-disable-next-line no-console
        console.warn("[lyfelabz] assessment callable rejected", {
          callable,
          code: envelope.code,
          message: envelope.message,
        });
      } catch {
        // console access failure is non-fatal.
      }
    }
  } catch {
    // Diagnostic sink must never itself throw.
  }
}

// The student already started a new attempt while this submission was in
// flight. Its outcome belongs to the discarded attempt, so the lesson's
// handler is never called: it would otherwise write that outcome over the new
// attempt's quiz. The attempt itself is recorded (or not) on the server.
function supersededSubmission(): Promise<never> {
  return new Promise<never>(() => undefined);
}

// The shim-owned student navigation state (assets/lyfelabz-assessment-runtime.js).
type DeliveryNavigationState = {
  finalizeStarted?: () => void;
  finalizeSettled?: (finalized: boolean) => void;
};

// Student save status, carried by the quiz's sticky progress tray so it stays
// in view while the student answers any question and scrolls away with the
// quiz. It never claims "Saved" before the backend acknowledged the latest
// change, and no lesson content moves:
// - Saving and Saved show as a short label inside the tray's progress row
//   (beside "x / 10 selected"), so they never cover a question.
// - The longer problem states (Not saved, Try again) hang as a pill below the
//   tray, absolutely positioned and click-through except for Try again. They
//   cover the top of the quiz content while shown; that is deliberate.
// The status element itself is the one live region for every state (visually
// hidden while the row label shows its text). A quiz without the tray gets an
// in-flow line after the Submit row instead (never inside it, so Submit stays
// centered).
const SAVE_STATUS_ID = "lyfelabz-save-status";
const SAVE_STATUS_LABEL_ID = "lyfelabz-save-status-label";
const SAVE_STATUS_STYLE_ID = "lyfelabz-save-status-style";
const COMPACT_SAVE_STATUSES: ReadonlySet<string> = new Set(["pending", "saving", "saved"]);

type SaveStatusView = SaveStatus | "signedOut" | "tooLong";

export const SAVE_STATUS_MESSAGES: Readonly<Record<SaveStatusView, string>> = {
  idle: "",
  pending: "Saving...",
  saving: "Saving...",
  saved: "Saved",
  retrying: "Connection problem. Trying to save again...",
  failed: "Not saved. Check your connection. Your work is still on this page.",
  blocked:
    "Not saved. Copy your written explanation somewhere safe, then reload this page to keep saving.",
  signedOut:
    "Not saved. You appear to be signed out. Sign in and reopen the assignment to save your work.",
  tooLong: `Your explanation is not saved. It is over ${WRITTEN_RESPONSE_MAX_LENGTH.toLocaleString("en-US")} characters. Shorten it to keep saving.`,
};

const SAVE_STATUS_SELECTOR = `#${SAVE_STATUS_ID}`;
const SAVE_STATUS_CSS =
  `${SAVE_STATUS_SELECTOR}{box-sizing:border-box;font-size:.8rem;line-height:1.35;color:var(--text-muted,#7ab4cc);text-align:right}` +
  `${SAVE_STATUS_SELECTOR}[data-save-anchor="tray"]{position:absolute;top:100%;right:max(.75rem,env(safe-area-inset-right));margin-top:.45rem;max-width:min(22rem,calc(100% - 1.5rem));padding:.3rem .8rem;border-radius:999px;background:var(--dark2,#111a24);border:1px solid var(--border,rgba(255,255,255,.12));box-shadow:0 4px 12px rgba(0,0,0,.25);pointer-events:none}` +
  `${SAVE_STATUS_SELECTOR}[data-save-anchor="inline"]{margin:.6rem auto 0;text-align:center;min-height:1.2em}` +
  `${SAVE_STATUS_SELECTOR}[data-save-status="idle"],${SAVE_STATUS_SELECTOR}[data-save-status="hidden"]{padding:0;border-color:transparent;background:transparent;box-shadow:none}` +
  `${SAVE_STATUS_SELECTOR}[data-save-status="failed"],${SAVE_STATUS_SELECTOR}[data-save-status="blocked"],${SAVE_STATUS_SELECTOR}[data-save-status="signedOut"],${SAVE_STATUS_SELECTOR}[data-save-status="tooLong"]{color:var(--orange,#e67e22);font-weight:600;border-radius:12px}` +
  `${SAVE_STATUS_SELECTOR} button{margin-left:.5rem;min-height:2.2rem;padding:.3rem .9rem;border-radius:8px;border:1.5px solid currentColor;background:transparent;color:inherit;font:inherit;cursor:pointer;pointer-events:auto}` +
  `${SAVE_STATUS_SELECTOR}[data-save-compact="true"]{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;box-shadow:none}` +
  `#${SAVE_STATUS_LABEL_ID}{flex:none;font-size:.75rem;line-height:1;font-weight:700;white-space:nowrap;color:var(--text-muted,#7ab4cc)}` +
  `#${SAVE_STATUS_LABEL_ID}:empty{display:none}` +
  // The phone menu drops the tray out of sticky positioning; the pill follows it.
  `body:has(nav.menu-open) ${SAVE_STATUS_SELECTOR}[data-save-anchor="tray"]{display:none}`;

function ensureSaveStatusElement(doc: Document | undefined): HTMLElement | null {
  if (doc === undefined) return null;
  const existing = doc.getElementById(SAVE_STATUS_ID);
  if (existing !== null) return existing;
  const quiz = doc.getElementById("quiz");
  if (quiz === null) return null;
  const tray = quiz.querySelector(".quiz-progress-sticky");
  const submitRow = quiz.querySelector(".quiz-submit-btn")?.parentElement ?? null;
  if (tray === null && (submitRow === null || submitRow.parentNode === null)) return null;
  if (doc.getElementById(SAVE_STATUS_STYLE_ID) === null && doc.head !== null) {
    const style = doc.createElement("style");
    style.id = SAVE_STATUS_STYLE_ID;
    style.textContent = SAVE_STATUS_CSS;
    doc.head.appendChild(style);
  }
  const el = doc.createElement("div");
  el.id = SAVE_STATUS_ID;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("data-save-status", "idle");
  if (tray !== null) {
    el.setAttribute("data-save-anchor", "tray");
    tray.appendChild(el);
    const row = tray.querySelector(".quiz-progress");
    if (row !== null) {
      const label = doc.createElement("span");
      label.id = SAVE_STATUS_LABEL_ID;
      label.setAttribute("aria-hidden", "true");
      row.insertBefore(label, row.querySelector(".progress-text"));
    }
  } else if (submitRow !== null && submitRow.parentNode !== null) {
    el.setAttribute("data-save-anchor", "inline");
    submitRow.parentNode.insertBefore(el, submitRow.nextSibling);
  }
  return el;
}

function renderSaveStatus(
  doc: Document | undefined,
  status: SaveStatusView | "hidden",
  onRetry?: () => void,
): void {
  const el = ensureSaveStatusElement(doc);
  if (el === null || doc === undefined) return;
  el.setAttribute("data-save-status", status);
  el.textContent = status === "hidden" ? "" : SAVE_STATUS_MESSAGES[status];
  const label = doc.getElementById(SAVE_STATUS_LABEL_ID);
  if (label !== null) {
    const compact = status === "hidden" || status === "idle" || COMPACT_SAVE_STATUSES.has(status);
    el.setAttribute("data-save-compact", compact ? "true" : "false");
    label.textContent = compact && status !== "hidden" ? SAVE_STATUS_MESSAGES[status] : "";
  }
  if (status === "failed" && onRetry !== undefined) {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = "Try again";
    button.addEventListener("click", onRetry);
    el.appendChild(button);
  }
}

// One save queue per assigned page: selections and Show Your Thinking text
// are saved together through the runtime, with bounded retries and a visible
// status (see saveCoordinator.ts).
//
// Over-limit text is never sent (the server would store a truncated copy and
// the status would say Saved). The last saved text stays on the server, the
// text stays on the page, and the status says the explanation is not saved
// until it is shortened. Connection and reload problems still take precedence.
type PageSaves = SaveCoordinator & {
  setTextOverLimit(over: boolean): void;
  isTextOverLimit(): boolean;
  // The page now shows what the server confirmed it holds. Says Saved only
  // when nothing on the page is still waiting to be saved.
  showRestored(): void;
};

function createPageSaveCoordinator(
  win: WindowWithRuntime,
  runtime: AssessmentRuntime,
): PageSaves {
  const doc = documentOf(win);
  let coordinator: SaveCoordinator | null = null;
  let textOverLimit = false;
  const retry = () => coordinator?.retryNow();
  const render = () => {
    if (coordinator === null) return;
    const status = coordinator.getStatus();
    const urgent = status === "blocked" || status === "failed" || status === "retrying";
    renderSaveStatus(doc, textOverLimit && !urgent ? "tooLong" : status, retry);
  };
  coordinator = createSaveCoordinator({
    send: (responses, writtenResponse) =>
      writtenResponse === undefined
        ? runtime.autosave(responses)
        : runtime.autosave(responses, writtenResponse),
    // The runtime refuses every later call until a reload once it is in its
    // error state (authentication, permission, integrity, refusal).
    isPermanentFailure: () => runtime.getStatus().mode === "error",
    onError: (err) => recordLastError(win, "autosave", err),
    onStatus: () => render(),
  });
  const base = coordinator;
  return {
    ...base,
    hasUnsavedChanges: () => textOverLimit || base.hasUnsavedChanges(),
    resetForNewAttempt: () => {
      textOverLimit = false;
      base.resetForNewAttempt();
    },
    setTextOverLimit(over) {
      if (over === textOverLimit) return;
      textOverLimit = over;
      render();
    },
    isTextOverLimit: () => textOverLimit,
    showRestored() {
      if (base.getStatus() !== "idle" || base.hasUnsavedChanges() || textOverLimit) return;
      renderSaveStatus(doc, "saved", retry);
    },
  };
}

function installLessonQuiz(
  win: WindowWithRuntime,
  runtime: AssessmentRuntime | null,
  hasAssignmentContext: boolean,
  restoreGuard: RestoreGuard = { restoring: false },
): () => void {
  // Read at call time (the lesson DOM is complete by the first answer), so a
  // runtime that loads before the page finishes parsing still sees the block.
  const mapSelections = (indexSelections: ReadonlyArray<number | null | undefined>) =>
    mapSelectionsForBinding(indexSelections, readPresentationBinding(documentOf(win)));
  const saves =
    runtime !== null && runtime.hasAssignmentContext
      ? createPageSaveCoordinator(win, runtime)
      : null;
  if (saves !== null) restoreGuard.onRestored = () => saves.showRestored();
  // New attempts. Every lesson locks its answers once Submit is pressed and only
  // unlocks them by rebuilding the quiz (Try Again), so an answer arriving
  // after a submission is the first answer of a new attempt. The adapter then
  // restarts the runtime (a new session and idempotency key) before saving it,
  // and the earlier submission's pending outcome is dropped rather than
  // reported over the new attempt. No lesson markup or script changes.
  let attemptGeneration = 0;
  // Starts the new attempt when the first change arrives after a submission.
  // Returns false when the new attempt could not begin.
  const ensureCurrentAttempt = async (): Promise<boolean> => {
    if (runtime === null || !runtime.hasSubmittedAttempt()) return true;
    attemptGeneration += 1;
    try {
      await runtime.restart();
    } catch (err) {
      // The new attempt could not begin; finalize reports the cause.
      recordLastError(win, "begin", err);
      return false;
    }
    saves?.resetForNewAttempt();
    saves?.resume();
    return true;
  };
  const saveWrittenResponse = (text: string) => {
    if (saves === null) return;
    const over = text.length > WRITTEN_RESPONSE_MAX_LENGTH;
    saves.setTextOverLimit(over);
    if (!over) saves.setWrittenResponse(text);
  };
  // Early input. Until the student is signed in the page has no save queue:
  // the inert helper drops answers and nothing listens to the explanation.
  // Once the session has begun (answers and text the server holds are then
  // restored), whatever the student entered meanwhile and the server does not
  // hold is saved through the ordinary queue, without another keystroke.
  // Until then, leaving warns.
  let earlyInputCaptured = false;
  const earlyInputWaiting = (): boolean => {
    const doc = documentOf(win);
    if (earlyInputCaptured || doc === undefined) return false;
    const text = quizWrittenResponseInput(doc)?.value.trim() ?? "";
    return text.length > 0 || selectedChoiceKeys(doc).length > 0;
  };
  const captureEarlyInput = (): void => {
    const doc = documentOf(win);
    if (saves === null || runtime === null || doc === undefined) return;
    whenDocumentReady(doc, () => {
      earlyInputCaptured = true;
      if (runtime.hasSubmittedAttempt()) return;
      const server = restoreGuard.serverSelections ?? new Set<string>();
      const chosen = selectedChoiceKeys(doc);
      if (chosen.some((key) => !server.has(key))) {
        let count = 0;
        for (const key of quizOptionButtons(doc).keys()) {
          count = Math.max(count, Number(key.split(":")[0]) + 1);
        }
        const indexSelections: Array<number | null> = new Array<number | null>(count).fill(null);
        for (const key of chosen) {
          const [qi, oi] = key.split(":").map(Number);
          indexSelections[qi!] = oi!;
        }
        void helper.autosave(indexSelections);
      }
      const input = quizWrittenResponseInput(doc);
      if (input !== null && !input.disabled) {
        const text = input.value.trim();
        if (text.length > 0) saveWrittenResponse(text);
      }
    });
  };
  if (saves !== null && runtime !== null) {
    const doc = documentOf(win);
    if (doc !== undefined) {
      whenDocumentReady(doc, () => {
        const input = quizWrittenResponseInput(doc);
        if (input === null) return;
        input.addEventListener("input", () => {
          const text = input.value.trim();
          if (restoreGuard.restoring) {
            saves.adoptWrittenResponse(text);
            return;
          }
          if (runtime.hasSubmittedAttempt()) {
            void ensureCurrentAttempt().then((ok) => {
              if (ok) saveWrittenResponse(text);
            });
            return;
          }
          saveWrittenResponse(text);
        });
      });
    }
    // Submit guard: over-limit text would be submitted truncated. Every lesson
    // reveals answers and locks the quiz in its own Submit handler, so the
    // click is stopped in the capture phase, before that handler runs, and the
    // student is sent back to shorten the explanation.
    doc?.addEventListener(
      "click",
      (event) => {
        if (!saves.isTextOverLimit()) return;
        const target = event.target as Element | null;
        const submit = target?.closest?.("#quiz .quiz-submit-btn");
        if (submit === null || submit === undefined) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const input = quizWrittenResponseInput(doc);
        try {
          input?.focus();
        } catch {
          // Focus is best effort.
        }
      },
      true,
    );
    // Page hide: send any debounced change now. Delivery is best effort; an
    // abrupt close can still drop the last change.
    try {
      win.addEventListener("pagehide", () => saves.flush());
      doc?.addEventListener("visibilitychange", () => {
        if (doc.visibilityState === "hidden") saves.flush();
      });
      win.addEventListener("online", () => {
        const status = saves.getStatus();
        if (status === "failed" || status === "retrying") saves.retryNow();
      });
      win.addEventListener("beforeunload", (event) => {
        if (!saves.hasUnsavedChanges() && !earlyInputWaiting()) return;
        saves.flush();
        event.preventDefault();
        event.returnValue = "";
      });
    } catch {
      // Event wiring is best effort.
    }
  }
  const helper: LessonQuizGlobal = {
    version: VERSION,
    optionLetters: OPTION_LETTERS,
    hasAssignmentContext: () =>
      runtime !== null ? runtime.hasAssignmentContext : hasAssignmentContext,
    mapIndexSelectionsToResponses: mapSelections,
    autosave: async (indexSelections) => {
      if (runtime === null || !runtime.hasAssignmentContext) return null;
      if (restoreGuard.restoring) return null;
      if (!(await ensureCurrentAttempt())) return null;
      let responses: readonly SessionResponse[];
      try {
        responses = mapSelections(indexSelections);
      } catch (err) {
        // Fail closed: nothing is sent for a malformed presentation binding.
        recordLastError(win, "autosave", err);
        return null;
      }
      if (responses.length === 0) return null;
      // Autosave failure is soft for the lesson (null): the save queue
      // retries transient failures, shows the student the save status, and
      // records the underlying rejection for diagnostics.
      return saves === null ? null : saves.setResponses(responses);
    },
    finalize: async (indexSelections, options) => {
      if (runtime === null) {
        if (!hasAssignmentContext) return null;
        return {
          ok: false,
          message: NOT_READY_MESSAGE,
          recoverable: true,
        };
      }
      if (!runtime.hasAssignmentContext) return null;
      let responses: readonly SessionResponse[];
      try {
        responses = mapSelections(indexSelections);
      } catch (err) {
        // Fail closed: nothing is submitted for a malformed presentation binding.
        recordLastError(win, "finalize", err);
        return { ok: false, message: PRESENTATION_UNAVAILABLE_MESSAGE, recoverable: false };
      }
      const writtenResponse = normalizeWrittenResponse(options);
      // Student navigation state (shim: deliveryNavigation). A failed or refused
      // finalize is NOT a finalization: settle(false) leaves the assignment
      // unfinished so Back to My Science still warns.
      const deliveryNav = win[NAMESPACE]?.deliveryNavigation;
      deliveryNav?.finalizeStarted?.();
      const generation = attemptGeneration;
      // Background saves hold while the submission writes its own final
      // state, so none can land between that write and the scored finalize.
      if (saves !== null) await saves.pause();
      try {
        const result = await runtime.finalize(responses, writtenResponse);
        deliveryNav?.finalizeSettled?.(true);
        if (generation !== attemptGeneration) return supersededSubmission();
        // The submission carried the final state; nothing is left unsaved
        // (no leave-page warning). Saving stays held until a new attempt.
        saves?.resetForNewAttempt();
        renderSaveStatus(documentOf(win), "hidden");
        return { ok: true, result };
      } catch (err) {
        saves?.resume();
        deliveryNav?.finalizeSettled?.(false);
        recordLastError(win, "finalize", err);
        if (generation !== attemptGeneration) return supersededSubmission();
        return {
          ok: false,
          message: finalizeFailureMessage(err),
          recoverable: isRecoverableFirebaseError(err),
        };
      }
    },
  };
  const ns = win[NAMESPACE] ?? {};
  ns[LESSON_QUIZ_KEY] = helper;
  win[NAMESPACE] = ns;
  return captureEarlyInput;
}

function detectAssignmentId(win: Window): string | null {
  try {
    const search = win.location.search ?? "";
    if (search.length > 0) {
      const params = new URLSearchParams(search);
      const raw = params.get("assignment");
      if (typeof raw === "string" && raw.length > 0) return raw;
    }
    const hash = win.location.hash ?? "";
    if (hash.length > 0) {
      const hashParams = new URLSearchParams(
        hash.startsWith("#") ? hash.slice(1) : hash,
      );
      const raw = hashParams.get("assignment");
      if (typeof raw === "string" && raw.length > 0) return raw;
    }
  } catch {
    return null;
  }
  return null;
}


function waitForUser(auth: ReturnType<typeof getAuth>): Promise<User | null> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (err) => {
        unsubscribe();
        reject(err);
      },
    );
  });
}

// Callable-response narrowing. The certified callables return the shapes
// established by the finalize/get contracts; a hostile or degraded server
// response is rejected at the client boundary so a malformed payload can
// not silently propagate to lesson code.
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parseItemResult(raw: unknown): AttemptItemResult | null {
  if (!isRecord(raw)) return null;
  const {
    itemId,
    isCorrect,
    pointsEarned,
    correctOptionId,
    explanation,
    studentResponse,
  } = raw;
  if (typeof itemId !== "string" || itemId.length === 0) return null;
  if (typeof isCorrect !== "boolean") return null;
  if (typeof pointsEarned !== "number" || !Number.isFinite(pointsEarned)) return null;
  if (typeof correctOptionId !== "string") return null;
  if (typeof explanation !== "string") return null;
  if (studentResponse !== null && typeof studentResponse !== "string") return null;
  return {
    itemId,
    isCorrect,
    pointsEarned,
    correctOptionId,
    explanation,
    studentResponse,
  };
}

function parseItemResults(raw: unknown): readonly AttemptItemResult[] {
  if (!Array.isArray(raw)) return [];
  const out: AttemptItemResult[] = [];
  for (const entry of raw) {
    const item = parseItemResult(entry);
    if (item !== null) out.push(item);
  }
  return out;
}

function parseFinalizeResult(raw: unknown): FinalizeResult {
  if (!isRecord(raw)) throw new Error("finalize returned an invalid payload");
  const { attemptId, attemptNumber, score, maxScore, percentage, replay } = raw;
  if (typeof attemptId !== "string" || attemptId.length === 0) {
    throw new Error("finalize returned an invalid attemptId");
  }
  if (typeof attemptNumber !== "number" || !Number.isFinite(attemptNumber)) {
    throw new Error("finalize returned an invalid attemptNumber");
  }
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("finalize returned an invalid score");
  }
  if (typeof maxScore !== "number" || !Number.isFinite(maxScore)) {
    throw new Error("finalize returned an invalid maxScore");
  }
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) {
    throw new Error("finalize returned an invalid percentage");
  }
  return {
    attemptId,
    attemptNumber,
    score,
    maxScore,
    percentage,
    itemResults: parseItemResults(raw.itemResults),
    replay: replay === true,
  };
}

function parseAttemptSummary(raw: unknown): AttemptSummary {
  const attempt = isRecord(raw) && isRecord(raw.attempt) ? raw.attempt : raw;
  if (!isRecord(attempt)) throw new Error("getAttempt returned an invalid payload");
  const { attemptId, attemptNumber, score, maxScore, percentage } = attempt;
  if (typeof attemptId !== "string" || attemptId.length === 0) {
    throw new Error("getAttempt returned an invalid attemptId");
  }
  if (typeof attemptNumber !== "number" || !Number.isFinite(attemptNumber)) {
    throw new Error("getAttempt returned an invalid attemptNumber");
  }
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("getAttempt returned an invalid score");
  }
  if (typeof maxScore !== "number" || !Number.isFinite(maxScore)) {
    throw new Error("getAttempt returned an invalid maxScore");
  }
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) {
    throw new Error("getAttempt returned an invalid percentage");
  }
  return {
    attemptId,
    attemptNumber,
    score,
    maxScore,
    percentage,
    itemResults: parseItemResults(attempt.itemResults),
  };
}

function createBackedCallables(functions: Functions): RuntimeCallables {
  const begin = httpsCallable(functions, "assessmentSessionsBegin");
  const autosave = httpsCallable(functions, "assessmentSessionsAutosave");
  const finalize = httpsCallable(functions, "assessmentAttemptsFinalize");
  const getAttempt = httpsCallable(functions, "assessmentAttemptGet");
  // Quiz session continuity: persisted responses on a Live session's replay.
  // Only well-formed `{itemId, response}` string pairs are accepted.
  const persistedOf = (data: Record<string, unknown>): {
    readonly responses: readonly SessionResponse[];
    readonly assessmentPresentationRevisionId?: string;
    readonly writtenResponse?: string;
  } => {
    const responses: SessionResponse[] = [];
    if (Array.isArray(data.responses)) {
      for (const entry of data.responses as unknown[]) {
        if (!isRecord(entry)) continue;
        const { itemId, response } = entry;
        if (typeof itemId !== "string" || itemId.length === 0) continue;
        if (typeof response !== "string" || response.length === 0) continue;
        responses.push({ itemId, response });
      }
    }
    const apId = data.assessmentPresentationRevisionId;
    const text = data.writtenResponse;
    return {
      responses,
      ...(typeof apId === "string" && apId.length > 0
        ? { assessmentPresentationRevisionId: apId }
        : {}),
      ...(typeof text === "string" && text.trim().length > 0 ? { writtenResponse: text } : {}),
    };
  };
  return {
    begin: async (assignmentId, launchRef) => {
      // F5.2 §4.3/§8: send the opaque `launchRef` ONLY when one was transported
      // from server resolution. A canonical launch omits it entirely, so the
      // request stays byte-identical to pre-feature behavior. The client never
      // decodes or derives the ref; Slice 6 makes the server consume it.
      const payload =
        typeof launchRef === "string" && launchRef.length > 0
          ? { assignmentId, launchRef }
          : { assignmentId };
      const res = await begin(payload);
      const data = isRecord(res.data) ? res.data : {};
      const sessionId = data.sessionId;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new Error("begin returned an invalid sessionId");
      }
      // F5.3 Slice 9C-1/9D: the session's frozen revision (server authority),
      // used only to verify the page. Absent or non-string -> undefined, which
      // the integrity gate refuses.
      const assessmentRevisionId =
        typeof data.assessmentRevisionId === "string" && data.assessmentRevisionId.length > 0
          ? data.assessmentRevisionId
          : undefined;
      return {
        sessionId,
        alreadyLive: data.alreadyLive === true,
        ...(assessmentRevisionId !== undefined ? { assessmentRevisionId } : {}),
        ...persistedOf(data),
      };
    },
    autosave: async (sessionId, responses, writtenResponse) => {
      const res = await autosave(
        writtenResponse === undefined
          ? { sessionId, responses }
          : { sessionId, responses, writtenResponse },
      );
      const data = isRecord(res.data) ? res.data : {};
      return { persisted: data.persisted === true };
    },
    finalize: async (sessionId, idempotencyKey) => {
      const res = await finalize({ sessionId, idempotencyKey });
      return parseFinalizeResult(res.data);
    },
    getAttempt: async (attemptId) => {
      const res = await getAttempt({ attemptId });
      return parseAttemptSummary(res.data);
    },
  };
}

function randomIdempotencyKey(): string {
  const crypto = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  const rand = Math.random().toString(36).slice(2);
  return `ik${Date.now().toString(36)}${rand}`;
}

function installInertRuntime(win: WindowWithRuntime, hasContext: boolean): RuntimeGlobal {
  const runtime: RuntimeGlobal = {
    version: VERSION,
    mode: hasContext ? "pending" : "inert",
    hasAssignmentContext: hasContext,
    lastError: null,
    begin: async () => {},
    autosave: async () => ({ persisted: false }),
    finalize: async () => {
      throw new Error("assessment runtime is not yet available");
    },
    getAttempt: async () => {
      throw new Error("assessment runtime is not yet available");
    },
  };
  const ns = win[NAMESPACE] ?? {};
  ns[RUNTIME_KEY] = runtime;
  win[NAMESPACE] = ns;
  installLessonQuiz(win, null, hasContext);
  return runtime;
}

function installSignedOutLessonQuiz(win: WindowWithRuntime): void {
  const helper: LessonQuizGlobal = {
    version: VERSION,
    optionLetters: OPTION_LETTERS,
    hasAssignmentContext: () => true,
    mapIndexSelectionsToResponses: (indexSelections) =>
      mapSelectionsForBinding(indexSelections, readPresentationBinding(documentOf(win))),
    autosave: async () => {
      renderSaveStatus(documentOf(win), "signedOut");
      return null;
    },
    finalize: async () => ({
      ok: false,
      message:
        "You appear to be signed out. Sign in and reopen the assignment to submit your work.",
      recoverable: false,
    }),
  };
  const ns = win[NAMESPACE] ?? {};
  ns[LESSON_QUIZ_KEY] = helper;
  win[NAMESPACE] = ns;
}

function attachRuntimeAdapter(
  win: WindowWithRuntime,
  runtime: AssessmentRuntime,
  restoreGuard?: RestoreGuard,
): () => void {
  const wrapper: RuntimeGlobal = {
    version: runtime.version,
    get mode() {
      return runtime.getStatus().mode;
    },
    hasAssignmentContext: runtime.hasAssignmentContext,
    lastError: null,
    begin: () => runtime.begin(),
    autosave: (responses) => runtime.autosave(responses),
    finalize: (responses, writtenResponse) =>
      runtime.finalize(responses, writtenResponse),
    getAttempt: (attemptId) => runtime.getAttempt(attemptId),
  };
  const ns = win[NAMESPACE] ?? {};
  ns[RUNTIME_KEY] = wrapper;
  win[NAMESPACE] = ns;
  return installLessonQuiz(win, runtime, runtime.hasAssignmentContext, restoreGuard);
}

async function bootstrap(win: Window): Promise<void> {
  const assignmentId = detectAssignmentId(win);
  const runtimeWin = win as WindowWithRuntime;

  if (assignmentId === null) {
    installInertRuntime(runtimeWin, false);
    return;
  }

  // Present only for an accommodated launch; ignored by the server until Slice 6.
  const launchRef = detectLaunchRef(win);

  installInertRuntime(runtimeWin, true);

  const existingApp = getApps()[0];
  const app = existingApp ?? initializeApp(getFirebaseClientConfig(win));
  const auth = getAuth(app);
  const functions = getFunctions(app);

  const emulators = getEmulatorEndpoints(win);
  if (emulators !== null) {
    try {
      connectAuthEmulator(auth, `http://${emulators.auth.host}:${emulators.auth.port}`, {
        disableWarnings: true,
      });
    } catch {
      // Already connected on a prior init.
    }
    try {
      connectFunctionsEmulator(functions, emulators.functions.host, emulators.functions.port);
    } catch {
      // Already connected on a prior init.
    }
  }

  const user = await waitForUser(auth);
  if (user === null) {
    // No authenticated student. Leave the inert stub in place so
    // callers observe a stable API surface; the assignment launcher is
    // responsible for routing unauthenticated visitors through the
    // certified sign-in flow. Install a signed-out lessonQuiz helper so
    // finalize surfaces a truthful, actionable error instead of leaving
    // the lesson UI stuck on "Submitting...".
    installSignedOutLessonQuiz(runtimeWin);
    return;
  }

  const callables = createBackedCallables(functions);
  const restoreGuard: RestoreGuard = { restoring: false };
  const runtime = createAssessmentRuntime({
    version: VERSION,
    assignmentId,
    launchRef,
    callables,
    env: { randomId: randomIdempotencyKey },
    // F5.3 Slice 9D: read at begin time (the deferred runtime runs after the
    // document is parsed), before any response can be sent.
    verifyAssessmentRevision: (serverRevision) =>
      verifyPageAssessmentRevision(readPageAssessmentRevision(documentOf(win)), serverRevision),
    // Quiz session continuity: keep and restore only what this page displays.
    adoptPersisted: (state) => adoptPersistedForPage(win, state, restoreGuard),
  });
  const captureEarlyInput = attachRuntimeAdapter(runtimeWin, runtime, restoreGuard);
  // Quiz session continuity: the assignment session begins when the assigned
  // page opens (not at the first answer), so "opened" is distinguishable from
  // "never started" for the teacher. Begin is idempotent: a reload or a second
  // tab replays the existing Live session, whose persisted answers are then
  // restored into the page. A refusal is recorded for diagnostics and leaves
  // the runtime exactly where a first-answer begin would have (a recoverable
  // failure is retried by the first answer).
  // Early input is saved once begin settles, either way: after a failure the
  // queue's own retry, refusal, and Not saved handling apply to it.
  void runtime
    .begin()
    .catch((err: unknown) => {
      recordLastError(runtimeWin, "begin", err);
    })
    .then(captureEarlyInput);
}

// Exported for unit tests of the real lesson adapter and callable payloads.
// Not part of the public runtime API.
export const __internal = {
  installLessonQuiz,
  adoptPersistedForPage,
  locatePersistedResponse,
  readPresentationBinding,
  mapSelectionsForBinding,
  readPageAssessmentRevision,
  verifyPageAssessmentRevision,
  REVISION_DECLARATION_ELEMENT_ID,
  PRESENTATION_BINDING_ELEMENT_ID,
  PRESENTATION_UNAVAILABLE_MESSAGE,
  normalizeWrittenResponse,
  createBackedCallables,
  WRITTEN_RESPONSE_MAX_LENGTH,
};

// Fire the bootstrap immediately. The IIFE bundle produced by esbuild
// executes synchronously on <script> load; the async body only awaits
// Firebase auth state resolution. Errors during bootstrap are swallowed
// after being logged so a Firebase runtime failure never prevents the
// standalone lesson experience from rendering.
if (typeof window !== "undefined") {
  const w = window as WindowWithRuntime;
  const existing = w[NAMESPACE]?.[RUNTIME_KEY];
  if (!existing || existing.version !== VERSION) {
    void bootstrap(window).catch((err) => {
      try {
        // eslint-disable-next-line no-console
        console.warn("[lyfelabz] assessment runtime bootstrap failed", err);
      } catch {
        // ignore
      }
    });
  }
}
