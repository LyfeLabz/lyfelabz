/**
 * @jest-environment jsdom
 */
import { renderSettingsSurface, type SettingsDeps } from "./settings";
import {
  isValidRecipientEmail,
  normalizeRecipientEmail,
  renderShareStudentProgressSection,
} from "./classSupportAccess";
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type {
  StudentSupportSeam,
  SupportGrant,
  SupportGrantManyResult,
  SupportRevokeManyResult,
} from "../../supportAccess/types";

// Student Support Workspace V2 (P2): Share Student Progress lives in
// Settings > Student Services. Multi-student, multi-recipient sharing through
// `supportAccessGrantMany`; individual and confirmed bulk removal; every
// outcome reported, including partial failures.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;
const teacher: ActiveTeacher = Object.freeze({
  kind: "activeTeacher",
  uid: "u1",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const STUDENTS = [
  { studentId: "s-ada", studentDisplayName: "Ada Avery" },
  { studentId: "s-ben", studentDisplayName: "Ben Baker" },
  { studentId: "s-cara", studentDisplayName: "Cara Cole" },
];

const grant = (grantId: string, studentId: string, name: string, email: string): SupportGrant => ({
  grantId,
  classId: "cls-1",
  studentId,
  studentDisplayName: name,
  granteeDisplayName: email.split("@")[0]!,
  granteeEmail: email,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T | null => root.querySelector<T>(sel);
const qa = (root: ParentNode, sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const tid = (id: string): string => `[data-testid="${id}"]`;

type Fake = {
  seam: StudentSupportSeam;
  grants: SupportGrant[];
  grantManyCalls: Array<{ classId: string; studentIds: ReadonlyArray<string>; granteeEmails: ReadonlyArray<string> }>;
  revokeCalls: string[];
  revokeManyCalls: Array<ReadonlyArray<string>>;
  listCalls: string[];
};

function fakeSeam(overrides: Partial<StudentSupportSeam> = {}, initial: SupportGrant[] = []): Fake {
  const f: Fake = {
    grants: [...initial],
    grantManyCalls: [],
    revokeCalls: [],
    revokeManyCalls: [],
    listCalls: [],
    seam: null as unknown as StudentSupportSeam,
  };
  f.seam = {
    listShared: async () => [],
    listForClass: async (classId) => {
      f.listCalls.push(classId);
      return f.grants.filter((g) => g.classId === classId);
    },
    grantMany: async (input) => {
      f.grantManyCalls.push(input);
      const out: SupportGrantManyResult[] = [];
      for (const studentId of input.studentIds) {
        for (const email of input.granteeEmails) {
          out.push({ studentId, granteeEmail: email, outcome: "shared", reason: null });
          f.grants.push(grant(`${studentId}-${email}`, studentId, studentId, email));
        }
      }
      return out;
    },
    revoke: async (grantId) => {
      f.revokeCalls.push(grantId);
      f.grants = f.grants.filter((g) => g.grantId !== grantId);
    },
    revokeMany: async (grantIds) => {
      f.revokeManyCalls.push(grantIds);
      f.grants = f.grants.filter((g) => !grantIds.includes(g.grantId));
      return grantIds.map((grantId): SupportRevokeManyResult => ({ grantId, outcome: "revoked" }));
    },
    listAttemptsForStudent: async () => {
      throw new Error("unused");
    },
    revisionContent: null,
    ...overrides,
  };
  return f;
}

function mountSection(fake: Fake, students = STUDENTS): HTMLElement {
  const el = renderShareStudentProgressSection(document, {
    classId: "cls-1",
    seam: fake.seam,
    students,
    isConnected: () => true,
  });
  document.body.appendChild(el);
  return el;
}

const check = (root: ParentNode, studentId: string): void => {
  const box = q<HTMLInputElement>(root, tid(`ss-share-student-${studentId}`))!;
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change"));
};

const addEmail = (root: ParentNode, text: string): void => {
  const input = q<HTMLInputElement>(root, tid("ss-share-email"))!;
  input.value = text;
  q<HTMLButtonElement>(root, tid("ss-share-add-recipient"))!.click();
};

const typeEmail = (root: ParentNode, text: string): void => {
  const input = q<HTMLInputElement>(root, tid("ss-share-email"))!;
  input.value = text;
  input.dispatchEvent(new Event("input"));
};

const recipients = (root: ParentNode): string[] =>
  qa(root, tid("ss-share-recipient")).map((li) => li.querySelector("span")!.textContent ?? "");

beforeEach(() => {
  document.body.replaceChildren();
});

describe("Share Student Progress: student selection", () => {
  it("selects nothing by default and counts individual selections", async () => {
    const root = mountSection(fakeSeam());
    await flush();
    const boxes = qa(root, '[data-testid^="ss-share-student-s-"]') as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(q(root, tid("ss-share-student-count"))!.textContent).toBe("0 students selected");
    check(root, "s-ben");
    expect(q(root, tid("ss-share-student-count"))!.textContent).toBe("1 student selected");
  });

  it("Select all and Clear all update every checkbox and the count", async () => {
    const root = mountSection(fakeSeam());
    await flush();
    q<HTMLButtonElement>(root, tid("ss-share-select-all"))!.click();
    const boxes = qa(root, '[data-testid^="ss-share-student-s-"]') as HTMLInputElement[];
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(q(root, tid("ss-share-student-count"))!.textContent).toBe("3 students selected");
    q<HTMLButtonElement>(root, tid("ss-share-clear-all"))!.click();
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(q(root, tid("ss-share-student-count"))!.textContent).toBe("0 students selected");
  });
});

describe("Share Student Progress: recipients", () => {
  it("normalizes, validates, and deduplicates emails", () => {
    expect(normalizeRecipientEmail("  Para@School.ORG ")).toBe("para@school.org");
    expect(isValidRecipientEmail("para@school.org")).toBe(true);
    expect(isValidRecipientEmail("para@school")).toBe(false);
    expect(isValidRecipientEmail("not an email")).toBe(false);
  });

  it("adds multiple recipients, dedupes normalized duplicates, and removes one", async () => {
    const root = mountSection(fakeSeam());
    await flush();
    addEmail(root, "Para@School.org, sped@school.org");
    addEmail(root, "para@school.org");
    expect(recipients(root)).toEqual(["para@school.org", "sped@school.org"]);
    expect(q(root, tid("ss-share-recipient-count"))!.textContent).toBe("2 teachers");
    q<HTMLButtonElement>(qa(root, tid("ss-share-recipient"))[0]!, "button")!.click();
    expect(recipients(root)).toEqual(["sped@school.org"]);
    expect(q(root, tid("ss-share-recipient-count"))!.textContent).toBe("1 teacher");
  });

  it("rejects a malformed email without adding it or calling the server", async () => {
    const fake = fakeSeam();
    const root = mountSection(fake);
    await flush();
    addEmail(root, "para@school");
    expect(recipients(root)).toEqual([]);
    expect(q(root, tid("ss-share-status"))!.textContent).toContain("Check the email address");
    expect(q<HTMLInputElement>(root, tid("ss-share-email"))!.value).toBe("para@school");
    expect(fake.grantManyCalls).toEqual([]);
  });

  it("Enter adds a recipient without submitting a share", async () => {
    const fake = fakeSeam();
    const root = mountSection(fake);
    await flush();
    const input = q<HTMLInputElement>(root, tid("ss-share-email"))!;
    input.value = "para@school.org";
    const ev = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(recipients(root)).toEqual(["para@school.org"]);
    expect(fake.grantManyCalls).toEqual([]);
  });
});

describe("Share Student Progress: sharing", () => {
  it("Share Access is a primary button, disabled until a student and a valid teacher are chosen", async () => {
    const fake = fakeSeam();
    const root = mountSection(fake);
    await flush();
    const submit = q<HTMLButtonElement>(root, tid("ss-share-submit"))!;
    expect(submit.className).toContain("shell-btn-primary");
    expect(submit.getAttribute("aria-describedby")).toBe("ss-share-student-count ss-share-recipient-count");
    expect(submit.disabled).toBe(true);
    submit.click();
    expect(fake.grantManyCalls).toEqual([]);
    check(root, "s-ada");
    expect(submit.disabled).toBe(true);
    // A typed but invalid email does not enable it; a valid one does.
    typeEmail(root, "para@school");
    expect(submit.disabled).toBe(true);
    typeEmail(root, "para@school.org");
    expect(submit.disabled).toBe(false);
    typeEmail(root, "");
    expect(submit.disabled).toBe(true);
    addEmail(root, "para@school.org");
    expect(submit.disabled).toBe(false);
    check(root, "s-ada");
    expect(submit.disabled).toBe(true);
    expect(fake.grantManyCalls).toEqual([]);
  });

  it("shares only the selected students with every recipient in one bulk call, then refreshes grants", async () => {
    const fake = fakeSeam();
    const root = mountSection(fake);
    await flush();
    check(root, "s-ada");
    check(root, "s-cara");
    addEmail(root, "para@school.org sped@school.org");
    q<HTMLButtonElement>(root, tid("ss-share-submit"))!.click();
    await flush();
    expect(fake.grantManyCalls).toEqual([
      { classId: "cls-1", studentIds: ["s-ada", "s-cara"], granteeEmails: ["para@school.org", "sped@school.org"] },
    ]);
    expect(q(root, tid("ss-share-status"))!.textContent).toBe("Shared 4. Already shared 0.");
    expect(qa(root, tid("ss-share-grant-row"))).toHaveLength(4);
    expect(fake.listCalls).toEqual(["cls-1", "cls-1"]);
    // Fully successful: selections clear.
    expect(recipients(root)).toEqual([]);
    expect(q(root, tid("ss-share-student-count"))!.textContent).toBe("0 students selected");
  });

  it("an email typed but not yet added is included in the share", async () => {
    const fake = fakeSeam();
    const root = mountSection(fake);
    await flush();
    check(root, "s-ada");
    typeEmail(root, "para@school.org");
    q<HTMLButtonElement>(root, tid("ss-share-submit"))!.click();
    await flush();
    expect(fake.grantManyCalls[0]!.granteeEmails).toEqual(["para@school.org"]);
  });

  it("reports partial success and duplicates, and keeps only failed selections for correction", async () => {
    const fake = fakeSeam({
      grantMany: async () => [
        { studentId: "s-ada", granteeEmail: "para@school.org", outcome: "shared", reason: null },
        { studentId: "s-ada", granteeEmail: "nobody@school.org", outcome: "failed", reason: "granteeUnavailable" },
        { studentId: "s-ben", granteeEmail: "para@school.org", outcome: "alreadyShared", reason: null },
        { studentId: "s-ben", granteeEmail: "nobody@school.org", outcome: "failed", reason: "granteeUnavailable" },
      ],
    });
    const root = mountSection(fake);
    await flush();
    check(root, "s-ada");
    check(root, "s-ben");
    addEmail(root, "para@school.org, nobody@school.org");
    q<HTMLButtonElement>(root, tid("ss-share-submit"))!.click();
    await flush();
    const status = q(root, tid("ss-share-status"))!;
    expect(status.querySelector("p")!.textContent).toBe(
      "Shared 1. Already shared 1. Failed 2. The students and emails that failed are still selected.",
    );
    const failures = qa(root, tid("ss-share-status-failures") + " li").map((li) => li.textContent);
    expect(failures).toEqual([
      "Ada Avery - nobody@school.org: no active teacher at your school uses this email",
      "Ben Baker - nobody@school.org: no active teacher at your school uses this email",
    ]);
    expect(recipients(root)).toEqual(["nobody@school.org"]);
    expect(q(root, tid("ss-share-student-count"))!.textContent).toBe("2 students selected");
  });

  it("says when sharing again would resend pairs that already worked", async () => {
    const fake = fakeSeam({
      grantMany: async () => [
        { studentId: "s-ada", granteeEmail: "x@school.org", outcome: "failed", reason: "writeConflict" },
        { studentId: "s-ada", granteeEmail: "y@school.org", outcome: "shared", reason: null },
        { studentId: "s-ben", granteeEmail: "x@school.org", outcome: "shared", reason: null },
        { studentId: "s-ben", granteeEmail: "y@school.org", outcome: "failed", reason: "writeConflict" },
      ],
    });
    const root = mountSection(fake);
    await flush();
    check(root, "s-ada");
    check(root, "s-ben");
    addEmail(root, "x@school.org y@school.org");
    q<HTMLButtonElement>(root, tid("ss-share-submit"))!.click();
    await flush();
    expect(q(root, tid("ss-share-status"))!.querySelector("p")!.textContent).toContain(
      "Sharing again also resends 2 pairs that already worked; those show as Already shared.",
    );
    expect(recipients(root)).toEqual(["x@school.org", "y@school.org"]);
    expect(q(root, tid("ss-share-student-count"))!.textContent).toBe("2 students selected");
  });

  it("never claims success when the whole call fails, and keeps selections", async () => {
    const fake = fakeSeam({ grantMany: () => Promise.reject(new Error("network")) });
    const root = mountSection(fake);
    await flush();
    check(root, "s-ada");
    addEmail(root, "para@school.org");
    q<HTMLButtonElement>(root, tid("ss-share-submit"))!.click();
    await flush();
    const text = q(root, tid("ss-share-status"))!.textContent ?? "";
    expect(text).toBe("We couldn't share access. Nothing was changed. Please try again.");
    expect(text).not.toContain("Shared");
    expect(recipients(root)).toEqual(["para@school.org"]);
    expect(q(root, tid("ss-share-student-count"))!.textContent).toBe("1 student selected");
  });

  it("blocks duplicate submission while a request is pending", async () => {
    let resolve!: (r: ReadonlyArray<SupportGrantManyResult>) => void;
    const calls: unknown[] = [];
    const fake = fakeSeam({
      grantMany: (input) => {
        calls.push(input);
        return new Promise((r) => {
          resolve = r;
        });
      },
    });
    const root = mountSection(fake);
    await flush();
    check(root, "s-ada");
    addEmail(root, "para@school.org");
    const submit = q<HTMLButtonElement>(root, tid("ss-share-submit"))!;
    submit.click();
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    submit.click();
    submit.dispatchEvent(new MouseEvent("click"));
    expect(calls).toHaveLength(1);
    resolve([{ studentId: "s-ada", granteeEmail: "para@school.org", outcome: "alreadyShared", reason: null }]);
    await flush();
    expect(submit.getAttribute("aria-busy")).toBeNull();
    expect(q(root, tid("ss-share-status"))!.textContent).toBe("Shared 0. Already shared 1.");
    // Nothing failed, so the selections cleared; Share Access waits for new ones.
    expect(submit.disabled).toBe(true);
  });
});

describe("Share Student Progress: existing grants and removal", () => {
  const initial = [
    grant("g1", "s-ada", "Ada Avery", "para@school.org"),
    grant("g2", "s-ben", "Ben Baker", "para@school.org"),
    grant("g3", "s-cara", "Cara Cole", "sped@school.org"),
  ];

  it("keeps existing shared access in a collapsed disclosure with the count in its header", async () => {
    const fake = fakeSeam({}, initial);
    const root = mountSection(fake);
    const toggle = q<HTMLButtonElement>(root, tid("ss-share-grants-toggle"))!;
    const body = q(root, tid("ss-share-grants-body"))!;
    expect(toggle.textContent).toBe("Shared access");
    await flush();
    expect(toggle.textContent).toBe("Shared access (3)");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("ss-share-grants-body");
    expect(body.id).toBe("ss-share-grants-body");
    expect(body.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body.hidden).toBe(false);
    expect(qa(body, tid("ss-share-grant-row"))).toHaveLength(3);
    // Removing one updates the count from the refreshed server list and the
    // disclosure stays open; the result is announced outside the body.
    q<HTMLButtonElement>(qa(body, tid("ss-share-grant-row"))[0]!, tid("ss-share-grant-remove"))!.click();
    await flush();
    expect(toggle.textContent).toBe("Shared access (2)");
    expect(body.hidden).toBe(false);
    expect(body.contains(q(root, tid("ss-share-grant-status")))).toBe(false);
    toggle.click();
    expect(body.hidden).toBe(true);
  });

  it("a new share updates the existing-access count; a failed read says so in the header", async () => {
    const fake = fakeSeam();
    const root = mountSection(fake);
    await flush();
    expect(q(root, tid("ss-share-grants-toggle"))!.textContent).toBe("Shared access (0)");
    check(root, "s-ada");
    addEmail(root, "para@school.org");
    q<HTMLButtonElement>(root, tid("ss-share-submit"))!.click();
    await flush();
    expect(q(root, tid("ss-share-grants-toggle"))!.textContent).toBe("Shared access (1)");
    document.body.replaceChildren();
    const failing = mountSection(fakeSeam({ listForClass: () => Promise.reject(new Error("x")) }));
    await flush();
    expect(q(failing, tid("ss-share-grants-toggle"))!.textContent).toBe("Shared access (couldn't load)");
  });

  it("shows loading, then compact rows with student, recipient, status, and Remove", async () => {
    const fake = fakeSeam({}, initial);
    const root = mountSection(fake);
    expect(q(root, tid("ss-share-grants-loading"))).not.toBeNull();
    await flush();
    const rows = qa(root, tid("ss-share-grant-row"));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Ada Avery - para (para@school.org)");
    expect(rows[0]!.textContent).toContain("Active");
    expect(q(rows[0]!, tid("ss-share-grant-remove"))!.textContent).toBe("Remove");
  });

  it("shows an empty state and an error state", async () => {
    const empty = mountSection(fakeSeam());
    await flush();
    expect(q(empty, tid("ss-share-grants-empty"))).not.toBeNull();
    document.body.replaceChildren();
    const failing = mountSection(fakeSeam({ listForClass: () => Promise.reject(new Error("x")) }));
    await flush();
    expect(q(failing, tid("ss-share-grants-error"))).not.toBeNull();
  });

  it("a failed grant-list read can be retried in place", async () => {
    let fail = true;
    const fake = fakeSeam({}, initial);
    const list = fake.seam.listForClass;
    fake.seam = { ...fake.seam, listForClass: (id) => (fail ? Promise.reject(new Error("x")) : list(id)) };
    const root = mountSection(fake);
    await flush();
    expect(q(root, tid("ss-share-grants-error"))).not.toBeNull();
    fail = false;
    q<HTMLButtonElement>(root, tid("ss-share-grants-retry"))!.click();
    await flush();
    expect(qa(root, tid("ss-share-grant-row"))).toHaveLength(3);
  });

  it("individual Remove revokes one grant and refreshes from the server", async () => {
    const fake = fakeSeam({}, initial);
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(qa(root, tid("ss-share-grant-row"))[1]!, tid("ss-share-grant-remove"))!.click();
    await flush();
    expect(fake.revokeCalls).toEqual(["g2"]);
    expect(fake.revokeManyCalls).toEqual([]);
    expect(qa(root, tid("ss-share-grant-row")).map((r) => r.getAttribute("data-grant-id"))).toEqual(["g1", "g3"]);
    expect(q(root, tid("ss-share-grant-status"))!.textContent).toBe("Removed 1.");
  });

  it("a failed individual Remove keeps the row and says nothing changed", async () => {
    const fake = fakeSeam({ revoke: () => Promise.reject(new Error("x")) }, initial);
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(qa(root, tid("ss-share-grant-row"))[0]!, tid("ss-share-grant-remove"))!.click();
    await flush();
    expect(qa(root, tid("ss-share-grant-row"))).toHaveLength(3);
    expect(q(root, tid("ss-share-grant-status"))!.textContent).toBe(
      "We couldn't remove access. Nothing was changed. Please try again.",
    );
  });

  const selectGrants = (root: ParentNode, ids: string[]): void => {
    for (const id of ids) {
      const box = q<HTMLInputElement>(root, `[data-grant-id="${id}"] ${tid("ss-share-grant-check")}`)!;
      box.checked = true;
      box.dispatchEvent(new Event("change"));
    }
  };

  it("bulk removal requires confirmation; Cancel writes nothing", async () => {
    const fake = fakeSeam({}, initial);
    const root = mountSection(fake);
    await flush();
    expect(q<HTMLButtonElement>(root, tid("ss-share-revoke-selected"))!.disabled).toBe(true);
    selectGrants(root, ["g1", "g3"]);
    const bulk = q<HTMLButtonElement>(root, tid("ss-share-revoke-selected"))!;
    expect(bulk.textContent).toBe("Remove selected (2)");
    bulk.click();
    expect(q(root, tid("ss-share-revoke-confirm"))).not.toBeNull();
    expect(fake.revokeManyCalls).toEqual([]);
    q<HTMLButtonElement>(root, tid("ss-share-revoke-confirm-cancel"))!.click();
    await flush();
    expect(q(root, tid("ss-share-revoke-confirm"))).toBeNull();
    expect(fake.revokeManyCalls).toEqual([]);
    expect(qa(root, tid("ss-share-grant-row"))).toHaveLength(3);
  });

  it("confirmed bulk removal calls supportAccessRevokeMany and reports partial results", async () => {
    const fake = fakeSeam({}, initial);
    fake.seam = {
      ...fake.seam,
      revokeMany: async (grantIds) => {
        fake.revokeManyCalls.push(grantIds);
        fake.grants = fake.grants.filter((g) => g.grantId !== "g1");
        return [
          { grantId: "g1", outcome: "revoked" },
          { grantId: "g2", outcome: "alreadyRevoked" },
          { grantId: "g3", outcome: "failed" },
        ];
      },
    };
    const root = mountSection(fake);
    await flush();
    selectGrants(root, ["g1", "g2", "g3"]);
    q<HTMLButtonElement>(root, tid("ss-share-revoke-selected"))!.click();
    q<HTMLButtonElement>(root, tid("ss-share-revoke-confirm-yes"))!.click();
    await flush();
    expect(fake.revokeManyCalls).toEqual([["g1", "g2", "g3"]]);
    expect(fake.revokeCalls).toEqual([]);
    const status = q(root, tid("ss-share-grant-status"))!;
    expect(status.querySelector("p")!.textContent).toBe("Removed 1. Already removed 1. Failed 1.");
    expect(qa(root, tid("ss-share-grant-status-failures") + " li").map((li) => li.textContent)).toEqual([
      "Cara Cole - sped: couldn't be removed",
    ]);
    // Refreshed from the server; the failed grant stays selected for retry.
    expect(qa(root, tid("ss-share-grant-row")).map((r) => r.getAttribute("data-grant-id"))).toEqual(["g2", "g3"]);
    expect(q(root, tid("ss-share-revoke-selected"))!.textContent).toBe("Remove selected (1)");
  });
});

describe("Settings > Student Services integration", () => {
  const classes: ReadonlyArray<ClassSummary> = Object.freeze([
    { id: "cls-1", title: "Block A", status: "active" } as unknown as ClassSummary,
    { id: "cls-2", title: "Block B", status: "active" } as unknown as ClassSummary,
  ]);

  const deps = (fake: Fake | null, listStudents = jest.fn(async ({ classId }: { classId: string }) => ({
    classId,
    students: classId === "cls-1" ? STUDENTS : [{ studentId: "s-dan", studentDisplayName: "Dan Diaz" }],
  }))): SettingsDeps => ({
    integrations: null,
    listClasses: async () => classes,
    listStudents,
    getAccommodation: jest.fn().mockResolvedValue({ configRevision: 0 }),
    setAccommodation: jest.fn(),
    studentSupport: fake?.seam ?? null,
  });

  const open = async (d: SettingsDeps, classId: string): Promise<HTMLElement> => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    renderSettingsSurface(mount, teacher, d);
    q<HTMLButtonElement>(mount, tid("settings-tab-student-services"))!.click();
    await flush();
    const select = q<HTMLSelectElement>(mount, tid("ss-class-select"))!;
    select.value = classId;
    select.dispatchEvent(new Event("change"));
    await flush();
    return mount;
  };

  const toggleOf = (root: ParentNode, key: "share" | "ra"): HTMLButtonElement =>
    q<HTMLButtonElement>(root, tid(`ss-${key}-toggle`))!;
  const bodyOf = (root: ParentNode, key: "share" | "ra"): HTMLElement => q(root, tid(`ss-${key}-body`))!;

  it("orders the class selector, Share Student Progress, then Reading Accessibility", async () => {
    const fake = fakeSeam();
    const d = deps(fake);
    const mount = await open(d, "cls-1");
    const panel = q(mount, tid("settings-panel-student-services"))!;
    const picker = q(panel, tid("ss-class-picker"))!;
    const share = q(panel, tid("ss-share-disclosure"))!;
    const ra = q(panel, tid("ss-ra-disclosure"))!;
    expect(picker.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(share.compareDocumentPosition(ra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q(panel, "#ss-share-heading")!.textContent).toBe("Share Student Progress");
    expect(q(panel, "#ss-ra-heading")!.textContent).toBe("Reading Accessibility");
    expect(share.getAttribute("aria-labelledby")).toBe("ss-share-heading");
    expect(ra.getAttribute("aria-labelledby")).toBe("ss-ra-heading");
    // One heading each: the share section carries no duplicate heading.
    expect(qa(panel, "h3").map((h) => h.textContent)).toEqual(["Share Student Progress", "Reading Accessibility"]);
    expect(q(share, tid("ss-share-section"))).not.toBeNull();
    expect(q(ra, tid("ss-student-list-section"))).not.toBeNull();
    expect(d.listStudents).toHaveBeenCalledTimes(1);
    expect(q(share, tid("ss-share-submit"))!.textContent).toBe("Share Access");
    expect(panel.textContent).not.toContain("Save");
  });

  it("opens Share Student Progress and collapses Reading Accessibility by default", async () => {
    const mount = await open(deps(fakeSeam()), "cls-1");
    expect(toggleOf(mount, "share").getAttribute("aria-expanded")).toBe("true");
    expect(bodyOf(mount, "share").hidden).toBe(false);
    expect(toggleOf(mount, "ra").getAttribute("aria-expanded")).toBe("false");
    expect(bodyOf(mount, "ra").hidden).toBe(true);
  });

  it("disclosure headers are keyboard-operable buttons that control their bodies and keep focus", async () => {
    const mount = await open(deps(fakeSeam()), "cls-1");
    for (const key of ["share", "ra"] as const) {
      const toggle = toggleOf(mount, key);
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle.type).toBe("button");
      expect(toggle.getAttribute("aria-controls")).toBe(`ss-${key}-body`);
      expect(q(mount, `#ss-${key}-body`)).toBe(bodyOf(mount, key));
      expect(toggle.closest("h3")).not.toBeNull();
    }
    // Toggling flips the body in place, so the same button keeps focus.
    const ra = toggleOf(mount, "ra");
    ra.focus();
    ra.click();
    expect(document.activeElement).toBe(ra);
    expect(toggleOf(mount, "ra")).toBe(ra);
    expect(ra.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggles each section independently without losing the class or share selections", async () => {
    const mount = await open(deps(fakeSeam()), "cls-1");
    check(mount, "s-ben");
    toggleOf(mount, "ra").click();
    expect(bodyOf(mount, "ra").hidden).toBe(false);
    expect(bodyOf(mount, "share").hidden).toBe(false);
    toggleOf(mount, "share").click();
    expect(bodyOf(mount, "share").hidden).toBe(true);
    expect(bodyOf(mount, "ra").hidden).toBe(false);
    toggleOf(mount, "ra").click();
    expect(bodyOf(mount, "ra").hidden).toBe(true);
    expect(bodyOf(mount, "share").hidden).toBe(true);
    toggleOf(mount, "share").click();
    expect(bodyOf(mount, "share").hidden).toBe(false);
    expect(q<HTMLSelectElement>(mount, tid("ss-class-select"))!.value).toBe("cls-1");
    expect(q(mount, tid("ss-share-student-count"))!.textContent).toBe("1 student selected");
    expect(q<HTMLInputElement>(mount, tid("ss-share-student-s-ben"))!.checked).toBe(true);
  });

  it("Reading Accessibility keeps working inside its section, with Share Student Progress kept above", async () => {
    const fake = fakeSeam();
    const d = deps(fake);
    const mount = await open(d, "cls-1");
    check(mount, "s-ben");
    toggleOf(mount, "ra").click();
    q<HTMLButtonElement>(mount, tid("ss-student-btn-s-ada"))!.click();
    await flush();
    expect(d.getAccommodation).toHaveBeenCalledWith({ studentId: "s-ada", classId: "cls-1" });
    const detail = q(bodyOf(mount, "ra"), tid("ss-student-detail"))!;
    expect(detail).not.toBeNull();
    expect(q(detail, tid("ss-ra-action"))!.textContent).toBe("Activate");
    // The redraw keeps both disclosure states and the share selections.
    expect(bodyOf(mount, "ra").hidden).toBe(false);
    expect(bodyOf(mount, "share").hidden).toBe(false);
    expect(q(mount, tid("ss-share-student-count"))!.textContent).toBe("1 student selected");
    q<HTMLButtonElement>(mount, ".shell-ss-back-btn")!.click();
    await flush();
    expect(q(bodyOf(mount, "ra"), tid("ss-student-list"))).not.toBeNull();
  });

  it("class switching keeps disclosure states and resets share selections", async () => {
    const fake = fakeSeam();
    const mount = await open(deps(fake), "cls-1");
    check(mount, "s-ben");
    toggleOf(mount, "ra").click();
    toggleOf(mount, "share").click();
    const select = q<HTMLSelectElement>(mount, tid("ss-class-select"))!;
    select.value = "cls-2";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(q<HTMLSelectElement>(mount, tid("ss-class-select"))!.value).toBe("cls-2");
    expect(toggleOf(mount, "share").getAttribute("aria-expanded")).toBe("false");
    expect(toggleOf(mount, "ra").getAttribute("aria-expanded")).toBe("true");
    const next = q(mount, tid("ss-share-section"))!;
    expect(q(next, tid("ss-share-student-count"))!.textContent).toBe("0 students selected");
    expect(q(next, tid("ss-share-student-s-dan"))).not.toBeNull();
    expect(q(next, tid("ss-share-student-s-ada"))).toBeNull();
    expect(q(mount, tid("ss-student-btn-s-dan"))).not.toBeNull();
    expect(fake.listCalls).toEqual(["cls-1", "cls-2"]);
  });

  it("shows the roster loading state once, without either section", async () => {
    const listStudents = jest.fn<Promise<{ classId: string; students: typeof STUDENTS }>, [{ classId: string }]>(
      () => new Promise(() => undefined),
    );
    const mount = await open(deps(fakeSeam(), listStudents), "cls-1");
    expect(qa(mount, tid("ss-students-loading"))).toHaveLength(1);
    expect(q(mount, tid("ss-share-disclosure"))).toBeNull();
    expect(q(mount, tid("ss-ra-disclosure"))).toBeNull();
  });

  it("ignores a late roster response for a class that is no longer selected", async () => {
    const pending: Record<string, (v: { classId: string; students: typeof STUDENTS }) => void> = {};
    const listStudents = jest.fn(
      ({ classId }: { classId: string }) =>
        new Promise<{ classId: string; students: typeof STUDENTS }>((r) => {
          pending[classId] = r;
        }),
    );
    const mount = await open(deps(fakeSeam(), listStudents), "cls-1");
    const select = q<HTMLSelectElement>(mount, tid("ss-class-select"))!;
    select.value = "cls-2";
    select.dispatchEvent(new Event("change"));
    await flush();
    pending["cls-2"]!({ classId: "cls-2", students: [{ studentId: "s-dan", studentDisplayName: "Dan Diaz" }] });
    await flush();
    pending["cls-1"]!({ classId: "cls-1", students: STUDENTS });
    await flush();
    const share = q(mount, tid("ss-share-section"))!;
    expect(q(share, tid("ss-share-student-s-dan"))).not.toBeNull();
    expect(q(share, tid("ss-share-student-s-ada"))).toBeNull();
    expect(q(mount, tid("ss-student-btn-s-ada"))).toBeNull();
  });

  it("hides the section without the support seam or with an empty roster", async () => {
    const without = await open(deps(null), "cls-1");
    expect(q(without, tid("ss-share-section"))).toBeNull();
    expect(q(without, tid("ss-share-disclosure"))).toBeNull();
    expect(q(without, tid("ss-student-list"))).not.toBeNull();
    expect(q(without, tid("ss-ra-disclosure"))).not.toBeNull();
    document.body.replaceChildren();
    const empty = await open(deps(fakeSeam(), jest.fn(async ({ classId }: { classId: string }) => ({ classId, students: [] }))), "cls-1");
    expect(q(empty, tid("ss-students-empty"))).not.toBeNull();
    expect(q(empty, tid("ss-share-section"))).toBeNull();
  });

  it("shows the roster error state without the share section", async () => {
    const mount = await open(deps(fakeSeam(), jest.fn((input: { classId: string }) => Promise.reject(new Error(input.classId)))), "cls-1");
    expect(q(mount, tid("ss-students-error"))).not.toBeNull();
    expect(q(mount, tid("ss-share-section"))).toBeNull();
  });

  it("explains a failed roster load without asking to reselect the class, and Try again re-reads it", async () => {
    let fail = true;
    const listStudents = jest.fn(async ({ classId }: { classId: string }) => {
      if (fail) throw new Error(classId);
      return { classId, students: STUDENTS };
    });
    const mount = await open(deps(fakeSeam(), listStudents), "cls-1");
    const err = q(mount, tid("ss-students-error"))!;
    expect(err.textContent).toBe("Could not load students.");
    expect(err.textContent).not.toMatch(/select/i);
    fail = false;
    q(mount, tid("ss-students-retry"))!.click();
    await flush();
    expect(listStudents).toHaveBeenCalledTimes(2);
    expect(listStudents.mock.calls[1]![0]).toEqual({ classId: "cls-1" });
    expect(q(mount, tid("ss-students-error"))).toBeNull();
    expect(q(mount, tid("ss-student-btn-s-ada"))).not.toBeNull();
  });
});
