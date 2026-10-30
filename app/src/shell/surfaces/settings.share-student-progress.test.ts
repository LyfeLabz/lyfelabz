/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";
import { renderSettingsSurface, type SettingsDeps } from "./settings";
import {
  MAX_REVOKE_GRANTS,
  describeShareResults,
  groupGrantsByTeacher,
  isValidRecipientEmail,
  normalizeRecipientEmail,
  recipientTeacherKey,
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
// `supportAccessGrantMany`; access listed by recipient teacher, with
// confirmed teacher-level and per-student removal (P5H); every outcome
// reported, including partial failures.

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
    expect(q(root, tid("ss-share-recipient-count"))!.textContent).toBe("2 teachers selected");
    q<HTMLButtonElement>(qa(root, tid("ss-share-recipient"))[0]!, "button")!.click();
    expect(recipients(root)).toEqual(["sped@school.org"]);
    expect(q(root, tid("ss-share-recipient-count"))!.textContent).toBe("1 teacher selected");
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
    expect(q(root, tid("ss-share-status"))!.textContent).toBe(
      "para@school.org: Access granted to 2 students. sped@school.org: Access granted to 2 students.",
    );
    expect(qa(root, tid("ss-access-student"))).toHaveLength(4);
    expect(q(root, tid("ss-share-grants-toggle"))!.textContent).toBe("Teachers with access (2)");
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
      "para@school.org: Access granted to 1 student. 1 student was already shared. nobody@school.org: No access was granted. 2 students couldn't be shared. What couldn't be shared is still selected so you can try again.",
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
      "Sharing again also resends 2 pairs that already worked; those will show as already shared.",
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
    expect(q(root, tid("ss-share-status"))!.textContent).toBe("This student already has access through this teacher.");
    // Nothing failed, so the selections cleared; Share Access waits for new ones.
    expect(submit.disabled).toBe(true);
  });
});

// P5H: Teachers with access. Active grants are grouped by recipient teacher
// (stable uid from the grant id, never the display name). Remove teacher
// revokes every grant that teacher holds in this class; Remove access revokes
// one student's grant. Both confirm first and use `supportAccessRevokeMany`.
describe("Teachers with access: grouping", () => {
  // Grant ids follow studentSupportGrantIdFor: `${classId}__${studentId}__${granteeUid}`.
  const sg = (classId: string, studentId: string, name: string, uid: string, teacher: string, email: string | null): SupportGrant => ({
    grantId: `${classId}__${studentId}__${uid}`,
    classId,
    studentId,
    studentDisplayName: name,
    granteeDisplayName: teacher,
    granteeEmail: email,
  });

  it("keys a teacher by the uid in the grant id, falling back to email, then the grant", () => {
    expect(recipientTeacherKey(sg("cls-1", "s-ada", "Ada", "uidPat", "Pat", "pat@school.org"))).toBe("uid:uidPat");
    // Underscores in class or student ids do not confuse the split.
    expect(recipientTeacherKey(sg("cls__1", "s__ada", "Ada", "uid_P", "Pat", null))).toBe("uid:uid_P");
    expect(recipientTeacherKey(grant("odd-id", "s-ada", "Ada", "pat@school.org"))).toBe("email:pat@school.org");
    expect(recipientTeacherKey({ ...grant("odd-id", "s-ada", "Ada", "x@y.z"), granteeEmail: null })).toBe("grant:odd-id");
  });

  it("groups by stable identity, counts students per teacher, and ignores other classes", () => {
    const teachers = groupGrantsByTeacher("cls-1", [
      sg("cls-1", "s-ben", "Ben Baker", "uidPat", "Pat Para", "pat@school.org"),
      sg("cls-1", "s-ada", "Ada Avery", "uidPat", "Pat Para", "pat@school.org"),
      // Same display name, different teacher: a separate entry.
      sg("cls-1", "s-ada", "Ada Avery", "uidPat2", "Pat Para", "pat.p@school.org"),
      // A missing email on one grant does not split the teacher.
      sg("cls-1", "s-cara", "Cara Cole", "uidSam", "Sam Sped", null),
      sg("cls-1", "s-ada", "Ada Avery", "uidSam", "Sam Sped", "sam@school.org"),
      sg("cls-2", "s-dan", "Dan Diaz", "uidPat", "Pat Para", "pat@school.org"),
    ]);
    expect(teachers.map((t) => [t.key, t.displayName, t.email, t.grants.map((g) => g.studentDisplayName)])).toEqual([
      ["uid:uidPat2", "Pat Para", "pat.p@school.org", ["Ada Avery"]],
      ["uid:uidPat", "Pat Para", "pat@school.org", ["Ada Avery", "Ben Baker"]],
      ["uid:uidSam", "Sam Sped", "sam@school.org", ["Ada Avery", "Cara Cole"]],
    ]);
  });
});

describe("Teachers with access: display and removal", () => {
  const sg = (studentId: string, name: string, uid: string, teacher: string, email: string, classId = "cls-1"): SupportGrant => ({
    grantId: `${classId}__${studentId}__${uid}`,
    classId,
    studentId,
    studentDisplayName: name,
    granteeDisplayName: teacher,
    granteeEmail: email,
  });
  const PAT_ADA = sg("s-ada", "Ada Avery", "uidPat", "Pat Para", "pat@school.org");
  const PAT_BEN = sg("s-ben", "Ben Baker", "uidPat", "Pat Para", "pat@school.org");
  const SAM_CARA = sg("s-cara", "Cara Cole", "uidSam", "Sam Sped", "sam@school.org");
  const initial = (): SupportGrant[] => [PAT_ADA, PAT_BEN, SAM_CARA];

  const teacherRows = (root: ParentNode): HTMLElement[] => qa(root, tid("ss-access-teacher"));
  const teacherRow = (root: ParentNode, uid: string): HTMLElement =>
    teacherRows(root).find((el) => el.getAttribute("data-teacher-key") === `uid:${uid}`)!;
  const studentRow = (root: ParentNode, grantId: string): HTMLElement =>
    qa(root, tid("ss-access-student")).find((el) => el.getAttribute("data-grant-id") === grantId)!;
  const summary = (root: ParentNode): string[] =>
    teacherRows(root).map(
      (row) =>
        `${q(row, tid("ss-access-teacher-name"))!.textContent} | ${q(row, tid("ss-access-teacher-email"))?.textContent ?? ""} | ${q(row, tid("ss-access-teacher-count"))!.textContent}`,
    );
  const header = (root: ParentNode): string => q(root, tid("ss-share-grants-toggle"))!.textContent ?? "";
  const grantStatus = (root: ParentNode): HTMLElement => q(root, tid("ss-share-grant-status"))!;
  const revokeManyFake = (fake: Fake, outcome: (id: string) => SupportRevokeManyResult["outcome"] = () => "revoked") =>
    async (grantIds: ReadonlyArray<string>): Promise<ReadonlyArray<SupportRevokeManyResult>> => {
      fake.revokeManyCalls.push(grantIds);
      const results = grantIds.map((grantId) => ({ grantId, outcome: outcome(grantId) }));
      const gone = new Set(results.filter((r) => r.outcome !== "failed").map((r) => r.grantId));
      fake.grants = fake.grants.filter((g) => !gone.has(g.grantId));
      return results;
    };

  it("heads the list with the number of distinct teachers, collapsed, and keeps loading, empty, and error states", async () => {
    const fake = fakeSeam({}, initial());
    const root = mountSection(fake);
    expect(header(root)).toBe("Teachers with access");
    expect(q(root, tid("ss-share-grants-loading"))).not.toBeNull();
    await flush();
    // Three grants, two teachers.
    expect(header(root)).toBe("Teachers with access (2)");
    const toggle = q<HTMLButtonElement>(root, tid("ss-share-grants-toggle"))!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(q(root, tid("ss-share-grants-body"))!.hidden).toBe(true);
    toggle.click();
    expect(q(root, tid("ss-share-grants-body"))!.hidden).toBe(false);
    expect(summary(root)).toEqual(["Pat Para | pat@school.org | 2 students", "Sam Sped | sam@school.org | 1 student"]);
    document.body.replaceChildren();
    const empty = mountSection(fakeSeam());
    await flush();
    expect(header(empty)).toBe("Teachers with access (0)");
    expect(q(empty, tid("ss-share-grants-empty"))).not.toBeNull();
    document.body.replaceChildren();
    const failing = mountSection(fakeSeam({ listForClass: () => Promise.reject(new Error("x")) }));
    await flush();
    expect(header(failing)).toBe("Teachers with access (couldn't load)");
    expect(q(failing, tid("ss-share-grants-error"))).not.toBeNull();
  });

  it("a failed list read can be retried in place", async () => {
    let fail = true;
    const fake = fakeSeam({}, initial());
    const list = fake.seam.listForClass;
    fake.seam = { ...fake.seam, listForClass: (id) => (fail ? Promise.reject(new Error("x")) : list(id)) };
    const root = mountSection(fake);
    await flush();
    fail = false;
    q<HTMLButtonElement>(root, tid("ss-share-grants-retry"))!.click();
    await flush();
    expect(teacherRows(root)).toHaveLength(2);
  });

  it("shows only the selected class's grants", async () => {
    const fake = fakeSeam({}, initial());
    // A response that wrongly included another class's grant is not shown.
    fake.seam = { ...fake.seam, listForClass: async () => [...initial(), sg("s-dan", "Dan Diaz", "uidZoe", "Zoe Z", "zoe@school.org", "cls-2")] };
    const root = mountSection(fake);
    await flush();
    expect(header(root)).toBe("Teachers with access (2)");
    expect(root.textContent).not.toContain("Dan Diaz");
    expect(root.textContent).not.toContain("Zoe Z");
  });

  it("lists each teacher's students directly, with no nested disclosure", async () => {
    const root = mountSection(fakeSeam({}, initial()));
    await flush();
    // The outer "Teachers with access" disclosure is the only toggle.
    expect(qa(root, "[aria-expanded]").map((el) => el.getAttribute("data-testid"))).toEqual(["ss-share-grants-toggle"]);
    expect(q(root, tid("ss-access-teacher-toggle"))).toBeNull();
    const pat = teacherRow(root, "uidPat");
    const list = q(pat, tid("ss-access-students"))!;
    expect(list.hidden).toBe(false);
    expect(list.getAttribute("aria-label")).toBe("Students shared with Pat Para");
    expect(pat.getAttribute("aria-labelledby")).toBe(q(pat, tid("ss-access-teacher-name"))!.id);
    expect(qa(list, tid("ss-access-student")).map((li) => li.querySelector("span")!.textContent)).toEqual(["Ada Avery", "Ben Baker"]);
    expect(qa(teacherRow(root, "uidSam"), tid("ss-access-student"))).toHaveLength(1);
    // Teacher-level and student-level removal look different.
    expect(q(pat, tid("ss-access-remove-teacher"))!.className).toContain("shell-ss-access-remove-teacher");
    expect(q(pat, tid("ss-access-remove-student"))!.className).toBe("shell-classes-settings-support-revoke");
  });

  it("Escape cancels a pending removal without a request", async () => {
    const fake = fakeSeam({}, initial());
    fake.seam = { ...fake.seam, revokeMany: revokeManyFake(fake) };
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(studentRow(root, PAT_ADA.grantId), tid("ss-access-remove-student"))!.click();
    const cancel = q<HTMLButtonElement>(root, tid("ss-access-student-confirm-cancel"))!;
    cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(q(root, tid("ss-access-student-confirm"))).toBeNull();
    expect(document.activeElement).toBe(q(studentRow(root, PAT_ADA.grantId), tid("ss-access-remove-student")));
    expect(fake.revokeManyCalls).toEqual([]);
  });

  it("labels the removal controls for screen readers", async () => {
    const root = mountSection(fakeSeam({}, initial()));
    await flush();
    const pat = teacherRow(root, "uidPat");
    const removeTeacher = q<HTMLButtonElement>(pat, tid("ss-access-remove-teacher"))!;
    expect(removeTeacher.textContent).toBe("Remove teacher");
    expect(removeTeacher.getAttribute("aria-label")).toBe("Remove teacher Pat Para (pat@school.org)");
    const removeStudent = q<HTMLButtonElement>(studentRow(root, PAT_ADA.grantId), tid("ss-access-remove-student"))!;
    expect(removeStudent.textContent).toBe("Remove access");
    expect(removeStudent.getAttribute("aria-label")).toBe("Remove Pat Para's access to Ada Avery");
  });

  it("has no grant checkboxes and no Remove selected", async () => {
    const root = mountSection(fakeSeam({}, initial()));
    await flush();
    const body = q(root, tid("ss-share-grants-body"))!;
    expect(body.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(q(root, tid("ss-share-revoke-selected"))).toBeNull();
    expect(q(root, tid("ss-share-grant-check"))).toBeNull();
    expect(root.textContent).not.toContain("Remove selected");
  });

  it("Remove teacher asks first, naming the teacher, email, and student count; Cancel changes nothing", async () => {
    const fake = fakeSeam({}, initial());
    fake.seam = { ...fake.seam, revokeMany: revokeManyFake(fake) };
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(teacherRow(root, "uidPat"), tid("ss-access-remove-teacher"))!.click();
    const confirm = q(teacherRow(root, "uidPat"), tid("ss-access-teacher-confirm"))!;
    expect(confirm.getAttribute("role")).toBe("alertdialog");
    expect(confirm.getAttribute("aria-labelledby")).toBe(q(confirm, tid("ss-access-teacher-confirm-question"))!.id);
    expect(confirm.getAttribute("aria-describedby")).toBe(q(confirm, tid("ss-access-teacher-confirm-detail"))!.id);
    expect(q(confirm, tid("ss-access-teacher-confirm-question"))!.textContent).toBe("Remove Pat Para's access to 2 students?");
    const text = q(confirm, tid("ss-access-teacher-confirm-detail"))!.textContent!;
    expect(text).toContain("Pat Para (pat@school.org)");
    expect(text).toContain("The students remain in your class");
    expect(q(confirm, tid("ss-access-teacher-confirm-yes"))!.textContent).toBe("Remove teacher");
    // Focus starts on the safe choice.
    expect(document.activeElement).toBe(q(confirm, tid("ss-access-teacher-confirm-cancel")));
    expect(fake.revokeManyCalls).toEqual([]);
    expect(fake.revokeCalls).toEqual([]);
    q<HTMLButtonElement>(confirm, tid("ss-access-teacher-confirm-cancel"))!.click();
    await flush();
    expect(q(root, tid("ss-access-teacher-confirm"))).toBeNull();
    expect(document.activeElement).toBe(q(teacherRow(root, "uidPat"), tid("ss-access-remove-teacher")));
    expect(fake.revokeManyCalls).toEqual([]);
    expect(fake.revokeCalls).toEqual([]);
    expect(summary(root)).toEqual(["Pat Para | pat@school.org | 2 students", "Sam Sped | sam@school.org | 1 student"]);
  });

  it("words the Remove teacher confirmation for a single student", async () => {
    const root = mountSection(fakeSeam({}, initial()));
    await flush();
    q<HTMLButtonElement>(teacherRow(root, "uidSam"), tid("ss-access-remove-teacher"))!.click();
    expect(q(root, tid("ss-access-teacher-confirm-question"))!.textContent).toBe("Remove Sam Sped's access to 1 student?");
    expect(q(root, tid("ss-access-teacher-confirm-detail"))!.textContent).toBe(
      "Sam Sped (sam@school.org) will no longer see this student's work in this class. The student remains in your class.",
    );
  });

  it("confirmed Remove teacher revokes only that teacher's grants in this class", async () => {
    const fake = fakeSeam({}, initial());
    fake.seam = { ...fake.seam, revokeMany: revokeManyFake(fake) };
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(teacherRow(root, "uidPat"), tid("ss-access-remove-teacher"))!.click();
    q<HTMLButtonElement>(root, tid("ss-access-teacher-confirm-yes"))!.click();
    await flush();
    expect(fake.revokeManyCalls).toEqual([[PAT_ADA.grantId, PAT_BEN.grantId]]);
    expect(fake.revokeCalls).toEqual([]);
    expect(grantStatus(root).textContent).toBe("Removed Pat Para's access to 2 students.");
    expect(header(root)).toBe("Teachers with access (1)");
    expect(summary(root)).toEqual(["Sam Sped | sam@school.org | 1 student"]);
    expect(fake.grants).toEqual([SAM_CARA]);
    // The removed row is gone; focus returns to the list header.
    expect(document.activeElement).toBe(q(root, tid("ss-share-grants-toggle")));
  });

  it("revokes a large teacher in batches within the server cap", async () => {
    const many = Array.from({ length: MAX_REVOKE_GRANTS + 1 }, (_, i) => sg(`s-${i}`, `Student ${i}`, "uidPat", "Pat Para", "pat@school.org"));
    const fake = fakeSeam({}, many);
    fake.seam = { ...fake.seam, revokeMany: revokeManyFake(fake) };
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(teacherRow(root, "uidPat"), tid("ss-access-remove-teacher"))!.click();
    q<HTMLButtonElement>(root, tid("ss-access-teacher-confirm-yes"))!.click();
    await flush();
    await flush();
    await flush();
    expect(fake.revokeManyCalls.map((c) => c.length)).toEqual([MAX_REVOKE_GRANTS, 1]);
    expect(grantStatus(root).textContent).toBe(`Removed Pat Para's access to ${MAX_REVOKE_GRANTS + 1} students.`);
    expect(header(root)).toBe("Teachers with access (0)");
  });

  it("partial success keeps what failed, names it, and Try again retries only that", async () => {
    const fake = fakeSeam({}, initial());
    let failBen = true;
    fake.seam = {
      ...fake.seam,
      revokeMany: revokeManyFake(fake, (id) => (id === PAT_BEN.grantId && failBen ? "failed" : "revoked")),
    };
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(teacherRow(root, "uidPat"), tid("ss-access-remove-teacher"))!.click();
    q<HTMLButtonElement>(root, tid("ss-access-teacher-confirm-yes"))!.click();
    await flush();
    expect(q(grantStatus(root), "p")!.textContent).toBe("Removed Pat Para's access to 1 of 2 students. Pat Para still has access to:");
    expect(qa(root, tid("ss-share-grant-status-failures") + " li").map((li) => li.textContent)).toEqual(["Ben Baker"]);
    expect(summary(root)).toEqual(["Pat Para | pat@school.org | 1 student", "Sam Sped | sam@school.org | 1 student"]);
    expect(document.activeElement).toBe(q(teacherRow(root, "uidPat"), tid("ss-access-remove-teacher")));
    failBen = false;
    q<HTMLButtonElement>(root, tid("ss-access-retry"))!.click();
    await flush();
    expect(fake.revokeManyCalls).toEqual([[PAT_ADA.grantId, PAT_BEN.grantId], [PAT_BEN.grantId]]);
    expect(grantStatus(root).textContent).toBe("Removed Pat Para's access to 1 student.");
    expect(summary(root)).toEqual(["Sam Sped | sam@school.org | 1 student"]);
  });

  it("when every removal fails, nothing changes and Try again works", async () => {
    const fake = fakeSeam({}, initial());
    let reject = true;
    const ok = revokeManyFake(fake);
    fake.seam = {
      ...fake.seam,
      revokeMany: (ids) => {
        if (!reject) return ok(ids);
        fake.revokeManyCalls.push(ids);
        return Promise.reject(new Error("unavailable"));
      },
    };
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(root, tid("ss-share-grants-toggle"))!.click();
    q<HTMLButtonElement>(teacherRow(root, "uidPat"), tid("ss-access-remove-teacher"))!.click();
    q<HTMLButtonElement>(root, tid("ss-access-teacher-confirm-yes"))!.click();
    await flush();
    expect(q(grantStatus(root), "p")!.textContent).toBe("We couldn't remove Pat Para's access. Nothing was changed. Please try again.");
    // The display is preserved.
    expect(summary(root)).toEqual(["Pat Para | pat@school.org | 2 students", "Sam Sped | sam@school.org | 1 student"]);
    expect(q(teacherRow(root, "uidPat"), tid("ss-access-students"))!.hidden).toBe(false);
    expect(q(root, tid("ss-access-teacher-confirm"))).toBeNull();
    reject = false;
    q<HTMLButtonElement>(root, tid("ss-access-retry"))!.click();
    await flush();
    expect(fake.revokeManyCalls).toEqual([[PAT_ADA.grantId, PAT_BEN.grantId], [PAT_ADA.grantId, PAT_BEN.grantId]]);
    expect(grantStatus(root).textContent).toBe("Removed Pat Para's access to 2 students.");
  });

  it("per-grant failures for every grant are reported as nothing changed", async () => {
    const fake = fakeSeam({}, initial());
    fake.seam = { ...fake.seam, revokeMany: revokeManyFake(fake, () => "failed") };
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(teacherRow(root, "uidPat"), tid("ss-access-remove-teacher"))!.click();
    q<HTMLButtonElement>(root, tid("ss-access-teacher-confirm-yes"))!.click();
    await flush();
    expect(q(grantStatus(root), "p")!.textContent).toBe("We couldn't remove Pat Para's access. Nothing was changed. Please try again.");
    expect(summary(root)).toEqual(["Pat Para | pat@school.org | 2 students", "Sam Sped | sam@school.org | 1 student"]);
  });

  it("blocks duplicate submission while a removal is pending", async () => {
    const fake = fakeSeam({}, initial());
    let resolve!: () => void;
    const ok = revokeManyFake(fake);
    fake.seam = {
      ...fake.seam,
      revokeMany: (ids) =>
        new Promise((r) => {
          resolve = () => r(ok(ids));
        }),
    };
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(teacherRow(root, "uidPat"), tid("ss-access-remove-teacher"))!.click();
    const yes = q<HTMLButtonElement>(root, tid("ss-access-teacher-confirm-yes"))!;
    yes.click();
    const pending = q<HTMLButtonElement>(root, tid("ss-access-teacher-confirm-yes"))!;
    expect(pending.disabled).toBe(true);
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.textContent).toBe("Removing…");
    expect(q<HTMLButtonElement>(root, tid("ss-access-teacher-confirm-cancel"))!.disabled).toBe(true);
    expect(qa(root, tid("ss-access-remove-teacher")).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(qa(root, tid("ss-access-remove-student")).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    yes.click();
    pending.click();
    pending.dispatchEvent(new MouseEvent("click"));
    q<HTMLButtonElement>(teacherRow(root, "uidSam"), tid("ss-access-remove-teacher"))!.dispatchEvent(new MouseEvent("click"));
    expect(grantStatus(root).textContent).toBe("Removing access…");
    await flush();
    resolve();
    await flush();
    await flush();
    expect(fake.revokeManyCalls).toHaveLength(1);
    expect(fake.revokeCalls).toEqual([]);
    // Controls come back enabled after the request settles.
    expect(qa(root, tid("ss-access-remove-teacher")).every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("Remove access revokes one student's grant after confirming, and updates the count", async () => {
    const fake = fakeSeam({}, initial());
    fake.seam = { ...fake.seam, revokeMany: revokeManyFake(fake) };
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(studentRow(root, PAT_BEN.grantId), tid("ss-access-remove-student"))!.click();
    const confirm = q(studentRow(root, PAT_BEN.grantId), tid("ss-access-student-confirm"))!;
    expect(q(confirm, tid("ss-access-student-confirm-question"))!.textContent).toBe("Remove Pat Para's access to Ben Baker?");
    expect(q(confirm, tid("ss-access-student-confirm-detail"))!.textContent).toBe(
      "The student will remain in your class. Other shared students will not be affected.",
    );
    expect(confirm.textContent).not.toMatch(/remove Ben Baker from/i);
    // Cancel comes first, the destructive action second.
    expect(qa(confirm, "button").map((b) => b.getAttribute("data-testid"))).toEqual([
      "ss-access-student-confirm-cancel",
      "ss-access-student-confirm-yes",
    ]);
    expect(document.activeElement).toBe(q(confirm, tid("ss-access-student-confirm-cancel")));
    // Cancel changes nothing.
    q<HTMLButtonElement>(confirm, tid("ss-access-student-confirm-cancel"))!.click();
    expect(q(root, tid("ss-access-student-confirm"))).toBeNull();
    expect(document.activeElement).toBe(q(studentRow(root, PAT_BEN.grantId), tid("ss-access-remove-student")));
    expect(fake.revokeManyCalls).toEqual([]);
    q<HTMLButtonElement>(studentRow(root, PAT_BEN.grantId), tid("ss-access-remove-student"))!.click();
    q<HTMLButtonElement>(root, tid("ss-access-student-confirm-yes"))!.click();
    await flush();
    expect(fake.revokeManyCalls).toEqual([[PAT_BEN.grantId]]);
    expect(fake.revokeCalls).toEqual([]);
    expect(grantStatus(root).textContent).toBe("Removed Pat Para's access to Ben Baker.");
    expect(summary(root)).toEqual(["Pat Para | pat@school.org | 1 student", "Sam Sped | sam@school.org | 1 student"]);
    expect(header(root)).toBe("Teachers with access (2)");
    // Other grants intact; focus stays in Pat's group on the remaining student.
    expect(document.activeElement).toBe(q(studentRow(root, PAT_ADA.grantId), tid("ss-access-remove-student")));
    expect(qa(teacherRow(root, "uidPat"), tid("ss-access-student")).map((li) => li.getAttribute("data-grant-id"))).toEqual([PAT_ADA.grantId]);
    expect(fake.grants).toEqual([PAT_ADA, SAM_CARA]);
  });

  it("a failed Remove access keeps the student and says nothing changed", async () => {
    const fake = fakeSeam({ revokeMany: () => Promise.reject(new Error("x")) }, initial());
    const root = mountSection(fake);
    await flush();
    q<HTMLButtonElement>(studentRow(root, PAT_ADA.grantId), tid("ss-access-remove-student"))!.click();
    q<HTMLButtonElement>(root, tid("ss-access-student-confirm-yes"))!.click();
    await flush();
    expect(q(grantStatus(root), "p")!.textContent).toBe(
      "We couldn't remove Pat Para's access to Ada Avery. Nothing was changed. Please try again.",
    );
    expect(summary(root)).toEqual(["Pat Para | pat@school.org | 2 students", "Sam Sped | sam@school.org | 1 student"]);
  });

  it("P5H regression: after a successful share, removal controls are enabled and reach the server", async () => {
    // Staging: the owner shared two students, then Remove did nothing. The
    // share left `busy` set while the refreshed rows were drawn, so every
    // Remove stayed disabled and no revoke request was ever sent.
    const fake = fakeSeam({}, []);
    fake.seam = { ...fake.seam, revokeMany: revokeManyFake(fake) };
    const root = mountSection(fake);
    await flush();
    check(root, "s-ada");
    check(root, "s-ben");
    addEmail(root, "para@school.org");
    q<HTMLButtonElement>(root, tid("ss-share-submit"))!.click();
    await flush();
    expect(q(root, tid("ss-share-status"))!.textContent).toBe("Access granted to 2 students.");
    expect(header(root)).toBe("Teachers with access (1)");
    const controls = [
      ...qa(root, tid("ss-access-remove-teacher")),
      ...qa(root, tid("ss-access-remove-student")),
    ] as HTMLButtonElement[];
    expect(controls).toHaveLength(3);
    expect(controls.every((b) => !b.disabled)).toBe(true);
    const [first] = qa(root, tid("ss-access-student"));
    q<HTMLButtonElement>(first!, tid("ss-access-remove-student"))!.click();
    q<HTMLButtonElement>(root, tid("ss-access-student-confirm-yes"))!.click();
    await flush();
    expect(fake.revokeManyCalls).toEqual([["s-ada-para@school.org"]]);
    expect(summary(root)).toEqual(["para | para@school.org | 1 student"]);
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

describe("describeShareResults", () => {
  const r = (studentId: string, granteeEmail: string, outcome: SupportGrantManyResult["outcome"]): SupportGrantManyResult => ({
    studentId,
    granteeEmail,
    outcome,
    reason: outcome === "failed" ? "unavailable" : null,
  });

  it("counts students for one teacher, with singular and plural wording", () => {
    expect(describeShareResults([r("a", "t@x.org", "shared")])).toBe("Access granted to 1 student.");
    expect(describeShareResults([r("a", "t@x.org", "shared"), r("b", "t@x.org", "shared")])).toBe("Access granted to 2 students.");
    expect(describeShareResults([r("a", "t@x.org", "alreadyShared"), r("b", "t@x.org", "alreadyShared")])).toBe(
      "Both students already have access through this teacher.",
    );
    expect(describeShareResults(["a", "b", "c"].map((id) => r(id, "t@x.org", "alreadyShared")))).toBe(
      "All 3 students already have access through this teacher.",
    );
    expect(
      describeShareResults([r("a", "t@x.org", "shared"), r("b", "t@x.org", "shared"), r("c", "t@x.org", "alreadyShared")]),
    ).toBe("Access granted to 2 students. 1 student was already shared.");
  });

  it("never implies success when pairs failed", () => {
    expect(describeShareResults([r("a", "t@x.org", "failed")])).toBe("No access was granted. 1 student couldn't be shared.");
    expect(describeShareResults([r("a", "t@x.org", "failed"), r("b", "t@x.org", "alreadyShared")])).toBe(
      "No access was granted. 1 student was already shared. 1 student couldn't be shared.",
    );
    expect(describeShareResults([r("a", "t@x.org", "shared"), r("b", "t@x.org", "failed"), r("c", "t@x.org", "failed")])).toBe(
      "Access granted to 1 student. 2 students couldn't be shared.",
    );
    expect(describeShareResults([])).toBe("Nothing was shared.");
  });

  it("reports each recipient teacher separately, in the order shared", () => {
    expect(
      describeShareResults([
        r("a", "p@x.org", "shared"),
        r("a", "q@x.org", "alreadyShared"),
        r("b", "p@x.org", "shared"),
        r("b", "q@x.org", "failed"),
      ]),
    ).toBe("p@x.org: Access granted to 2 students. q@x.org: No access was granted. 1 student was already shared. 1 student couldn't be shared.");
    expect(describeShareResults([r("a", "p@x.org", "alreadyShared"), r("a", "q@x.org", "alreadyShared")])).toBe(
      "p@x.org: This student already has access. q@x.org: This student already has access.",
    );
  });
});

describe("Share Student Progress: stable action area", () => {
  it("drops the redundant description and puts Share Access, then the teacher count, in one action row", async () => {
    const root = mountSection(fakeSeam());
    await flush();
    expect(root.textContent).not.toContain("Give other teachers at your school read-only access");
    const actions = q(root, tid("ss-share-actions"))!;
    // The button leads, so the count's changing width never moves it.
    expect(Array.from(actions.children).map((el) => el.getAttribute("data-testid"))).toEqual([
      "ss-share-submit",
      "ss-share-recipient-count",
    ]);
    // The status line sits directly after the row with a reserved line, so
    // feedback never pushes the button.
    const status = q(root, tid("ss-share-status"))!;
    expect(actions.nextElementSibling).toBe(status);
    expect(status.className).toContain("shell-ss-share-status--reserved");
    expect(status.getAttribute("role")).toBe("status");
    expect(q(root, tid("ss-share-submit"))!.className).toContain("shell-btn-primary");
    expect(q(root, tid("ss-share-recipients"))!.getAttribute("data-empty")).toBe("true");
  });

  it("swaps Sharing… for the result in the same element and restores focus without leaving the row", async () => {
    let resolve!: (r: ReadonlyArray<SupportGrantManyResult>) => void;
    const fake = fakeSeam({ grantMany: () => new Promise((res) => (resolve = res)) });
    const root = mountSection(fake);
    await flush();
    check(root, "s-ada");
    addEmail(root, "para@school.org");
    expect(q(root, tid("ss-share-recipients"))!.getAttribute("data-empty")).toBe("false");
    const status = q(root, tid("ss-share-status"))!;
    const submit = q<HTMLButtonElement>(root, tid("ss-share-submit"))!;
    submit.focus();
    submit.click();
    expect(status.textContent).toBe("Sharing…");
    resolve([{ studentId: "s-ada", granteeEmail: "para@school.org", outcome: "shared", reason: null }]);
    await flush();
    expect(q(root, tid("ss-share-status"))).toBe(status);
    expect(status.textContent).toBe("Access granted to 1 student.");
    // Nothing is left selected, so the button is disabled; focus lands on
    // the result instead of falling to the page.
    expect(submit.disabled).toBe(true);
    expect(document.activeElement).toBe(status);
    expect(q(root, tid("ss-share-recipients"))!.getAttribute("data-empty")).toBe("true");
  });

  it("shares a typed email directly, with the count changing only after the button", async () => {
    // Staging acceptance: typing an email and pressing Share Access (no Add)
    // turns it into a chip and changes the count from "0 teachers" to
    // "1 teacher" and back. Both happen after the button in the row, so
    // neither can push it sideways.
    let resolve!: (r: ReadonlyArray<SupportGrantManyResult>) => void;
    const root = mountSection(fakeSeam({ grantMany: () => new Promise((res) => (resolve = res)) }));
    await flush();
    check(root, "s-ada");
    typeEmail(root, "para@school.org");
    const count = q(root, tid("ss-share-recipient-count"))!;
    const submit = q<HTMLButtonElement>(root, tid("ss-share-submit"))!;
    expect(count.textContent).toBe("0 teachers selected");
    expect(submit.disabled).toBe(false);
    expect(submit.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    submit.click();
    expect(count.textContent).toBe("1 teacher selected");
    expect(recipients(root)).toEqual(["para@school.org"]);
    expect(q(root, tid("ss-share-status"))!.textContent).toBe("Sharing…");
    resolve([{ studentId: "s-ada", granteeEmail: "para@school.org", outcome: "shared", reason: null }]);
    await flush();
    expect(count.textContent).toBe("0 teachers selected");
    expect(q(root, tid("ss-share-status"))!.textContent).toBe("Access granted to 1 student.");
    expect(q(root, tid("ss-share-actions"))!.firstElementChild).toBe(submit);
  });

  it("reserves exactly one status line and one chip row in the served CSS", () => {
    // jsdom never applies app/index.html, so pin the rules that keep the
    // row still: the reserved status line's line-height matches its
    // min-height (inherited by its message), and an empty chip list is one
    // chip tall (30px; 46px under coarse pointers, where the remove button
    // is 44px).
    const css = fs.readFileSync(path.resolve(__dirname, "../../../index.html"), "utf8");
    expect(css).toMatch(
      /\.shell-ss-share-status--reserved \{ min-height: 1\.35em; line-height: 1\.35;/,
    );
    expect(css).toMatch(/\.shell-ss-share-recipients\[data-empty="true"\] \{ min-height: 30px; \}/);
    expect(css).toMatch(
      /@media \(pointer: coarse\) \{[^}]*\.shell-ss-share-tools \.shell-ss-ra-action \{ min-height: 44px; \}\s*\.shell-ss-share-recipients\[data-empty="true"\] \{ min-height: 46px; \}/,
    );
  });

  it("keeps the teacher list's height after a share clears it, until the teacher edits it", async () => {
    const fake = fakeSeam();
    const root = mountSection(fake);
    await flush();
    check(root, "s-ada");
    addEmail(root, "para@school.org, sped@school.org");
    const list = q(root, tid("ss-share-recipients"))!;
    list.getBoundingClientRect = () => ({ height: 64 }) as DOMRect;
    q<HTMLButtonElement>(root, tid("ss-share-submit"))!.click();
    await flush();
    expect(recipients(root)).toEqual([]);
    expect(list.style.minHeight).toBe("64px");
    addEmail(root, "new@school.org");
    expect(list.style.minHeight).toBe("");
  });

  it("clears a stale result when a new share starts", async () => {
    let calls = 0;
    let resolveSecond!: (r: ReadonlyArray<SupportGrantManyResult>) => void;
    const fake = fakeSeam({
      grantMany: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve([{ studentId: "s-ada", granteeEmail: "para@school.org", outcome: "shared", reason: null }]);
        return new Promise((res) => (resolveSecond = res));
      },
    });
    const root = mountSection(fake);
    await flush();
    check(root, "s-ada");
    addEmail(root, "para@school.org");
    q<HTMLButtonElement>(root, tid("ss-share-submit"))!.click();
    await flush();
    expect(q(root, tid("ss-share-status"))!.textContent).toBe("Access granted to 1 student.");
    check(root, "s-ben");
    addEmail(root, "para@school.org");
    q<HTMLButtonElement>(root, tid("ss-share-submit"))!.click();
    expect(q(root, tid("ss-share-status"))!.textContent).toBe("Sharing…");
    resolveSecond([{ studentId: "s-ben", granteeEmail: "para@school.org", outcome: "failed", reason: "unavailable" }]);
    await flush();
    expect(q(root, tid("ss-share-status"))!.querySelector("p")!.textContent).toContain("No access was granted.");
  });
});
