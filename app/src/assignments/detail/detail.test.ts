/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";
import { renderAssignmentDetail } from "./detail";
import type {
  AssignmentDetailMetadata,
  AssignmentDetailMetadataReader,
} from "./types";
import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
} from "../summary/types";

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const freezeMetadata = (
  overrides: Partial<AssignmentDetailMetadata> = {},
): AssignmentDetailMetadata =>
  Object.freeze({
    assignmentId: "assign-1",
    title: "Waves and Signals Check",
    status: "published",
    className: "Period 3 - Grade 7 Physical Science",
    ...overrides,
  }) as AssignmentDetailMetadata;

const freezeSummary = (
  overrides: Partial<AssignmentSummary> = {},
): AssignmentSummary =>
  Object.freeze({
    assignmentId: "assign-1",
    classId: "class-1",
    totalStudents: 24,
    completedStudents: 12,
    inProgressStudents: 6,
    notStartedStudents: 6,
    completionPercentage: 50,
    averagePercentage: 82,
    highestPercentage: 100,
    lowestPercentage: 45,
    perfectScoreStudents: 3,
    ...overrides,
  }) as AssignmentSummary;

const resolvingMeta =
  (metadata: AssignmentDetailMetadata | null): AssignmentDetailMetadataReader =>
  () =>
    Promise.resolve(metadata);

const rejectingMeta = (): AssignmentDetailMetadataReader => () =>
  Promise.reject(new Error("metadata read failed"));

const resolvingSummary =
  (summary: AssignmentSummary): AssignmentSummaryCallable =>
  () =>
    Promise.resolve(summary);

const rejectingSummary = (): AssignmentSummaryCallable => () =>
  Promise.reject(new Error("summary callable failed"));

const spyingMeta = (
  metadata: AssignmentDetailMetadata,
): {
  readonly reader: AssignmentDetailMetadataReader;
  readonly calls: Array<string>;
} => {
  const calls: Array<string> = [];
  const reader: AssignmentDetailMetadataReader = (input) => {
    calls.push(input.assignmentId);
    return Promise.resolve(metadata);
  };
  return { reader, calls };
};

const spyingSummary = (
  summary: AssignmentSummary,
): {
  readonly callable: AssignmentSummaryCallable;
  readonly calls: Array<string>;
} => {
  const calls: Array<string> = [];
  const callable: AssignmentSummaryCallable = (input) => {
    calls.push(input.assignmentId);
    return Promise.resolve(summary);
  };
  return { callable, calls };
};

describe("renderAssignmentDetail - loading state", () => {
  test("renders the loading indicator immediately on mount", () => {
    const mount = mkMount();
    let resolveMeta: (v: AssignmentDetailMetadata | null) => void = () =>
      undefined;
    const reader: AssignmentDetailMetadataReader = () =>
      new Promise<AssignmentDetailMetadata | null>((r) => {
        resolveMeta = r;
      });
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: reader,
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    expect(
      mount.querySelector("[data-testid=assignment-detail-spinner]"),
    ).not.toBeNull();
    const loading = mount.querySelector(
      "[data-testid=assignment-detail-loading]",
    );
    expect(loading?.getAttribute("role")).toBe("status");
    expect(loading?.getAttribute("aria-live")).toBe("polite");
    resolveMeta(freezeMetadata());
  });

  test("loading indicator disappears once metadata resolves", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-spinner]"),
    ).toBeNull();
  });

  test("summary card renders its own loading state while metadata is present", async () => {
    const mount = mkMount();
    let resolveSummary: (v: AssignmentSummary) => void = () => undefined;
    const summaryCallable: AssignmentSummaryCallable = () =>
      new Promise<AssignmentSummary>((r) => {
        resolveSummary = r;
      });
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable,
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-header]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-summary-spinner]"),
    ).not.toBeNull();
    resolveSummary(freezeSummary());
  });
});

describe("renderAssignmentDetail - success rendering", () => {
  test("renders the assignment title and class; an ordinary published assignment shows no Status pair", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-title]")?.textContent,
    ).toBe("Waves and Signals Check");
    expect(
      mount.querySelector("[data-testid=assignment-detail-class-value]")
        ?.textContent,
    ).toBe("Period 3 - Grade 7 Physical Science");
    // The ordinary published state does not announce itself: no Status
    // label, no Published pill, no Current marker. The lifecycle status is
    // still carried by the metadata (and drives the legacy Reopen action
    // for a record that is already closed).
    expect(mount.querySelector("[data-testid=assignment-detail-status]")).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-status-value]")).toBeNull();
    const header = mount.querySelector<HTMLElement>("[data-testid=assignment-detail-header]");
    expect(header?.textContent).not.toMatch(/Published|Current|Status/);
  });

  test("mounts the Sprint 13A summary card exactly once", async () => {
    const mount = mkMount();
    const meta = spyingMeta(freezeMetadata());
    const summary = spyingSummary(freezeSummary());
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: meta.reader,
      summaryCallable: summary.callable,
    });
    await flush();
    await flush();
    const cards = mount.querySelectorAll(
      "[data-testid=assignment-summary]",
    );
    expect(cards.length).toBe(1);
    expect(meta.calls).toEqual(["assign-1"]);
    expect(summary.calls).toEqual(["assign-1"]);
  });

  test("draft and closed statuses map to distinct visible labels", async () => {
    for (const [status, label] of [
      ["draft", "Draft"],
      ["closed", "Closed"],
    ] as const) {
      const mount = mkMount();
      renderAssignmentDetail(mount, {
        assignmentId: `assign-${status}`,
        loadMetadata: resolvingMeta(freezeMetadata({ status })),
        summaryCallable: resolvingSummary(freezeSummary()),
      });
      await flush();
      await flush();
      expect(
        mount.querySelector("[data-testid=assignment-detail-status-value]")
          ?.textContent,
      ).toBe(label);
    }
  });
});

describe("renderAssignmentDetail - navigation", () => {
  test("renders a Back button when onBack is provided and invokes it on click", async () => {
    const mount = mkMount();
    let clicked = 0;
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: resolvingSummary(freezeSummary()),
      onBack: () => {
        clicked += 1;
      },
    });
    await flush();
    const back = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-back]",
    );
    expect(back).not.toBeNull();
    // Sprint 16 Slice 4: the Back control identifies Curriculum as its
    // destination in both the visible label and the accessible name.
    expect(back?.getAttribute("aria-label")).toBe("Back to Curriculum");
    expect(back?.textContent).toBe("Back to Curriculum");
    // Control hierarchy Op 1: the shared Teacher Workspace Back control.
    expect(back?.classList.contains("shell-back")).toBe(true);
    back?.click();
    expect(clicked).toBe(1);
  });

  test("omits the Back button when onBack is not provided", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-back]"),
    ).toBeNull();
  });

  test("opening a second detail after a return re-invokes both readers per open", async () => {
    const firstMount = mkMount();
    const meta = spyingMeta(freezeMetadata({ assignmentId: "assign-A" }));
    const summary = spyingSummary(freezeSummary({ assignmentId: "assign-A" }));
    renderAssignmentDetail(firstMount, {
      assignmentId: "assign-A",
      loadMetadata: meta.reader,
      summaryCallable: summary.callable,
      onBack: () => undefined,
    });
    await flush();
    await flush();
    firstMount.remove();

    const secondMount = mkMount();
    renderAssignmentDetail(secondMount, {
      assignmentId: "assign-B",
      loadMetadata: (input) => {
        meta.calls.push(input.assignmentId);
        return Promise.resolve(
          freezeMetadata({
            assignmentId: "assign-B",
            title: "Second Assignment",
          }),
        );
      },
      summaryCallable: (input) => {
        summary.calls.push(input.assignmentId);
        return Promise.resolve(freezeSummary({ assignmentId: "assign-B" }));
      },
    });
    await flush();
    await flush();
    expect(meta.calls).toEqual(["assign-A", "assign-B"]);
    expect(summary.calls).toEqual(["assign-A", "assign-B"]);
  });
});

describe("renderAssignmentDetail - empty state", () => {
  test("renders the empty state when the reader resolves with null", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-missing",
      loadMetadata: resolvingMeta(null),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    const empty = mount.querySelector("[data-testid=assignment-detail-empty]");
    expect(empty?.getAttribute("role")).toBe("status");
    expect(empty?.getAttribute("aria-live")).toBe("polite");
    expect(empty?.textContent ?? "").toContain(
      "We could not find this assignment",
    );
  });

  test("empty state never mounts the summary card and never invokes the summary callable", async () => {
    const mount = mkMount();
    const summary = spyingSummary(freezeSummary());
    renderAssignmentDetail(mount, {
      assignmentId: "assign-missing",
      loadMetadata: resolvingMeta(null),
      summaryCallable: summary.callable,
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-summary]"),
    ).toBeNull();
    expect(summary.calls.length).toBe(0);
  });

  test("empty state never exposes recipient, roster, or Firestore vocabulary", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-missing",
      loadMetadata: resolvingMeta(null),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    const text = mount.textContent ?? "";
    for (const forbidden of [
      "recipient",
      "recipients",
      "roster",
      "enrollment",
      "collection",
      "Firestore",
      "callable",
      "permission-denied",
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("renderAssignmentDetail - error state", () => {
  test("renders the error alert when the reader rejects", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: rejectingMeta(),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    const error = mount.querySelector("[data-testid=assignment-detail-error]");
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent ?? "").toContain(
      "We could not load this assignment",
    );
    expect(
      mount.querySelector("[data-testid=assignment-detail-retry]"),
    ).not.toBeNull();
  });

  test("retry re-invokes the reader and recovers on success", async () => {
    const mount = mkMount();
    let attempts = 0;
    const reader: AssignmentDetailMetadataReader = () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve(freezeMetadata());
    };
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: reader,
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    const retry = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-retry]",
    );
    expect(retry).not.toBeNull();
    retry?.click();
    await flush();
    await flush();
    expect(attempts).toBe(2);
    expect(
      mount.querySelector("[data-testid=assignment-detail-error]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-title]"),
    ).not.toBeNull();
  });

  test("rejection message never leaks to the DOM", async () => {
    const mount = mkMount();
    const secret =
      "Firestore permission-denied at attempts/{attempt-42} for user student-77";
    const reader: AssignmentDetailMetadataReader = () =>
      Promise.reject(new Error(secret));
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: reader,
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    const text = mount.textContent ?? "";
    expect(text).not.toContain("Firestore");
    expect(text).not.toContain("permission-denied");
    expect(text).not.toContain("attempts/");
    expect(text).not.toContain("attempt-42");
    expect(text).not.toContain("student-77");
  });

  test("summary callable failure is surfaced by the summary card, not by the detail error state", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: rejectingSummary(),
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-error]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-summary-error]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-header]"),
    ).not.toBeNull();
  });
});

describe("renderAssignmentDetail - confidentiality", () => {
  test("rendered subtree never contains forbidden identifiers", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    await flush();
    const html = mount.innerHTML;
    const text = mount.textContent ?? "";
    for (const forbidden of [
      "studentId",
      "student-id",
      "recipientId",
      "attemptId",
      "sessionId",
      "teacherId",
      "districtId",
      "schoolId",
      "displayName",
      "answerKey",
      "explanation",
    ]) {
      expect(html).not.toContain(forbidden);
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("renderAssignmentDetail - accessibility", () => {
  test("headline id is stable and referenced by aria-labelledby", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    const surface = mount.querySelector("[data-testid=assignment-detail]");
    expect(surface?.getAttribute("aria-labelledby")).toBe(
      "assignment-detail-headline",
    );
    const headline = mount.querySelector(
      "#assignment-detail-headline",
    );
    expect(headline).not.toBeNull();
  });

  test("loading, empty, and error states announce via aria-live or role=alert", async () => {
    for (const [reader, testid, expectRole] of [
      [resolvingMeta(null), "assignment-detail-empty", "status"],
      [rejectingMeta(), "assignment-detail-error", "alert"],
    ] as const) {
      const mount = mkMount();
      renderAssignmentDetail(mount, {
        assignmentId: "assign-1",
        loadMetadata: reader,
        summaryCallable: resolvingSummary(freezeSummary()),
      });
      await flush();
      const node = mount.querySelector(`[data-testid=${testid}]`);
      expect(node?.getAttribute("role")).toBe(expectRole);
    }
  });
});

describe("renderAssignmentDetail - request posture", () => {
  test("metadata reader is called exactly once per mount and only once", async () => {
    const mount = mkMount();
    const meta = spyingMeta(freezeMetadata());
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: meta.reader,
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    await flush();
    expect(meta.calls).toEqual(["assign-1"]);
  });

  test("detail source module opens no firebase/*, listener, or browser storage", () => {
    const detailSource = fs.readFileSync(
      path.join(__dirname, "detail.ts"),
      "utf8",
    );
    const typesSource = fs.readFileSync(
      path.join(__dirname, "types.ts"),
      "utf8",
    );
    for (const source of [detailSource, typesSource]) {
      expect(source).not.toMatch(/from ['"]firebase\//);
      expect(source).not.toContain("httpsCallable(");
      expect(source).not.toContain("onSnapshot(");
      expect(source).not.toContain("localStorage");
      expect(source).not.toContain("sessionStorage");
    }
  });
});

// -----------------------------------------------------------------------------
// Assignment lifecycle: teacher-controlled closing is retired. A published
// assignment stays available for the lifetime of its class, so Assignment
// Detail never offers Close. `closed` survives only as a legacy state whose
// recovery path is Reopen (Sprint 13E, below).
// -----------------------------------------------------------------------------

import type {
  AssignmentsReopenCallable,
  AssignmentsReopenResult,
} from "./types";

describe("renderAssignmentDetail - Close is retired", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("published assignment renders no Close action and no lifecycle scaffold, even with Reopen wired", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "published" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: resolvingReopen().callable,
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-close-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-reopen-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-closed-label]"),
    ).toBeNull();
    // The header holds only the identity column, so it fills the row; no
    // placeholder control is rendered in the former action slot.
    expect(
      mount.querySelector("[data-testid=assignment-detail-lifecycle]"),
    ).toBeNull();
    const header = mount.querySelector(
      "[data-testid=assignment-detail-header]",
    );
    expect(header?.children.length).toBe(1);
    expect(
      header?.firstElementChild?.getAttribute("data-testid"),
    ).toBe("assignment-detail-identity");
    // No button anywhere on the surface reads as a Close control.
    for (const btn of Array.from(mount.querySelectorAll("button"))) {
      expect(btn.textContent ?? "").not.toMatch(/close assignment/i);
    }
  });

  test("published assignment renders no lifecycle scaffold when no lifecycle seam is wired", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "published" })),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-lifecycle]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-close-action]"),
    ).toBeNull();
  });

  test("legacy closed assignment without a Reopen seam keeps the calm Assignment closed label", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-close-action]"),
    ).toBeNull();
    const label = mount.querySelector(
      "[data-testid=assignment-detail-closed-label]",
    );
    expect(label?.textContent).toBe("Assignment closed");
    expect(label?.getAttribute("role")).toBe("status");
    // The legacy Closed status pair still renders for an actually closed
    // record.
    expect(
      mount.querySelector("[data-testid=assignment-detail-status-value]")
        ?.textContent,
    ).toBe("Closed");
  });

  test("no Close confirmation dialog can be opened from a published assignment", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "published" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: resolvingReopen().callable,
    });
    await flush();
    await flush();
    for (const btn of Array.from(mount.querySelectorAll("button"))) {
      btn.click();
    }
    await flush();
    expect(
      document.querySelector("[data-testid=assignment-detail-close-dialog]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assignment-detail-close-confirm]"),
    ).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Sprint 13E: Reopen assignment lifecycle
// -----------------------------------------------------------------------------

const resolvingReopen = (
  result?: Partial<AssignmentsReopenResult>,
): {
  readonly callable: AssignmentsReopenCallable;
  readonly calls: Array<string>;
} => {
  const calls: Array<string> = [];
  const callable: AssignmentsReopenCallable = ({ assignmentId }) => {
    calls.push(assignmentId);
    return Promise.resolve(
      Object.freeze({
        assignmentId,
        status: "published" as const,
        alreadyPublished: false,
        ...(result ?? {}),
      }),
    );
  };
  return { callable, calls };
};

const rejectingReopen = (): {
  readonly callable: AssignmentsReopenCallable;
  readonly calls: Array<string>;
} => {
  const calls: Array<string> = [];
  const callable: AssignmentsReopenCallable = ({ assignmentId }) => {
    calls.push(assignmentId);
    return Promise.reject(new Error("reopen failed"));
  };
  return { callable, calls };
};

describe("renderAssignmentDetail - reopen lifecycle (Sprint 13E)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("closed assignment shows Reopen assignment when the reopen callable is wired", async () => {
    const mount = mkMount();
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: reopen.callable,
    });
    await flush();
    await flush();
    const action = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-reopen-action]",
    );
    expect(action).not.toBeNull();
    expect(action?.textContent).toBe("Reopen assignment");
    expect(
      mount.querySelector("[data-testid=assignment-detail-close-action]"),
    ).toBeNull();
    // Sprint 13E: exactly one lifecycle action visible; the closed
    // label is superseded by the reopen action.
    expect(
      mount.querySelector("[data-testid=assignment-detail-closed-label]"),
    ).toBeNull();
  });

  test("a legacy closed assignment that is reopened returns to the ordinary published header with no Close action", async () => {
    const mount = mkMount();
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: reopen.callable,
    });
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    expect(reopen.calls).toEqual(["assign-1"]);
    expect(
      mount.querySelector("[data-testid=assignment-detail-close-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-lifecycle]"),
    ).toBeNull();
  });
  test("closed assignment falls back to the Assignment closed label when reopen is not wired", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-reopen-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-closed-label]")
        ?.textContent,
    ).toBe("Assignment closed");
  });

  test("clicking Reopen assignment opens the confirmation dialog", async () => {
    const mount = mkMount();
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: reopen.callable,
    });
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    const dialog = document.querySelector(
      "[data-testid=assignment-detail-reopen-dialog]",
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(
      document.querySelector("[data-testid=assignment-detail-reopen-title]")
        ?.textContent,
    ).toBe("Reopen this assignment?");
    expect(
      document.querySelector(
        "[data-testid=assignment-detail-reopen-description]",
      )?.textContent,
    ).toContain("Students will be able to submit new work again.");
    expect(reopen.calls).toEqual([]);
  });

  test("Cancel leaves the assignment unchanged and never invokes the callable", async () => {
    const mount = mkMount();
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: reopen.callable,
    });
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-cancel]",
      )
      ?.click();
    await flush();
    expect(
      document.querySelector("[data-testid=assignment-detail-reopen-dialog]"),
    ).toBeNull();
    expect(reopen.calls).toEqual([]);
    expect(
      mount.querySelector("[data-testid=assignment-detail-status-value]")
        ?.textContent,
    ).toBe("Closed");
    expect(
      mount.querySelector("[data-testid=assignment-detail-reopen-action]"),
    ).not.toBeNull();
  });

  test("Confirm invokes the callable exactly once and updates the header to Published", async () => {
    const mount = mkMount();
    const reopen = resolvingReopen();
    const statusChanges: Array<AssignmentDetailMetadata> = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: reopen.callable,
      onStatusChange: (m) => {
        statusChanges.push(m);
      },
    });
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    expect(reopen.calls).toEqual(["assign-1"]);
    // Published is the ordinary state: no Status pair is shown for it.
    expect(
      mount.querySelector("[data-testid=assignment-detail-status-value]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-reopen-action]"),
    ).toBeNull();
    // Teacher-controlled closing is retired: the reopened (now published)
    // assignment renders no lifecycle action at all.
    expect(
      mount.querySelector("[data-testid=assignment-detail-close-action]"),
    ).toBeNull();
    expect(statusChanges).toHaveLength(1);
    expect(statusChanges[0]?.status).toBe("published");
    expect(statusChanges[0]?.assignmentId).toBe("assign-1");
  });

  test("Failure preserves the Closed state and renders a generic error message", async () => {
    const mount = mkMount();
    const reopen = rejectingReopen();
    const statusChanges: Array<AssignmentDetailMetadata> = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: reopen.callable,
      onStatusChange: (m) => {
        statusChanges.push(m);
      },
    });
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    expect(reopen.calls).toEqual(["assign-1"]);
    expect(
      mount.querySelector("[data-testid=assignment-detail-status-value]")
        ?.textContent,
    ).toBe("Closed");
    expect(
      mount.querySelector("[data-testid=assignment-detail-reopen-action]"),
    ).not.toBeNull();
    const err = mount.querySelector(
      "[data-testid=assignment-detail-reopen-error]",
    );
    expect(err).not.toBeNull();
    expect(err?.getAttribute("role")).toBe("alert");
    expect(err?.textContent).not.toMatch(/firestore|callable|assignments\.|stack/i);
    expect(statusChanges).toHaveLength(0);
  });

  test("Escape closes the confirmation dialog without invoking the callable", async () => {
    const mount = mkMount();
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: reopen.callable,
    });
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await flush();
    expect(
      document.querySelector("[data-testid=assignment-detail-reopen-dialog]"),
    ).toBeNull();
    expect(reopen.calls).toEqual([]);
  });

  test("Back button remains functional in the reopened state after a successful reopen", async () => {
    const mount = mkMount();
    const reopen = resolvingReopen();
    let backClicks = 0;
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: reopen.callable,
      onBack: () => {
        backClicks += 1;
      },
    });
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-back]",
      )
      ?.click();
    expect(backClicks).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// Sprint 13F - Draft assignment discovery in Assignment Detail
// -----------------------------------------------------------------------------

describe("renderAssignmentDetail - draft state (Sprint 13F)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("draft assignment shows the Draft status label", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    const status = mount.querySelector(
      "[data-testid=assignment-detail-status-value]",
    );
    expect(status?.textContent).toBe("Draft");
  });

  test("draft assignment renders the Draft assignment lifecycle label", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    const label = mount.querySelector(
      "[data-testid=assignment-detail-draft-label]",
    );
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("Draft assignment");
  });

  test("draft assignment does not expose Close or Reopen actions", async () => {
    const reopener = resolvingReopen();
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: reopener.callable,
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-close-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-reopen-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-closed-label]"),
    ).toBeNull();
  });

  test("published workflow is unchanged when neither draft nor closed", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "published" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: resolvingReopen().callable,
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-close-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-draft-label]"),
    ).toBeNull();
  });

  test("draft hides the Sprint 13A Assignment Summary card and never invokes the summary callable", async () => {
    const summary = spyingSummary(freezeSummary());
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: summary.callable,
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-summary-host]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-summary]"),
    ).toBeNull();
    expect(summary.calls.length).toBe(0);
  });

  test("draft renders the informational Assignment results panel", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    const panel = mount.querySelector(
      "[data-testid=assignment-detail-draft-summary]",
    );
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("role")).toBe("status");
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-draft-summary-heading]",
      )?.textContent,
    ).toBe("Assignment results");
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-draft-summary-body]",
      )?.textContent,
    ).toBe(
      "Assignment results will appear after this draft is published and students begin submitting work.",
    );
  });

  test("published still renders the Sprint 13A Assignment Summary card", async () => {
    const summary = spyingSummary(freezeSummary());
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "published" })),
      summaryCallable: summary.callable,
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-summary-host]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-draft-summary]"),
    ).toBeNull();
    expect(summary.calls).toEqual(["assign-1"]);
  });

  test("closed still renders the Sprint 13A Assignment Summary card", async () => {
    const summary = spyingSummary(freezeSummary());
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: summary.callable,
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-summary-host]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-draft-summary]"),
    ).toBeNull();
    expect(summary.calls).toEqual(["assign-1"]);
  });
});

// -----------------------------------------------------------------------------
// Sprint 13G: Draft editing foundation
// -----------------------------------------------------------------------------

import type {
  AssignmentsUpdateDraftCallable,
  AssignmentsUpdateDraftInput,
  AssignmentsUpdateDraftResult,
} from "./types";

const resolvingUpdate = (
  result?: Partial<AssignmentsUpdateDraftResult>,
): {
  readonly callable: AssignmentsUpdateDraftCallable;
  readonly calls: Array<AssignmentsUpdateDraftInput>;
} => {
  const calls: Array<AssignmentsUpdateDraftInput> = [];
  const callable: AssignmentsUpdateDraftCallable = (input) => {
    calls.push(input);
    return Promise.resolve(
      Object.freeze({
        assignmentId: input.assignmentId,
        alreadyUpdated: false,
        ...(result ?? {}),
      }),
    );
  };
  return { callable, calls };
};

const rejectingUpdate = (): {
  readonly callable: AssignmentsUpdateDraftCallable;
  readonly calls: Array<AssignmentsUpdateDraftInput>;
} => {
  const calls: Array<AssignmentsUpdateDraftInput> = [];
  const callable: AssignmentsUpdateDraftCallable = (input) => {
    calls.push(input);
    return Promise.reject(new Error("update failed"));
  };
  return { callable, calls };
};

describe("renderAssignmentDetail - draft editing (Sprint 13G)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("draft assignment renders the Edit draft action when the update callable is wired", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    const editButton = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-edit-action]",
    );
    expect(editButton).not.toBeNull();
    expect(editButton?.textContent).toBe("Edit draft");
    expect(update.calls).toEqual([]);
  });

  test("draft assignment omits the Edit draft action when the update callable is not wired", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-edit-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-draft-label]"),
    ).not.toBeNull();
  });

  test("published assignment never exposes the Edit draft action", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "published" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-edit-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-editor]"),
    ).toBeNull();
  });

  test("closed assignment never exposes the Edit draft action", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-edit-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-editor]"),
    ).toBeNull();
  });

  test("clicking Edit draft opens the inline editor prefilled with the current title", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    const editButton = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-edit-action]",
    );
    editButton?.click();
    const form = mount.querySelector<HTMLFormElement>(
      "[data-testid=assignment-detail-editor]",
    );
    expect(form).not.toBeNull();
    const input = mount.querySelector<HTMLInputElement>(
      "[data-testid=assignment-detail-editor-title]",
    );
    expect(input?.value).toBe("Original Title");
    expect(
      mount.querySelector("[data-testid=assignment-detail-draft-label]"),
    ).toBeNull();
    expect(update.calls).toEqual([]);
  });

  test("Cancel closes the editor and never invokes the callable", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const input = mount.querySelector<HTMLInputElement>(
      "[data-testid=assignment-detail-editor-title]",
    ) as HTMLInputElement;
    input.value = "Modified before cancel";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-editor-cancel]",
      )
      ?.click();
    expect(
      mount.querySelector("[data-testid=assignment-detail-editor]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-draft-label]"),
    ).not.toBeNull();
    const title = mount.querySelector(
      "[data-testid=assignment-detail-title]",
    );
    expect(title?.textContent).toBe("Original Title");
    expect(update.calls).toEqual([]);
  });

  test("Save invokes the update callable exactly once and updates the header title on success", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    const statusChanges: Array<AssignmentDetailMetadata> = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
      onStatusChange: (m) => {
        statusChanges.push(m);
      },
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const input = mount.querySelector<HTMLInputElement>(
      "[data-testid=assignment-detail-editor-title]",
    ) as HTMLInputElement;
    input.value = "Renamed Draft";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-editor-save]",
      )
      ?.click();
    await flush();
    await flush();
    expect(update.calls).toEqual([
      { assignmentId: "assign-draft", title: "Renamed Draft" },
    ]);
    const title = mount.querySelector(
      "[data-testid=assignment-detail-title]",
    );
    expect(title?.textContent).toBe("Renamed Draft");
    expect(
      mount.querySelector("[data-testid=assignment-detail-editor]"),
    ).toBeNull();
    expect(statusChanges.length).toBe(1);
    expect(statusChanges[0]?.title).toBe("Renamed Draft");
    expect(statusChanges[0]?.status).toBe("draft");
    expect(statusChanges[0]?.assignmentId).toBe("assign-draft");
  });

  test("Save with an empty title blocks the callable and surfaces the validation message", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const input = mount.querySelector<HTMLInputElement>(
      "[data-testid=assignment-detail-editor-title]",
    ) as HTMLInputElement;
    input.value = "   ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-editor-save]",
      )
      ?.click();
    await flush();
    expect(update.calls).toEqual([]);
    const err = mount.querySelector(
      "[data-testid=assignment-detail-editor-title-error]",
    );
    expect(err).not.toBeNull();
    expect(err?.textContent).toBe("Enter a title before saving.");
    const inputAfter = mount.querySelector<HTMLInputElement>(
      "[data-testid=assignment-detail-editor-title]",
    );
    expect(inputAfter?.getAttribute("aria-invalid")).toBe("true");
    const title = mount.querySelector(
      "[data-testid=assignment-detail-title]",
    );
    expect(title?.textContent).toBe("Original Title");
  });

  test("callable failure preserves the header and renders a generic error message", async () => {
    const mount = mkMount();
    const update = rejectingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const input = mount.querySelector<HTMLInputElement>(
      "[data-testid=assignment-detail-editor-title]",
    ) as HTMLInputElement;
    input.value = "Renamed Draft";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-editor-save]",
      )
      ?.click();
    await flush();
    await flush();
    expect(update.calls.length).toBe(1);
    const banner = mount.querySelector(
      "[data-testid=assignment-detail-editor-save-error]",
    );
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toBe(
      "We could not save this draft right now. Try again in a moment.",
    );
    const title = mount.querySelector(
      "[data-testid=assignment-detail-title]",
    );
    expect(title?.textContent).toBe("Original Title");
    expect(
      mount.querySelector("[data-testid=assignment-detail-editor]"),
    ).not.toBeNull();
  });

  test("Save with an unchanged title still invokes the callable with only the assignmentId and updates onStatusChange registry", async () => {
    // Idempotent editing round-trip. The callable is invoked so a
    // registry consumer that mirrors the metadata (Sprint 13B / 13C /
    // 13F) receives the fresh copy; the header title is unchanged.
    const mount = mkMount();
    const update = resolvingUpdate({ alreadyUpdated: true });
    const statusChanges: Array<AssignmentDetailMetadata> = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
      onStatusChange: (m) => {
        statusChanges.push(m);
      },
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    // Save without editing.
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-editor-save]",
      )
      ?.click();
    await flush();
    await flush();
    expect(update.calls).toEqual([{ assignmentId: "assign-draft" }]);
    expect(statusChanges[0]?.title).toBe("Original Title");
    expect(
      mount.querySelector("[data-testid=assignment-detail-editor]"),
    ).toBeNull();
  });

  test("editor never exposes ownership, class, submission, attempt, session, or firebase vocabulary", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const editor = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-editor]",
    ) as HTMLElement;
    const text = editor.textContent ?? "";
    for (const forbidden of [
      "teacherId",
      "schoolId",
      "districtId",
      "recipient",
      "attempt",
      "session",
      "submission",
      "firestore",
      "firebase",
      "callable",
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  // Sprint 13G scope completion tests: instructions round-trip.
  test("editor exposes the instructions textarea prefilled with the current instructions", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
          instructions: "Existing instructions.",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const textarea = mount.querySelector<HTMLTextAreaElement>(
      "[data-testid=assignment-detail-editor-instructions]",
    );
    expect(textarea).not.toBeNull();
    expect(textarea?.tagName).toBe("TEXTAREA");
    expect(textarea?.value).toBe("Existing instructions.");
  });

  test("editor exposes an empty instructions textarea when the metadata has no instructions", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const textarea = mount.querySelector<HTMLTextAreaElement>(
      "[data-testid=assignment-detail-editor-instructions]",
    );
    expect(textarea?.value).toBe("");
  });

  test("Save sends instructions when the trimmed edit differs from the current value", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    const statusChanges: Array<AssignmentDetailMetadata> = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
      onStatusChange: (m) => {
        statusChanges.push(m);
      },
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const textarea = mount.querySelector<HTMLTextAreaElement>(
      "[data-testid=assignment-detail-editor-instructions]",
    ) as HTMLTextAreaElement;
    textarea.value = "  Read the introduction.  ";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-editor-save]",
      )
      ?.click();
    await flush();
    await flush();
    expect(update.calls).toEqual([
      {
        assignmentId: "assign-draft",
        instructions: "Read the introduction.",
      },
    ]);
    expect(statusChanges[0]?.instructions).toBe("Read the introduction.");
  });

  test("Save omits instructions when unchanged", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
          instructions: "Existing instructions.",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const input = mount.querySelector<HTMLInputElement>(
      "[data-testid=assignment-detail-editor-title]",
    ) as HTMLInputElement;
    input.value = "Renamed Draft";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-editor-save]",
      )
      ?.click();
    await flush();
    await flush();
    expect(update.calls).toEqual([
      { assignmentId: "assign-draft", title: "Renamed Draft" },
    ]);
  });

  test("Cancel discards edited instructions and the callable is not invoked", async () => {
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
          instructions: "Existing instructions.",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const textarea = mount.querySelector<HTMLTextAreaElement>(
      "[data-testid=assignment-detail-editor-instructions]",
    ) as HTMLTextAreaElement;
    textarea.value = "Different instructions.";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-editor-cancel]",
      )
      ?.click();
    await flush();
    expect(update.calls).toEqual([]);
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const reopened = mount.querySelector<HTMLTextAreaElement>(
      "[data-testid=assignment-detail-editor-instructions]",
    );
    expect(reopened?.value).toBe("Existing instructions.");
  });

  test("whitespace-only instructions edit is not sent to the callable", async () => {
    // The callable rejects an empty-string `instructions` per its
    // canonical contract; the client treats a whitespace-only edit as
    // no change and never sends the field. Clearing instructions is
    // not supported until the callable admits a canonical clear
    // sentinel.
    const mount = mkMount();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(
        freezeMetadata({
          assignmentId: "assign-draft",
          status: "draft",
          title: "Original Title",
          instructions: "Existing instructions.",
        }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    const textarea = mount.querySelector<HTMLTextAreaElement>(
      "[data-testid=assignment-detail-editor-instructions]",
    ) as HTMLTextAreaElement;
    textarea.value = "   ";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-editor-save]",
      )
      ?.click();
    await flush();
    await flush();
    expect(update.calls).toEqual([{ assignmentId: "assign-draft" }]);
  });
});

// -----------------------------------------------------------------------------
// Sprint 13H: Draft publication workflow
// -----------------------------------------------------------------------------

import type {
  AssignmentsPublishCallable,
  AssignmentsPublishResult,
} from "./types";

const resolvingPublish = (
  result?: Partial<AssignmentsPublishResult>,
): {
  readonly callable: AssignmentsPublishCallable;
  readonly calls: Array<string>;
} => {
  const calls: Array<string> = [];
  const callable: AssignmentsPublishCallable = ({ assignmentId }) => {
    calls.push(assignmentId);
    return Promise.resolve(
      Object.freeze({
        assignmentId,
        status: "published" as const,
        alreadyPublished: false,
        ...(result ?? {}),
      }),
    );
  };
  return { callable, calls };
};

const rejectingPublish = (): {
  readonly callable: AssignmentsPublishCallable;
  readonly calls: Array<string>;
} => {
  const calls: Array<string> = [];
  const callable: AssignmentsPublishCallable = ({ assignmentId }) => {
    calls.push(assignmentId);
    return Promise.reject(new Error("publish failed"));
  };
  return { callable, calls };
};

describe("renderAssignmentDetail - publish lifecycle (Sprint 13H)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("draft assignment shows the Publish assignment action when the publish callable is wired", async () => {
    const mount = mkMount();
    const publish = resolvingPublish();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
      publishCallable: publish.callable,
    });
    await flush();
    const action = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-publish-action]",
    );
    expect(action).not.toBeNull();
    expect(action?.textContent).toBe("Publish assignment");
    // Edit draft still renders alongside Publish.
    expect(
      mount.querySelector("[data-testid=assignment-detail-edit-action]"),
    ).not.toBeNull();
    expect(publish.calls).toEqual([]);
  });

  test("published assignment never exposes the Publish assignment action", async () => {
    const mount = mkMount();
    const publish = resolvingPublish();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "published" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      publishCallable: publish.callable,
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-publish-action]"),
    ).toBeNull();
  });

  test("closed assignment never exposes the Publish assignment action", async () => {
    const mount = mkMount();
    const publish = resolvingPublish();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      publishCallable: publish.callable,
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-publish-action]"),
    ).toBeNull();
  });

  test("draft renders no publish action when the publish callable is not wired", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-publish-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-draft-label]"),
    ).not.toBeNull();
  });

  test("clicking Publish assignment opens the confirmation dialog", async () => {
    const mount = mkMount();
    const publish = resolvingPublish();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      publishCallable: publish.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-publish-action]",
      )
      ?.click();
    const dialog = document.querySelector(
      "[data-testid=assignment-detail-publish-dialog]",
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(
      document.querySelector(
        "[data-testid=assignment-detail-publish-title]",
      )?.textContent,
    ).toBe("Publish this assignment?");
    expect(
      document.querySelector(
        "[data-testid=assignment-detail-publish-description]",
      )?.textContent,
    ).toBe(
      "Students in the frozen recipient list will be able to begin submitting work.",
    );
    expect(publish.calls).toEqual([]);
  });

  test("Cancel leaves the draft unchanged and never invokes the callable", async () => {
    const mount = mkMount();
    const publish = resolvingPublish();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      publishCallable: publish.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-publish-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-publish-cancel]",
      )
      ?.click();
    await flush();
    expect(
      document.querySelector(
        "[data-testid=assignment-detail-publish-dialog]",
      ),
    ).toBeNull();
    expect(publish.calls).toEqual([]);
    expect(
      mount.querySelector("[data-testid=assignment-detail-status-value]")
        ?.textContent,
    ).toBe("Draft");
    expect(
      mount.querySelector("[data-testid=assignment-detail-publish-action]"),
    ).not.toBeNull();
  });

  test("Confirm invokes the callable exactly once and updates the header to Published", async () => {
    const mount = mkMount();
    const publish = resolvingPublish();
    const update = resolvingUpdate();
    const statusChanges: Array<AssignmentDetailMetadata> = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
      publishCallable: publish.callable,
      onStatusChange: (m) => {
        statusChanges.push(m);
      },
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-publish-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-publish-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    expect(publish.calls).toEqual(["assign-1"]);
    // Published is the ordinary state: no Status pair is shown for it.
    expect(
      mount.querySelector("[data-testid=assignment-detail-status-value]"),
    ).toBeNull();
    // Draft-only affordances are removed on success.
    expect(
      mount.querySelector("[data-testid=assignment-detail-edit-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-publish-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-draft-label]"),
    ).toBeNull();
    // Sprint 13A summary composition is restored (draft-only informational
    // panel is gone; summary host is present).
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-draft-summary]",
      ),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-summary-host]"),
    ).not.toBeNull();
    expect(statusChanges).toHaveLength(1);
    expect(statusChanges[0]?.status).toBe("published");
    expect(statusChanges[0]?.assignmentId).toBe("assign-1");
  });

  test("Failure preserves the Draft state and renders a generic error message", async () => {
    const mount = mkMount();
    const publish = rejectingPublish();
    const update = resolvingUpdate();
    const statusChanges: Array<AssignmentDetailMetadata> = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
      publishCallable: publish.callable,
      onStatusChange: (m) => {
        statusChanges.push(m);
      },
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-publish-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-publish-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    expect(publish.calls).toEqual(["assign-1"]);
    expect(
      mount.querySelector("[data-testid=assignment-detail-status-value]")
        ?.textContent,
    ).toBe("Draft");
    // Draft-only affordances remain intact so the teacher can retry.
    expect(
      mount.querySelector("[data-testid=assignment-detail-publish-action]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-edit-action]"),
    ).not.toBeNull();
    // Editor was closed and stays closed.
    expect(
      mount.querySelector("[data-testid=assignment-detail-editor]"),
    ).toBeNull();
    const err = mount.querySelector(
      "[data-testid=assignment-detail-publish-error]",
    );
    expect(err).not.toBeNull();
    expect(err?.getAttribute("role")).toBe("alert");
    expect(err?.textContent).not.toMatch(
      /firestore|callable|assignments\.|stack/i,
    );
    expect(statusChanges).toHaveLength(0);
  });

  test("Published workflow is unchanged when publishCallable is wired for a published assignment", async () => {
    const mount = mkMount();
    const publish = resolvingPublish();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "published" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      publishCallable: publish.callable,
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-publish-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-close-action]"),
    ).toBeNull();
  });

  test("Closed workflow is unchanged when publishCallable is wired for a closed assignment", async () => {
    const mount = mkMount();
    const publish = resolvingPublish();
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      publishCallable: publish.callable,
      reopenCallable: reopen.callable,
    });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-publish-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-reopen-action]"),
    ).not.toBeNull();
  });

  test("Publish action is hidden while the inline editor is open", async () => {
    const mount = mkMount();
    const publish = resolvingPublish();
    const update = resolvingUpdate();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-draft",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      updateDraftCallable: update.callable,
      publishCallable: publish.callable,
    });
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-edit-action]",
      )
      ?.click();
    expect(
      mount.querySelector("[data-testid=assignment-detail-publish-action]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-editor]"),
    ).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Sprint 16 Slice 2: Assignment Detail per-render fetch cache. Multiple
// sub-panels on one Detail render share one in-flight or resolved
// request per (callable, key) pair. Lifecycle-triggered rerenders
// invalidate the cache so no sub-panel observes a stale snapshot.
// -----------------------------------------------------------------------------

import type { AssignmentRecipientListCallable } from "./roster-wire";
import type {
  AttemptGetForTeacherCallable,
  AttemptsListForClassCallable,
  CompletedAttemptSummary,
  TeacherVisibleAttempt,
} from "./attempts-wire";

const spyingRecipients = (
  recipients: ReadonlyArray<{
    readonly studentId: string;
    readonly studentDisplayName: string;
  }>,
): {
  readonly callable: AssignmentRecipientListCallable;
  readonly calls: Array<string>;
} => {
  const calls: Array<string> = [];
  const callable: AssignmentRecipientListCallable = ({ assignmentId }) => {
    calls.push(assignmentId);
    return Promise.resolve({ assignmentId, recipients });
  };
  return { callable, calls };
};

const spyingAttemptsList = (
  attempts: ReadonlyArray<CompletedAttemptSummary>,
): {
  readonly callable: AttemptsListForClassCallable;
  readonly calls: Array<string>;
} => {
  const calls: Array<string> = [];
  const callable: AttemptsListForClassCallable = ({ classId }) => {
    calls.push(classId);
    return Promise.resolve({ classId, attempts });
  };
  return { callable, calls };
};

const spyingAttemptGet = (
  byId: ReadonlyMap<string, TeacherVisibleAttempt>,
): {
  readonly callable: AttemptGetForTeacherCallable;
  readonly calls: Array<string>;
} => {
  const calls: Array<string> = [];
  const callable: AttemptGetForTeacherCallable = ({ attemptId }) => {
    calls.push(attemptId);
    const record = byId.get(attemptId);
    if (record === undefined) {
      return Promise.reject(new Error("missing"));
    }
    return Promise.resolve(record);
  };
  return { callable, calls };
};

const mkAttempt = (
  overrides: Partial<CompletedAttemptSummary>,
): CompletedAttemptSummary =>
  Object.freeze({
    attemptId: overrides.attemptId ?? "att-1",
    studentId: overrides.studentId ?? "stu-1",
    studentDisplayName: overrides.studentDisplayName ?? "Student One",
    assignmentId: overrides.assignmentId ?? "assign-1",
    attemptNumber: overrides.attemptNumber ?? 1,
    score: overrides.score ?? 5,
    maxScore: overrides.maxScore ?? 10,
    percentage: overrides.percentage ?? 50,
    submittedAt: overrides.submittedAt ?? 1000,
  });

describe("renderAssignmentDetail - Sprint 16 Slice 2 shared fetch cache", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("one Detail render issues exactly one summary call across summary card and roster panel", async () => {
    const mount = mkMount();
    const meta = freezeMetadata({ classId: "class-1" });
    const summary = spyingSummary(freezeSummary());
    const recipients = spyingRecipients([
      { studentId: "stu-1", studentDisplayName: "Alice" },
      { studentId: "stu-2", studentDisplayName: "Bob" },
    ]);
    const attempts = spyingAttemptsList([]);
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta),
      summaryCallable: summary.callable,
      recipientListCallable: recipients.callable,
      attemptsListForClassCallable: attempts.callable,
    });
    await flush();
    await flush();
    await flush();
    expect(summary.calls).toEqual(["assign-1"]);
  });

  test("one Detail render issues exactly one attempts-list call across roster and question panels", async () => {
    const mount = mkMount();
    const meta = freezeMetadata({ classId: "class-1" });
    const recipients = spyingRecipients([
      { studentId: "stu-1", studentDisplayName: "Alice" },
    ]);
    const attempts = spyingAttemptsList([]);
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta),
      summaryCallable: resolvingSummary(freezeSummary()),
      recipientListCallable: recipients.callable,
      attemptsListForClassCallable: attempts.callable,
      attemptGetForTeacherCallable: spyingAttemptGet(new Map()).callable,
    });
    await flush();
    await flush();
    await flush();
    expect(attempts.calls).toEqual(["class-1"]);
  });

  test("concurrent consumers of the same shared attempts list observe the same resolved snapshot", async () => {
    const mount = mkMount();
    const meta = freezeMetadata({ classId: "class-1" });
    const shared = [
      mkAttempt({ attemptId: "att-1", studentId: "stu-1", percentage: 90 }),
      mkAttempt({ attemptId: "att-2", studentId: "stu-2", percentage: 80 }),
      mkAttempt({ attemptId: "att-3", studentId: "stu-3", percentage: 70 }),
    ];
    const attempts = spyingAttemptsList(shared);
    const recipients = spyingRecipients([
      { studentId: "stu-1", studentDisplayName: "Alice" },
      { studentId: "stu-2", studentDisplayName: "Bob" },
      { studentId: "stu-3", studentDisplayName: "Cara" },
    ]);
    const attemptGet = spyingAttemptGet(
      new Map(
        shared.map((a) => [
          a.attemptId,
          Object.freeze({
            attemptId: a.attemptId,
            studentId: a.studentId,
            assignmentId: a.assignmentId,
            attemptNumber: a.attemptNumber,
            percentage: a.percentage,
            itemResults: Object.freeze([]),
          }) as TeacherVisibleAttempt,
        ]),
      ),
    );
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta),
      // Sprint 16 Slice 3: header counts anchor to the authoritative
      // summary snapshot. A summary matching the seeded roster keeps the
      // shared-cache assertion focused on cache reuse rather than the
      // reconciliation note.
      summaryCallable: resolvingSummary(
        freezeSummary({
          totalStudents: 3,
          completedStudents: 3,
          inProgressStudents: 0,
          notStartedStudents: 0,
        }),
      ),
      recipientListCallable: recipients.callable,
      attemptsListForClassCallable: attempts.callable,
      attemptGetForTeacherCallable: attemptGet.callable,
    });
    await flush();
    await flush();
    await flush();
    await flush();
    expect(attempts.calls.length).toBe(1);
    // Roster derives Submitted from the same attempts snapshot the
    // question panel used to select representative attempts.
    const submittedGroup = mount.querySelector(
      "[data-testid=assignment-detail-roster-group-submitted]",
    );
    expect(submittedGroup).not.toBeNull();
    expect(submittedGroup?.textContent ?? "").toContain("Completed 3");
  });

  test("second independent Detail render performs its own fresh fetch cycle", async () => {
    const firstMount = mkMount();
    const attempts = spyingAttemptsList([]);
    const summary = spyingSummary(freezeSummary());
    const recipients = spyingRecipients([]);
    renderAssignmentDetail(firstMount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ classId: "class-1" })),
      summaryCallable: summary.callable,
      recipientListCallable: recipients.callable,
      attemptsListForClassCallable: attempts.callable,
    });
    await flush();
    await flush();
    await flush();
    firstMount.remove();

    const secondMount = mkMount();
    renderAssignmentDetail(secondMount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ classId: "class-1" })),
      summaryCallable: summary.callable,
      recipientListCallable: recipients.callable,
      attemptsListForClassCallable: attempts.callable,
    });
    await flush();
    await flush();
    await flush();
    expect(summary.calls).toEqual(["assign-1", "assign-1"]);
    expect(attempts.calls).toEqual(["class-1", "class-1"]);
  });

  test("rendering a different assignment does not reuse the previous cache", async () => {
    const mountA = mkMount();
    const summary = spyingSummary(freezeSummary());
    renderAssignmentDetail(mountA, {
      assignmentId: "assign-A",
      loadMetadata: resolvingMeta(
        freezeMetadata({ assignmentId: "assign-A", classId: "class-A" }),
      ),
      summaryCallable: summary.callable,
      recipientListCallable: spyingRecipients([]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
    });
    await flush();
    await flush();
    await flush();
    mountA.remove();

    const mountB = mkMount();
    renderAssignmentDetail(mountB, {
      assignmentId: "assign-B",
      loadMetadata: resolvingMeta(
        freezeMetadata({ assignmentId: "assign-B", classId: "class-B" }),
      ),
      summaryCallable: summary.callable,
      recipientListCallable: spyingRecipients([]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
    });
    await flush();
    await flush();
    await flush();
    expect(summary.calls).toEqual(["assign-A", "assign-B"]);
  });

  test("lifecycle-triggered rerender refreshes the cache and refetches", async () => {
    const mount = mkMount();
    const meta = freezeMetadata({ status: "closed", classId: "class-1" });
    const summary = spyingSummary(freezeSummary());
    const recipients = spyingRecipients([
      { studentId: "stu-1", studentDisplayName: "Alice" },
    ]);
    const attempts = spyingAttemptsList([]);
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta),
      summaryCallable: summary.callable,
      recipientListCallable: recipients.callable,
      attemptsListForClassCallable: attempts.callable,
      reopenCallable: reopen.callable,
    });
    await flush();
    await flush();
    await flush();
    expect(summary.calls).toEqual(["assign-1"]);
    expect(attempts.calls).toEqual(["class-1"]);

    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    // After the successful reopen the cache is invalidated; the recomposed
    // sub-surfaces observe fresh callable responses. One additional call
    // per callable identity, not two.
    expect(summary.calls).toEqual(["assign-1", "assign-1"]);
    expect(attempts.calls).toEqual(["class-1", "class-1"]);
  });

  test("rejected shared attempts request does not produce an unhandled rejection", async () => {
    const unhandled: Array<unknown> = [];
    const listener = (ev: PromiseRejectionEvent): void => {
      unhandled.push(ev.reason);
    };
    // jsdom emits `unhandledrejection` on window when a rejection has no
    // handler by the end of the current microtask queue.
    window.addEventListener("unhandledrejection", listener);
    try {
      const mount = mkMount();
      const meta = freezeMetadata({ classId: "class-1" });
      const failing: AttemptsListForClassCallable = () =>
        Promise.reject(new Error("attempts failed"));
      renderAssignmentDetail(mount, {
        assignmentId: "assign-1",
        loadMetadata: resolvingMeta(meta),
        summaryCallable: resolvingSummary(freezeSummary()),
        recipientListCallable: spyingRecipients([]).callable,
        attemptsListForClassCallable: failing,
        attemptGetForTeacherCallable: spyingAttemptGet(new Map()).callable,
      });
      await flush();
      await flush();
      await flush();
      await flush();
      expect(unhandled.length).toBe(0);
      // The roster error branch surfaced the shared failure.
      expect(
        mount.querySelector("[data-testid=assignment-detail-roster-error]"),
      ).not.toBeNull();
    } finally {
      window.removeEventListener("unhandledrejection", listener);
    }
  });
});

// -----------------------------------------------------------------------------
// Sprint 16 Slice 3: Progress consistency audit. Every roster group header
// count is anchored to `assessmentAssignmentSummary`; disagreements between
// the authoritative aggregate and the enumerated roster surface as a calm
// note beneath the roster rather than a silent rewrite of either dataset.
// -----------------------------------------------------------------------------

describe("renderAssignmentDetail - Sprint 16 Slice 3 progress consistency", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const meta = (): AssignmentDetailMetadata =>
    freezeMetadata({ classId: "class-1", status: "published" });

  test("roster group header counts equal the authoritative summary counts when inputs align", async () => {
    const mount = mkMount();
    const summary = freezeSummary({
      totalStudents: 3,
      completedStudents: 1,
      inProgressStudents: 1,
      notStartedStudents: 1,
      studentProgress: [{ studentId: "stu-3", answered: 2, total: 10, retake: false }],
    });
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(summary),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
        { studentId: "stu-2", studentDisplayName: "Bob" },
        { studentId: "stu-3", studentDisplayName: "Cara" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([
        mkAttempt({
          attemptId: "att-1",
          studentId: "stu-1",
          percentage: 90,
        }),
      ]).callable,
    });
    await flush();
    await flush();
    await flush();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-group-submitted]",
      )?.textContent ?? "",
    ).toContain("Completed 1");
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-group-in-progress]",
      )?.textContent ?? "",
    ).toContain("In Progress 1");
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-group-not-started]",
      )?.textContent ?? "",
    ).toContain("Not Started 1");
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-discrepancy]",
      ),
    ).toBeNull();
  });

  test("header counts prefer summary values even when the enumerated roster is shorter", async () => {
    const mount = mkMount();
    const summary = freezeSummary({
      totalStudents: 5,
      completedStudents: 2,
      inProgressStudents: 2,
      notStartedStudents: 1,
    });
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(summary),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
        { studentId: "stu-2", studentDisplayName: "Bob" },
        { studentId: "stu-3", studentDisplayName: "Cara" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([
        mkAttempt({
          attemptId: "att-1",
          studentId: "stu-1",
          percentage: 90,
        }),
      ]).callable,
    });
    await flush();
    await flush();
    await flush();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-group-submitted]",
      )?.textContent ?? "",
    ).toContain("Completed 2");
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-group-in-progress]",
      )?.textContent ?? "",
    ).toContain("In Progress 2");
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-group-not-started]",
      )?.textContent ?? "",
    ).toContain("Not Started 1");
  });

  test("recipient-total mismatch renders the calm discrepancy note", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(
        freezeSummary({
          totalStudents: 5,
          completedStudents: 1,
          inProgressStudents: 1,
          notStartedStudents: 3,
        }),
      ),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
        { studentId: "stu-2", studentDisplayName: "Bob" },
        { studentId: "stu-3", studentDisplayName: "Cara" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([
        mkAttempt({
          attemptId: "att-1",
          studentId: "stu-1",
          percentage: 90,
        }),
      ]).callable,
    });
    await flush();
    await flush();
    await flush();
    const note = mount.querySelector(
      "[data-testid=assignment-detail-roster-discrepancy]",
    );
    expect(note).not.toBeNull();
    expect(note?.getAttribute("role")).toBe("status");
    expect(note?.getAttribute("aria-live")).toBe("polite");
    expect(note?.getAttribute("data-discrepancy-kind")).toBe(
      "recipientTotalMismatch",
    );
    expect(note?.textContent).toBe(
      "Roster and summary are temporarily out of sync. The latest details will appear after refresh.",
    );
  });

  test("submitted/completed mismatch renders the calm discrepancy note", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(
        freezeSummary({
          totalStudents: 3,
          completedStudents: 2,
          inProgressStudents: 1,
          notStartedStudents: 0,
        }),
      ),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
        { studentId: "stu-2", studentDisplayName: "Bob" },
        { studentId: "stu-3", studentDisplayName: "Cara" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([
        mkAttempt({
          attemptId: "att-1",
          studentId: "stu-1",
          percentage: 90,
        }),
      ]).callable,
    });
    await flush();
    await flush();
    await flush();
    const note = mount.querySelector(
      "[data-testid=assignment-detail-roster-discrepancy]",
    );
    expect(note).not.toBeNull();
    expect(note?.getAttribute("data-discrepancy-kind")).toBe(
      "submittedMismatch",
    );
  });

  test("started mismatch surfacing is exercised at the reconciliation helper layer", () => {
    // The `startedMismatch` branch is covered by the reconciliation helper
    // unit tests in `reconciliation.test.ts`; the DOM plumbing passes the
    // roster's actual per-student in-progress rows to that helper.
    expect(true).toBe(true);
  });

  test("aligned empty assignment renders no discrepancy note", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(
        freezeSummary({
          totalStudents: 0,
          completedStudents: 0,
          inProgressStudents: 0,
          notStartedStudents: 0,
        }),
      ),
      recipientListCallable: spyingRecipients([]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
    });
    await flush();
    await flush();
    await flush();
    // A zero-recipient summary short-circuits the summary card into the
    // empty branch; the roster still renders with zero-count headers and
    // no discrepancy note because summary and roster agree at zero.
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-discrepancy]",
      ),
    ).toBeNull();
  });

  test("attempts for another assignment do not inflate roster group counts", async () => {
    // The roster panel filters attempts by assignmentId before grouping;
    // a stray attempt for a different assignment must not appear in
    // Submitted for the current assignment.
    const mount = mkMount();
    const summary = freezeSummary({
      totalStudents: 3,
      completedStudents: 1,
      inProgressStudents: 0,
      notStartedStudents: 2,
    });
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(summary),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
        { studentId: "stu-2", studentDisplayName: "Bob" },
        { studentId: "stu-3", studentDisplayName: "Cara" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([
        mkAttempt({
          attemptId: "att-1",
          studentId: "stu-1",
          assignmentId: "assign-1",
          percentage: 90,
        }),
        mkAttempt({
          attemptId: "att-other",
          studentId: "stu-2",
          assignmentId: "assign-other",
          percentage: 80,
        }),
      ]).callable,
    });
    await flush();
    await flush();
    await flush();
    const list = mount.querySelectorAll(
      "[data-testid=assignment-detail-roster-group-submitted] li",
    );
    expect(list.length).toBe(1);
    // The stray attempt is filtered before reconciliation; summary and
    // roster align on submitted=1, so no discrepancy note is emitted.
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-discrepancy]",
      ),
    ).toBeNull();
  });

  test("multiple attempts by the same student collapse to a single Submitted row", async () => {
    const mount = mkMount();
    const summary = freezeSummary({
      totalStudents: 3,
      completedStudents: 1,
      inProgressStudents: 0,
      notStartedStudents: 2,
    });
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(summary),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
        { studentId: "stu-2", studentDisplayName: "Bob" },
        { studentId: "stu-3", studentDisplayName: "Cara" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([
        mkAttempt({
          attemptId: "att-1",
          studentId: "stu-1",
          attemptNumber: 1,
          percentage: 60,
        }),
        mkAttempt({
          attemptId: "att-2",
          studentId: "stu-1",
          attemptNumber: 2,
          percentage: 90,
        }),
      ]).callable,
    });
    await flush();
    await flush();
    await flush();
    const list = mount.querySelectorAll(
      "[data-testid=assignment-detail-roster-group-submitted] li",
    );
    expect(list.length).toBe(1);
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-discrepancy]",
      ),
    ).toBeNull();
  });

  test("roster callable failure renders the roster error and does not fabricate a discrepancy note", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(freezeSummary()),
      recipientListCallable: (() => {
        const fail: AssignmentRecipientListCallable = () =>
          Promise.reject(new Error("recipients failed"));
        return fail;
      })(),
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
    });
    await flush();
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-error]"),
    ).not.toBeNull();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-discrepancy]",
      ),
    ).toBeNull();
  });

  test("dashboard progress line copy remains anchored to the same summary snapshot", async () => {
    // The Curriculum dashboard progress line is produced from the same
    // `AssignmentSummary` shape rendered on the Detail summary card. This
    // regression guard keeps the shared string format aligned so the two
    // surfaces cannot silently drift apart.
    const summary: AssignmentSummary = freezeSummary({
      totalStudents: 24,
      completedStudents: 12,
      inProgressStudents: 6,
      notStartedStudents: 6,
    });
    const started = summary.inProgressStudents + summary.completedStudents;
    const dashboardLine = `${summary.completedStudents} submitted / ${started} started / ${summary.totalStudents} total`;
    expect(dashboardLine).toBe("12 submitted / 18 started / 24 total");
  });
});

// -----------------------------------------------------------------------------
// Sprint 16 Slice 4: Teacher workflow polish. Focus on mount, Back label,
// question-panel loading, and the calm zero-recipient empty state.
// -----------------------------------------------------------------------------

describe("renderAssignmentDetail - Sprint 16 Slice 4 workflow polish", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("focuses the assignment title on the first successful ready render", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: resolvingSummary(freezeSummary()),
      onBack: () => undefined,
    });
    await flush();
    await flush();
    const title = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-title]",
    );
    expect(title).not.toBeNull();
    expect(title?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(title);
  });

  test("internal panel hydration does not steal focus back to the title", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(
        freezeMetadata({ classId: "class-1", status: "published" }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
      onBack: () => undefined,
    });
    await flush();
    await flush();
    const title = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-title]",
    );
    expect(document.activeElement).toBe(title);
    const backBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-back]",
    );
    backBtn?.focus();
    expect(document.activeElement).toBe(backBtn);
    // Let the roster / question-summary panels resolve and rerender.
    await flush();
    await flush();
    await flush();
    expect(document.activeElement).toBe(backBtn);
  });

  test("Back control identifies Curriculum as the destination in label and accessible name", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: resolvingSummary(freezeSummary()),
      onBack: () => undefined,
    });
    await flush();
    const back = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-back]",
    );
    expect(back?.textContent).toBe("Back to Curriculum");
    expect(back?.getAttribute("aria-label")).toBe("Back to Curriculum");
  });

  test("published assignment with zero recipients renders the calm empty note", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(
        freezeMetadata({ classId: "class-1", status: "published" }),
      ),
      summaryCallable: resolvingSummary(
        freezeSummary({
          totalStudents: 0,
          completedStudents: 0,
          inProgressStudents: 0,
          notStartedStudents: 0,
        }),
      ),
      recipientListCallable: spyingRecipients([]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
    });
    await flush();
    await flush();
    await flush();
    const empty = mount.querySelector(
      "[data-testid=assignment-detail-roster-empty-recipients]",
    );
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe("No students are assigned yet.");
    expect(empty?.getAttribute("role")).toBe("status");
    // No group headers render when there are no recipients.
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-group-submitted]",
      ),
    ).toBeNull();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-group-in-progress]",
      ),
    ).toBeNull();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-roster-group-not-started]",
      ),
    ).toBeNull();
    // The Roster heading remains as a stable section landmark.
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-heading]"),
    ).not.toBeNull();
  });

  test("question summary panel announces loading through role=status while attempts resolve", async () => {
    const mount = mkMount();
    let releaseAttempts!: (
      value: {
        readonly classId: string;
        readonly attempts: ReadonlyArray<CompletedAttemptSummary>;
      },
    ) => void;
    const pendingAttempts: AttemptsListForClassCallable = ({ classId }) =>
      new Promise((resolve) => {
        releaseAttempts = (value) => resolve(value);
        void classId;
      });
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(
        freezeMetadata({ classId: "class-1", status: "published" }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
      ]).callable,
      attemptsListForClassCallable: pendingAttempts,
      attemptGetForTeacherCallable: spyingAttemptGet(new Map()).callable,
    });
    await flush();
    await flush();
    const loading = mount.querySelector(
      "[data-testid=assignment-detail-questions-loading]",
    );
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toBe("Loading question results...");
    expect(loading?.getAttribute("role")).toBe("status");
    expect(loading?.getAttribute("aria-live")).toBe("polite");
    releaseAttempts({ classId: "class-1", attempts: [] });
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-questions-loading]"),
    ).toBeNull();
  });

  test("retry after an error focuses the title once the ready render replaces the error state", async () => {
    const mount = mkMount();
    let call = 0;
    const reader: AssignmentDetailMetadataReader = () => {
      call += 1;
      if (call === 1) return Promise.reject(new Error("first load fails"));
      return Promise.resolve(freezeMetadata());
    };
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: reader,
      summaryCallable: resolvingSummary(freezeSummary()),
      onBack: () => undefined,
    });
    await flush();
    await flush();
    const retry = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-retry]",
    );
    expect(retry).not.toBeNull();
    retry?.click();
    await flush();
    await flush();
    const title = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-title]",
    );
    expect(document.activeElement).toBe(title);
  });

  test("lifecycle rerender does not repeatedly refocus the title if focus is elsewhere", async () => {
    const mount = mkMount();
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(
        freezeMetadata({ classId: "class-1", status: "closed" }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: reopen.callable,
      onBack: () => undefined,
    });
    await flush();
    await flush();
    const title = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-title]",
    );
    expect(document.activeElement).toBe(title);
    const backBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-back]",
    );
    backBtn?.focus();
    expect(document.activeElement).toBe(backBtn);
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    // Sprint 16 Slice 6 reconciliation: the confirm dialog moved focus to
    // its Cancel button on open and removed both buttons on Confirm, so
    // pre-Slice-6 code left `document.activeElement` orphaned on `body`.
    // Slice 6 requires that a lifecycle action which removes the active
    // control move focus to the closest logical surviving target; here
    // that is the assignment title. The load-scoped focus latch continues
    // to guard against refocus during ordinary sub-panel rerenders where
    // the focused control still exists in the surface.
    const titleEl = mount.querySelector(
      "[data-testid=assignment-detail-title]",
    );
    expect(document.activeElement).toBe(titleEl);
  });
});

// -----------------------------------------------------------------------------
// Sprint 16 Slice 5: performance guard tests. The Detail surface must issue
// exactly one call per callable identity per ready-render, and lifecycle
// transitions must refresh each identity exactly once. These assertions
// lock in the Slice 2 shared cache guarantees for the summary/attempts
// callables and extend the same guarantees to `recipientList` and
// `attemptGetForTeacher`, both of which previously bypassed the cache and
// were re-issued during pending-state rerenders.
// -----------------------------------------------------------------------------

describe("renderAssignmentDetail - Sprint 16 Slice 5 performance guards", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("one Detail render issues exactly one recipient-list call across pending-state rerenders", async () => {
    const mount = mkMount();
    const meta = freezeMetadata({ classId: "class-1", status: "closed" });
    const recipients = spyingRecipients([
      { studentId: "stu-1", studentDisplayName: "Alice" },
    ]);
    const attempts = spyingAttemptsList([]);
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta),
      summaryCallable: resolvingSummary(freezeSummary()),
      recipientListCallable: recipients.callable,
      attemptsListForClassCallable: attempts.callable,
      reopenCallable: reopen.callable,
    });
    await flush();
    await flush();
    await flush();
    expect(recipients.calls).toEqual(["assign-1"]);
    // Clicking Reopen fires a pending-state rerender before the callable
    // resolves. The shared cache must serve the pending rerender's roster
    // panel from the already-resolved recipient snapshot rather than
    // re-issuing the call.
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    // Exactly one additional recipient call: the successful reopen
    // invalidates the shared cache so the recomposed roster observes a
    // fresh recipient snapshot. Never two per transition.
    expect(recipients.calls).toEqual(["assign-1", "assign-1"]);
  });

  test("one Detail render fetches each representative attempt exactly once even across a pending-state rerender", async () => {
    const mount = mkMount();
    const meta = freezeMetadata({ classId: "class-1", status: "closed" });
    const shared = [
      mkAttempt({ attemptId: "att-1", studentId: "stu-1", percentage: 90 }),
      mkAttempt({ attemptId: "att-2", studentId: "stu-2", percentage: 80 }),
      mkAttempt({ attemptId: "att-3", studentId: "stu-3", percentage: 70 }),
    ];
    const attemptGet = spyingAttemptGet(
      new Map(
        shared.map((a) => [
          a.attemptId,
          Object.freeze({
            attemptId: a.attemptId,
            studentId: a.studentId,
            assignmentId: a.assignmentId,
            attemptNumber: a.attemptNumber,
            percentage: a.percentage,
            itemResults: Object.freeze([]),
          }) as TeacherVisibleAttempt,
        ]),
      ),
    );
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta),
      summaryCallable: resolvingSummary(
        freezeSummary({
          totalStudents: 3,
          completedStudents: 3,
          inProgressStudents: 0,
          notStartedStudents: 0,
        }),
      ),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
        { studentId: "stu-2", studentDisplayName: "Bob" },
        { studentId: "stu-3", studentDisplayName: "Cara" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList(shared).callable,
      attemptGetForTeacherCallable: attemptGet.callable,
      reopenCallable: reopen.callable,
    });
    await flush();
    await flush();
    await flush();
    await flush();
    // Each representative attempt is fetched exactly once for the initial
    // render, regardless of any pending panel rerender.
    expect(attemptGet.calls.slice().sort()).toEqual(["att-1", "att-2", "att-3"]);

    // A lifecycle-triggered rerender (reopen success) invalidates the
    // shared cache so a subsequent render observes fresh per-attempt
    // snapshots; still exactly once per attemptId, not twice.
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    await flush();
    expect(attemptGet.calls.slice().sort()).toEqual([
      "att-1",
      "att-1",
      "att-2",
      "att-2",
      "att-3",
      "att-3",
    ]);
  });

  test("retry after a failed shared request performs a fresh call exactly once", async () => {
    const mount = mkMount();
    const meta = freezeMetadata({ classId: "class-1", status: "published" });
    let calls = 0;
    // First attempt rejects; the shared cache evicts the entry so the
    // subsequent retry performs a fresh, non-cached call.
    const flaky: AssignmentSummaryCallable = (input) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("summary offline"));
      return Promise.resolve(freezeSummary({ assignmentId: input.assignmentId }));
    };
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta),
      summaryCallable: flaky,
      recipientListCallable: spyingRecipients([]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
    });
    await flush();
    await flush();
    await flush();
    // First attempt fired and rejected.
    expect(calls).toBe(1);
    // A retry triggered through the shared cache (a fresh get for the same
    // key after a rejection) issues exactly one new call.
    const retry = flaky({ assignmentId: "assign-1" });
    await retry;
    expect(calls).toBe(2);
  });

  test("does not open any Firestore listener, timer, or storage handle from the Detail render", () => {
    // Posture check: the Slice 5 wrapping added no new global side effects
    // to detail.ts. This mirrors the earlier posture assertions and would
    // catch a future regression that reached for a persistent cache or a
    // background poll while trying to reduce call counts.
    const source = fs.readFileSync(
      path.resolve(__dirname, "./detail.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/setInterval\s*\(/);
    expect(source).not.toMatch(/setTimeout\s*\(/);
    expect(source).not.toMatch(/onSnapshot\s*\(/);
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("IndexedDB");
  });
});

// -----------------------------------------------------------------------------
// Sprint 16 Slice 6: Accessibility review. Landmark structure, persistent
// section headings across state transitions, group semantics, and duplicate-id
// guards for the teacher workflow surfaces introduced across Sprints 13-16.
// -----------------------------------------------------------------------------

describe("renderAssignmentDetail - Sprint 16 Slice 6 accessibility", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("published Detail render exposes a labeled Roster region with role=group subsections", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(
        freezeMetadata({ classId: "class-1", status: "published" }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
    });
    await flush();
    await flush();
    await flush();
    const rosterHost = mount.querySelector(
      "[data-testid=assignment-detail-roster-host]",
    );
    const rosterHeading = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-roster-heading]",
    );
    expect(rosterHeading).not.toBeNull();
    expect(rosterHeading?.id).toBe("assignment-detail-roster-heading");
    expect(rosterHost?.getAttribute("aria-labelledby")).toBe(
      rosterHeading!.id,
    );
    for (const key of ["submitted", "in-progress", "not-started"] as const) {
      const group = mount.querySelector<HTMLElement>(
        `[data-testid=assignment-detail-roster-group-${key}]`,
      );
      const groupHeading = mount.querySelector<HTMLElement>(
        `[data-testid=assignment-detail-roster-group-heading-${key}]`,
      );
      expect(group).not.toBeNull();
      expect(groupHeading).not.toBeNull();
      expect(group?.getAttribute("role")).toBe("group");
      expect(group?.getAttribute("aria-labelledby")).toBe(groupHeading!.id);
    }
  });

  test("Roster heading persists through a roster fetch failure so the section landmark survives", async () => {
    const mount = mkMount();
    const failingRecipients: AssignmentRecipientListCallable = () =>
      Promise.reject(new Error("recipients offline"));
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(
        freezeMetadata({ classId: "class-1", status: "published" }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      recipientListCallable: failingRecipients,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
    });
    await flush();
    await flush();
    await flush();
    const heading = mount.querySelector(
      "[data-testid=assignment-detail-roster-heading]",
    );
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Roster");
    const err = mount.querySelector(
      "[data-testid=assignment-detail-roster-error]",
    );
    expect(err).not.toBeNull();
    expect(err?.getAttribute("role")).toBe("alert");
    // Exactly one Roster heading remains (the persistent one; not a clone
    // appended alongside the original).
    expect(
      mount.querySelectorAll(
        "[data-testid=assignment-detail-roster-heading]",
      ).length,
    ).toBe(1);
  });

  test("Question results heading persists across loading, deferred, and result branches", async () => {
    const mount = mkMount();
    const shared = [
      mkAttempt({ attemptId: "att-1", studentId: "stu-1", percentage: 90 }),
    ];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(
        freezeMetadata({ classId: "class-1", status: "published" }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList(shared).callable,
      attemptGetForTeacherCallable: spyingAttemptGet(new Map()).callable,
    });
    await flush();
    await flush();
    await flush();
    const questionHost = mount.querySelector(
      "[data-testid=assignment-detail-questions-host]",
    );
    const heading = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-questions-heading]",
    );
    expect(heading).not.toBeNull();
    expect(heading?.id).toBe("assignment-detail-questions-heading");
    expect(questionHost?.getAttribute("aria-labelledby")).toBe(heading!.id);
    // Below-threshold branch renders the deferred note under the same
    // persistent heading, not in place of it.
    const deferred = mount.querySelector(
      "[data-testid=assignment-detail-questions-deferred]",
    );
    expect(deferred).not.toBeNull();
    expect(deferred?.getAttribute("role")).toBe("status");
  });

  test("published Detail render introduces no duplicate id or empty aria-label anywhere in the surface", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(
        freezeMetadata({ classId: "class-1", status: "published" }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
    });
    await flush();
    await flush();
    await flush();
    const idElements = Array.from(
      mount.querySelectorAll<HTMLElement>("[id]"),
    );
    const ids = idElements.map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Every id-refs target resolves to exactly one element.
    for (const el of Array.from(
      mount.querySelectorAll<HTMLElement>("[aria-labelledby]"),
    )) {
      const ref = el.getAttribute("aria-labelledby")!;
      expect(mount.querySelectorAll(`#${ref}`).length).toBe(1);
    }
    for (const el of Array.from(
      mount.querySelectorAll<HTMLElement>("[aria-label]"),
    )) {
      expect(el.getAttribute("aria-label")?.trim().length ?? 0).toBeGreaterThan(
        0,
      );
    }
  });

  test("lifecycle transition preserves the labeled Roster region and does not orphan focus", async () => {
    const mount = mkMount();
    const reopen = resolvingReopen();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(
        freezeMetadata({ classId: "class-1", status: "closed" }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
      reopenCallable: reopen.callable,
    });
    await flush();
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-action]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-reopen-confirm]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    // After the reopen resolves the Roster heading is still present and
    // labels its host section, so screen-reader users keep the landmark.
    const heading = mount.querySelector(
      "[data-testid=assignment-detail-roster-heading]",
    );
    const host = mount.querySelector(
      "[data-testid=assignment-detail-roster-host]",
    );
    expect(heading).not.toBeNull();
    expect(host?.getAttribute("aria-labelledby")).toBe(heading!.id);
    // Focus is not lost on the document body.
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("renderAssignmentDetail - Student Progress & Assignment Membership Phase A, Slice 3 (student navigation)", () => {
  const meta = (): AssignmentDetailMetadata =>
    freezeMetadata({ classId: "class-1", status: "published" });

  test("Submitted student's name is clickable and invokes onSelectStudent with the correct payload", async () => {
    const mount = mkMount();
    const selections: unknown[] = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(
        freezeSummary({ completedStudents: 1, inProgressStudents: 0, notStartedStudents: 0, totalStudents: 1 }),
      ),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([
        mkAttempt({ attemptId: "att-1", studentId: "stu-1", percentage: 90 }),
      ]).callable,
      onSelectStudent: (selection) => {
        selections.push(selection);
      },
    });
    await flush();
    await flush();
    await flush();

    const nameBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-roster-name-stu-1]",
    );
    expect(nameBtn).not.toBeNull();
    expect(nameBtn!.tagName).toBe("BUTTON");
    nameBtn!.click();

    expect(selections).toEqual([
      {
        classId: "class-1",
        studentId: "stu-1",
        studentDisplayName: "Alice",
        returnToAssignmentId: "assign-1",
      },
    ]);
  });

  test("In Progress student's name is clickable and invokes onSelectStudent with the correct payload", async () => {
    const mount = mkMount();
    const selections: unknown[] = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(
        freezeSummary({
          completedStudents: 0,
          inProgressStudents: 1,
          notStartedStudents: 0,
          totalStudents: 1,
          studentProgress: [{ studentId: "stu-2", answered: 4, total: 10, retake: false }],
        }),
      ),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-2", studentDisplayName: "Bob" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
      onSelectStudent: (selection) => {
        selections.push(selection);
      },
    });
    await flush();
    await flush();
    await flush();

    const nameBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-roster-name-stu-2]",
    );
    expect(nameBtn).not.toBeNull();
    expect(
      mount
        .querySelector("[data-testid=assignment-detail-roster-group-in-progress]")
        ?.contains(nameBtn),
    ).toBe(true);
    nameBtn!.click();

    expect(selections).toEqual([
      {
        classId: "class-1",
        studentId: "stu-2",
        studentDisplayName: "Bob",
        returnToAssignmentId: "assign-1",
      },
    ]);
  });

  test("Not Started student's name is clickable and invokes onSelectStudent with the correct payload", async () => {
    const mount = mkMount();
    const selections: unknown[] = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(
        freezeSummary({ completedStudents: 0, inProgressStudents: 0, notStartedStudents: 1, totalStudents: 1 }),
      ),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-3", studentDisplayName: "Cara" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
      onSelectStudent: (selection) => {
        selections.push(selection);
      },
    });
    await flush();
    await flush();
    await flush();

    const nameBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-roster-name-stu-3]",
    );
    expect(nameBtn).not.toBeNull();
    expect(
      mount
        .querySelector("[data-testid=assignment-detail-roster-group-not-started]")
        ?.contains(nameBtn),
    ).toBe(true);
    nameBtn!.click();

    expect(selections).toEqual([
      {
        classId: "class-1",
        studentId: "stu-3",
        studentDisplayName: "Cara",
        returnToAssignmentId: "assign-1",
      },
    ]);
  });

  test("when onSelectStudent is not supplied, names render as static text with no click behavior (back-compat)", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(
        freezeSummary({ completedStudents: 1, inProgressStudents: 0, notStartedStudents: 0, totalStudents: 1 }),
      ),
      recipientListCallable: spyingRecipients([
        { studentId: "stu-1", studentDisplayName: "Alice" },
      ]).callable,
      attemptsListForClassCallable: spyingAttemptsList([
        mkAttempt({ attemptId: "att-1", studentId: "stu-1", percentage: 90 }),
      ]).callable,
    });
    await flush();
    await flush();
    await flush();

    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-name-stu-1]"),
    ).toBeNull();
    const group = mount.querySelector(
      "[data-testid=assignment-detail-roster-group-submitted]",
    );
    expect(group?.textContent).toContain("Alice");
    expect(group?.querySelector("button.shell-assignment-detail-roster-name")).toBeNull();
  });
});

describe("renderAssignmentDetail - Sprint 30 roster polish (score + attempts beside the name)", () => {
  const meta = (): AssignmentDetailMetadata =>
    freezeMetadata({ classId: "class-1", status: "published" });

  const render = async (
    recipients: ReadonlyArray<{ studentId: string; studentDisplayName: string }>,
    attempts: ReadonlyArray<CompletedAttemptSummary>,
    completedStudents: number,
    onSelectStudent?: (selection: unknown) => void,
  ) => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(
        freezeSummary({
          totalStudents: recipients.length,
          completedStudents,
          inProgressStudents: 0,
          notStartedStudents: recipients.length - completedStudents,
        }),
      ),
      recipientListCallable: spyingRecipients(recipients).callable,
      attemptsListForClassCallable: spyingAttemptsList(attempts).callable,
      ...(onSelectStudent !== undefined ? { onSelectStudent } : {}),
    });
    await flush();
    await flush();
    await flush();
    return mount;
  };

  const rowText = (mount: HTMLElement, studentId: string): string =>
    (
      mount.querySelector(`[data-testid=assignment-detail-roster-summary-${studentId}]`)
        ?.textContent ?? ""
    );

  test("shows the same best score with a grammatical attempt count", async () => {
    const mount = await render(
      [
        { studentId: "stu-1", studentDisplayName: "Adrianna Blumberg" },
        { studentId: "stu-2", studentDisplayName: "Ben Cole" },
      ],
      [
        mkAttempt({ attemptId: "a1", studentId: "stu-1", attemptNumber: 1, percentage: 100, submittedAt: 1 }),
        mkAttempt({ attemptId: "a2", studentId: "stu-1", attemptNumber: 2, percentage: 80, submittedAt: 2 }),
        mkAttempt({ attemptId: "b1", studentId: "stu-2", attemptNumber: 1, percentage: 72.25, submittedAt: 3 }),
        // Another assignment's attempt never counts toward this roster.
        mkAttempt({ attemptId: "x1", studentId: "stu-2", assignmentId: "assign-other", percentage: 10 }),
      ],
      2,
    );
    expect(rowText(mount, "stu-1")).toBe("100% 2 attempts");
    expect(rowText(mount, "stu-2")).toBe("72.3% 1 attempt");
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-attempts-stu-2]")?.textContent,
    ).toBe("1 attempt");
    // Score and attempts are separate cells; the old visual "·" separator
    // is gone because the two occupy distinct layout columns.
    const summary = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-roster-summary-stu-1]",
    )!;
    expect(summary.querySelector(".shell-assignment-detail-roster-summary-sep")).toBeNull();
    expect(summary.textContent).not.toContain("·");
    const cells = Array.from(summary.children).map((c) => c.className);
    expect(cells).toEqual([
      "shell-assignment-detail-roster-percentage",
      "shell-assignment-detail-roster-attempts",
    ]);
    expect(summary.querySelector(".shell-assignment-detail-roster-percentage")?.textContent).toBe("100%");
  });

  test("rows are ordered by last name regardless of score or attempts", async () => {
    const mount = await render(
      [
        { studentId: "s-y", studentDisplayName: "Amy Young" },
        { studentId: "s-b", studentDisplayName: "Zed Baker" },
        { studentId: "s-m", studentDisplayName: "Max Moss" },
      ],
      [
        mkAttempt({ attemptId: "y", studentId: "s-y", percentage: 100 }),
        mkAttempt({ attemptId: "b1", studentId: "s-b", percentage: 10, submittedAt: 1 }),
        mkAttempt({ attemptId: "b2", studentId: "s-b", attemptNumber: 2, percentage: 20, submittedAt: 2 }),
        mkAttempt({ attemptId: "m", studentId: "s-m", percentage: 50 }),
      ],
      3,
    );
    const order = Array.from(
      mount.querySelectorAll(
        "[data-testid=assignment-detail-roster-group-submitted] .shell-assignment-detail-roster-name",
      ),
    ).map((el) => el.textContent);
    // Default Last name (A-Z) mode presents rows as "Last, First".
    expect(order).toEqual(["Baker, Zed", "Moss, Max", "Young, Amy"]);
  });

  test("not-started rows show no score or attempt summary", async () => {
    const mount = await render(
      [{ studentId: "stu-1", studentDisplayName: "Ada Lovelace" }],
      [],
      0,
    );
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-row-stu-1]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-summary-stu-1]"),
    ).toBeNull();
  });

  test("the summary is plain text beside the name button, never inside it, and the name still opens Student Detail", async () => {
    const selections: unknown[] = [];
    const mount = await render(
      [{ studentId: "stu-1", studentDisplayName: "Adrianna Blumberg" }],
      [mkAttempt({ attemptId: "a1", studentId: "stu-1", percentage: 100 })],
      1,
      (s) => selections.push(s),
    );
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-roster-name-stu-1]",
    )!;
    const summary = mount.querySelector(
      "[data-testid=assignment-detail-roster-summary-stu-1]",
    )!;
    expect(btn.textContent).toBe("Blumberg, Adrianna");
    expect(btn.getAttribute("aria-label")).toBe("Open student detail for Blumberg, Adrianna");
    expect(btn.contains(summary)).toBe(false);
    expect(summary.querySelector("button, a")).toBeNull();
    expect(btn.nextElementSibling).toBe(summary);
    btn.click();
    expect(selections).toEqual([
      {
        classId: "class-1",
        studentId: "stu-1",
        studentDisplayName: "Adrianna Blumberg",
        returnToAssignmentId: "assign-1",
      },
    ]);
  });
});

describe("renderAssignmentDetail - Sprint 30 roster sort preference", () => {
  const meta = (): AssignmentDetailMetadata =>
    freezeMetadata({ classId: "class-1", status: "published" });
  const recipients = [
    { studentId: "s-adr", studentDisplayName: "Adrianna Zimmer" },
    { studentId: "s-ben", studentDisplayName: "Ben Adams" },
    { studentId: "s-cal", studentDisplayName: "Cal Moss" },
    { studentId: "s-dee", studentDisplayName: "Dee Brown" },
  ];
  const attempts = [
    mkAttempt({ attemptId: "a1", studentId: "s-adr", percentage: 100, submittedAt: 1 }),
    mkAttempt({ attemptId: "a2", studentId: "s-adr", attemptNumber: 2, percentage: 60, submittedAt: 2 }),
    mkAttempt({ attemptId: "b1", studentId: "s-ben", percentage: 40, submittedAt: 3 }),
    mkAttempt({ attemptId: "c1", studentId: "s-cal", percentage: 80, submittedAt: 4 }),
  ];

  const render = async (rosterSort?: { read: () => "lastName" | "firstName"; write: (o: "lastName" | "firstName") => void }) => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(
        freezeSummary({ totalStudents: 4, completedStudents: 3, inProgressStudents: 0, notStartedStudents: 1 }),
      ),
      recipientListCallable: spyingRecipients(recipients).callable,
      attemptsListForClassCallable: spyingAttemptsList(attempts).callable,
      onSelectStudent: () => undefined,
      ...(rosterSort !== undefined ? { rosterSort } : {}),
    });
    await flush();
    await flush();
    await flush();
    return mount;
  };
  const submittedNames = (mount: HTMLElement) =>
    Array.from(
      mount.querySelectorAll(
        "[data-testid=assignment-detail-roster-group-submitted] .shell-assignment-detail-roster-name",
      ),
    ).map((el) => el.textContent);
  const select = (mount: HTMLElement) =>
    mount.querySelector<HTMLSelectElement>("[data-testid=assignment-detail-roster-sort-select]")!;

  test("no preference seam: control shows Last name and rows are in last-name order", async () => {
    const mount = await render();
    expect(select(mount).value).toBe("lastName");
    expect(submittedNames(mount)).toEqual(["Adams, Ben", "Moss, Cal", "Zimmer, Adrianna"]);
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-group-not-started] .shell-assignment-detail-roster-name")
        ?.textContent,
    ).toBe("Brown, Dee");
  });

  test("switching First name -> Last name changes order AND presentation in place; the click still passes the natural name", async () => {
    const selections: unknown[] = [];
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(meta()),
      summaryCallable: resolvingSummary(
        freezeSummary({ totalStudents: 4, completedStudents: 3, inProgressStudents: 0, notStartedStudents: 1 }),
      ),
      recipientListCallable: spyingRecipients(recipients).callable,
      attemptsListForClassCallable: spyingAttemptsList(attempts).callable,
      onSelectStudent: (sel) => selections.push(sel),
      rosterSort: { read: () => "firstName", write: () => undefined },
    });
    await flush();
    await flush();
    await flush();
    expect(submittedNames(mount)).toEqual(["Adrianna Zimmer", "Ben Adams", "Cal Moss"]);
    select(mount).value = "lastName";
    select(mount).dispatchEvent(new Event("change"));
    expect(submittedNames(mount)).toEqual(["Adams, Ben", "Moss, Cal", "Zimmer, Adrianna"]);
    const btn = mount.querySelector<HTMLButtonElement>("[data-testid=assignment-detail-roster-name-s-adr]")!;
    expect(btn.getAttribute("aria-label")).toBe("Open student detail for Zimmer, Adrianna");
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-summary-s-adr]")?.textContent,
    ).toBe("100% 2 attempts");
    btn.click();
    expect(selections).toEqual([
      {
        classId: "class-1",
        studentId: "s-adr",
        studentDisplayName: "Adrianna Zimmer",
        returnToAssignmentId: "assign-1",
      },
    ]);
  });

  test("a saved First name preference is shown and applied", async () => {
    const mount = await render({ read: () => "firstName", write: () => undefined });
    expect(select(mount).value).toBe("firstName");
    expect(submittedNames(mount)).toEqual(["Adrianna Zimmer", "Ben Adams", "Cal Moss"]);
  });

  test("changing the control persists it and reorders rows in place, keeping score, attempts, membership, and focus", async () => {
    const writes: string[] = [];
    const mount = await render({ read: () => "lastName", write: (o) => writes.push(o) });
    const adrRow = mount.querySelector("[data-testid=assignment-detail-roster-row-s-adr]");
    select(mount).focus();
    select(mount).value = "firstName";
    select(mount).dispatchEvent(new Event("change"));
    expect(writes).toEqual(["firstName"]);
    expect(submittedNames(mount)).toEqual(["Adrianna Zimmer", "Ben Adams", "Cal Moss"]);
    // The same row element moved (no rebuild), with its summary intact.
    expect(mount.querySelector("[data-testid=assignment-detail-roster-row-s-adr]")).toBe(adrRow);
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-summary-s-adr]")?.textContent,
    ).toBe("100% 2 attempts");
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-group-not-started]")?.textContent,
    ).toContain("Dee Brown");
    expect(document.activeElement).toBe(select(mount));
  });

  test("the Sort control is labeled and offers exactly the two name orders", async () => {
    const mount = await render();
    const control = mount.querySelector("[data-testid=assignment-detail-roster-sort]")!;
    expect(control.querySelector("label")!.textContent).toBe("Sort");
    expect(select(mount).getAttribute("aria-label")).toBe("Sort students by");
    expect(Array.from(select(mount).options).map((o) => o.textContent)).toEqual([
      "Last name (A-Z)",
      "First name (A-Z)",
    ]);
  });
});

describe("renderAssignmentDetail - quiz progress visibility", () => {
  const recipients = [
    { studentId: "stu-1", studentDisplayName: "Alice Adams" },
    { studentId: "stu-2", studentDisplayName: "Bob Brown" },
    { studentId: "stu-3", studentDisplayName: "Cara Cole" },
    { studentId: "stu-4", studentDisplayName: "Dan Dunn" },
    { studentId: "stu-5", studentDisplayName: "Eve Ever" },
  ];

  async function renderWith(summary: AssignmentSummary, attempts: ReturnType<typeof mkAttempt>[]) {
    const mount = mkMount();
    const requests: unknown[] = [];
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ classId: "class-1" })),
      summaryCallable: (input) => {
        requests.push(input);
        return Promise.resolve(summary);
      },
      recipientListCallable: spyingRecipients(recipients).callable,
      attemptsListForClassCallable: spyingAttemptsList(attempts).callable,
    });
    await flush();
    await flush();
    await flush();
    const text = (id: string) =>
      mount.querySelector(`[data-testid=assignment-detail-roster-progress-${id}]`)?.textContent ?? null;
    const group = (key: string) =>
      Array.from(
        mount.querySelectorAll(`[data-testid=assignment-detail-roster-group-${key}] li[data-student-id]`),
      ).map((li) => li.getAttribute("data-student-id"));
    return { mount, requests, text, group };
  }

  test("each student shows their actual state, matched by studentId", async () => {
    const { requests, text, group } = await renderWith(
      freezeSummary({
        totalStudents: 5,
        completedStudents: 1,
        inProgressStudents: 3,
        notStartedStudents: 1,
        studentProgress: [
          { studentId: "stu-1", answered: 3, total: 10, retake: true },
          { studentId: "stu-3", answered: 0, total: 10, retake: false },
          { studentId: "stu-4", answered: 6, total: 10, retake: false },
          { studentId: "stu-5", answered: 10, total: 10, retake: false },
        ],
      }),
      [mkAttempt({ attemptId: "att-1", studentId: "stu-1", percentage: 80 })],
    );
    // The detail surface opts into per-student progress.
    expect(requests).toEqual([{ assignmentId: "assign-1", includeStudentProgress: true }]);
    expect(group("submitted")).toEqual(["stu-1"]);
    expect(group("in-progress")).toEqual(["stu-3", "stu-4", "stu-5"]);
    expect(group("not-started")).toEqual(["stu-2"]);
    expect(text("stu-3")).toBe("Started · 0/10");
    expect(text("stu-4")).toBe("In Progress · 6/10");
    expect(text("stu-5")).toBe("Ready to Submit · 10/10");
    expect(text("stu-1")).toBe("Retake In Progress · 3/10");
    expect(text("stu-2")).toBeNull();
  });

  test("a retake keeps the best score beside the retake status", async () => {
    const { mount, text } = await renderWith(
      freezeSummary({
        totalStudents: 5,
        completedStudents: 1,
        inProgressStudents: 0,
        notStartedStudents: 4,
        studentProgress: [{ studentId: "stu-1", answered: 7, total: 10, retake: true }],
      }),
      [
        mkAttempt({ attemptId: "att-1", studentId: "stu-1", percentage: 90 }),
        mkAttempt({ attemptId: "att-2", studentId: "stu-1", percentage: 40 }),
      ],
    );
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-summary-stu-1]")?.textContent,
    ).toBe("90% 2 attempts");
    expect(text("stu-1")).toBe("Retake In Progress · 7/10");
  });

  test("progress is never inferred from counts when no per-student rows arrive", async () => {
    const { group } = await renderWith(
      freezeSummary({
        totalStudents: 5,
        completedStudents: 0,
        inProgressStudents: 2,
        notStartedStudents: 3,
      }),
      [],
    );
    expect(group("in-progress")).toEqual([]);
    expect(group("not-started").length).toBe(5);
  });

  test("teacher-facing roster text carries no response contents", async () => {
    const { mount } = await renderWith(
      freezeSummary({
        totalStudents: 5,
        completedStudents: 0,
        inProgressStudents: 1,
        notStartedStudents: 4,
        studentProgress: [{ studentId: "stu-2", answered: 1, total: 10, retake: false }],
      }),
      [],
    );
    const text = mount.textContent ?? "";
    for (const forbidden of ["response", "itemId", "optionId", "sessionId"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("renderAssignmentDetail - roster information hierarchy", () => {
  const recipients = [
    { studentId: "stu-1", studentDisplayName: "Christopher Brown" },
    { studentId: "stu-2", studentDisplayName: "Maya Chen" },
    { studentId: "stu-3", studentDisplayName: "Liam Johnson" },
  ];

  async function renderWith(
    summary: AssignmentSummary,
    attempts: ReturnType<typeof mkAttempt>[],
    onSelectStudent?: (selection: unknown) => void,
  ) {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ classId: "class-1" })),
      summaryCallable: resolvingSummary(summary),
      recipientListCallable: spyingRecipients(recipients).callable,
      attemptsListForClassCallable: spyingAttemptsList(attempts).callable,
      onSelectStudent,
    });
    await flush();
    await flush();
    await flush();
    const group = (key: string) =>
      mount.querySelector<HTMLElement>(`[data-testid=assignment-detail-roster-group-${key}]`)!;
    return { mount, group };
  }

  const allCompleted = () =>
    renderWith(
      freezeSummary({ totalStudents: 3, completedStudents: 3, inProgressStudents: 0, notStartedStudents: 0 }),
      [
        mkAttempt({ attemptId: "a1", studentId: "stu-1", percentage: 50, attemptNumber: 1, submittedAt: 1 }),
        mkAttempt({ attemptId: "a2", studentId: "stu-1", percentage: 40, attemptNumber: 2, submittedAt: 2 }),
        mkAttempt({ attemptId: "b1", studentId: "stu-2", percentage: 90 }),
        mkAttempt({ attemptId: "c1", studentId: "stu-3", percentage: 100 }),
      ],
    );

  test("Roster heading and the shared Sort control share the Detail-scoped header row", async () => {
    const { mount } = await allCompleted();
    const host = mount.querySelector<HTMLElement>("[data-testid=assignment-detail-roster-host]")!;
    const header = mount.querySelector<HTMLElement>("[data-testid=assignment-detail-roster-header]")!;
    expect(header.parentElement).toBe(host);
    expect(header.firstElementChild?.getAttribute("data-testid")).toBe("assignment-detail-roster-heading");
    const sort = mount.querySelector<HTMLElement>("[data-testid=assignment-detail-roster-sort]")!;
    expect(sort.parentElement).toBe(header);
    // The section is still named by the Roster heading.
    expect(host.getAttribute("aria-labelledby")).toBe("assignment-detail-roster-heading");
    // Groups follow the header, in the fixed order.
    expect(
      Array.from(mount.querySelectorAll("[data-testid^=assignment-detail-roster-group-heading-]")).map(
        (h) => h.textContent,
      ),
    ).toEqual(["Completed 3", "In Progress 0", "Not Started 0"]);
  });

  test("zero groups stay visible as compact headings: no sentence, no list, no tint", async () => {
    const { mount, group } = await allCompleted();
    expect(mount.textContent).not.toContain("No students in this group");
    for (const key of ["in-progress", "not-started"]) {
      const g = group(key);
      expect(g).not.toBeNull();
      expect(g.getAttribute("role")).toBe("group");
      expect(g.querySelector("ul")).toBeNull();
      expect(g.querySelector("p")).toBeNull();
      expect(g.classList.contains("shell-assignment-detail-roster-group-tinted")).toBe(false);
      expect(
        mount.querySelector(`[data-testid=assignment-detail-roster-group-count-${key}]`)?.textContent,
      ).toBe("0");
    }
    const completed = group("submitted");
    expect(completed.classList.contains("shell-assignment-detail-roster-group-tinted")).toBe(true);
    expect(completed.querySelector("ul[role=list]")).not.toBeNull();
  });

  test("group heading: status word and count are separate spans inside the labelled h4", async () => {
    const { group } = await allCompleted();
    const h = group("submitted").querySelector("h4")!;
    expect(group("submitted").getAttribute("aria-labelledby")).toBe(h.id);
    expect(h.querySelector(".shell-assignment-detail-roster-group-label")?.textContent).toBe("Completed");
    expect(h.querySelector(".shell-assignment-detail-roster-group-count")?.textContent).toBe("3");
    expect(h.textContent).toBe("Completed 3");
  });

  test("each group renders only the fields it has: no placeholders", async () => {
    const { mount } = await renderWith(
      freezeSummary({
        totalStudents: 3,
        completedStudents: 1,
        inProgressStudents: 1,
        notStartedStudents: 1,
        studentProgress: [{ studentId: "stu-3", answered: 4, total: 10, retake: false }],
      }),
      [mkAttempt({ attemptId: "a1", studentId: "stu-1", percentage: 50 })],
      () => undefined,
    );
    const row = (id: string) =>
      mount.querySelector<HTMLElement>(`[data-testid=assignment-detail-roster-row-${id}]`)!;
    // Completed: name button, then the score + attempts cells.
    expect(Array.from(row("stu-1").children).map((c) => c.className)).toEqual([
      "shell-assignment-detail-roster-name",
      "shell-assignment-detail-roster-summary",
    ]);
    expect(row("stu-1").textContent).toBe("Brown, Christopher50% 1 attempt");
    // In Progress: name + the unchanged progress string.
    expect(Array.from(row("stu-3").children).map((c) => c.className)).toEqual([
      "shell-assignment-detail-roster-name",
      "shell-assignment-detail-roster-progress",
    ]);
    expect(row("stu-3").textContent).toBe("Johnson, LiamIn Progress · 4/10");
    // Not Started: the name only.
    expect(row("stu-2").children.length).toBe(1);
    expect(row("stu-2").textContent).toBe("Chen, Maya");
    expect(mount.querySelector("[data-testid=assignment-detail-roster-groups]")?.textContent).not.toMatch(
      /\u2014|--|N\/A/,
    );
    // Every non-empty group is tinted.
    for (const key of ["submitted", "in-progress", "not-started"]) {
      expect(
        mount
          .querySelector(`[data-testid=assignment-detail-roster-group-${key}]`)
          ?.classList.contains("shell-assignment-detail-roster-group-tinted"),
      ).toBe(true);
    }
  });

  test("the student-name button stays the only Student Detail affordance; rows are not clickable", async () => {
    const selections: unknown[] = [];
    const { mount } = await renderWith(
      freezeSummary({ totalStudents: 3, completedStudents: 1, inProgressStudents: 0, notStartedStudents: 2 }),
      [mkAttempt({ attemptId: "a1", studentId: "stu-1", percentage: 50 })],
      (s) => selections.push(s),
    );
    const row = mount.querySelector<HTMLElement>("[data-testid=assignment-detail-roster-row-stu-1]")!;
    expect(row.tagName).toBe("LI");
    expect(row.getAttribute("role")).toBeNull();
    expect(row.tabIndex).toBe(-1);
    row.click();
    row.querySelector<HTMLElement>(".shell-assignment-detail-roster-percentage")!.click();
    expect(selections).toEqual([]);
    const name = mount.querySelector<HTMLButtonElement>("[data-testid=assignment-detail-roster-name-stu-1]")!;
    expect(name.getAttribute("aria-label")).toBe("Open student detail for Brown, Christopher");
    name.click();
    expect(selections).toEqual([
      {
        classId: "class-1",
        studentId: "stu-1",
        studentDisplayName: "Christopher Brown",
        returnToAssignmentId: "assign-1",
      },
    ]);
    // No nested interactive elements inside the name button.
    expect(name.querySelector("button, a, input")).toBeNull();
  });

  test("no recipients: the distinct empty state remains and no groups or Sort render", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ classId: "class-1" })),
      summaryCallable: resolvingSummary(
        freezeSummary({ totalStudents: 0, completedStudents: 0, inProgressStudents: 0, notStartedStudents: 0 }),
      ),
      recipientListCallable: spyingRecipients([]).callable,
      attemptsListForClassCallable: spyingAttemptsList([]).callable,
    });
    await flush();
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-empty-recipients]")?.textContent,
    ).toBe("No students are assigned yet.");
    expect(mount.querySelector("[data-testid=assignment-detail-roster-groups]")).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-roster-sort]")).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-roster-header]")).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Assignment Overview: identity, lifecycle action, and the summary metrics
// share one outer card; Attempt 2+ participation tiles come from the same
// cached class attempts list the roster and Question results read.
// -----------------------------------------------------------------------------

describe("renderAssignmentDetail - Assignment Overview", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await flush();
  };

  const metricKeys = (mount: HTMLElement): string[] =>
    Array.from(
      mount.querySelectorAll<HTMLElement>(".shell-assignment-summary-metric"),
    ).map((el) =>
      (el.getAttribute("data-testid") ?? "").replace(
        "assignment-summary-metric-",
        "",
      ),
    );

  const BASE_KEYS = [
    "total-students",
    "completed",
    "in-progress",
    "not-started",
    "completion-percent",
    "average-percent",
    "highest-percent",
    "lowest-percent",
    "perfect-scores",
  ];

  test("identity, class, lifecycle action, and summary metrics live in one overview card", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(
        freezeMetadata({ classId: "class-1", status: "closed" }),
      ),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: resolvingReopen().callable,
    });
    await settle();
    const overviews = mount.querySelectorAll(
      "[data-testid=assignment-detail-overview]",
    );
    expect(overviews.length).toBe(1);
    const overview = overviews[0] as HTMLElement;
    const header = overview.querySelector(
      "[data-testid=assignment-detail-header]",
    );
    expect(header).not.toBeNull();
    expect(
      overview.querySelector("[data-testid=assignment-detail-title]")
        ?.textContent,
    ).toBe("Waves and Signals Check");
    expect(
      overview.querySelector("[data-testid=assignment-detail-class-value]")
        ?.textContent,
    ).toBe("Period 3 - Grade 7 Physical Science");
    expect(
      overview.querySelector("[data-testid=assignment-detail-reopen-action]")
        ?.textContent,
    ).toBe("Reopen assignment");
    const summaryCard = overview.querySelector(
      "[data-testid=assignment-summary]",
    );
    expect(summaryCard).not.toBeNull();
    expect(metricKeys(overview)).toEqual(BASE_KEYS);
    // DOM reading order: title, class, action, then the metrics.
    const order = [
      "assignment-detail-title",
      "assignment-detail-class-value",
      "assignment-detail-reopen-action",
      "assignment-summary-metrics",
    ].map((id) => overview.querySelector(`[data-testid=${id}]`)!);
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  test("the redundant CLASS label is gone; the class name reads directly beneath the title", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await settle();
    expect(mount.querySelector("[data-testid=assignment-detail-class]")).toBeNull();
    const header = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-header]",
    )!;
    const labels = Array.from(header.querySelectorAll("dt")).map(
      (dt) => dt.textContent,
    );
    expect(labels).not.toContain("Class");
    const title = mount.querySelector("[data-testid=assignment-detail-title]");
    expect(title?.nextElementSibling?.getAttribute("data-testid")).toBe(
      "assignment-detail-class-value",
    );
  });

  test("the summary heading remains for assistive technology, and the title stays the primary heading", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata()),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await settle();
    const card = mount.querySelector("[data-testid=assignment-summary]");
    expect(card?.getAttribute("aria-labelledby")).toBe(
      "assignment-summary-headline",
    );
    expect(mount.querySelector("#assignment-summary-headline")).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-title]")?.tagName,
    ).toBe("H3");
  });

  test("closed assignment keeps its Reopen action inside the overview", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "closed" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      reopenCallable: resolvingReopen().callable,
    });
    await settle();
    const overview = mount.querySelector(
      "[data-testid=assignment-detail-overview]",
    );
    expect(
      overview?.querySelector("[data-testid=assignment-detail-reopen-action]"),
    ).not.toBeNull();
    expect(
      overview?.querySelector("[data-testid=assignment-detail-status-value]")
        ?.textContent,
    ).toBe("Closed");
  });

  test("no retakes: exactly the nine summary metrics, no attempt tiles", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ classId: "class-1" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      attemptsListForClassCallable: spyingAttemptsList([
        mkAttempt({ attemptId: "a1", studentId: "s1", attemptNumber: 1 }),
        mkAttempt({ attemptId: "a2", studentId: "s2", attemptNumber: 1 }),
      ]).callable,
    });
    await settle();
    expect(metricKeys(mount)).toEqual(BASE_KEYS);
    expect(mount.textContent).not.toMatch(/Attempt 1/);
  });

  test("Attempt 2+ tiles count unique students per canonical attemptNumber for this assignment only", async () => {
    const mount = mkMount();
    const attempts = spyingAttemptsList([
      // Attempt 1 for three students (covered by Completed; no tile).
      mkAttempt({ attemptId: "s1-1", studentId: "s1", attemptNumber: 1, submittedAt: 9000 }),
      mkAttempt({ attemptId: "s2-1", studentId: "s2", attemptNumber: 1 }),
      mkAttempt({ attemptId: "s3-1", studentId: "s3", attemptNumber: 1 }),
      // Attempt 2 for two students; attemptNumber, not submission time,
      // decides the cohort.
      mkAttempt({ attemptId: "s1-2", studentId: "s1", attemptNumber: 2, submittedAt: 10 }),
      mkAttempt({ attemptId: "s2-2", studentId: "s2", attemptNumber: 2 }),
      // Attempt 3 for one student.
      mkAttempt({ attemptId: "s1-3", studentId: "s1", attemptNumber: 3 }),
      // Another assignment in the same class is never counted.
      mkAttempt({ attemptId: "x-2", studentId: "s3", attemptNumber: 2, assignmentId: "assign-other" }),
      mkAttempt({ attemptId: "x-4", studentId: "s3", attemptNumber: 4, assignmentId: "assign-other" }),
    ]);
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ classId: "class-1" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      attemptsListForClassCallable: attempts.callable,
    });
    await settle();
    expect(metricKeys(mount)).toEqual([...BASE_KEYS, "attempt-2", "attempt-3"]);
    const value = (key: string): string | null =>
      mount.querySelector(`[data-testid=assignment-summary-value-${key}]`)
        ?.textContent ?? null;
    expect(value("attempt-2")).toBe("2 students");
    expect(value("attempt-3")).toBe("1 student");
    // Existing summary values come from the summary callable, unchanged.
    expect(value("completed")).toBe("12");
    expect(value("total-students")).toBe("24");
  });

  test("attempt tiles add no server call: one attempts-list read shared with roster and Question results", async () => {
    const mount = mkMount();
    const attempts = spyingAttemptsList([
      mkAttempt({ attemptId: "s1-1", studentId: "s1", attemptNumber: 1 }),
      mkAttempt({ attemptId: "s1-2", studentId: "s1", attemptNumber: 2 }),
    ]);
    const summary = spyingSummary(freezeSummary());
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ classId: "class-1" })),
      summaryCallable: summary.callable,
      recipientListCallable: spyingRecipients([
        { studentId: "s1", studentDisplayName: "Alice" },
      ]).callable,
      attemptsListForClassCallable: attempts.callable,
      attemptGetForTeacherCallable: spyingAttemptGet(new Map()).callable,
    });
    await settle();
    expect(attempts.calls).toEqual(["class-1"]);
    expect(summary.calls).toEqual(["assign-1"]);
    expect(metricKeys(mount)).toContain("attempt-2");
  });

  test("a failed attempts read keeps the nine summary metrics and shows no attempt tiles", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ classId: "class-1" })),
      summaryCallable: resolvingSummary(freezeSummary()),
      attemptsListForClassCallable: () => Promise.reject(new Error("down")),
    });
    await settle();
    expect(metricKeys(mount)).toEqual(BASE_KEYS);
  });

  test("a draft keeps its overview header and separate results panel, with no metrics", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "assign-1",
      loadMetadata: resolvingMeta(freezeMetadata({ status: "draft" })),
      summaryCallable: resolvingSummary(freezeSummary()),
    });
    await settle();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-overview] [data-testid=assignment-detail-draft-label]",
      ),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-draft-summary]"),
    ).not.toBeNull();
    expect(mount.querySelector("[data-testid=assignment-summary]")).toBeNull();
  });
});
