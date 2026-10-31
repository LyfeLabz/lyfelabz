/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";

// Student autosave reliability, end to end on the REAL Measuring Matter r2
// assessment rendition: its quiz section markup and quiz script, the REAL shim
// and the REAL runtime bundle entry, against a stateful fake server that can
// fail on demand.
//
// Covers: Show Your Thinking text is autosaved while typing and restored on
// reload; answers and text never overwrite each other; transient failures are
// retried; a permanent refusal is shown and stops saving without touching the
// page; the student-facing status never says Saved before the server has the
// latest change.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SHIM_SOURCE = fs.readFileSync(path.join(REPO_ROOT, "assets/lyfelabz-assessment-runtime.js"), "utf8");
const LESSON_HTML = fs.readFileSync(
  path.join(REPO_ROOT, "app/lessons/assessment-revisions/lesson_measuring-matter__r2.html"),
  "utf8",
);
const LESSON_PATH = "/app/lessons/assessment-revisions/lesson_measuring-matter__r2.html";
const ASSIGNMENT_ID = "a-measuring-matter-1";
const REVISION_ID = "assessment_measuring-matter__r2";

type Stored = { itemId: string; response: string };
type Call = { readonly name: string; readonly data: Record<string, unknown> };
type Failure = "unavailable" | "permission-denied";

const mockServer: {
  session: { responses: Stored[]; writtenResponse?: string } | null;
  calls: Call[];
  failAutosaves: Failure[];
  holdAutosaves: boolean;
  held: Array<() => void>;
  failBegins: Failure[];
  holdBegin: boolean;
  heldBegins: Array<() => void>;
  finalized: { responses: Stored[]; writtenResponse?: string } | null;
} = {
  session: null,
  calls: [],
  failAutosaves: [],
  holdAutosaves: false,
  held: [],
  failBegins: [],
  holdBegin: false,
  heldBegins: [],
  finalized: null,
};

jest.mock("firebase/app", () => ({ getApps: () => [], initializeApp: jest.fn(() => ({})) }));
jest.mock("firebase/auth", () => ({
  connectAuthEmulator: jest.fn(),
  getAuth: jest.fn(() => ({})),
  onAuthStateChanged: jest.fn((_auth: unknown, next: (user: unknown) => void) => {
    setTimeout(() => next({ uid: "student-mm" }), 0);
    return () => undefined;
  }),
}));
jest.mock("firebase/functions", () => ({
  connectFunctionsEmulator: jest.fn(),
  getFunctions: jest.fn(() => ({})),
  httpsCallable: (_functions: unknown, name: string) => async (data: Record<string, unknown>) => {
    mockServer.calls.push({ name, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown> });
    const revision = { assessmentRevisionId: "assessment_measuring-matter__r2" };
    if (name === "assessmentSessionsBegin") {
      if (mockServer.holdBegin) {
        await new Promise<void>((resolve) => mockServer.heldBegins.push(resolve));
      }
      const beginFailure = mockServer.failBegins.shift();
      if (beginFailure !== undefined) {
        throw Object.assign(new Error(beginFailure), { code: `functions/${beginFailure}` });
      }
      if (mockServer.session === null) {
        mockServer.session = { responses: [] };
        return { data: { sessionId: "sess-mm", alreadyLive: false, ...revision } };
      }
      const { responses, writtenResponse } = mockServer.session;
      return {
        data: {
          sessionId: "sess-mm",
          alreadyLive: true,
          ...revision,
          responses,
          ...(writtenResponse ? { writtenResponse } : {}),
        },
      };
    }
    if (name === "assessmentSessionsAutosave") {
      const failure = mockServer.failAutosaves.shift();
      if (failure !== undefined) {
        throw Object.assign(new Error(failure), { code: `functions/${failure}` });
      }
      if (mockServer.holdAutosaves) {
        await new Promise<void>((resolve) => mockServer.held.push(resolve));
      }
      mockServer.session!.responses = data.responses as Stored[];
      if (typeof data.writtenResponse === "string") {
        const text = data.writtenResponse.trim();
        if (text.length > 0) mockServer.session!.writtenResponse = text;
        else delete mockServer.session!.writtenResponse;
      }
      return { data: { persisted: true } };
    }
    if (name === "assessmentAttemptsFinalize") {
      mockServer.finalized = { ...mockServer.session! };
      mockServer.session = null;
      return {
        data: { attemptId: "att-1", attemptNumber: 1, score: 7, maxScore: 10, percentage: 70, itemResults: [] },
      };
    }
    return { data: {} };
  },
}));

async function settle(ms = 0): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await jest.advanceTimersByTimeAsync(0);
}

// A real reload discards the previous document's listeners; the shared jsdom
// window does not, so each simulated load removes the previous page's.
const pageListeners: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = [];
const TRACKED = new Set(["hashchange", "pagehide", "beforeunload", "online", "visibilitychange", "click"]);
for (const target of [window, document] as EventTarget[]) {
  const real = target.addEventListener.bind(target);
  target.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    if (TRACKED.has(type)) pageListeners.push([target, type, listener]);
    real(type, listener, options as AddEventListenerOptions);
  }) as typeof target.addEventListener;
}

const QUIZ_SECTION = LESSON_HTML.slice(
  LESSON_HTML.indexOf('<section id="quiz"'),
  LESSON_HTML.indexOf("</section>", LESSON_HTML.indexOf('<section id="quiz"')) + "</section>".length,
);
const QUIZ_SCRIPT = (() => {
  const start = LESSON_HTML.indexOf("var mmQuizState");
  return LESSON_HTML.slice(start, LESSON_HTML.indexOf("</script>", start));
})();

async function loadPage(url: string): Promise<void> {
  for (const [target, type, listener] of pageListeners.splice(0)) {
    target.removeEventListener(type, listener);
  }
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
  window.history.replaceState(null, "", url);
  document.head.innerHTML = "";
  document.body.innerHTML = `
    <script type="application/json" id="lyfelabz-assessment-revision">{"schemaVersion":1,"lessonSlug":"measuring-matter","assessmentRevisionId":"${REVISION_ID}"}</script>
    ${QUIZ_SECTION}
    <div id="continue"></div>
  `;
  Element.prototype.scrollIntoView = function () {
    /* jsdom: noop */
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    QUIZ_SCRIPT +
      "\nwindow.mmSelectAnswer=mmSelectAnswer;window.mmQuizState=mmQuizState;window.mmSubmitQuiz=mmSubmitQuiz;",
  )();
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(SHIM_SOURCE)();
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./entry");
  });
  await settle();
}

const launchUrl = `${LESSON_PATH}#assignment=${ASSIGNMENT_ID}`;
const reload = () => loadPage(window.location.pathname + window.location.search + window.location.hash);
const selected = () =>
  (window as unknown as { mmQuizState: { selected: Array<number | null> } }).mmQuizState.selected;
const select = (qi: number, oi: number) =>
  (document.getElementById(`mm-q-${qi}-${oi}`) as HTMLButtonElement).click();
const thinking = () => document.getElementById("mm-thinking") as HTMLTextAreaElement;
const type = (text: string) => {
  thinking().value = text;
  thinking().dispatchEvent(new Event("input", { bubbles: true }));
};
const autosaves = () => mockServer.calls.filter((c) => c.name === "assessmentSessionsAutosave");
const statusEl = () => document.getElementById("lyfelabz-save-status");
const status = () => statusEl()?.getAttribute("data-save-status");

beforeEach(() => {
  jest.useFakeTimers();
  mockServer.session = null;
  mockServer.calls = [];
  mockServer.failAutosaves = [];
  mockServer.holdAutosaves = false;
  mockServer.held = [];
  mockServer.failBegins = [];
  mockServer.holdBegin = false;
  mockServer.heldBegins = [];
  mockServer.finalized = null;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = "";
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
});

describe("Measuring Matter r2: answer, save, reload, restore", () => {
  it("restores answers and the written explanation after a reload", async () => {
    await loadPage(launchUrl);
    select(0, 1);
    select(1, 2);
    select(2, 0);
    type("A steel ship spreads its mass over a huge volume, so its density is low.");
    await settle(1500);
    expect(mockServer.session).toEqual({
      responses: [
        { itemId: "q1", response: "B" },
        { itemId: "q2", response: "C" },
        { itemId: "q3", response: "A" },
      ],
      writtenResponse: "A steel ship spreads its mass over a huge volume, so its density is low.",
    });
    expect(status()).toBe("saved");
    const savesBeforeReload = autosaves().length;

    await reload();

    expect(selected()).toEqual([1, 2, 0, null, null, null, null, null, null, null]);
    expect(thinking().value).toBe(
      "A steel ship spreads its mass over a huge volume, so its density is low.",
    );
    expect(document.getElementById("mm-progress-text")!.textContent).toBe("3 / 10 selected");
    // Restoring sends nothing.
    expect(autosaves()).toHaveLength(savesBeforeReload);
  });

  it("an answer after the reload keeps the restored explanation on the server", async () => {
    await loadPage(launchUrl);
    select(0, 1);
    type("Density decides floating.");
    await settle(1500);
    await reload();
    select(1, 3);
    await settle();
    expect(autosaves().at(-1)!.data).toEqual({
      sessionId: "sess-mm",
      responses: [
        { itemId: "q1", response: "B" },
        { itemId: "q2", response: "D" },
      ],
      writtenResponse: "Density decides floating.",
    });
    expect(mockServer.session!.writtenResponse).toBe("Density decides floating.");
  });

  it("restores a saved explanation even when no answer was saved yet", async () => {
    await loadPage(launchUrl);
    type("Just the explanation so far.");
    await settle(1500);
    await reload();
    expect(thinking().value).toBe("Just the explanation so far.");
  });

  it("text the student typed before the restore arrives is kept", async () => {
    mockServer.session = { responses: [], writtenResponse: "older saved text" };
    // The page parses and the student types before begin returns.
    await loadPage(launchUrl);
    type("new text typed now");
    await settle(1500);
    expect(thinking().value).toBe("new text typed now");
    expect(mockServer.session.writtenResponse).toBe("new text typed now");
  });
});

describe("answer and explanation saves never overwrite each other", () => {
  it("text is debounced, and an answer meanwhile carries the newest text", async () => {
    await loadPage(launchUrl);
    type("first");
    type("first draft");
    expect(autosaves()).toHaveLength(0);
    select(0, 0);
    await settle();
    expect(autosaves()).toHaveLength(1);
    expect(autosaves()[0]!.data).toMatchObject({
      responses: [{ itemId: "q1", response: "A" }],
      writtenResponse: "first draft",
    });
    // Nothing else is pending: the debounce did not fire a second write.
    await settle(1500);
    expect(autosaves()).toHaveLength(1);
  });

  it("an older in-flight write never lands after a newer change", async () => {
    await loadPage(launchUrl);
    mockServer.holdAutosaves = true;
    select(0, 0);
    await settle();
    select(0, 2); // changes q1 while the first write is still in flight
    type("final words");
    await settle(1500);
    expect(autosaves()).toHaveLength(1);
    expect(status()).toBe("saving");
    mockServer.holdAutosaves = false;
    mockServer.held.shift()!();
    await settle();
    expect(mockServer.session).toEqual({
      responses: [{ itemId: "q1", response: "C" }],
      writtenResponse: "final words",
    });
    expect(status()).toBe("saved");
  });
});

describe("save status", () => {
  it("says Saving while the write is in flight and Saved only after it is acknowledged", async () => {
    await loadPage(launchUrl);
    // Nothing is shown before the student changes anything.
    expect(statusEl()).toBeNull();
    mockServer.holdAutosaves = true;
    select(0, 0);
    await settle();
    expect(status()).toBe("saving");
    expect(statusEl()!.textContent).toBe("Saving...");
    expect(statusEl()!.getAttribute("role")).toBe("status");
    mockServer.held.shift()!();
    await settle();
    expect(status()).toBe("saved");
    expect(statusEl()!.textContent).toBe("Saved");
  });

  it("hangs from the sticky progress tray, outside the Submit row", async () => {
    await loadPage(launchUrl);
    const submit = document.getElementById("mm-submit-btn")!;
    const submitRow = submit.parentElement!;
    const rowBefore = submitRow.innerHTML;
    select(0, 0);
    await settle();
    const el = statusEl()!;
    const tray = document.querySelector("#quiz .quiz-progress-sticky")!;
    expect(el.parentElement).toBe(tray);
    expect(el.getAttribute("data-save-anchor")).toBe("tray");
    expect(el.getAttribute("aria-live")).toBe("polite");
    // The Submit row is untouched, so Submit stays centered.
    expect(submitRow.contains(el)).toBe(false);
    expect(submitRow.innerHTML).toBe(rowBefore);
    expect(submitRow.children).toHaveLength(1);
    // The pill is out of flow (moves no lesson content), keeps clear of the
    // safe area, and only its Try again button takes pointer input.
    const css = document.getElementById("lyfelabz-save-status-style")!.textContent!;
    const trayRule = css.slice(css.indexOf('[data-save-anchor="tray"]{'));
    expect(trayRule).toMatch(/^[^}]*position:absolute;top:100%/);
    expect(trayRule).toMatch(/^[^}]*env\(safe-area-inset-right\)/);
    expect(trayRule).toMatch(/^[^}]*max-width:min\(22rem,calc\(100% - 1\.5rem\)\)/);
    expect(trayRule).toMatch(/^[^}]*pointer-events:none/);
    expect(css).toContain("button{");
    expect(css).toMatch(/button\{[^}]*pointer-events:auto/);
  });

  it("shows Saving and Saved inside the progress row, covering nothing", async () => {
    await loadPage(launchUrl);
    mockServer.holdAutosaves = true;
    select(0, 0);
    await settle();
    const row = document.querySelector("#quiz .quiz-progress-sticky .quiz-progress")!;
    const label = document.getElementById("lyfelabz-save-status-label")!;
    expect(label.parentElement).toBe(row);
    // Between the bar and "x / 10 selected", hidden from assistive technology
    // (the status element is the one live region).
    expect(label.nextElementSibling).toBe(document.getElementById("mm-progress-text"));
    expect(label.getAttribute("aria-hidden")).toBe("true");
    expect(label.textContent).toBe("Saving...");
    expect(statusEl()!.getAttribute("data-save-compact")).toBe("true");
    expect(statusEl()!.textContent).toBe("Saving...");
    mockServer.held.shift()!();
    await settle();
    expect(label.textContent).toBe("Saved");
    expect(statusEl()!.textContent).toBe("Saved");
    // The compact pill is visually hidden; the label is a one-line flex item
    // no taller than the row's own text, so the tray keeps its height.
    const css = document.getElementById("lyfelabz-save-status-style")!.textContent!;
    expect(css).toMatch(/\[data-save-compact="true"\]\{position:absolute;width:1px;height:1px;[^}]*clip:rect\(0 0 0 0\)/);
    expect(css).toMatch(/#lyfelabz-save-status-label\{flex:none;font-size:\.75rem;line-height:1;[^}]*white-space:nowrap/);
  });

  it("moves Not saved to the pill below the tray and clears the row label", async () => {
    await loadPage(launchUrl);
    mockServer.failAutosaves = ["unavailable", "unavailable", "unavailable", "unavailable"];
    select(0, 1);
    await settle();
    expect(document.getElementById("lyfelabz-save-status-label")!.textContent).toBe("");
    expect(statusEl()!.getAttribute("data-save-compact")).toBe("false");
    expect(statusEl()!.textContent).toContain("Trying to save again");
    await settle(2000);
    await settle(5000);
    await settle(10000);
    expect(status()).toBe("failed");
    expect(statusEl()!.getAttribute("data-save-compact")).toBe("false");
    expect(statusEl()!.querySelector("button")!.textContent).toBe("Try again");
    (statusEl()!.querySelector("button") as HTMLButtonElement).click();
    await settle();
    expect(status()).toBe("saved");
    expect(document.getElementById("lyfelabz-save-status-label")!.textContent).toBe("Saved");
  });

  it("clears the row label after the final submission", async () => {
    await loadPage(launchUrl);
    for (let qi = 0; qi < 10; qi++) select(qi, 0);
    type("Density compares mass to volume.");
    (window as unknown as { mmSubmitQuiz: () => void }).mmSubmitQuiz();
    await settle();
    expect(status()).toBe("hidden");
    expect(document.getElementById("lyfelabz-save-status-label")!.textContent).toBe("");
  });

  it("is in view while the student answers the first question", async () => {
    await loadPage(launchUrl);
    mockServer.holdAutosaves = true;
    select(0, 0);
    await settle();
    // The first question and the pill share the quiz's sticky tray context:
    // the pill is not after the questions, it rides with the tray.
    const tray = document.querySelector("#quiz .quiz-progress-sticky")!;
    const firstOption = document.getElementById("mm-q-0-0")!;
    expect(tray.contains(statusEl())).toBe(true);
    expect(
      tray.compareDocumentPosition(firstOption) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(statusEl()!.textContent).toBe("Saving...");
  });

  it("falls back to a line after the Submit row when a quiz has no tray", async () => {
    await loadPage(launchUrl);
    document.querySelector("#quiz .quiz-progress-sticky")!.classList.remove("quiz-progress-sticky");
    select(0, 0);
    await settle();
    const submitRow = document.getElementById("mm-submit-btn")!.parentElement!;
    expect(statusEl()!.getAttribute("data-save-anchor")).toBe("inline");
    expect(submitRow.nextElementSibling).toBe(statusEl());
    expect(submitRow.children).toHaveLength(1);
  });
});

describe("restored work", () => {
  it("says Saved after the server-confirmed answers and text are restored", async () => {
    mockServer.session = {
      responses: [{ itemId: "q1", response: "B" }],
      writtenResponse: "saved on the server",
    };
    await loadPage(launchUrl);
    expect(selected()[0]).toBe(1);
    expect(thinking().value).toBe("saved on the server");
    expect(status()).toBe("saved");
    expect(statusEl()!.textContent).toBe("Saved");
    // Restoring sent nothing and left nothing to save.
    expect(autosaves()).toHaveLength(0);
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
  });

  it("says Saved when the page already shows the server's text", async () => {
    mockServer.session = { responses: [], writtenResponse: "same words" };
    // A browser restoring the form, or the student retyping it, before sign-in.
    const pending = loadPage(launchUrl);
    type("same words");
    await pending;
    await settle(1500);
    expect(status()).toBe("saved");
    // Nothing needed saving, so nothing was sent.
    expect(autosaves()).toHaveLength(0);
  });

  it("shows nothing when there was nothing saved to restore", async () => {
    await loadPage(launchUrl);
    expect(statusEl()).toBeNull();
  });
});

describe("transient failure and retry", () => {
  it("retries a network failure and then saves the full state", async () => {
    await loadPage(launchUrl);
    mockServer.failAutosaves = ["unavailable"];
    select(0, 1);
    await settle();
    expect(status()).toBe("retrying");
    expect(mockServer.session!.responses).toEqual([]);
    await settle(2000);
    expect(status()).toBe("saved");
    expect(mockServer.session!.responses).toEqual([{ itemId: "q1", response: "B" }]);
  });

  it("shows Not saved after the bounded retries, with a working Try again", async () => {
    await loadPage(launchUrl);
    mockServer.failAutosaves = ["unavailable", "unavailable", "unavailable", "unavailable"];
    select(0, 1);
    await settle();
    await settle(2000);
    await settle(5000);
    await settle(10000);
    expect(autosaves()).toHaveLength(4);
    expect(status()).toBe("failed");
    expect(statusEl()!.textContent).toContain("Not saved");
    // Bounded: nothing more is sent on its own.
    await settle(60000);
    expect(autosaves()).toHaveLength(4);
    // The student's selection is untouched.
    expect(selected()[0]).toBe(1);
    (statusEl()!.querySelector("button") as HTMLButtonElement).click();
    await settle();
    expect(status()).toBe("saved");
    expect(mockServer.session!.responses).toEqual([{ itemId: "q1", response: "B" }]);
  });
});

describe("permanent authentication or permission failure", () => {
  it("shows a reload instruction, stops saving, and keeps the page state", async () => {
    await loadPage(launchUrl);
    mockServer.failAutosaves = ["permission-denied"];
    select(0, 1);
    await settle();
    expect(status()).toBe("blocked");
    expect(statusEl()!.textContent).toContain("reload this page");
    const sent = autosaves().length;
    select(1, 1);
    type("my explanation");
    await settle(20000);
    expect(autosaves()).toHaveLength(sent);
    expect(selected().slice(0, 2)).toEqual([1, 1]);
    expect(thinking().value).toBe("my explanation");
  });
});

describe("written response over the 10,000-character limit", () => {
  it("is never sent truncated and never shown as Saved", async () => {
    await loadPage(launchUrl);
    type("short version");
    await settle(1500);
    expect(status()).toBe("saved");
    const tooLong = "x".repeat(10001);
    type(tooLong);
    await settle(1500);
    // The server keeps the last complete text; nothing truncated is stored.
    expect(mockServer.session!.writtenResponse).toBe("short version");
    expect(status()).toBe("tooLong");
    expect(statusEl()!.textContent).toContain("not saved");
    expect(statusEl()!.textContent).toContain("10,000");
    // An answer save still succeeds but cannot turn the status into Saved.
    select(0, 1);
    await settle();
    expect(mockServer.session!.responses).toEqual([{ itemId: "q1", response: "B" }]);
    expect(mockServer.session!.writtenResponse).toBe("short version");
    expect(status()).toBe("tooLong");
    // The student's text is untouched, and leaving warns.
    expect(thinking().value).toBe(tooLong);
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    // Shortening it saves normally.
    type("x".repeat(10000));
    await settle(1500);
    expect(mockServer.session!.writtenResponse).toBe("x".repeat(10000));
    expect(status()).toBe("saved");
  });

  it("blocks Submit before the lesson reveals answers, then submits the full text once shortened", async () => {
    await loadPage(launchUrl);
    for (let qi = 0; qi < 10; qi++) select(qi, 0);
    type("z".repeat(10001));
    const submit = document.getElementById("mm-submit-btn") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    submit.click();
    await settle();
    // Nothing was submitted, nothing was revealed or locked.
    expect(mockServer.calls.some((c) => c.name === "assessmentAttemptsFinalize")).toBe(false);
    expect((window as unknown as { mmQuizState: { submitted: boolean } }).mmQuizState.submitted).toBe(false);
    expect(thinking().disabled).toBe(false);
    expect(document.getElementById("mm-feedback-0")!.textContent).toBe("");
    expect(document.activeElement).toBe(thinking());
    expect(status()).toBe("tooLong");
    // Shortened to the limit: Submit works and the complete text is submitted.
    type("z".repeat(10000));
    submit.click();
    await settle();
    expect(mockServer.finalized!.writtenResponse).toBe("z".repeat(10000));
  });

  it("a connection failure still takes precedence over the length notice", async () => {
    await loadPage(launchUrl);
    type("y".repeat(10001));
    mockServer.failAutosaves = ["permission-denied"];
    select(0, 0);
    await settle();
    expect(status()).toBe("blocked");
  });
});

describe("submission", () => {
  it("submits the final answers and text, then leaves nothing flagged unsaved", async () => {
    await loadPage(launchUrl);
    for (let qi = 0; qi < 10; qi++) select(qi, 0);
    type("Density compares mass to volume.");
    (window as unknown as { mmSubmitQuiz: () => void }).mmSubmitQuiz();
    await settle();
    expect(mockServer.finalized).toMatchObject({ writtenResponse: "Density compares mass to volume." });
    expect(mockServer.finalized!.responses).toHaveLength(10);
    expect(statusEl()!.textContent).toBe("");
    expect(status()).toBe("hidden");
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
  });

  it("stops warning once every change is acknowledged", async () => {
    await loadPage(launchUrl);
    mockServer.holdAutosaves = true;
    select(0, 2);
    type("still in flight");
    await settle(1500);
    const during = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    mockServer.holdAutosaves = false;
    mockServer.held.shift()!();
    await settle();
    expect(status()).toBe("saved");
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("warns before leaving while a change is still unsaved", async () => {
    await loadPage(launchUrl);
    type("not saved yet");
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    // Leaving also flushes the pending text at once.
    await settle();
    expect(mockServer.session!.writtenResponse).toBe("not saved yet");
  });
});

describe("standalone (no assignment context)", () => {
  it("shows no save status and sends nothing", async () => {
    await loadPage(LESSON_PATH);
    select(0, 1);
    type("practice text");
    await settle(2000);
    expect(mockServer.calls).toHaveLength(0);
    expect(statusEl()).toBeNull();
  });
});

describe("save status anchor across the assigned lessons", () => {
  // The runtime anchors the pill to the quiz's sticky progress tray and never
  // touches the Submit row. Every lesson below must offer that anchor.
  const LESSONS = [
    "app/lessons/assessment-revisions/lesson_measuring-matter__r1.html",
    "app/lessons/assessment-revisions/lesson_measuring-matter__r2.html",
    "app/lessons/lesson_measuring-matter.html",
    "app/lessons/lesson_conducting-experiments.html",
    "app/lessons/lesson_engineering-design.html",
  ];
  it.each(LESSONS)("%s offers a sticky tray inside #quiz and a single-button Submit row", (file) => {
    const html = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const quiz = parsed.getElementById("quiz")!;
    expect(quiz).not.toBeNull();
    const tray = quiz.querySelector(".quiz-progress-sticky")!;
    expect(tray).not.toBeNull();
    // The tray is sticky, so it is the pill's containing block.
    expect(html).toMatch(/\.quiz-progress-sticky\s*\{[^}]*position:\s*sticky/);
    const submitRow = quiz.querySelector(".quiz-submit-btn")!.parentElement!;
    expect(submitRow.classList.contains("quiz-submit-wrap")).toBe(true);
    expect(submitRow.children).toHaveLength(1);
    expect(quiz.querySelectorAll("textarea")).toHaveLength(1);
  });
});

describe("input entered before the save queue is ready", () => {
  // Loading starts the runtime; the student acts before sign-in resolves (the
  // runtime is not attached yet) unless the test awaits the load first.
  const leaveWarns = () => {
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    return leave.defaultPrevented;
  };

  it("text typed before the runtime attaches is saved without another keystroke", async () => {
    const pending = loadPage(launchUrl);
    type("typed before sign-in");
    await pending;
    expect(status()).not.toBe("saved");
    await settle(1500);
    expect(mockServer.session!.writtenResponse).toBe("typed before sign-in");
    expect(status()).toBe("saved");
    expect(autosaves()).toHaveLength(1);
    expect(leaveWarns()).toBe(false);
  });

  it("an answer chosen before the runtime attaches is saved without another click", async () => {
    const pending = loadPage(launchUrl);
    select(0, 1);
    await pending;
    await settle();
    expect(mockServer.session!.responses).toEqual([{ itemId: "q1", response: "B" }]);
    expect(status()).toBe("saved");
    expect(autosaves()).toHaveLength(1);
  });

  it("newer local text wins over older server text and Saved waits for the write", async () => {
    mockServer.session = { responses: [{ itemId: "q1", response: "B" }], writtenResponse: "older" };
    mockServer.holdAutosaves = true;
    const pending = loadPage(launchUrl);
    type("newer local text");
    await pending;
    // The server's answer is restored; the server's older text is not.
    expect(selected()[0]).toBe(1);
    expect(thinking().value).toBe("newer local text");
    expect(status()).not.toBe("saved");
    await settle(1500);
    expect(status()).toBe("saving");
    mockServer.holdAutosaves = false;
    mockServer.held.shift()!();
    await settle();
    expect(mockServer.session.writtenResponse).toBe("newer local text");
    expect(mockServer.session.responses).toEqual([{ itemId: "q1", response: "B" }]);
    expect(status()).toBe("saved");
  });

  it("a local answer that differs from the server's is kept and saved", async () => {
    mockServer.session = { responses: [{ itemId: "q1", response: "B" }] };
    const pending = loadPage(launchUrl);
    select(0, 3);
    await pending;
    expect(selected()[0]).toBe(3);
    await settle();
    expect(mockServer.session.responses).toEqual([{ itemId: "q1", response: "D" }]);
    expect(status()).toBe("saved");
  });

  it("warns before leaving while begin is still pending, then saves", async () => {
    mockServer.holdBegin = true;
    const pending = loadPage(launchUrl);
    type("written before sign-in");
    await pending;
    expect(mockServer.heldBegins).toHaveLength(1);
    expect(leaveWarns()).toBe(true);
    mockServer.holdBegin = false;
    mockServer.heldBegins.shift()!();
    await settle(1500);
    expect(mockServer.session!.writtenResponse).toBe("written before sign-in");
    expect(status()).toBe("saved");
    expect(leaveWarns()).toBe(false);
  });

  it("text typed while begin is pending is saved once it settles", async () => {
    mockServer.holdBegin = true;
    await loadPage(launchUrl);
    type("typed during begin");
    await settle(1500);
    expect(status()).toBe("saving");
    expect(leaveWarns()).toBe(true);
    mockServer.holdBegin = false;
    mockServer.heldBegins.shift()!();
    await settle();
    expect(mockServer.session!.writtenResponse).toBe("typed during begin");
    expect(status()).toBe("saved");
    // One write: the early capture found nothing new to send.
    expect(autosaves()).toHaveLength(1);
  });

  it("a transient begin failure still saves the early text", async () => {
    mockServer.failBegins = ["unavailable"];
    const pending = loadPage(launchUrl);
    type("kept through a failed begin");
    await pending;
    await settle(1500);
    await settle(2000);
    expect(mockServer.session!.writtenResponse).toBe("kept through a failed begin");
    expect(status()).toBe("saved");
    expect(leaveWarns()).toBe(false);
  });

  it("a refused begin shows Not saved, keeps the text, and warns before leaving", async () => {
    mockServer.failBegins = ["permission-denied", "permission-denied", "permission-denied"];
    const pending = loadPage(launchUrl);
    type("never acknowledged");
    await pending;
    await settle(1500);
    await settle(20000);
    expect(mockServer.session).toBeNull();
    expect(status()).toMatch(/^(blocked|failed)$/);
    expect(statusEl()!.textContent).toContain("Not saved");
    expect(thinking().value).toBe("never acknowledged");
    expect(leaveWarns()).toBe(true);
  });

  it("an answer after a normal load is saved exactly as before", async () => {
    await loadPage(launchUrl);
    select(2, 3);
    await settle();
    expect(autosaves()).toHaveLength(1);
    expect(mockServer.session!.responses).toEqual([{ itemId: "q3", response: "D" }]);
    expect(status()).toBe("saved");
  });
});
