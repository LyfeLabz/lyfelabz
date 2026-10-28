import type { ClassRosterStudent } from "../../classes/classRoster";
import {
  supportAccessErrorCode,
  type SharedStudent,
  type StudentSupportSeam,
  type SupportGrant,
} from "../../supportAccess/types";

// Student Support Access (PDR-032, STUDENT_SUPPORT_ACCESS.md section 7).
//
// 1. `renderSupportAccessSection`: the class owner's "Support access" section
//    inside Class settings. Choose a student, enter a support educator's
//    school email, grant; see active grants; revoke. Every action is an
//    independent, non-submit control: it never triggers the settings Save.
// 2. `renderSharedStudentsSection`: the support educator's "Shared students"
//    list on the Classes surface. Choosing a student opens the existing
//    Student Detail in read-only mode (wired by classes.ts).
//
// Neither is a security control; the server authorizes every call.

export type SupportAccessSectionDeps = {
  readonly classId: string;
  readonly seam: StudentSupportSeam;
  readonly loadRoster: () => Promise<ReadonlyArray<ClassRosterStudent>>;
};

function grantErrorMessage(err: unknown): string {
  switch (supportAccessErrorCode(err)) {
    case "supportAccess.granteeUnavailable":
      return "No other active teacher at your school uses that email. Check the address and try again.";
    case "supportAccess.studentNotEnrolled":
      return "That student is no longer active in this class.";
    case "supportAccess.invalidRequest":
      return "Enter a school email address.";
    default:
      return "We couldn't share access. Please try again.";
  }
}

export function renderSupportAccessSection(
  doc: Document,
  deps: SupportAccessSectionDeps,
): HTMLElement {
  const section = doc.createElement("div");
  section.className = "shell-classes-settings-support";
  section.setAttribute("data-testid", "classes-settings-support");

  const sectionLabel = doc.createElement("span");
  sectionLabel.className = "shell-classes-settings-section-label";
  sectionLabel.textContent = "Support access";
  section.appendChild(sectionLabel);

  const help = doc.createElement("p");
  help.className = "shell-classes-settings-support-help";
  help.textContent =
    "Let another teacher at your school view one student's results, read-only. You can remove access at any time.";
  section.appendChild(help);

  const list = doc.createElement("ul");
  list.className = "shell-classes-settings-support-list";
  list.setAttribute("data-testid", "classes-settings-support-list");
  list.setAttribute("aria-label", "Teachers with support access");
  section.appendChild(list);

  const studentLabel = doc.createElement("label");
  studentLabel.textContent = "Student";
  const studentSelect = doc.createElement("select");
  studentSelect.setAttribute("data-testid", "classes-settings-support-student");
  studentSelect.disabled = true;
  const placeholder = doc.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Loading students…";
  studentSelect.appendChild(placeholder);
  studentLabel.appendChild(studentSelect);
  section.appendChild(studentLabel);

  const emailLabel = doc.createElement("label");
  emailLabel.textContent = "Teacher's school email";
  const emailInput = doc.createElement("input");
  emailInput.type = "email";
  emailInput.autocomplete = "off";
  emailInput.maxLength = 320;
  emailInput.setAttribute("data-testid", "classes-settings-support-email");
  emailLabel.appendChild(emailInput);
  section.appendChild(emailLabel);

  const grantButton = doc.createElement("button");
  grantButton.type = "button";
  grantButton.className = "shell-class-rostersync-button";
  grantButton.setAttribute("data-testid", "classes-settings-support-grant");
  grantButton.textContent = "Share access";
  section.appendChild(grantButton);

  const status = doc.createElement("p");
  status.className = "shell-class-rostersync-status";
  status.setAttribute("data-testid", "classes-settings-support-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  section.appendChild(status);

  let grants: ReadonlyArray<SupportGrant> = [];
  let busy = false;

  const renderGrants = (): void => {
    list.replaceChildren();
    if (grants.length === 0) {
      const empty = doc.createElement("li");
      empty.className = "shell-classes-settings-support-empty";
      empty.setAttribute("data-testid", "classes-settings-support-empty");
      empty.textContent = "No one else has access to students in this class.";
      list.appendChild(empty);
      return;
    }
    for (const grant of grants) {
      const li = doc.createElement("li");
      li.className = "shell-classes-settings-support-grant";
      li.setAttribute("data-testid", "classes-settings-support-grant-row");
      li.setAttribute("data-grant-id", grant.grantId);
      const text = doc.createElement("span");
      const who = grant.granteeEmail === null ? grant.granteeDisplayName : `${grant.granteeDisplayName} (${grant.granteeEmail})`;
      text.textContent = `${grant.studentDisplayName}: ${who}`;
      li.appendChild(text);
      const revoke = doc.createElement("button");
      revoke.type = "button";
      revoke.className = "shell-classes-settings-support-revoke";
      revoke.setAttribute("data-testid", "classes-settings-support-revoke");
      revoke.setAttribute("aria-label", `Remove ${grant.granteeDisplayName}'s access to ${grant.studentDisplayName}`);
      revoke.textContent = "Remove";
      revoke.addEventListener("click", () => {
        if (busy) return;
        busy = true;
        revoke.disabled = true;
        status.textContent = "";
        deps.seam.revoke(grant.grantId).then(
          () => {
            grants = grants.filter((g) => g.grantId !== grant.grantId);
            renderGrants();
            status.textContent = `Removed ${grant.granteeDisplayName}'s access to ${grant.studentDisplayName}.`;
          },
          () => {
            revoke.disabled = false;
            status.textContent = "We couldn't remove access. Please try again.";
          },
        ).finally(() => {
          busy = false;
        });
      });
      li.appendChild(revoke);
      list.appendChild(li);
    }
  };

  const submitGrant = (): void => {
    if (busy) return;
    const studentId = studentSelect.value;
    const email = emailInput.value.trim();
    if (studentId === "") {
      status.textContent = "Choose a student.";
      return;
    }
    if (email === "") {
      status.textContent = "Enter a school email address.";
      return;
    }
    busy = true;
    grantButton.disabled = true;
    grantButton.setAttribute("aria-busy", "true");
    status.textContent = "";
    deps.seam.grant({ classId: deps.classId, studentId, granteeEmail: email }).then(
      (grant) => {
        grants = [...grants.filter((g) => g.grantId !== grant.grantId), grant].sort((a, b) =>
          a.studentDisplayName.localeCompare(b.studentDisplayName),
        );
        renderGrants();
        emailInput.value = "";
        status.textContent = `${grant.granteeDisplayName} can now view ${grant.studentDisplayName}'s results.`;
      },
      (err: unknown) => {
        status.textContent = grantErrorMessage(err);
      },
    ).finally(() => {
      busy = false;
      grantButton.disabled = false;
      grantButton.removeAttribute("aria-busy");
    });
  };

  grantButton.addEventListener("click", submitGrant);
  // Enter in the email field shares access instead of submitting (saving)
  // the surrounding Class settings form.
  emailInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      submitGrant();
    }
  });

  deps.loadRoster().then(
    (students) => {
      studentSelect.replaceChildren();
      const prompt = doc.createElement("option");
      prompt.value = "";
      prompt.textContent = students.length === 0 ? "No active students" : "Choose a student";
      studentSelect.appendChild(prompt);
      for (const s of students) {
        const option = doc.createElement("option");
        option.value = s.studentId;
        option.textContent = s.studentDisplayName;
        studentSelect.appendChild(option);
      }
      studentSelect.disabled = students.length === 0;
    },
    () => {
      placeholder.textContent = "Couldn't load students";
    },
  );
  deps.seam.listForClass(deps.classId).then(
    (loaded) => {
      grants = loaded;
      renderGrants();
    },
    () => {
      status.textContent = "We couldn't load support access. Close and reopen to try again.";
    },
  );

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
