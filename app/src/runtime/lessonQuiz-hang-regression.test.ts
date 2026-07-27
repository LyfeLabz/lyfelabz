/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";

// Regression coverage for the production "Submitting..." hang.
//
// Root cause: in assignment context, the lessonQuiz helper's `finalize`
// could resolve to `null` in two independent windows:
//
//   1. The static shim (`/assets/lyfelabz-assessment-runtime.js`)
//      installed its placeholder `finalize` as `Promise.resolve(null)`.
//      If the student submitted before the active bundle finished
//      loading, the lesson `.then(function (r) { ... })` had no branch
//      for `r === null` and the UI stayed on "Submitting..." forever.
//
//   2. The active bundle's `installLessonQuiz(win, null)` also returned
//      `null` from `finalize`. That helper is installed for the whole
//      duration of the auth-state resolution, and stays in place if
//      `waitForUser` resolves to `null` (a signed-out visitor navigating
//      directly to `/app/lessons/lesson_<slug>.html?assignment=<id>`).
//
// Both paths now produce a truthful, terminal `{ok:false, message, ...}`
// so the lesson UI leaves "Submitting..." with an actionable error.

const SHIM_PATH = path.resolve(
  __dirname,
  "../../../assets/lyfelabz-assessment-runtime.js",
);

const NAMESPACE = "lyfelabz";
const LESSON_QUIZ_KEY = "lessonQuiz";

function loadShim(): string {
  return fs.readFileSync(SHIM_PATH, "utf8");
}

function resetWindow(searchWithAssignment: boolean): void {
  // Clean up any prior namespace state so each test starts fresh.
  const win = window as unknown as Record<string, unknown>;
  delete win[NAMESPACE];
  delete (win as { __lyfelabzFirebaseConfig?: unknown })
    .__lyfelabzFirebaseConfig;
  // The shim reads `window.location.search`; jsdom lets us swap the URL
  // by re-assigning `window.location.href`. We short-circuit by directly
  // stubbing `window.location.search` for determinism.
  const search = searchWithAssignment ? "?assignment=asg-1" : "";
  Object.defineProperty(window, "location", {
    value: {
      ...window.location,
      search,
      hash: "",
    },
    writable: true,
    configurable: true,
  });
}

function runShim(): void {
  // Execute the shim IIFE in the current jsdom context.
  const shimSource = loadShim();
  // Strip nothing; the shim is self-contained.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function(shimSource).call(window);
}

describe("shim lessonQuiz.finalize - regression: production 'Submitting...' hang", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("standalone (no assignment context) still resolves to null", async () => {
    resetWindow(false);
    runShim();
    const ns = (window as unknown as {
      [NAMESPACE]: Record<string, { finalize: (x: unknown) => Promise<unknown> }>;
    })[NAMESPACE];
    const helper = ns[LESSON_QUIZ_KEY]!;
    await expect(helper.finalize([0, 1, 2])).resolves.toBeNull();
  });

  it("assignment context: never resolves to null when the active bundle is absent - resolves to a truthful terminal error after the bounded wait", async () => {
    resetWindow(true);
    runShim();
    const ns = (window as unknown as {
      [NAMESPACE]: Record<string, {
        finalize: (x: unknown) => Promise<{
          ok: boolean;
          message: string;
          recoverable: boolean;
        } | null>;
      }>;
    })[NAMESPACE];
    const helper = ns[LESSON_QUIZ_KEY]!;

    jest.useFakeTimers();
    const pending = helper.finalize([0, 1, 2]);
    // Advance beyond the shim's ACTIVE_WAIT_TIMEOUT_MS (15000).
    await jest.advanceTimersByTimeAsync(20000);
    const result = await pending;
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      ok: false,
      recoverable: true,
    });
    expect((result as { message: string }).message.length).toBeGreaterThan(0);
  });

  it("assignment context: delegates to the active bundle's helper once it replaces window.lyfelabz.lessonQuiz", async () => {
    resetWindow(true);
    runShim();

    const activeResult = { ok: true, result: { attemptId: "a1" } } as const;
    const activeFinalize = jest.fn().mockResolvedValue(activeResult);

    const ns = (window as unknown as {
      [NAMESPACE]: Record<string, unknown>;
    })[NAMESPACE];
    const shimHelper = ns[LESSON_QUIZ_KEY] as {
      finalize: (x: unknown) => Promise<unknown>;
    };

    jest.useFakeTimers();
    const pending = shimHelper.finalize([0, 1, 2]);

    // Simulate the active bundle installing its replacement helper.
    setTimeout(() => {
      ns[LESSON_QUIZ_KEY] = {
        finalize: activeFinalize,
        autosave: jest.fn().mockResolvedValue({ persisted: true }),
        hasAssignmentContext: () => true,
      };
    }, 300);

    await jest.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(activeFinalize).toHaveBeenCalledTimes(1);
    expect(result).toBe(activeResult);
  });
});

// Lesson-UI defensive handler regression.
//
// The lesson HTML's finalize callback used to be:
//
//   finalize(...).then(function (r) {
//     if (r && r.ok) { ...submitted... }
//     else if (r) { ...error... }
//   });
//
// With no branch for `r === null` and no `.catch`. The pattern below is
// the fixed lesson HTML shape - it must (a) show an error message when
// finalize resolves to null, and (b) show an error message when finalize
// rejects. Neither path may leave the status element on "Submitting...".

describe("lesson defensive handler for finalize null/rejection", () => {
  function renderLessonHandler(
    finalizePromise: Promise<unknown>,
  ): Promise<string> {
    const status: { html: string } = {
      html: '<div class="score-submitted">Submitting...</div>',
    };
    const setHtml = (h: string) => {
      status.html = h;
    };
    const GENERIC = "Submission did not complete. Please refresh and try again.";
    function showError(msg: string | null): void {
      setHtml(
        '<div class="score-error">⚠️ Could not submit: ' + (msg || GENERIC) + "</div>",
      );
    }
    return finalizePromise.then(
      (r: unknown) => {
        if (r && (r as { ok?: boolean }).ok) {
          setHtml('<div class="score-submitted">✅ Submitted</div>');
        } else if (r) {
          showError((r as { message?: string }).message ?? null);
        } else {
          showError(null);
        }
        return status.html;
      },
      () => {
        showError(null);
        return status.html;
      },
    );
  }

  it("shows a generic error when finalize resolves to null (never leaves Submitting...)", async () => {
    const html = await renderLessonHandler(Promise.resolve(null));
    expect(html).toContain("score-error");
    expect(html).not.toContain("Submitting...");
  });

  it("shows the server-provided message when finalize resolves {ok:false, message}", async () => {
    const html = await renderLessonHandler(
      Promise.resolve({ ok: false, message: "assignment closed" }),
    );
    expect(html).toContain("assignment closed");
    expect(html).not.toContain("Submitting...");
  });

  it("shows a generic error when finalize rejects", async () => {
    const html = await renderLessonHandler(
      Promise.reject(new Error("boom")),
    );
    expect(html).toContain("score-error");
    expect(html).not.toContain("Submitting...");
  });

  it("shows the submitted confirmation on success", async () => {
    const html = await renderLessonHandler(
      Promise.resolve({ ok: true, result: {} }),
    );
    expect(html).toContain("Submitted");
    expect(html).not.toContain("Submitting...");
  });
});
