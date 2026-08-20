/**
 * @jest-environment jsdom
 */

// Sprint 28 O1 (Branch B) - permanent lifecycle regression coverage.
//
// Phase 2A established, with deterministic and browser evidence, that the
// Assignment Detail lifecycle controls are provenance-agnostic: an
// LMS-linked assignment receives the same Close / Reopen controls as a
// manual-class assignment, both in-session and after a full reload. There is
// no reproduced LMS-specific Close-control defect, so the Close/Reopen
// production rendering logic is NOT modified.
//
// This file pins that verified contract so it cannot silently regress. It
// exercises the real production path a reload/hydration follows - the Phase 1
// primary suspect and the most valuable contract to pin:
//
//   raw assignmentsTeacherList item
//     -> parseAssignmentsTeacherListItem   (production parser, hydrate.ts)
//     -> hydrateAssignmentDetailRegistry   (production hydration, hydrate.ts)
//     -> createAssignmentDetailRegistry    (production registry, registry.ts)
//     -> createAssignmentDetailMetadataReader (production reader, wire.ts)
//     -> renderAssignmentDetail            (production surface, detail.ts)
//
// The client `AssignmentDetailMetadata` shape carries NO provenance field:
// an LMS-linked assignment is projected by `assignmentsTeacherList`
// identically to a manual one. That is the architecture the Phase 2A
// disposition preserves, so these tests do not invent a fake provenance
// branch to "say LMS". They use the actual canonical projection shape (the
// same fields both provenances receive) with LMS-flavored class naming, and
// assert the metadata carries no provenance key. The contract being pinned is
// precisely: an LMS-originated assignment survives the canonical
// projection/hydration contract and receives the same lifecycle controls as a
// manual assignment.

import { renderAssignmentDetail } from "./detail";
import {
  parseAssignmentsTeacherListItem,
  hydrateAssignmentDetailRegistry,
  type AssignmentsTeacherListCallable,
} from "./hydrate";
import { createAssignmentDetailRegistry } from "./registry";
import { createAssignmentDetailMetadataReader } from "./wire";
import type {
  AssignmentsCloseCallable,
  AssignmentsReopenCallable,
} from "./types";
import type { AssignmentSummary, AssignmentSummaryCallable } from "../summary/types";

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

// The exact shape an LMS-linked assignment receives through the canonical
// `assignmentsTeacherList` projection. It is structurally identical to a
// manual-class item; only the human-readable class name hints at the LMS
// origin. No provenance/enrollmentSource field exists on the projection.
const lmsTeacherListItem = (
  status: "published" | "closed",
): Record<string, unknown> => ({
  assignmentId: "assign-lms-1",
  lessonSlug: "earths-layers",
  title: "Earth's Layers Check",
  classId: "class-lms-1",
  className: "Google Classroom: Period 4 Earth Science",
  status,
  publishedAt: 1_724_000_000_000,
});

// A teacher-list callable that mirrors the production `hydrate-wire`
// composition (parse each raw item, drop malformed ones) without loading
// firebase/functions.
const listCallableFrom = (
  raw: ReadonlyArray<Record<string, unknown>>,
): AssignmentsTeacherListCallable => {
  return async () => {
    const parsed = [];
    for (const item of raw) {
      const metadata = parseAssignmentsTeacherListItem(item);
      if (metadata !== null) parsed.push(metadata);
    }
    return parsed;
  };
};

const freezeSummary = (): AssignmentSummary =>
  Object.freeze({
    assignmentId: "assign-lms-1",
    classId: "class-lms-1",
    totalStudents: 20,
    completedStudents: 10,
    inProgressStudents: 4,
    notStartedStudents: 6,
    completionPercentage: 50,
    averagePercentage: 80,
    highestPercentage: 100,
    lowestPercentage: 40,
    perfectScoreStudents: 2,
  }) as AssignmentSummary;

const summaryCallable: AssignmentSummaryCallable = () =>
  Promise.resolve(freezeSummary());

const resolvingClose = (): AssignmentsCloseCallable => ({ assignmentId }) =>
  Promise.resolve(
    Object.freeze({ assignmentId, status: "closed" as const, alreadyClosed: false }),
  );

const resolvingReopen = (): AssignmentsReopenCallable => ({ assignmentId }) =>
  Promise.resolve(
    Object.freeze({
      assignmentId,
      status: "published" as const,
      alreadyPublished: false,
    }),
  );

// Render the Assignment Detail exactly as an active-teacher session would after
// a full reload: hydrate the session-scoped registry from the certified
// teacher-list retrieval path, then open the detail through the registry-backed
// metadata reader.
const renderAfterHydration = async (
  raw: ReadonlyArray<Record<string, unknown>>,
): Promise<HTMLElement> => {
  const registry = createAssignmentDetailRegistry();
  await hydrateAssignmentDetailRegistry(registry, listCallableFrom(raw));
  const mount = mkMount();
  renderAssignmentDetail(mount, {
    assignmentId: "assign-lms-1",
    loadMetadata: createAssignmentDetailMetadataReader(registry),
    summaryCallable,
    closeCallable: resolvingClose(),
    reopenCallable: resolvingReopen(),
  });
  await flush();
  await flush();
  return mount;
};

describe("Sprint 28 O1 - LMS-linked lifecycle controls survive hydration (provenance-agnostic)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("the canonical projection carries no provenance field", () => {
    const parsed = parseAssignmentsTeacherListItem(
      lmsTeacherListItem("published"),
    );
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      assignmentId: "assign-lms-1",
      status: "published",
      className: "Google Classroom: Period 4 Earth Science",
    });
    // The client metadata shape is provenance-agnostic by design; no LMS
    // marker survives (or exists in) the projection.
    expect("enrollmentSource" in (parsed as object)).toBe(false);
    expect("provider" in (parsed as object)).toBe(false);
    expect("lms" in (parsed as object)).toBe(false);
  });

  test("a hydrated LMS-published assignment renders the header and Close, not Reopen", async () => {
    const mount = await renderAfterHydration([lmsTeacherListItem("published")]);

    // Header rendered (not the empty state).
    expect(
      mount.querySelector("[data-testid=assignment-detail-header]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-title]")?.textContent,
    ).toBe("Earth's Layers Check");

    // Close present, Reopen absent.
    const close = mount.querySelector(
      "[data-testid=assignment-detail-close-action]",
    );
    expect(close).not.toBeNull();
    expect(close?.textContent).toBe("Close assignment");
    expect(
      mount.querySelector("[data-testid=assignment-detail-reopen-action]"),
    ).toBeNull();
  });

  test("a hydrated LMS-closed assignment renders the header and Reopen, not Close", async () => {
    const mount = await renderAfterHydration([lmsTeacherListItem("closed")]);

    expect(
      mount.querySelector("[data-testid=assignment-detail-header]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-title]")?.textContent,
    ).toBe("Earth's Layers Check");

    // Reopen present, Close absent.
    const reopen = mount.querySelector(
      "[data-testid=assignment-detail-reopen-action]",
    );
    expect(reopen).not.toBeNull();
    expect(reopen?.textContent).toBe("Reopen assignment");
    expect(
      mount.querySelector("[data-testid=assignment-detail-close-action]"),
    ).toBeNull();
  });
});
