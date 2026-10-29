import {
  type SharedStudent,
  type StudentSupportSeam,
  type SupportGrant,
  type SupportGrantFailureReason,
  type SupportRevokeManyResult,
  sharedStudentContextLabel,
} from "../../supportAccess/types";

// Student Support Access (PDR-032, STUDENT_SUPPORT_ACCESS.md section 7).
//
// 1. `renderShareStudentProgressSection`: the class owner's "Share Student
//    Progress" section in Settings > Student Services, for the class chosen
//    there. Check students, add one or more support teachers' emails, and
//    share in one `supportAccessGrantMany` call. Active grants are listed by
//    recipient teacher ("Teachers with access"); after confirmation, Remove
//    teacher revokes all of that teacher's grants in this class, and Remove
//    access revokes one student's grant (both `supportAccessRevokeMany`).
//    Every change takes effect when the server confirms it; there is no
//    Save. Results report each outcome, including partial failures, and the
//    grant list is re-read from the server afterwards.
// 2. `renderSharedStudentsSection`: the support educator's "Shared students"
//    list on the Classes surface. Choosing a student opens the existing
//    Student Detail in read-only mode (wired by classes.ts).
//
// Neither is a security control; the server authorizes every call.

export type ShareStudent = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

export type ShareStudentProgressDeps = {
  readonly classId: string;
  readonly seam: StudentSupportSeam;
  // The class's active roster, already loaded by Student Services.
  readonly students: ReadonlyArray<ShareStudent>;
  // False once Settings has unmounted; late results are then ignored.
  readonly isConnected: () => boolean;
};

// Server caps (STUDENT_SUPPORT_ACCESS.md section 3.1), checked before the
// call so an over-cap request is explained instead of refused whole.
export const MAX_SHARE_STUDENTS = 40;
export const MAX_SHARE_RECIPIENTS = 10;
export const MAX_REVOKE_GRANTS = 200;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRecipientEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidRecipientEmail(email: string): boolean {
  return email.length <= 320 && EMAIL_PATTERN.test(email);
}

function failureMessage(reason: SupportGrantFailureReason | null): string {
  switch (reason) {
    case "invalidEmail":
      return "not an email address";
    case "granteeUnavailable":
      return "no active teacher at your school uses this email";
    case "studentNotEnrolled":
      return "no longer active in this class";
    case "writeConflict":
    case "unavailable":
      return "couldn't be saved, try again";
    default:
      return "couldn't be shared";
  }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// A recipient teacher's stable identity. Grant ids are
// `${classId}__${studentId}__${granteeUid}` (studentSupportGrantIdFor), so
// the uid is the remainder after the known class and student prefix. Names
// are never an identity; a grant id of another shape keys on its email, or
// stands alone.
export function recipientTeacherKey(grant: SupportGrant): string {
  const prefix = `${grant.classId}__${grant.studentId}__`;
  if (grant.grantId.startsWith(prefix) && grant.grantId.length > prefix.length) {
    return `uid:${grant.grantId.slice(prefix.length)}`;
  }
  return grant.granteeEmail !== null ? `email:${grant.granteeEmail}` : `grant:${grant.grantId}`;
}

export type RecipientTeacher = {
  readonly key: string;
  readonly displayName: string;
  readonly email: string | null;
  // This class's active grants to the teacher, by student name.
  readonly grants: ReadonlyArray<SupportGrant>;
};

// Groups one class's active grants by recipient teacher, ordered by name,
// then email, then key. Grants from any other class are ignored.
export function groupGrantsByTeacher(
  classId: string,
  grants: ReadonlyArray<SupportGrant>,
): ReadonlyArray<RecipientTeacher> {
  const byKey = new Map<string, SupportGrant[]>();
  for (const grant of grants) {
    if (grant.classId !== classId) continue;
    const key = recipientTeacherKey(grant);
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [grant]);
    else list.push(grant);
  }
  const teachers: RecipientTeacher[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.studentDisplayName.localeCompare(b.studentDisplayName) || (a.grantId < b.grantId ? -1 : 1));
    const first = list[0]!;
    teachers.push({
      key,
      displayName: first.granteeDisplayName,
      email: list.find((g) => g.granteeEmail !== null)?.granteeEmail ?? null,
      grants: list,
    });
  }
  teachers.sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) ||
      (a.email ?? "").localeCompare(b.email ?? "") ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  return teachers;
}

const teacherLabel = (t: RecipientTeacher): string => (t.email === null ? t.displayName : `${t.displayName} (${t.email})`);

export function renderShareStudentProgressSection(
  doc: Document,
  deps: ShareStudentProgressDeps,
): HTMLElement {
  // The "Share Student Progress" heading (a disclosure) belongs to Settings.
  const section = doc.createElement("div");
  section.className = "shell-ss-share";
  section.setAttribute("data-testid", "ss-share-section");

  const desc = doc.createElement("p");
  desc.className = "shell-ss-section-desc";
  desc.textContent =
    "Give other teachers at your school read-only access to students' assignments and assessment results.";
  section.appendChild(desc);

  // Students (left) and recipients + Share Access (right) sit side by side
  // when there is room and stack otherwise.
  const form = doc.createElement("div");
  form.className = "shell-ss-share-form";
  section.appendChild(form);

  const selected = new Set<string>();
  let recipients: string[] = [];
  let grants: ReadonlyArray<SupportGrant> = [];
  let grantsState: "loading" | "error" | "loaded" = "loading";
  // Teachers whose student list is open, and the one pending confirmation
  // (a whole teacher, or one student's grant).
  const expandedTeachers = new Set<string>();
  let confirming: { readonly kind: "teacher"; readonly key: string } | { readonly kind: "student"; readonly grantId: string } | null = null;
  // One flag for every request. Any change goes through `setBusy`, which
  // redraws the access list, so its buttons never keep a stale disabled
  // state (P5H: after a share, every Remove stayed disabled).
  let busy = false;
  const nameOf = new Map(deps.students.map((s) => [s.studentId, s.studentDisplayName]));

  // --- Students ---
  const studentsGroup = doc.createElement("fieldset");
  studentsGroup.className = "shell-ss-share-group";
  const studentsLegend = doc.createElement("legend");
  studentsLegend.textContent = "Students";
  studentsGroup.appendChild(studentsLegend);

  const studentTools = doc.createElement("div");
  studentTools.className = "shell-ss-share-tools";
  const selectAll = doc.createElement("button");
  selectAll.type = "button";
  selectAll.className = "shell-ss-ra-action";
  selectAll.setAttribute("data-testid", "ss-share-select-all");
  selectAll.textContent = "Select all";
  const clearAll = doc.createElement("button");
  clearAll.type = "button";
  clearAll.className = "shell-ss-ra-action";
  clearAll.setAttribute("data-testid", "ss-share-clear-all");
  clearAll.textContent = "Clear all";
  const studentCount = doc.createElement("span");
  studentCount.id = "ss-share-student-count";
  studentCount.className = "shell-ss-share-count";
  studentCount.setAttribute("data-testid", "ss-share-student-count");
  studentCount.setAttribute("aria-live", "polite");
  studentTools.append(selectAll, clearAll, studentCount);
  studentsGroup.appendChild(studentTools);

  const studentList = doc.createElement("ul");
  studentList.className = "shell-ss-share-students";
  studentList.setAttribute("data-testid", "ss-share-students");
  const checkboxes: HTMLInputElement[] = [];
  for (const student of deps.students) {
    const li = doc.createElement("li");
    const label = doc.createElement("label");
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.value = student.studentId;
    box.setAttribute("data-testid", `ss-share-student-${student.studentId}`);
    box.addEventListener("change", () => {
      if (box.checked) selected.add(student.studentId);
      else selected.delete(student.studentId);
      updateCounts();
    });
    checkboxes.push(box);
    label.append(box, doc.createTextNode(` ${student.studentDisplayName}`));
    li.appendChild(label);
    studentList.appendChild(li);
  }
  studentsGroup.appendChild(studentList);
  form.appendChild(studentsGroup);

  const syncCheckboxes = (): void => {
    for (const box of checkboxes) box.checked = selected.has(box.value);
  };
  selectAll.addEventListener("click", () => {
    for (const s of deps.students) selected.add(s.studentId);
    syncCheckboxes();
    updateCounts();
  });
  clearAll.addEventListener("click", () => {
    selected.clear();
    syncCheckboxes();
    updateCounts();
  });

  // --- Recipients ---
  const recipientsGroup = doc.createElement("fieldset");
  recipientsGroup.className = "shell-ss-share-group";
  const recipientsLegend = doc.createElement("legend");
  recipientsLegend.textContent = "Share with";
  recipientsGroup.appendChild(recipientsLegend);

  const emailRow = doc.createElement("div");
  emailRow.className = "shell-ss-share-tools shell-ss-share-email-row";
  const emailLabel = doc.createElement("label");
  emailLabel.htmlFor = "ss-share-email";
  emailLabel.className = "shell-ss-picker-label";
  emailLabel.textContent = "Teacher email";
  const emailInput = doc.createElement("input");
  emailInput.id = "ss-share-email";
  emailInput.type = "email";
  emailInput.autocomplete = "off";
  emailInput.maxLength = 320;
  emailInput.className = "shell-ss-share-email";
  emailInput.setAttribute("data-testid", "ss-share-email");
  const addRecipient = doc.createElement("button");
  addRecipient.type = "button";
  addRecipient.className = "shell-ss-ra-action";
  addRecipient.setAttribute("data-testid", "ss-share-add-recipient");
  addRecipient.textContent = "Add";
  emailRow.append(emailLabel, emailInput, addRecipient);
  recipientsGroup.appendChild(emailRow);

  const recipientList = doc.createElement("ul");
  recipientList.className = "shell-ss-share-recipients";
  recipientList.setAttribute("data-testid", "ss-share-recipients");
  recipientList.setAttribute("aria-label", "Teachers to share with");
  recipientsGroup.appendChild(recipientList);

  const recipientCount = doc.createElement("span");
  recipientCount.id = "ss-share-recipient-count";
  recipientCount.className = "shell-ss-share-count";
  recipientCount.setAttribute("data-testid", "ss-share-recipient-count");
  recipientCount.setAttribute("aria-live", "polite");
  recipientsGroup.appendChild(recipientCount);

  const sendColumn = doc.createElement("div");
  sendColumn.className = "shell-ss-share-send";
  sendColumn.appendChild(recipientsGroup);
  form.appendChild(sendColumn);

  // Disabled until at least one student is checked and at least one valid
  // email is listed or typed; the counts say what is still missing.
  const shareButton = doc.createElement("button");
  shareButton.type = "button";
  shareButton.className = "shell-btn shell-btn-primary shell-ss-share-submit";
  shareButton.setAttribute("data-testid", "ss-share-submit");
  shareButton.setAttribute("aria-describedby", "ss-share-student-count ss-share-recipient-count");
  shareButton.textContent = "Share Access";
  sendColumn.appendChild(shareButton);

  const shareStatus = doc.createElement("div");
  shareStatus.className = "shell-ss-share-status";
  shareStatus.setAttribute("data-testid", "ss-share-status");
  shareStatus.setAttribute("role", "status");
  shareStatus.setAttribute("aria-live", "polite");
  sendColumn.appendChild(shareStatus);

  // --- Teachers with access: a disclosure, collapsed, with the number of
  // recipient teachers in its header ---
  const grantsDisclosure = doc.createElement("div");
  grantsDisclosure.className = "shell-ss-share-existing";
  section.appendChild(grantsDisclosure);

  const grantsHeading = doc.createElement("h4");
  grantsHeading.className = "shell-ss-share-subheading";
  const grantsToggle = doc.createElement("button");
  grantsToggle.type = "button";
  grantsToggle.className = "shell-ss-disclosure-toggle shell-ss-disclosure-toggle--sub";
  grantsToggle.setAttribute("data-testid", "ss-share-grants-toggle");
  grantsToggle.setAttribute("aria-controls", "ss-share-grants-body");
  grantsToggle.setAttribute("aria-expanded", "false");
  grantsHeading.appendChild(grantsToggle);
  grantsDisclosure.appendChild(grantsHeading);

  const grantsBody = doc.createElement("div");
  grantsBody.id = "ss-share-grants-body";
  grantsBody.setAttribute("data-testid", "ss-share-grants-body");
  grantsBody.hidden = true;
  grantsDisclosure.appendChild(grantsBody);
  grantsToggle.addEventListener("click", () => {
    const open = grantsToggle.getAttribute("aria-expanded") !== "true";
    grantsToggle.setAttribute("aria-expanded", open ? "true" : "false");
    grantsBody.hidden = !open;
  });

  const grantList = doc.createElement("ul");
  grantList.className = "shell-classes-settings-support-list shell-ss-access-teachers";
  grantList.setAttribute("data-testid", "ss-access-teachers");
  grantList.setAttribute("aria-label", "Teachers with access");
  grantsBody.appendChild(grantList);

  // Outside the collapsed body so removal results are always announced.
  const grantStatus = doc.createElement("div");
  grantStatus.className = "shell-ss-share-status";
  grantStatus.setAttribute("data-testid", "ss-share-grant-status");
  grantStatus.setAttribute("role", "status");
  grantStatus.setAttribute("aria-live", "polite");
  grantsDisclosure.appendChild(grantStatus);

  const setStatus = (el: HTMLElement, summary: string, details: ReadonlyArray<string> = []): void => {
    el.replaceChildren();
    if (summary === "") return;
    const p = doc.createElement("p");
    p.textContent = summary;
    el.appendChild(p);
    if (details.length > 0) {
      const ul = doc.createElement("ul");
      ul.setAttribute("data-testid", `${el.getAttribute("data-testid") ?? ""}-failures`);
      for (const d of details) {
        const li = doc.createElement("li");
        li.textContent = d;
        ul.appendChild(li);
      }
      el.appendChild(ul);
    }
  };

  const renderRecipients = (): void => {
    recipientList.replaceChildren();
    for (const email of recipients) {
      const li = doc.createElement("li");
      li.className = "shell-ss-share-recipient";
      li.setAttribute("data-testid", "ss-share-recipient");
      const text = doc.createElement("span");
      text.textContent = email;
      const remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "shell-classes-settings-support-revoke";
      remove.setAttribute("aria-label", `Remove ${email}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        if (busy) return;
        recipients = recipients.filter((r) => r !== email);
        renderRecipients();
        updateCounts();
      });
      li.append(text, remove);
      recipientList.appendChild(li);
    }
  };

  // Adds every comma/space-separated entry in the field. Returns false and
  // keeps the field's text when any entry is not an email.
  const addFromInput = (): boolean => {
    const entries = emailInput.value.split(/[\s,;]+/).map(normalizeRecipientEmail).filter((e) => e !== "");
    if (entries.length === 0) return true;
    const invalid = entries.filter((e) => !isValidRecipientEmail(e));
    if (invalid.length > 0) {
      setStatus(shareStatus, `Check the email address: ${invalid.join(", ")}`);
      return false;
    }
    const next = [...recipients];
    for (const e of entries) if (!next.includes(e)) next.push(e);
    if (next.length > MAX_SHARE_RECIPIENTS) {
      setStatus(shareStatus, `Share with up to ${MAX_SHARE_RECIPIENTS} teachers at a time.`);
      return false;
    }
    recipients = next;
    emailInput.value = "";
    setStatus(shareStatus, "");
    renderRecipients();
    updateCounts();
    return true;
  };
  addRecipient.addEventListener("click", () => {
    addFromInput();
  });
  emailInput.addEventListener("input", () => updateCounts());
  emailInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === ",") {
      ev.preventDefault();
      addFromInput();
    }
  });

  const updateCounts = (): void => {
    studentCount.textContent = `${plural(selected.size, "student", "students")} selected`;
    recipientCount.textContent = plural(recipients.length, "teacher", "teachers");
    selectAll.disabled = busy || deps.students.length === 0;
    clearAll.disabled = busy || selected.size === 0;
    shareButton.disabled = busy || selected.size === 0 || (recipients.length === 0 && !typedEmailsValid());
  };

  // True when the email field holds one or more entries and all are valid
  // (Share Access adds them, as Add would).
  const typedEmailsValid = (): boolean => {
    const entries = emailInput.value.split(/[\s,;]+/).map(normalizeRecipientEmail).filter((e) => e !== "");
    return entries.length > 0 && entries.every(isValidRecipientEmail);
  };

  const refreshGrants = (): Promise<void> =>
    deps.seam.listForClass(deps.classId).then(
      (loaded) => {
        grants = loaded.filter((g) => g.classId === deps.classId);
        grantsState = "loaded";
        renderGrants();
      },
      () => {
        grantsState = "error";
        renderGrants();
      },
    );

  const submitShare = (): void => {
    if (busy) return;
    if (!addFromInput()) return;
    if (selected.size === 0) {
      setStatus(shareStatus, "Choose at least one student.");
      return;
    }
    if (recipients.length === 0) {
      setStatus(shareStatus, "Add at least one teacher email.");
      return;
    }
    if (selected.size > MAX_SHARE_STUDENTS) {
      setStatus(shareStatus, `Share up to ${MAX_SHARE_STUDENTS} students at a time.`);
      return;
    }
    const studentIds = deps.students.map((s) => s.studentId).filter((id) => selected.has(id));
    const granteeEmails = [...recipients];
    shareButton.setAttribute("aria-busy", "true");
    setBusy(true);
    setStatus(shareStatus, "Sharing…");
    deps.seam
      .grantMany({ classId: deps.classId, studentIds, granteeEmails })
      .then(
        (results) => {
          if (!deps.isConnected()) return;
          const shared = results.filter((r) => r.outcome === "shared").length;
          const already = results.filter((r) => r.outcome === "alreadyShared").length;
          const failed = results.filter((r) => r.outcome === "failed");
          const parts = [`Shared ${shared}.`, `Already shared ${already}.`];
          if (failed.length > 0) parts.push(`Failed ${failed.length}.`);
          // Keep only the students and emails in a failed pair so the teacher
          // can correct them. Sharing again sends every checked student with
          // every listed email; when that includes pairs that just succeeded,
          // say so (the server reports them as Already shared).
          const failedStudents = new Set(failed.map((r) => r.studentId));
          const failedEmails = new Set(failed.map((r) => r.granteeEmail));
          for (const id of [...selected]) if (!failedStudents.has(id)) selected.delete(id);
          recipients = recipients.filter((e) => failedEmails.has(e));
          const retryPairs = selected.size * recipients.length;
          if (failed.length > 0) {
            parts.push(
              retryPairs > failed.length
                ? `The students and emails that failed are still selected. Sharing again also resends ${plural(retryPairs - failed.length, "pair", "pairs")} that already worked; those show as Already shared.`
                : "The students and emails that failed are still selected.",
            );
          }
          setStatus(
            shareStatus,
            parts.join(" "),
            failed.map((r) => `${nameOf.get(r.studentId) ?? "Student"} - ${r.granteeEmail}: ${failureMessage(r.reason)}`),
          );
          syncCheckboxes();
          renderRecipients();
          if (shared > 0) return refreshGrants();
          return undefined;
        },
        () => {
          if (!deps.isConnected()) return;
          setStatus(shareStatus, "We couldn't share access. Nothing was changed. Please try again.");
        },
      )
      .finally(() => {
        shareButton.removeAttribute("aria-busy");
        setBusy(false);
      });
  };
  shareButton.addEventListener("click", submitShare);

  const setBusy = (next: boolean): void => {
    busy = next;
    updateCounts();
    renderGrants();
  };

  // Moves focus to an access-list control after a redraw replaced it: the
  // control `testId` inside the element whose `attr` is `value`, else the
  // list header.
  const focusIn = (testId: string, attr?: "data-teacher-key" | "data-grant-id", value?: string): void => {
    const scope =
      attr === undefined
        ? grantList
        : Array.from(grantList.querySelectorAll<HTMLElement>(`[${attr}]`)).find((el) => el.getAttribute(attr) === value);
    const el = scope?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null;
    if (el !== null) el.focus();
    else grantsToggle.focus();
  };

  type RevokeTarget = {
    readonly teacher: RecipientTeacher;
    // One student's grant (Remove access), or null for the whole teacher.
    readonly grant: SupportGrant | null;
  };

  // Revokes the given grants (all belong to `target.teacher` in this class)
  // through `supportAccessRevokeMany`, which authorizes each grant on the
  // server. Batches stay within the server cap. Each outcome is reported;
  // what failed keeps its access and can be tried again.
  const runRevoke = (target: RevokeTarget, grantIds: ReadonlyArray<string>): void => {
    if (busy || grantIds.length === 0) return;
    const name = target.teacher.displayName;
    const studentName = (id: string): string =>
      grants.find((g) => g.grantId === id)?.studentDisplayName ??
      target.teacher.grants.find((g) => g.grantId === id)?.studentDisplayName ??
      "Student";
    setStatus(grantStatus, "Removing access…");
    setBusy(true);
    const batches: string[][] = [];
    for (let i = 0; i < grantIds.length; i += MAX_REVOKE_GRANTS) batches.push(grantIds.slice(i, i + MAX_REVOKE_GRANTS));
    const results: SupportRevokeManyResult[] = [];
    let chain: Promise<void> = Promise.resolve();
    for (const batch of batches) {
      chain = chain.then(() =>
        deps.seam.revokeMany(batch).then(
          (r) => {
            results.push(...r);
          },
          (err: unknown) => {
            // A batch the server never answered: none of it is known removed.
            if (results.length === 0) throw err;
            for (const grantId of batch) results.push({ grantId, outcome: "failed" });
          },
        ),
      );
    }
    chain
      .then(
        () => {
          if (!deps.isConnected()) return undefined;
          confirming = null;
          const answered = new Set(results.map((r) => r.grantId));
          const failed = [
            ...results.filter((r) => r.outcome === "failed").map((r) => r.grantId),
            // A grant the response left out was not confirmed removed.
            ...grantIds.filter((id) => !answered.has(id)),
          ];
          const removed = grantIds.length - failed.length;
          if (failed.length === 0) {
            setStatus(
              grantStatus,
              target.grant === null
                ? `Removed ${name}'s access to ${plural(removed, "student", "students")}.`
                : `Removed ${name}'s access to ${target.grant.studentDisplayName}.`,
            );
          } else if (removed === 0) {
            setStatus(
              grantStatus,
              target.grant === null
                ? `We couldn't remove ${name}'s access. Nothing was changed. Please try again.`
                : `We couldn't remove ${name}'s access to ${target.grant.studentDisplayName}. Nothing was changed. Please try again.`,
            );
            appendRetry(target, failed);
          } else {
            setStatus(
              grantStatus,
              `Removed ${name}'s access to ${removed} of ${plural(grantIds.length, "student", "students")}. ${name} still has access to:`,
              failed.map(studentName),
            );
            appendRetry(target, failed);
          }
          return refreshGrants();
        },
        () => {
          if (!deps.isConnected()) return;
          confirming = null;
          setStatus(
            grantStatus,
            target.grant === null
              ? `We couldn't remove ${name}'s access. Nothing was changed. Please try again.`
              : `We couldn't remove ${name}'s access to ${target.grant.studentDisplayName}. Nothing was changed. Please try again.`,
          );
          appendRetry(target, grantIds);
        },
      )
      .finally(() => {
        setBusy(false);
        if (!deps.isConnected()) return;
        // The teacher's row, if any access remains; else the list header.
        focusIn(target.grant === null ? "ss-access-remove-teacher" : "ss-access-teacher-toggle", "data-teacher-key", target.teacher.key);
      });
  };

  // "Try again" for removals that did not happen. The teacher already
  // confirmed, so it re-runs the same removal for what is left.
  const appendRetry = (target: RevokeTarget, grantIds: ReadonlyArray<string>): void => {
    const retry = doc.createElement("button");
    retry.type = "button";
    retry.className = "shell-ss-ra-action";
    retry.setAttribute("data-testid", "ss-access-retry");
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      const live = new Set(grants.map((g) => g.grantId));
      runRevoke(target, grantsState === "loaded" ? grantIds.filter((id) => live.has(id)) : grantIds);
    });
    grantStatus.appendChild(retry);
  };

  const confirmBox = (
    testId: string,
    message: string,
    confirmLabel: string,
    onConfirm: () => void,
    onCancel: () => void,
  ): HTMLElement => {
    const box = doc.createElement("div");
    box.className = "shell-ss-confirm shell-ss-access-confirm";
    box.setAttribute("data-testid", testId);
    box.setAttribute("role", "alertdialog");
    const msgId = `${testId}-msg`;
    box.setAttribute("aria-labelledby", msgId);
    const msg = doc.createElement("p");
    msg.id = msgId;
    msg.textContent = message;
    const actions = doc.createElement("div");
    actions.className = "shell-ss-access-confirm-actions";
    const yes = doc.createElement("button");
    yes.type = "button";
    yes.className = "shell-ss-ra-action shell-ss-ra-action--confirm";
    yes.setAttribute("data-testid", `${testId}-yes`);
    yes.textContent = busy ? "Removing…" : confirmLabel;
    yes.disabled = busy;
    if (busy) yes.setAttribute("aria-busy", "true");
    yes.addEventListener("click", onConfirm);
    const no = doc.createElement("button");
    no.type = "button";
    no.className = "shell-ss-ra-action";
    no.setAttribute("data-testid", `${testId}-cancel`);
    no.textContent = "Cancel";
    no.disabled = busy;
    no.addEventListener("click", onCancel);
    actions.append(yes, no);
    box.append(msg, actions);
    return box;
  };

  const renderTeacher = (teacher: RecipientTeacher, index: number): HTMLElement => {
    const li = doc.createElement("li");
    li.className = "shell-ss-access-teacher";
    li.setAttribute("data-testid", "ss-access-teacher");
    li.setAttribute("data-teacher-key", teacher.key);
    const expanded = expandedTeachers.has(teacher.key);
    const listId = `ss-access-students-${index}`;
    const count = plural(teacher.grants.length, "student", "students");

    const row = doc.createElement("div");
    row.className = "shell-ss-access-teacher-row";
    const toggle = doc.createElement("button");
    toggle.type = "button";
    toggle.className = "shell-ss-access-toggle";
    toggle.setAttribute("data-testid", "ss-access-teacher-toggle");
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.setAttribute("aria-controls", listId);
    const nameEl = doc.createElement("span");
    nameEl.className = "shell-ss-access-name";
    nameEl.setAttribute("data-testid", "ss-access-teacher-name");
    nameEl.textContent = teacher.displayName;
    const meta = doc.createElement("span");
    meta.className = "shell-ss-access-meta";
    if (teacher.email !== null) {
      const email = doc.createElement("span");
      email.className = "shell-ss-access-email";
      email.setAttribute("data-testid", "ss-access-teacher-email");
      email.textContent = teacher.email;
      meta.appendChild(email);
    }
    const countEl = doc.createElement("span");
    countEl.className = "shell-ss-access-count";
    countEl.setAttribute("data-testid", "ss-access-teacher-count");
    countEl.textContent = count;
    meta.appendChild(countEl);
    toggle.append(nameEl, meta);
    toggle.addEventListener("click", () => {
      if (expandedTeachers.has(teacher.key)) expandedTeachers.delete(teacher.key);
      else expandedTeachers.add(teacher.key);
      renderGrants();
      focusIn("ss-access-teacher-toggle", "data-teacher-key", teacher.key);
    });

    const removeTeacher = doc.createElement("button");
    removeTeacher.type = "button";
    removeTeacher.className = "shell-classes-settings-support-revoke";
    removeTeacher.setAttribute("data-testid", "ss-access-remove-teacher");
    removeTeacher.setAttribute("aria-label", `Remove teacher ${teacherLabel(teacher)}`);
    removeTeacher.textContent = "Remove teacher";
    removeTeacher.disabled = busy;
    removeTeacher.addEventListener("click", () => {
      if (busy) return;
      confirming = { kind: "teacher", key: teacher.key };
      renderGrants();
      focusIn("ss-access-teacher-confirm-cancel");
    });
    row.append(toggle, removeTeacher);
    li.appendChild(row);

    if (confirming?.kind === "teacher" && confirming.key === teacher.key) {
      const target: RevokeTarget = { teacher, grant: null };
      li.appendChild(
        confirmBox(
          "ss-access-teacher-confirm",
          teacher.grants.length === 1
            ? `Remove ${teacherLabel(teacher)}? Their access to 1 student in this class will be removed, and they will no longer see this student's assignments or assessment results. The student stays in your class, and the teacher's account is not changed.`
            : `Remove ${teacherLabel(teacher)}? Their access to ${count} in this class will be removed, and they will no longer see these students' assignments or assessment results. The students stay in your class, and the teacher's account is not changed.`,
          "Remove teacher",
          () => runRevoke(target, teacher.grants.map((g) => g.grantId)),
          () => {
            if (busy) return;
            confirming = null;
            renderGrants();
            focusIn("ss-access-remove-teacher", "data-teacher-key", teacher.key);
          },
        ),
      );
    }

    const students = doc.createElement("ul");
    students.id = listId;
    students.className = "shell-ss-access-students";
    students.setAttribute("data-testid", "ss-access-students");
    students.setAttribute("aria-label", `Students shared with ${teacher.displayName}`);
    students.hidden = !expanded;
    for (const grant of teacher.grants) {
      const sli = doc.createElement("li");
      sli.className = "shell-ss-access-student";
      sli.setAttribute("data-testid", "ss-access-student");
      sli.setAttribute("data-grant-id", grant.grantId);
      const sname = doc.createElement("span");
      sname.className = "shell-ss-access-student-name";
      sname.textContent = grant.studentDisplayName;
      const remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "shell-classes-settings-support-revoke";
      remove.setAttribute("data-testid", "ss-access-remove-student");
      remove.setAttribute("aria-label", `Remove ${teacher.displayName}'s access to ${grant.studentDisplayName}`);
      remove.textContent = "Remove access";
      remove.disabled = busy;
      remove.addEventListener("click", () => {
        if (busy) return;
        confirming = { kind: "student", grantId: grant.grantId };
        renderGrants();
        focusIn("ss-access-student-confirm-cancel");
      });
      sli.append(sname, remove);
      if (confirming?.kind === "student" && confirming.grantId === grant.grantId) {
        const target: RevokeTarget = { teacher, grant };
        sli.appendChild(
          confirmBox(
            "ss-access-student-confirm",
            `Remove access to ${grant.studentDisplayName} for ${teacherLabel(teacher)}? Only this student's shared access is removed. ${grant.studentDisplayName} stays in your class, and ${teacher.displayName} keeps access to any other students you shared.`,
            "Remove access",
            () => runRevoke(target, [grant.grantId]),
            () => {
              if (busy) return;
              confirming = null;
              renderGrants();
              focusIn("ss-access-remove-student", "data-grant-id", grant.grantId);
            },
          ),
        );
      }
      students.appendChild(sli);
    }
    li.appendChild(students);
    return li;
  };

  const renderGrants = (): void => {
    const teachers = groupGrantsByTeacher(deps.classId, grants);
    grantsToggle.textContent =
      grantsState === "loaded"
        ? `Teachers with access (${teachers.length})`
        : grantsState === "error"
          ? "Teachers with access (couldn't load)"
          : "Teachers with access";
    grantList.replaceChildren();
    if (grantsState === "loading" || grantsState === "error") {
      const li = doc.createElement("li");
      li.className = "shell-classes-settings-support-empty";
      li.setAttribute("data-testid", grantsState === "loading" ? "ss-share-grants-loading" : "ss-share-grants-error");
      li.textContent = grantsState === "loading" ? "Loading shared access…" : "We couldn't load shared access. ";
      if (grantsState === "error") {
        const retry = doc.createElement("button");
        retry.type = "button";
        retry.className = "shell-ss-ra-action";
        retry.setAttribute("data-testid", "ss-share-grants-retry");
        retry.textContent = "Try again";
        retry.disabled = busy;
        retry.addEventListener("click", () => {
          if (busy) return;
          grantsState = "loading";
          renderGrants();
          void refreshGrants();
        });
        li.appendChild(retry);
      }
      grantList.appendChild(li);
      return;
    }
    if (teachers.length === 0) {
      const empty = doc.createElement("li");
      empty.className = "shell-classes-settings-support-empty";
      empty.setAttribute("data-testid", "ss-share-grants-empty");
      empty.textContent = "You haven't shared any students in this class.";
      grantList.appendChild(empty);
      return;
    }
    // A teacher or grant that is gone after a refresh drops its open state.
    const keys = new Set(teachers.map((t) => t.key));
    for (const key of [...expandedTeachers]) if (!keys.has(key)) expandedTeachers.delete(key);
    const pending = confirming;
    if (pending !== null && (pending.kind === "teacher" ? !keys.has(pending.key) : !grants.some((g) => g.grantId === pending.grantId))) {
      confirming = null;
    }
    teachers.forEach((teacher, i) => grantList.appendChild(renderTeacher(teacher, i)));
  };

  updateCounts();
  renderGrants();
  void refreshGrants();
  return section;
}

export function renderSharedStudentsSection(
  doc: Document,
  students: ReadonlyArray<SharedStudent>,
  onOpen: (student: SharedStudent) => void,
): HTMLElement {
  const section = doc.createElement("section");
  section.className = "shell-classes-shared";
  section.setAttribute("data-testid", "classes-shared-students");
  section.setAttribute("aria-labelledby", "classes-shared-heading");

  const heading = doc.createElement("h3");
  heading.id = "classes-shared-heading";
  heading.className = "shell-classes-shared-heading";
  heading.textContent = "Shared students";
  section.appendChild(heading);

  const help = doc.createElement("p");
  help.className = "shell-classes-shared-help";
  help.textContent = "Other teachers shared these students' results with you. View only.";
  section.appendChild(help);

  const list = doc.createElement("ul");
  list.className = "shell-classes-shared-list";
  for (const student of students) {
    const li = doc.createElement("li");
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "shell-classes-shared-student";
    button.setAttribute("data-testid", "classes-shared-student");
    button.setAttribute("data-grant-id", student.grantId);
    const name = doc.createElement("span");
    name.className = "shell-classes-shared-name";
    name.textContent = student.studentDisplayName;
    const meta = doc.createElement("span");
    meta.className = "shell-classes-shared-meta";
    meta.textContent = sharedStudentContextLabel(student);
    button.append(name, meta);
    button.addEventListener("click", () => onOpen(student));
    li.appendChild(button);
    list.appendChild(li);
  }
  section.appendChild(list);
  return section;
}

// Shared students read failed (V2 P3): said plainly, with a working retry,
// rather than shown as "nobody shared anything with you".
export function renderSharedStudentsError(doc: Document, onRetry: () => void): HTMLElement {
  const region = doc.createElement("div");
  region.className = "shell-classes-shared";
  region.setAttribute("data-testid", "shared-students-error");
  const msg = doc.createElement("p");
  msg.className = "shell-status";
  msg.setAttribute("role", "status");
  msg.textContent = "We could not load students shared with you.";
  const retry = doc.createElement("button");
  retry.type = "button";
  retry.className = "shell-btn";
  retry.setAttribute("data-testid", "shared-students-retry");
  retry.textContent = "Try again";
  retry.addEventListener("click", () => onRetry());
  region.append(msg, retry);
  return region;
}

export type StudentSupportLandingInput = {
  readonly students: ReadonlyArray<SharedStudent>;
  // `loaded` with no students: every grant was revoked during this visit.
  readonly status: "loading" | "loaded" | "error";
  readonly onOpen: (student: SharedStudent) => void;
  readonly onRetry: () => void;
};

// Student Support Workspace (V2 P3): a support-only teacher's landing page,
// in the Classes outlet. The same shared-student list (and Student Detail
// behind it) as the Classes section; only the framing differs.
export function renderStudentSupportLanding(
  doc: Document,
  mount: HTMLElement,
  input: StudentSupportLandingInput,
): void {
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = "Student Support";
  mount.appendChild(headline);

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "support-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  mount.appendChild(status);

  if (input.status === "error") {
    status.textContent = "";
    mount.appendChild(renderSharedStudentsError(doc, input.onRetry));
    return;
  }
  if (input.status === "loading" && input.students.length === 0) {
    status.textContent = "Loading students";
    return;
  }
  if (input.students.length === 0) {
    status.textContent = "No students are shared with you right now.";
    const help = doc.createElement("p");
    help.className = "shell-classes-shared-help";
    help.setAttribute("data-testid", "support-empty");
    help.textContent = "When a classroom teacher shares a student with you, the student appears here.";
    mount.appendChild(help);
    return;
  }
  status.textContent = input.students.length === 1 ? "1 student" : `${input.students.length} students`;
  const section = renderSharedStudentsSection(doc, input.students, input.onOpen);
  section.setAttribute("data-testid", "support-students");
  // The page headline already names the list.
  section.removeAttribute("aria-labelledby");
  section.setAttribute("aria-label", "Shared students");
  section.querySelector(".shell-classes-shared-heading")?.remove();
  section.querySelector(".shell-classes-shared-help")?.remove();
  mount.appendChild(section);
}
