import {
  type SharedStudent,
  type StudentSupportSeam,
  type SupportGrant,
  type SupportGrantFailureReason,
} from "../../supportAccess/types";

// Student Support Access (PDR-032, STUDENT_SUPPORT_ACCESS.md section 7).
//
// 1. `renderShareStudentProgressSection`: the class owner's "Share Student
//    Progress" section in Settings > Student Services, for the class chosen
//    there. Check students, add one or more support teachers' emails, and
//    share in one `supportAccessGrantMany` call; review active grants and
//    remove one (`supportAccessRevoke`) or several (`supportAccessRevokeMany`,
//    after confirmation). Every change takes effect when the server confirms
//    it; there is no Save. Results report each outcome, including partial
//    failures, and the grant list is re-read from the server afterwards.
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

export function renderShareStudentProgressSection(
  doc: Document,
  deps: ShareStudentProgressDeps,
): HTMLElement {
  const section = doc.createElement("section");
  section.className = "shell-ss-share";
  section.setAttribute("data-testid", "ss-share-section");
  section.setAttribute("aria-labelledby", "ss-share-heading");

  const heading = doc.createElement("h3");
  heading.id = "ss-share-heading";
  heading.className = "shell-settings-section-heading";
  heading.textContent = "Share Student Progress";
  section.appendChild(heading);

  const desc = doc.createElement("p");
  desc.className = "shell-ss-section-desc";
  desc.textContent =
    "Give other teachers at your school read-only access to students' assignments and assessment results. Changes take effect right away.";
  section.appendChild(desc);

  const selected = new Set<string>();
  let recipients: string[] = [];
  let grants: ReadonlyArray<SupportGrant> = [];
  let grantsState: "loading" | "error" | "loaded" = "loading";
  const selectedGrants = new Set<string>();
  let confirmingBulk = false;
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
  section.appendChild(studentsGroup);

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
  emailRow.className = "shell-ss-share-tools";
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
  recipientCount.className = "shell-ss-share-count";
  recipientCount.setAttribute("data-testid", "ss-share-recipient-count");
  recipientCount.setAttribute("aria-live", "polite");
  recipientsGroup.appendChild(recipientCount);
  section.appendChild(recipientsGroup);

  const shareButton = doc.createElement("button");
  shareButton.type = "button";
  shareButton.className = "shell-class-rostersync-button";
  shareButton.setAttribute("data-testid", "ss-share-submit");
  shareButton.textContent = "Share Access";
  section.appendChild(shareButton);

  const shareStatus = doc.createElement("div");
  shareStatus.className = "shell-ss-share-status";
  shareStatus.setAttribute("data-testid", "ss-share-status");
  shareStatus.setAttribute("role", "status");
  shareStatus.setAttribute("aria-live", "polite");
  section.appendChild(shareStatus);

  // --- Existing grants ---
  const grantsHeading = doc.createElement("h4");
  grantsHeading.className = "shell-ss-share-subheading";
  grantsHeading.textContent = "Shared access";
  section.appendChild(grantsHeading);

  const grantTools = doc.createElement("div");
  grantTools.className = "shell-ss-share-tools";
  section.appendChild(grantTools);

  const grantList = doc.createElement("ul");
  grantList.className = "shell-classes-settings-support-list";
  grantList.setAttribute("data-testid", "ss-share-grants");
  grantList.setAttribute("aria-label", "Students shared with other teachers");
  section.appendChild(grantList);

  const grantStatus = doc.createElement("div");
  grantStatus.className = "shell-ss-share-status";
  grantStatus.setAttribute("data-testid", "ss-share-grant-status");
  grantStatus.setAttribute("role", "status");
  grantStatus.setAttribute("aria-live", "polite");
  section.appendChild(grantStatus);

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
    shareButton.disabled = busy;
  };

  const refreshGrants = (): Promise<void> =>
    deps.seam.listForClass(deps.classId).then(
      (loaded) => {
        grants = loaded;
        grantsState = "loaded";
        for (const id of [...selectedGrants]) {
          if (!grants.some((g) => g.grantId === id)) selectedGrants.delete(id);
        }
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
    busy = true;
    shareButton.setAttribute("aria-busy", "true");
    updateCounts();
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
        busy = false;
        shareButton.removeAttribute("aria-busy");
        updateCounts();
      });
  };
  shareButton.addEventListener("click", submitShare);

  const runRevoke = (grantIds: ReadonlyArray<string>): void => {
    if (busy || grantIds.length === 0) return;
    busy = true;
    confirmingBulk = false;
    renderGrants();
    updateCounts();
    setStatus(grantStatus, "Removing…");
    const call =
      grantIds.length === 1
        ? deps.seam.revoke(grantIds[0]!).then(() => [{ grantId: grantIds[0]!, outcome: "revoked" as const }])
        : deps.seam.revokeMany(grantIds);
    call
      .then(
        (results) => {
          if (!deps.isConnected()) return undefined;
          const revoked = results.filter((r) => r.outcome === "revoked").length;
          const already = results.filter((r) => r.outcome === "alreadyRevoked").length;
          const failed = results.filter((r) => r.outcome === "failed");
          const parts = [`Removed ${revoked}.`];
          if (already > 0) parts.push(`Already removed ${already}.`);
          if (failed.length > 0) parts.push(`Failed ${failed.length}.`);
          const labelOf = (id: string): string => {
            const g = grants.find((x) => x.grantId === id);
            return g === undefined ? "Shared access" : `${g.studentDisplayName} - ${g.granteeDisplayName}`;
          };
          setStatus(grantStatus, parts.join(" "), failed.map((r) => `${labelOf(r.grantId)}: couldn't be removed`));
          for (const r of results) if (r.outcome !== "failed") selectedGrants.delete(r.grantId);
          return refreshGrants();
        },
        () => {
          if (!deps.isConnected()) return;
          setStatus(grantStatus, "We couldn't remove access. Nothing was changed. Please try again.");
        },
      )
      .finally(() => {
        busy = false;
        renderGrants();
        updateCounts();
      });
  };

  const renderGrants = (): void => {
    grantTools.replaceChildren();
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
        retry.addEventListener("click", () => {
          grantsState = "loading";
          renderGrants();
          void refreshGrants();
        });
        li.appendChild(retry);
      }
      grantList.appendChild(li);
      return;
    }
    if (grants.length === 0) {
      const empty = doc.createElement("li");
      empty.className = "shell-classes-settings-support-empty";
      empty.setAttribute("data-testid", "ss-share-grants-empty");
      empty.textContent = "You haven't shared any students in this class.";
      grantList.appendChild(empty);
      return;
    }

    if (confirmingBulk) {
      const confirm = doc.createElement("div");
      confirm.className = "shell-ss-confirm";
      confirm.setAttribute("data-testid", "ss-share-revoke-confirm");
      confirm.setAttribute("role", "alertdialog");
      const msg = doc.createElement("p");
      msg.textContent = `Remove access for ${selectedGrants.size} selected? Those teachers lose access right away.`;
      const yes = doc.createElement("button");
      yes.type = "button";
      yes.className = "shell-ss-ra-action shell-ss-ra-action--confirm";
      yes.setAttribute("data-testid", "ss-share-revoke-confirm-yes");
      yes.textContent = "Remove";
      yes.addEventListener("click", () => runRevoke(grants.map((g) => g.grantId).filter((id) => selectedGrants.has(id))));
      const no = doc.createElement("button");
      no.type = "button";
      no.className = "shell-ss-ra-action";
      no.setAttribute("data-testid", "ss-share-revoke-confirm-cancel");
      no.textContent = "Cancel";
      no.addEventListener("click", () => {
        confirmingBulk = false;
        renderGrants();
      });
      confirm.append(msg, yes, no);
      grantTools.appendChild(confirm);
    } else {
      const bulk = doc.createElement("button");
      bulk.type = "button";
      bulk.className = "shell-ss-ra-action";
      bulk.setAttribute("data-testid", "ss-share-revoke-selected");
      bulk.textContent = `Remove selected (${selectedGrants.size})`;
      bulk.disabled = busy || selectedGrants.size === 0;
      bulk.addEventListener("click", () => {
        if (busy || selectedGrants.size === 0) return;
        if (selectedGrants.size > MAX_REVOKE_GRANTS) {
          setStatus(grantStatus, `Remove up to ${MAX_REVOKE_GRANTS} at a time.`);
          return;
        }
        confirmingBulk = true;
        renderGrants();
      });
      grantTools.appendChild(bulk);
    }

    for (const grant of grants) {
      const li = doc.createElement("li");
      li.className = "shell-classes-settings-support-grant";
      li.setAttribute("data-testid", "ss-share-grant-row");
      li.setAttribute("data-grant-id", grant.grantId);
      const label = doc.createElement("label");
      label.className = "shell-ss-share-grant-label";
      const box = doc.createElement("input");
      box.type = "checkbox";
      box.checked = selectedGrants.has(grant.grantId);
      box.disabled = busy;
      box.setAttribute("data-testid", "ss-share-grant-check");
      box.addEventListener("change", () => {
        if (box.checked) selectedGrants.add(grant.grantId);
        else selectedGrants.delete(grant.grantId);
        confirmingBulk = false;
        renderGrants();
      });
      const who = grant.granteeEmail === null ? grant.granteeDisplayName : `${grant.granteeDisplayName} (${grant.granteeEmail})`;
      const text = doc.createElement("span");
      text.textContent = `${grant.studentDisplayName} - ${who}`;
      const status = doc.createElement("span");
      status.className = "shell-ss-share-grant-status";
      status.textContent = "Active";
      label.append(box, text, status);
      li.appendChild(label);
      const remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "shell-classes-settings-support-revoke";
      remove.setAttribute("data-testid", "ss-share-grant-remove");
      remove.setAttribute("aria-label", `Remove ${grant.granteeDisplayName}'s access to ${grant.studentDisplayName}`);
      remove.textContent = "Remove";
      remove.disabled = busy;
      remove.addEventListener("click", () => runRevoke([grant.grantId]));
      li.appendChild(remove);
      grantList.appendChild(li);
    }
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
    meta.textContent = `${student.classTitle} · ${student.ownerDisplayName}`;
    button.append(name, meta);
    button.addEventListener("click", () => onOpen(student));
    li.appendChild(button);
    list.appendChild(li);
  }
  section.appendChild(list);
  return section;
}
