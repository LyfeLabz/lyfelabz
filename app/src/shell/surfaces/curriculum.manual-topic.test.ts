/**
 * @jest-environment jsdom
 *
 * Sprint 28.5D (microcopy): the Assign dialog used to render an inert
 * free-text "Google Classroom topic" field for a manual (non-LMS) LyfeLabz
 * class, which has no Google Classroom to publish to (28.5C audit §11/§23).
 * That field is now omitted for manual classes; LMS-linked classes still
 * expose the Google Classroom topic *select* used by publication.
 *
 * These tests pin both halves of the conditional so the manual-class field
 * cannot silently return and the LMS-linked field cannot silently vanish.
 */
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
} from "./curriculum";
import type { ListClasses } from "../../classes/listClasses";
import type { Session } from "../../session/types";
import type {
  IntegrationsDeps,
  IntegrationsLmsTopic,
} from "../../settings/integrations/types";

const teacher = (): Extract<Session, { kind: "activeTeacher" }> =>
  Object.freeze({
    kind: "activeTeacher",
    uid: "u1",
    schoolId: "school-abc",
    displayName: "Ada Lovelace",
  }) as Extract<Session, { kind: "activeTeacher" }>;

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

// The curriculum surface holds module-scoped class/link/topic caches keyed by
// uid; reset them between tests so the LMS-linked case cannot leak a cached
// link into the manual case (both use uid u1).
beforeEach(() => {
  _resetCurriculumSessionStateForTest();
});

const manualClass = () =>
  Promise.resolve(
    Object.freeze([
      Object.freeze({
        id: "c1",
        title: "Period 3 Science",
        grade: "7",
        block: "C",
        status: "active" as const,
        joinCode: "ABC123",
      }),
    ]),
  );

const openAssignDialog = async (mount: HTMLElement): Promise<void> => {
  mount
    .querySelector<HTMLButtonElement>("[data-testid=lesson-assign-earths-layers]")
    ?.click();
  await flush();
};

describe("Sprint 28.5D - manual class hides the Google Classroom topic field", () => {
  test("a manual (non-LMS) class row shows no Google Classroom topic input", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher(), {
      listClasses: manualClass as ListClasses,
    });
    await openAssignDialog(mount);

    // The row for the manual class must exist...
    expect(
      document.querySelector("[data-testid=assign-row-date-c1]"),
    ).not.toBeNull();
    // ...but neither the old free-text topic input nor the LMS topic select.
    expect(
      document.querySelector("[data-testid=assign-row-topic-c1]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-lms-topic-c1]"),
    ).toBeNull();
    // No visible "Google Classroom topic" label leaks onto the manual row.
    const dialogText =
      document.querySelector("[data-testid=assign-dialog]")?.textContent ?? "";
    expect(dialogText).not.toContain("Google Classroom topic");
  });

  test("an LMS-linked class row still shows the Google Classroom topic select", async () => {
    const mount = mkMount();
    // Minimal integrations seam: the dialog treats a row as LMS-linked when
    // `link` resolves and integrations is present. Provide a link lookup and
    // a topic list callable so the LMS row shape renders.
    const topics: ReadonlyArray<IntegrationsLmsTopic> = Object.freeze([
      Object.freeze({ lmsTopicId: "t1", name: "Unit 2" }),
    ]);
    const integrations = {
      listClassLinks: () =>
        Promise.resolve(
          Object.freeze([
            Object.freeze({
              classId: "c1",
              linkId: "l1",
              providerId: "google-classroom",
              lmsClassId: "gc-1",
            }),
          ]),
        ),
      callables: {
        listClassTopics: () => Promise.resolve(topics),
      },
    } as unknown as IntegrationsDeps;

    renderCurriculumSurface(mount, teacher(), {
      listClasses: manualClass as ListClasses,
      integrations,
    });
    await openAssignDialog(mount);
    await flush();

    // The LMS-linked row exposes the Google Classroom topic *select*.
    expect(
      document.querySelector("[data-testid=assign-row-lms-topic-c1]"),
    ).not.toBeNull();
    // And not the removed manual free-text input.
    expect(
      document.querySelector("[data-testid=assign-row-topic-c1]"),
    ).toBeNull();
  });
});
