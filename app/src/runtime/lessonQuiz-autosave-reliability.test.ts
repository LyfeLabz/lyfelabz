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
  finalized: { responses: Stored[]; writtenResponse?: string } | null;
} = { session: null, calls: [], failAutosaves: [], holdAutosaves: false, held: [], finalized: null };

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

  it("is placed beside the Submit button", async () => {
    await loadPage(launchUrl);
    select(0, 0);
    await settle();
    const submit = document.getElementById("mm-submit-btn")!;
    expect(statusEl()).not.toBeNull();
    expect(submit.nextElementSibling).toBe(statusEl());
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
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
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
