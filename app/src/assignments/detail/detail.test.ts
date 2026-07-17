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
  test("renders the assignment title, class, and status", async () => {
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
    expect(
      mount.querySelector("[data-testid=assignment-detail-status-value]")
        ?.textContent,
    ).toBe("Published");
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
    expect(back?.getAttribute("aria-label")).toBe("Back to previous workspace");
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
