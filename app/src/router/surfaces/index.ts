import type { RouteSurface } from "../router";
import type { ListClasses } from "../../classes/listClasses";
import type { CreateClass } from "../../classes/createClass";
import type { ActivateClass } from "../../classes/activateClass";
import type { SyncRoster } from "../../classes/syncRoster";
import type { ImportFromClassroomDeps } from "../../classes/importFromClassroom";
import type {
  AssignmentsCallables,
  IntegrationsDeps,
} from "../../settings/integrations/types";
import type { CurriculumAssignmentDetailSeam } from "../../shell/surfaces/curriculum";
import type {
  AssignmentSummaryCallable,
  LessonSummaryCallable,
} from "../../assignments/summary/types";
import type {
  AssignmentsListForStudentCallable,
  AssignmentsListForStudentItem,
} from "../../assignments/studentList/types";
import {
  planAssignmentLaunch,
  type LaunchPlan,
} from "../../assignments/studentList/launchRouting";
import type {
  StudentResultsListCallable,
  StudentResultAggregate,
} from "../../assignments/studentResults/types";
import { aggregateByAssignment } from "../../assignments/studentResults/aggregate";
// Sprint 28.6G: the canonical curriculum manifest is the single source of
// truth for a student card's science domain and its displayed lesson title.
// No second student-side domain/title registry is introduced.
import {
  getUnitBySlug,
  TOPIC_LABEL,
  type LessonTopic,
} from "../../curriculum/curriculumManifest";
import { mountTeacherShell } from "../../shell/shell";
import {
  clear,
  clearButtonPending,
  renderErrorBanner,
  renderHeader,
  renderHeadline,
  renderLegalLinks,
  renderLoadingIndicator,
  renderParagraph,
  renderPrimaryButton,
  renderReturnLink,
  renderSignOut,
  setButtonPending,
  SUPPORT_EMAIL,
  type OnSignOut,
} from "./shared";

// Route surface factory dependencies. Route surfaces receive these
// once from the entry point via createRouteTable so that the surfaces
// themselves stay pure DOM builders with no Firebase imports.
export type SurfaceDeps = {
  readonly onSignOut: OnSignOut;
  readonly onSignIn: () => Promise<void>;
  readonly onRefreshSession: () => Promise<void>;
  // Retained manual teacher-verification seam (Sprint 8-era). The curated
  // pilot onboarding path no longer routes through it (see
  // `onActivatePilotTeacher`), but the manual request/approve architecture
  // is preserved for possible future non-pilot onboarding, so the seam
  // stays wired.
  readonly onRequestVerification: (input: {
    readonly role: "teacher";
    readonly schoolId: string;
    readonly displayName: string;
  }) => Promise<void>;
  // Sprint 29G.5C direct allowlisted pilot-teacher activation. The teacher
  // onboarding branch calls this with no arguments: the server reads the
  // authenticated email, checks the protected pilot allowlist, assigns the
  // canonical pilot school, and activates the teacher. The client asserts
  // no name, school, or email. The entry point force-refreshes the ID token
  // after a successful call so the newly issued teacher claims are present
  // before the workspace loads. Wired to the `teachersActivatePilot`
  // callable.
  readonly onActivatePilotTeacher: () => Promise<void>;
  // Sprint 20 internal beta: student self-onboarding + first-class join.
  // The client calls `studentsCompleteOnboarding` then force-refreshes the
  // ID token so custom claims (role, schoolId, districtId) are present
  // before `enrollmentsJoinByCode` is invoked. See
  // platform/functions/src/students/students-complete-onboarding.ts and
  // platform/functions/src/enrollments/enrollments-join-by-code.ts.
  readonly onStudentOnboarding?: (input: {
    readonly displayName: string;
    readonly joinCode: string;
  }) => Promise<void>;
  // Sprint 27 Phase 3 (Decision 2): LMS-rostered student activation. The
  // client calls `studentsCompleteLmsOnboarding` (no join code, no
  // client-asserted school/class/provider identity) then force-refreshes
  // the ID token so the newly issued custom claims are present before the
  // active-student surface loads. The server derives school and district
  // entirely from the authoritative LMS enrollment the teacher's roster
  // sync established. The optional `displayName` is the only field the
  // client may supply, and the server falls back to the name recorded at
  // sign-in when it is omitted. See
  // platform/functions/src/students/students-complete-lms-onboarding.ts.
  readonly onStudentLmsOnboarding?: (input: {
    readonly displayName?: string;
  }) => Promise<void>;
  // Sprint 20 internal beta: best-effort Google profile displayName used
  // to prefill the student onboarding form. Returns null when the
  // authenticated user has no Google profile name.
  readonly getGoogleDisplayName?: () => string | null;
  readonly listClasses: ListClasses;
  // Sprint 6G: injected launch handler. See
  // src/presentMode/launchContext.ts.
  readonly onLaunchPresentMode: () => void;
  // Sprint 8C: Teacher Integrations dependencies. Null in tests; the
  // real entry point wires the LMS callable seam. Accepts a getter so
  // the entry point can re-establish per-session state across reruns
  // without rebuilding the route table. See LMS_EXPERIENCE.md and
  // PDR-020c.
  readonly integrations?: IntegrationsDeps | null | (() => IntegrationsDeps | null);
  // Sprint 8D.1: authoritative assignment lifecycle callable seam. Same
  // getter pattern as `integrations` so per-session state can rebind
  // across reruns without rebuilding the route table.
  readonly assignments?:
    | AssignmentsCallables
    | null
    | (() => AssignmentsCallables | null);
  // Sprint 13B remediation. Same getter pattern as `integrations` /
  // `assignments` so per-session state (registry, opener) can rebind
  // across reruns without rebuilding the route table.
  readonly assignmentDetail?:
    | CurriculumAssignmentDetailSeam
    | null
    | (() => CurriculumAssignmentDetailSeam | null);
  // Sprint 15: certified `assessmentAssignmentSummary` seam consumed by
  // the Active Assignments dashboard for per-card progress counts.
  // Always supplied through a getter so per-session state can rebind
  // across reruns without rebuilding the route table; the callable
  // itself is a function, so the getter-form is required to keep the
  // type check unambiguous.
  readonly assignmentSummary?: () => AssignmentSummaryCallable | null;
  // Sprint 28.6E: certified `assessmentLessonSummary` seam consumed by the
  // Curriculum lesson-card View Summary surface for lesson-level
  // (cross-assignment) aggregate analytics. Supplied through a getter for
  // the same per-session rebind reason as `assignmentSummary`.
  readonly lessonSummary?: () => LessonSummaryCallable | null;
  // Sprint 17 Slice 4: certified `assignmentsListForStudent` callable
  // seam consumed by the activeStudent surface. Always supplied through
  // a getter so per-session state can rebind across reruns without
  // rebuilding the route table; the callable itself is a function, so
  // the getter form is required to keep the type check unambiguous.
  readonly studentAssignmentsList?: () =>
    | AssignmentsListForStudentCallable
    | null;
  // Sprint 27 Phase 2 (Decision 1): caller-scoped `assessmentAttemptsList`
  // seam consumed by the activeStudent My Results surface. Always supplied
  // through a getter so per-session state can rebind across reruns without
  // rebuilding the route table; the callable itself is a function, so the
  // getter form is required to keep the type check unambiguous. This seam
  // targets ONLY the caller-scoped student read; the class-scoped teacher
  // read `assessmentAttemptsListForClass` is never wired here.
  readonly studentResultsList?: () => StudentResultsListCallable | null;
  // Sprint 17 Slice 4 / F5.2 Slice 5: launch a lesson from the activeStudent
  // surface. Receives the server-authoritative launch PLAN (canonical or
  // differentiated) composed inside the surface from the certified item fields;
  // the entry point wires the plan into the launch executor (navigate + variant
  // load-probe + fallback). Injected so tests can assert routing without
  // stubbing window.location or fetch. Identifier leakage cannot be introduced
  // at the wire: the plan's canonical URL carries only the assignmentId, and the
  // opaque launchRef travels only on the (probed) differentiated target.
  readonly onLaunchAssignment?: (plan: LaunchPlan) => void;
  // Sprint 20 internal beta: injected create-class callable seam wired
  // per active-teacher session. Always supplied through a getter so
  // per-session state can rebind across reruns without rebuilding the
  // route table; the callable itself is a function, so the getter form
  // is required to keep the type check unambiguous.
  readonly createClass?: () => CreateClass | null;
  // Sprint 24B Phase 2: getter for the injected import-from-classroom
  // dependencies. Rebound per active-teacher session so cross-session
  // state cannot leak; null on any non-teacher session so the Classes
  // surface renders without the primary import entry point.
  readonly importFromClassroom?: () => ImportFromClassroomDeps | null;
  // Sprint 24B Phase 2B.4: getter for the certified `classesActivate`
  // seam. Rebound per active-teacher session so cross-session state
  // cannot leak.
  readonly activateClass?: () => ActivateClass | null;
  // Sprint 24B Phase 2B.8: getter for the certified
  // `lmsClassesSyncRoster` seam. Same rebind semantics as the other
  // per-active-teacher dependencies.
  readonly syncRoster?: () => SyncRoster | null;
  // Sprint 29G.5K-3: best-effort class-open membership freshness callable
  // getter. Same rebind semantics as syncRoster.
  readonly refreshRoster?: () =>
    | ((input: { readonly classId: string }) => Promise<unknown>)
    | null;
};

// -----------------------------------------------------------------------------
// Signed-out
// -----------------------------------------------------------------------------

export const makeSignedOutSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "Sign in to LyfeLabz.");
    renderParagraph(
      mount,
      "Teachers and students use the same secure Google sign-in. LyfeLabz will take you to the right place automatically.",
    );
    const btn = renderPrimaryButton(
      mount,
      "Continue with Google",
      async () => {
        setButtonPending(btn, "Signing in");
        try {
          await deps.onSignIn();
          // On success the Auth state change re-runs the bootstrap and
          // the router will re-render. No local navigation is required.
        } catch (err) {
          clearButtonPending(btn, "Continue with Google");
          renderErrorBanner(mount, describeSignInError(err));
        }
      },
      "google-signin",
    );
    btn.setAttribute("aria-label", "Continue with Google");
    renderReturnLink(mount);
    // Sprint 29B: quiet Privacy Policy + Terms of Use links on the sign-in
    // surface (the shared teacher/student entry point). This is the /app
    // legal-link integration; the locked Teacher Workspace navigation and the
    // no-links shell footer are intentionally left unchanged.
    renderLegalLinks(mount);
  };

function describeSignInError(err: unknown): string {
  const code = (err && typeof err === "object" && "code" in err
    ? String((err as { code?: unknown }).code)
    : "") || "";
  if (code.includes("popup-closed") || code.includes("cancelled")) {
    return "Sign in was cancelled. Try again whenever you are ready.";
  }
  if (code.includes("network")) {
    return "We could not reach Google right now. Check your connection and try again.";
  }
  return "Google sign in did not complete. Try again in a moment.";
}

// -----------------------------------------------------------------------------
// Provisioned (welcome + request verification)
// -----------------------------------------------------------------------------

const TRANSITION_MESSAGE_MS = 600;

export const makeProvisionedSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    const doc = mount.ownerDocument;
    renderHeader(mount);
    renderHeadline(mount, "Welcome to LyfeLabz.");
    renderParagraph(
      mount,
      "Choose how you'll use LyfeLabz to continue.",
    );

    // ------------------------------------------------------------
    // Role selector (Sprint 29F onboarding UX correction).
    //
    // The two role workflows below (teacher verification, student
    // enrollment) are each preserved verbatim, including every existing
    // data-testid and callable wiring. What changed is presentation: on
    // arrival neither complete form is shown. The learner first picks a
    // role from two substantial, keyboard-operable controls, and only the
    // selected workflow is revealed. Selection is reflected with
    // aria-expanded and aria-pressed (not color alone), and focus moves
    // into the revealed region so assistive technology announces the new
    // content. Switching roles hides the previous workflow without a
    // reload and without clearing any fields the learner already typed.
    // ------------------------------------------------------------
    const TEACHER_SECTION_ID = "onboarding-teacher-section";
    const STUDENT_SECTION_ID = "onboarding-student-section";

    const roleSelector = doc.createElement("div");
    roleSelector.className = "role-selector";
    roleSelector.setAttribute("role", "group");
    roleSelector.setAttribute("aria-label", "Choose your role");
    roleSelector.setAttribute("data-testid", "role-selector");

    const makeRoleChoice = (
      testId: string,
      controls: string,
      title: string,
      description: string,
    ): HTMLButtonElement => {
      const choice = doc.createElement("button");
      choice.type = "button";
      choice.className = "role-choice";
      choice.setAttribute("data-testid", testId);
      choice.setAttribute("aria-controls", controls);
      choice.setAttribute("aria-expanded", "false");
      choice.setAttribute("aria-pressed", "false");
      const titleEl = doc.createElement("span");
      titleEl.className = "role-choice-title";
      titleEl.textContent = title;
      const descEl = doc.createElement("span");
      descEl.className = "role-choice-desc";
      descEl.textContent = description;
      choice.appendChild(titleEl);
      choice.appendChild(descEl);
      roleSelector.appendChild(choice);
      return choice;
    };

    const teacherChoice = makeRoleChoice(
      "role-choice-teacher",
      TEACHER_SECTION_ID,
      "Teacher",
      "Create and assign lessons to your students.",
    );
    const studentChoice = makeRoleChoice(
      "role-choice-student",
      STUDENT_SECTION_ID,
      "Student",
      "Join your class with Google Classroom or a class code.",
    );
    mount.appendChild(roleSelector);

    // ------------------------------------------------------------
    // Teacher path (preserved verbatim). Existing test IDs stay put.
    // ------------------------------------------------------------
    const teacherSection = doc.createElement("section");
    teacherSection.setAttribute("data-testid", "teacher-section");
    teacherSection.className = "shell-section workflow-panel";
    teacherSection.id = TEACHER_SECTION_ID;
    teacherSection.hidden = true;
    teacherSection.setAttribute("role", "region");
    teacherSection.setAttribute("aria-labelledby", "onboarding-teacher-heading");

    // Left context column: heading + explanatory copy. Kept narrow so it
    // does not consume the full width above the fields.
    const teacherContext = doc.createElement("div");
    teacherContext.className = "workflow-context";
    const teacherHead = doc.createElement("h2");
    teacherHead.id = "onboarding-teacher-heading";
    teacherHead.textContent = "Teacher access";
    teacherContext.appendChild(teacherHead);
    const teacherIntro = doc.createElement("p");
    teacherIntro.textContent =
      "Continue to activate your LyfeLabz teacher workspace.";
    teacherContext.appendChild(teacherIntro);
    teacherSection.appendChild(teacherContext);

    // Right action column: a single direct-activation control. Sprint
    // 29G.5C removed the manual "Your name" and "School identifier" fields
    // for the curated pilot: the server reads the authenticated email,
    // checks the protected allowlist, and assigns the canonical pilot
    // school. No name or school is typed here.
    const teacherAction = doc.createElement("div");
    teacherAction.className = "workflow-action";

    const teacherErrorHost = doc.createElement("div");
    teacherErrorHost.setAttribute("data-testid", "teacher-error-host");
    teacherAction.appendChild(teacherErrorHost);

    const teacherBtn = renderPrimaryButton(
      teacherAction,
      "Continue as Teacher",
      async () => {
        clear(teacherErrorHost);
        setButtonPending(teacherBtn, "Activating teacher access");
        try {
          await deps.onActivatePilotTeacher();
          setButtonPending(teacherBtn, "Teacher access enabled");
          window.setTimeout(() => {
            void deps.onRefreshSession();
          }, TRANSITION_MESSAGE_MS);
        } catch (err) {
          clearButtonPending(teacherBtn, "Continue as Teacher");
          renderErrorBanner(teacherErrorHost, describePilotActivationError(err));
        }
      },
      "activate-teacher",
    );
    // Also expose the classic banner for legacy tests that read from the
    // mount root.
    const teacherBannerMirror = doc.createElement("div");
    teacherBannerMirror.setAttribute("data-testid", "teacher-error-mirror");
    teacherBannerMirror.style.display = "none";
    teacherAction.appendChild(teacherBannerMirror);

    teacherSection.appendChild(teacherAction);
    mount.appendChild(teacherSection);

    // ------------------------------------------------------------
    // Student path.
    // ------------------------------------------------------------
    const studentSection = doc.createElement("section");
    studentSection.setAttribute("data-testid", "student-section");
    studentSection.className = "shell-section workflow-panel";
    studentSection.id = STUDENT_SECTION_ID;
    studentSection.hidden = true;
    studentSection.setAttribute("role", "region");
    studentSection.setAttribute("aria-labelledby", "onboarding-student-heading");

    const studentContext = doc.createElement("div");
    studentContext.className = "workflow-context";
    const studentHead = doc.createElement("h2");
    studentHead.id = "onboarding-student-heading";
    studentHead.textContent = "Join your class";
    studentContext.appendChild(studentHead);
    // The Class code / Google Classroom selector directly below the heading
    // already communicates the choice, so no intro sentence is needed here.
    studentSection.appendChild(studentContext);

    const studentAction = doc.createElement("div");
    studentAction.className = "workflow-action";

    // Secondary enrollment-method selector, subordinate to the primary
    // Teacher/Student choice. A student joins one of two ways: a class code
    // or Google Classroom. Only the selected method's action is revealed;
    // selecting a method never triggers enrollment.
    const methodSelector = doc.createElement("div");
    methodSelector.className = "method-selector";
    methodSelector.setAttribute("role", "group");
    methodSelector.setAttribute("aria-label", "Choose how you were invited");
    methodSelector.setAttribute("data-testid", "method-selector");

    const makeMethodChoice = (
      testId: string,
      controls: string,
      label: string,
    ): HTMLButtonElement => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "method-choice";
      b.setAttribute("data-testid", testId);
      b.setAttribute("aria-controls", controls);
      b.setAttribute("aria-expanded", "false");
      b.setAttribute("aria-pressed", "false");
      b.textContent = label;
      methodSelector.appendChild(b);
      return b;
    };
    // Sprint 29F: Google Classroom is the primary student join method, so it is
    // created (and therefore rendered) first. Class code remains fully
    // supported as the second choice. Creation order is the render order because
    // makeMethodChoice appends each button to the selector.
    const googleMethodChoice = makeMethodChoice(
      "method-choice-google",
      "student-google-method",
      "Google Classroom",
    );
    const codeMethodChoice = makeMethodChoice(
      "method-choice-code",
      "student-code-method",
      "Class code",
    );
    studentAction.appendChild(methodSelector);

    // Class code method panel.
    const codeMethod = doc.createElement("div");
    codeMethod.className = "method-panel";
    codeMethod.id = "student-code-method";
    codeMethod.setAttribute("role", "group");
    codeMethod.setAttribute("aria-label", "Class code");
    codeMethod.setAttribute("data-testid", "method-code");

    const studentForm = doc.createElement("form");
    studentForm.setAttribute("data-testid", "student-form");
    studentForm.className = "shell-form workflow-fields";

    const sNameLabel = doc.createElement("label");
    sNameLabel.textContent = "Your name";
    const sNameInput = doc.createElement("input");
    sNameInput.type = "text";
    sNameInput.required = true;
    sNameInput.autocomplete = "name";
    sNameInput.setAttribute("data-testid", "student-display-name");
    const prefill =
      typeof deps.getGoogleDisplayName === "function"
        ? deps.getGoogleDisplayName()
        : null;
    if (prefill && prefill.trim().length > 0) sNameInput.value = prefill.trim();
    sNameLabel.appendChild(sNameInput);

    const codeLabel = doc.createElement("label");
    codeLabel.textContent = "Class join code";
    const codeInput = doc.createElement("input");
    codeInput.type = "text";
    codeInput.required = true;
    codeInput.autocomplete = "off";
    codeInput.setAttribute("data-testid", "join-code");
    codeInput.setAttribute("inputmode", "text");
    codeInput.setAttribute("maxlength", "8");
    codeInput.setAttribute("aria-describedby", "join-code-hint");
    codeInput.setAttribute("spellcheck", "false");
    codeInput.setAttribute("autocapitalize", "characters");
    codeLabel.appendChild(codeInput);

    const codeHint = doc.createElement("span");
    codeHint.id = "join-code-hint";
    codeHint.className = "shell-small";
    codeHint.textContent = "8 characters: 0-9 and A-F.";
    codeLabel.appendChild(codeHint);

    studentForm.appendChild(sNameLabel);
    studentForm.appendChild(codeLabel);
    codeMethod.appendChild(studentForm);

    const studentErrorHost = doc.createElement("div");
    studentErrorHost.setAttribute("data-testid", "student-error-host");
    codeMethod.appendChild(studentErrorHost);

    const studentBtn = renderPrimaryButton(
      codeMethod,
      "Join class",
      async () => {
        const displayName = sNameInput.value.trim();
        const joinCode = codeInput.value.trim().toUpperCase();
        clear(studentErrorHost);
        if (!displayName || !joinCode) {
          renderErrorBanner(
            studentErrorHost,
            "Enter your name and the class join code your teacher shared.",
          );
          sNameInput.focus();
          return;
        }
        if (!/^[A-F0-9]{8}$/.test(joinCode)) {
          renderErrorBanner(
            studentErrorHost,
            "Join codes are eight characters long and use the digits 0-9 and the letters A-F.",
          );
          codeInput.focus();
          return;
        }
        if (typeof deps.onStudentOnboarding !== "function") {
          renderErrorBanner(
            studentErrorHost,
            "Student sign-up is not available right now. Try again in a moment.",
          );
          return;
        }
        setButtonPending(studentBtn, "Joining class");
        try {
          await deps.onStudentOnboarding({ displayName, joinCode });
          setButtonPending(studentBtn, "You're in");
          window.setTimeout(() => {
            void deps.onRefreshSession();
          }, TRANSITION_MESSAGE_MS);
        } catch (err) {
          clearButtonPending(studentBtn, "Join class");
          renderErrorBanner(studentErrorHost, describeStudentOnboardingError(err));
          // Focus the field most likely to need attention.
          const platformCode = extractPlatformErrorCode(err);
          if (
            platformCode === "enrollments.invalidJoinCode" ||
            platformCode === "enrollments.joinCodeNotFound" ||
            platformCode === "enrollments.conflict"
          ) {
            codeInput.focus();
            codeInput.select();
          } else {
            sNameInput.focus();
          }
        }
      },
      "join-class",
    );
    studentBtn.setAttribute("aria-label", "Join class");
    studentAction.appendChild(codeMethod);

    // ------------------------------------------------------------
    // Google Classroom (LMS) method panel. The two trust boundaries stay
    // separate: the manual path requires a valid join code; the LMS path
    // requires a server-confirmed LMS enrollment and asserts nothing about
    // roster, class, school, or Google identity. The student never types or
    // selects a class or a school here. Errors render into a dedicated host
    // so the manual and LMS flows never contaminate each other.
    // ------------------------------------------------------------
    const googleMethod = doc.createElement("div");
    googleMethod.className = "method-panel";
    googleMethod.id = "student-google-method";
    googleMethod.setAttribute("role", "group");
    googleMethod.setAttribute("aria-label", "Google Classroom");
    googleMethod.setAttribute("data-testid", "method-google");
    googleMethod.hidden = true;

    const lmsDesc = doc.createElement("p");
    lmsDesc.className = "method-desc";
    lmsDesc.setAttribute("data-testid", "lms-desc");
    lmsDesc.textContent = "Join using your school Google account.";
    googleMethod.appendChild(lmsDesc);

    const lmsErrorHost = doc.createElement("div");
    lmsErrorHost.setAttribute("data-testid", "lms-error-host");
    googleMethod.appendChild(lmsErrorHost);

    const lmsBtn = renderPrimaryButton(
      googleMethod,
      "Continue with Google Classroom",
      async () => {
        clear(lmsErrorHost);
        if (typeof deps.onStudentLmsOnboarding !== "function") {
          renderErrorBanner(
            lmsErrorHost,
            "Google Classroom sign-in is not available right now. Try again in a moment.",
          );
          return;
        }
        // The LMS path asks the student to assert nothing about their
        // class, school, or Google identity. The optional display name is
        // the only value carried, reusing the name field above when the
        // student typed one; otherwise the server falls back to the name
        // recorded at sign-in. No join code, class id, school id, district
        // id, or provider identity is ever sent.
        const typedName = sNameInput.value.trim();
        setButtonPending(lmsBtn, "Setting up your class");
        try {
          await deps.onStudentLmsOnboarding(
            typedName.length > 0 ? { displayName: typedName } : {},
          );
          setButtonPending(lmsBtn, "You're in");
          window.setTimeout(() => {
            void deps.onRefreshSession();
          }, TRANSITION_MESSAGE_MS);
        } catch (err) {
          clearButtonPending(lmsBtn, "Continue with Google Classroom");
          renderErrorBanner(lmsErrorHost, describeLmsOnboardingError(err));
        }
      },
      "lms-onboarding",
    );
    lmsBtn.setAttribute("aria-label", "Continue with Google Classroom");
    studentAction.appendChild(googleMethod);

    // Enrollment-method progressive disclosure. Sprint 29F: default to Google
    // Classroom (the primary student join method) so its panel appears
    // immediately on entering Student onboarding. Selecting a method reveals
    // only that method's action, updates aria and selected state, and never
    // triggers enrollment. Typed manual values are preserved when switching away
    // and back because the fields are only hidden, never rebuilt.
    let studentMethod: "code" | "google" = "google";
    const selectMethod = (method: "code" | "google", moveFocus: boolean): void => {
      const codeActive = method === "code";
      studentMethod = method;
      codeMethod.hidden = !codeActive;
      googleMethod.hidden = codeActive;
      codeMethodChoice.setAttribute("aria-expanded", String(codeActive));
      codeMethodChoice.setAttribute("aria-pressed", String(codeActive));
      googleMethodChoice.setAttribute("aria-expanded", String(!codeActive));
      googleMethodChoice.setAttribute("aria-pressed", String(!codeActive));
      codeMethodChoice.classList.toggle("is-selected", codeActive);
      googleMethodChoice.classList.toggle("is-selected", !codeActive);
      if (moveFocus) {
        const target = codeActive ? sNameInput : lmsBtn;
        try {
          target.focus();
        } catch {
          // ignored
        }
      }
    };
    selectMethod("google", false);
    codeMethodChoice.addEventListener("click", () => selectMethod("code", true));
    googleMethodChoice.addEventListener("click", () =>
      selectMethod("google", true),
    );

    studentSection.appendChild(studentAction);
    mount.appendChild(studentSection);

    // Reveal exactly one workflow and reflect selection state. Fields are
    // never cleared on switch, so a learner who typed a name before
    // changing their mind does not lose it.
    const selectRole = (role: "teacher" | "student"): void => {
      const teacherActive = role === "teacher";
      teacherSection.hidden = !teacherActive;
      studentSection.hidden = teacherActive;
      teacherChoice.setAttribute("aria-expanded", String(teacherActive));
      studentChoice.setAttribute("aria-expanded", String(!teacherActive));
      teacherChoice.setAttribute("aria-pressed", String(teacherActive));
      studentChoice.setAttribute("aria-pressed", String(!teacherActive));
      teacherChoice.classList.toggle("is-selected", teacherActive);
      studentChoice.classList.toggle("is-selected", !teacherActive);
      // Move focus to the first control of the revealed workflow (not the
      // region container). This takes keyboard and screen-reader users
      // straight to the form the labelled region announces, and avoids
      // drawing a focus outline around the entire panel. For Student, the
      // target depends on the active enrollment method so focus never lands
      // on a hidden field. Best-effort; never throws in a non-focusable
      // test environment.
      const firstField = teacherActive
        ? teacherBtn
        : studentMethod === "code"
          ? sNameInput
          : lmsBtn;
      try {
        firstField.focus();
      } catch {
        // ignored
      }
    };
    teacherChoice.addEventListener("click", () => selectRole("teacher"));
    studentChoice.addEventListener("click", () => selectRole("student"));

    renderSignOut(mount, deps.onSignOut);
  };

// Map a direct pilot-activation failure to calm, safe copy. Sprint 29G.5C.
// No branch ever exposes allowlist contents, an internal school/district
// id, a Firestore path, administrator details, or a raw backend message.
// The unknown-code fallback is a fixed generic string (never the server
// message) so backend text cannot leak into the onboarding UI.
function describePilotActivationError(err: unknown): string {
  const platformCode = extractPlatformErrorCode(err);
  switch (platformCode) {
    case "teachers.pilotNotAllowlisted":
      return "Teacher access has not been enabled for this account.";
    case "teachers.pilotSchoolUnconfigured":
    case "teachers.schoolNotFound":
    case "district-unassigned":
    case "school-district-mismatch":
      return "Teacher access isn't ready yet. Please try again later.";
    case "teachers.activeSchoolMismatch":
    case "teachers.roleConflict":
    case "teachers.invalidStatus":
    case "teachers.invalidRole":
      return "This account can't be activated as a teacher. Sign out and try again with your school Google account.";
    case "teachers.unauthenticated":
    case "unauthenticated":
      return "Your sign-in expired. Sign out and try again.";
  }
  const fb =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  if (fb.includes("permission")) {
    // A permission-denied with no canonical code still resolves to the safe
    // not-enabled message rather than exposing anything internal.
    return "Teacher access has not been enabled for this account.";
  }
  if (fb.includes("unavailable") || fb.includes("network")) {
    return "We could not reach LyfeLabz. Check your connection and try again.";
  }
  return "We could not enable teacher access. Try again in a moment.";
}

// Extract the canonical PlatformError code the callable layer preserves on
// the wire. The Cloud Function translator (platform/functions/src/shared/
// errors/https-callable.ts) stores the platform code on `details.code` in
// addition to the Firebase-shaped `code` bucket. We prefer the canonical
// identifier when present, and fall back to the Firebase code otherwise.
function extractPlatformErrorCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const details = (err as { details?: unknown }).details;
  if (details && typeof details === "object" && "code" in details) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function describeStudentOnboardingError(err: unknown): string {
  const platformCode = extractPlatformErrorCode(err);
  switch (platformCode) {
    case "enrollments.invalidJoinCode":
      return "That join code doesn't look right. Check the code your teacher shared and try again.";
    case "enrollments.joinCodeNotFound":
      return "We could not find a class for that join code. Check the code your teacher shared and try again.";
    case "enrollments.conflict":
      return "There is already an enrollment on file for this class. Ask your teacher for help.";
    case "students.invalidDisplayName":
      return "Enter your name and try again.";
    case "students.invalidStatus":
      return "Your account is not eligible to join a class right now. Sign out and try again.";
    case "students.schoolNotFound":
    case "district-unassigned":
    case "school-district-mismatch":
      return "This class is not set up correctly. Ask your teacher for help.";
    case "role-forbidden":
      return "Your account is not eligible to join a class. Sign out and try again with your student account.";
    case "students.unauthenticated":
    case "unauthenticated":
    case "claim-stale":
      return "Your sign-in expired. Sign out and try again.";
  }
  const fb =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  if (fb.includes("unavailable") || fb.includes("network")) {
    return "We could not reach LyfeLabz. Check your connection and try again.";
  }
  if (fb.includes("permission") || fb.includes("unauthenticated")) {
    return "Your account is not eligible to join a class right now. Sign out and try again.";
  }
  return "We could not join the class. Try again in a moment.";
}

// Map an LMS-onboarding failure to calm, non-technical copy. The recovery
// states are distinguished per the blueprint §6.3 and definition:
//   - no LMS enrollment yet: the teacher has most likely not re-synced the
//     roster since the student first signed in; the student is invited to
//     ask the teacher and try again (the button itself is the retry).
//   - conflicting membership / server validation: generic support guidance.
//   - retryable network/server failure: invite a retry.
// No branch ever exposes a class id, school id, district id, provider id,
// Google subject identifier, or internal status code.
function describeLmsOnboardingError(err: unknown): string {
  const platformCode = extractPlatformErrorCode(err);
  switch (platformCode) {
    case "students.noLmsEnrollment":
      // Sprint 29G.5K-2: zero-coordination onboarding. A genuine
      // no-membership student sees calm, non-technical copy with a clear
      // next step and NO synchronization instruction. It never names a
      // class, a roster, sync, or any Google identifier.
      return "We couldn't find a LyfeLabz class connected to your Google Classroom account yet. Ask your teacher for help.";
    case "students.conflictingLmsEnrollment":
    case "students.schoolNotFound":
    case "district-unassigned":
    case "school-district-mismatch":
      return "We could not set up your account for this class. Ask your teacher for help.";
    case "students.invalidStatus":
      return "Your account is not ready to join a class right now. Sign out and try again.";
    case "students.invalidDisplayName":
      return "Enter your name and try again.";
    case "students.forbiddenField":
    case "students.invalidRequest":
      return "We could not complete sign-in. Try again in a moment.";
    case "students.unauthenticated":
    case "unauthenticated":
    case "claim-stale":
      return "Your sign-in expired. Sign out and try again.";
  }
  const fb =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  if (fb.includes("unavailable") || fb.includes("network")) {
    return "We could not reach LyfeLabz. Check your connection and try again.";
  }
  if (fb.includes("permission") || fb.includes("unauthenticated")) {
    return "Your account is not eligible to join a class right now. Sign out and try again.";
  }
  return "We could not open your class. Try again in a moment.";
}

// -----------------------------------------------------------------------------
// Pending verification
// -----------------------------------------------------------------------------

const AUTO_REFRESH_INTERVAL_MS = 60_000;

export const makePendingSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "Your verification is pending.");
    renderParagraph(
      mount,
      "Your request has been sent to a LyfeLabz administrator. Verification usually takes one school day.",
    );
    renderParagraph(
      mount,
      "You will be able to reach the teacher tools as soon as the administrator approves your request.",
    );
    renderParagraph(
      mount,
      "You do not need to keep this page open. Sign in again anytime to check your status.",
    );

    const btn = renderPrimaryButton(
      mount,
      "Check status now",
      async () => {
        setButtonPending(btn, "Checking status");
        try {
          await deps.onRefreshSession();
          // If the bootstrap kept us on pendingVerification, the router
          // has already re-rendered the surface. The listener code path
          // updates the timestamp on the fresh render.
        } catch {
          clearButtonPending(btn, "Check status now");
          renderErrorBanner(
            mount,
            "We could not check your status. Try again in a moment.",
          );
        }
      },
      "check-status",
    );

    const lastCheckedLine = mount.ownerDocument.createElement("p");
    lastCheckedLine.className = "shell-small";
    lastCheckedLine.setAttribute("data-testid", "last-checked");
    lastCheckedLine.textContent = `Last checked at ${formatTime(new Date())}`;
    mount.appendChild(lastCheckedLine);

    // Visibility-gated 60s auto refresh. The interval is registered on
    // the mount so a subsequent surface re-render disposes it via the
    // router's `clear` step (the interval is attached to the mount node
    // and cleared when the mount is torn down).
    const doc = mount.ownerDocument;
    let intervalId: number | null = null;
    let hidden = doc.visibilityState === "hidden";

    const tick = (): void => {
      if (hidden) return;
      void deps.onRefreshSession();
    };

    const start = (): void => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(tick, AUTO_REFRESH_INTERVAL_MS);
    };
    const stop = (): void => {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };

    const onVisibilityChange = (): void => {
      hidden = doc.visibilityState === "hidden";
      if (hidden) stop();
      else start();
    };
    doc.addEventListener("visibilitychange", onVisibilityChange);
    if (!hidden) start();

    // When the mount is later cleared by the router, MutationObserver
    // fires with the removal and we clean up. This avoids leaking timers
    // across surface transitions without exposing internals.
    const mo = new MutationObserver(() => {
      if (!mount.contains(btn)) {
        stop();
        doc.removeEventListener("visibilitychange", onVisibilityChange);
        mo.disconnect();
      }
    });
    mo.observe(mount, { childList: true });

    renderSignOut(mount, deps.onSignOut);
  };

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// -----------------------------------------------------------------------------
// Active teacher
// -----------------------------------------------------------------------------

export const makeActiveTeacherSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (session, mount) => {
    if (session.kind !== "activeTeacher") return;
    // Step 5: minimal Step 4 body replaced by the Teacher Platform Shell.
    // The router still owns dispatch; the shell owns layout and Home.
    const integrations =
      typeof deps.integrations === "function"
        ? deps.integrations()
        : (deps.integrations ?? null);
    const assignments =
      typeof deps.assignments === "function"
        ? deps.assignments()
        : (deps.assignments ?? null);
    const assignmentDetail =
      typeof deps.assignmentDetail === "function"
        ? deps.assignmentDetail()
        : (deps.assignmentDetail ?? null);
    const assignmentSummary =
      deps.assignmentSummary !== undefined
        ? deps.assignmentSummary()
        : null;
    const lessonSummary =
      deps.lessonSummary !== undefined ? deps.lessonSummary() : null;
    const createClass =
      deps.createClass !== undefined ? deps.createClass() : null;
    const importFromClassroom =
      deps.importFromClassroom !== undefined
        ? deps.importFromClassroom()
        : null;
    const activateClass =
      deps.activateClass !== undefined ? deps.activateClass() : null;
    const syncRoster =
      deps.syncRoster !== undefined ? deps.syncRoster() : null;
    const refreshRoster =
      deps.refreshRoster !== undefined ? deps.refreshRoster() : null;
    mountTeacherShell(session, mount, {
      onSignOut: deps.onSignOut,
      listClasses: deps.listClasses,
      onLaunchPresentMode: deps.onLaunchPresentMode,
      integrations,
      assignments,
      assignmentDetail,
      assignmentSummary,
      lessonSummary,
      createClass,
      importFromClassroom,
      activateClass,
      syncRoster,
      refreshRoster,
    });
  };

// -----------------------------------------------------------------------------
// Active student
// -----------------------------------------------------------------------------

// Sprint 17 Slice 4 / Sprint 27 Phase 2: authenticated student landing
// surface. It presents the PDR-024i two-surface identity menu - My
// Assignments and My Results - and nothing else. My Assignments consumes
// the certified `assignmentsListForStudent` callable and presents the
// student's published assignments with a launch control. My Results
// consumes the caller-scoped `assessmentAttemptsList` read and presents
// the student's own completed-attempt history with best score, attempt
// count, the PDR-024l status indicator, and Improve My Score on every
// less-than-perfect best score (PDR-024k). The surface never prompts for
// credentials, never reads role/schoolId/districtId from the browser,
// never issues a Firestore read, never begins an assessment session
// (session lifecycle is the runtime), never reaches the class-scoped
// teacher attempt read, and never computes a cross-student aggregate.
//
// Both surfaces support loading, populated, empty, and recoverable-error
// states, and preserve the calm-software conventions (welcome,
// return-to-lessons, sign-out) across every state.

// Sprint 28.6G: My Science consolidates the former two-surface split
// (My Assignments / My Results) into a single domain-grouped student
// landing. There is no view switcher: a student sees all their science
// work in one place, grouped by canonical science domain, with unfinished
// work prominent and completed work quieter but still visible and
// re-launchable. Blueprint (SPRINT_28_6_ARCHITECTURAL_BLUEPRINT.md) section 15.

// Locked student-facing domain order (Blueprint section 15). The four
// assignable science domains, in the fixed order a student always sees.
// behavioral-science is gated (never assignable) and never appears. This
// array carries ONLY the locked ORDER; every human-readable domain label
// and lesson title still comes from the canonical curriculum manifest
// (TOPIC_LABEL / getUnitBySlug), so no second registry is introduced.
const STUDENT_DOMAIN_ORDER: ReadonlyArray<LessonTopic> = Object.freeze([
  "earth-space",
  "life-science",
  "physical-science",
  "tech-engineering",
]);

const STUDENT_DOMAINS: ReadonlySet<LessonTopic> = new Set(STUDENT_DOMAIN_ORDER);

// Heading for the single trailing catch-all group that holds any card whose
// lessonSlug cannot be resolved to one of the four student domains: an
// unknown or gated slug, or a completed attempt whose assignment is no
// longer listed (e.g. it was closed after the student finished). Blueprint
// section 15: such a card is placed here rather than dropped, so no work is
// ever lost.
const OTHER_DOMAIN_HEADING = "Other";

// One unified work item for My Science, derived by joining a caller-scoped
// published assignment (assignmentsListForStudent) with the student's own
// completed-attempt aggregate (aggregateByAssignment). A "historical" item
// (launchUrl null, no live assignment record) is completed work whose
// assignment is no longer listed; it still shows the student's result so
// completed work is never hidden, but it is not re-launchable.
type MyScienceItem = {
  readonly assignmentId: string;
  readonly title: string;
  readonly topic: LessonTopic | null;
  // F5.2 Slice 5: the server-authoritative launch plan (canonical or
  // differentiated) for a live assignment; null for historical completed work
  // that is no longer launchable.
  readonly launchPlan: LaunchPlan | null;
  readonly aggregate: StudentResultAggregate | null;
  readonly completed: boolean;
  readonly publishedAt: number | null;
  readonly lessonSlug: string | null;
};

// Sprint 28.6H (Finding 17): My Science shows OBJECTIVE status only. A
// completed assignment says "Completed"; the score itself communicates
// performance. An unfinished assignment says "Ready to Begin". The former
// subjective judgments (Perfect Score / Well Done! / Improving) are removed -
// a score does not establish "improvement", and the labels added a value
// judgment the student did not need. Two states, each carried by visible text
// (primary) plus a decorative aria-hidden glyph (never color alone).
type MyScienceStatus = "ready" | "completed";

const MY_SCIENCE_STATUS_LABEL: Readonly<Record<MyScienceStatus, string>> =
  Object.freeze({
    ready: "Ready to Begin",
    completed: "Completed",
  });

const MY_SCIENCE_STATUS_GLYPH: Readonly<Record<MyScienceStatus, string>> =
  Object.freeze({
    ready: "○", // hollow circle
    completed: "●", // filled circle
  });

export const makeActiveStudentSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (session, mount) => {
    if (session.kind !== "activeStudent") return;
    const doc = mount.ownerDocument;

    // Minimal student header (Blueprint section 15; Task 4): LYFELABZ
    // wordmark, the student's safe display name, and Log out - nothing else.
    // No teacher-style navigation, no My Assignments / My Results tabs, no
    // dashboard chrome. displayName is the same safe identity field the
    // product already showed; no uid / schoolId / provider id / email is
    // ever rendered.
    const header = doc.createElement("header");
    header.className = "student-header";
    header.setAttribute("data-testid", "student-header");
    renderHeader(header);
    const identity = doc.createElement("div");
    identity.className = "student-identity";
    const name = doc.createElement("span");
    name.className = "student-name";
    name.setAttribute("data-testid", "student-name");
    name.textContent = session.displayName;
    identity.appendChild(name);
    renderSignOut(identity, deps.onSignOut);
    header.appendChild(identity);
    mount.appendChild(header);

    // The single surface heading. renderHeadline focuses it, which both
    // announces the surface on load and restores a sensible focus target
    // when a student returns here from an assessment (Blueprint section 16).
    renderHeadline(mount, "My Science");

    const panel = doc.createElement("div");
    panel.setAttribute("data-testid", "my-science-panel");
    mount.appendChild(panel);

    const assignmentsCallable =
      typeof deps.studentAssignmentsList === "function"
        ? deps.studentAssignmentsList()
        : null;
    const resultsCallable =
      typeof deps.studentResultsList === "function"
        ? deps.studentResultsList()
        : null;
    const launch = deps.onLaunchAssignment;

    // Rendering My Science is strictly read-only (Task 18): it invokes only
    // the two caller-scoped READ callables (published assignments + the
    // student's own completed attempts). It never creates or mutates an
    // attempt, session, result, recipient, or enrollment. The only writing
    // path is the existing authorized launcher, reached solely by a student
    // clicking Open assignment.
    const load = (): void => {
      clear(panel);
      if (assignmentsCallable === null) {
        // The primary seam is unavailable (e.g. a route transition raced the
        // wiring). Fall back to a calm empty state rather than prompting a
        // retry against a missing dependency.
        renderMyScienceEmpty(panel);
        return;
      }
      renderLoadingIndicator(panel, "Loading your science");
      const assignmentsRead = assignmentsCallable().then((r) => r.items);
      // Results are auxiliary: a results failure degrades the surface (no
      // scores / tiers) rather than failing the whole page, so a student can
      // always still open their work. A missing seam is treated the same as
      // a failed read: null => degraded (Task 16).
      const resultsRead: Promise<ReadonlyMap<
        string,
        StudentResultAggregate
      > | null> =
        resultsCallable === null
          ? Promise.resolve(null)
          : resultsCallable()
              .then((r) => aggregateByAssignment(r.attempts))
              .catch(() => null);
      Promise.all([assignmentsRead, resultsRead]).then(
        ([items, resultsMap]) => {
          clear(panel);
          renderMyScience(panel, items ?? [], resultsMap, launch);
        },
        () => {
          // The primary (assignments) read failed. Show a calm, recoverable
          // error with a retry that re-invokes the read. No Firebase code,
          // callable name, or Firestore path is ever exposed.
          clear(panel);
          renderMyScienceError(panel, load);
        },
      );
    };

    load();
  };

// Build the accessible status chip: a decorative glyph (aria-hidden) plus
// the canonical PDR-024l label as visible text, so status is never
// conveyed by color alone.
function renderStatusChip(
  doc: Document,
  status: MyScienceStatus,
  testId: string,
): HTMLElement {
  const chip = doc.createElement("span");
  chip.className = "student-status";
  chip.setAttribute("data-testid", testId);
  chip.setAttribute("data-status", status);
  const glyph = doc.createElement("span");
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = MY_SCIENCE_STATUS_GLYPH[status];
  const label = doc.createElement("span");
  label.className = "student-status-label";
  label.textContent = MY_SCIENCE_STATUS_LABEL[status];
  chip.appendChild(glyph);
  chip.appendChild(doc.createTextNode(" "));
  chip.appendChild(label);
  return chip;
}

function renderMyScienceEmpty(mount: HTMLElement): void {
  const p = mount.ownerDocument.createElement("p");
  p.setAttribute("data-testid", "my-science-empty");
  p.textContent =
    "No science assignments yet. Check back after your teacher assigns work.";
  mount.appendChild(p);
}

function renderMyScienceError(mount: HTMLElement, onRetry: () => void): void {
  const banner = renderErrorBanner(
    mount,
    "We could not load your science work. Check your connection and try again.",
  );
  // Reuse the certified student error-callout hook (Sprint 28.5B B5) so the
  // message reads as an error, not muted text.
  banner.setAttribute("data-testid", "assignments-error");
  const retry = renderPrimaryButton(
    mount,
    "Try again",
    () => {
      onRetry();
    },
    "assignments-retry",
  );
  retry.setAttribute("aria-label", "Try again");
}

// Pure join of the caller-scoped published assignments with the student's
// own completed-attempt aggregate. Deterministic; no I/O. When resultsMap is
// null (results unavailable / degraded), every listed item is treated as
// not-yet-completed with no status, and no historical items are synthesized,
// so nothing is mislabeled as done (or not-done) on incomplete data.
function buildMyScienceItems(
  items: ReadonlyArray<AssignmentsListForStudentItem>,
  resultsMap: ReadonlyMap<string, StudentResultAggregate> | null,
): ReadonlyArray<MyScienceItem> {
  const out: MyScienceItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    // F5.2 §7.3 (Slice 5): the routing decision is server-authoritative. The
    // plan routes to the server-selected differentiated presentation when one
    // was minted for this item, else to the canonical lesson; it never derives a
    // variant or path from the item. A null plan means the canonical lesson URL
    // is unresolvable (malformed slug); drop it rather than render a dead
    // control (fail closed).
    const launchPlan = planAssignmentLaunch(item);
    if (launchPlan === null) continue;
    seen.add(item.assignmentId);
    const unit = getUnitBySlug(item.lessonSlug);
    // The canonical curriculum title is the source of truth for the card
    // label; the stored teacher-authored assignment title is the fallback
    // and is never mutated (Blueprint section 15). Gated / unknown units
    // fall back to the stored title and to the trailing "Other" group.
    const title = unit ? unit.title : item.title;
    const topic = unit && STUDENT_DOMAINS.has(unit.topic) ? unit.topic : null;
    const aggregate = resultsMap
      ? resultsMap.get(item.assignmentId) ?? null
      : null;
    out.push({
      assignmentId: item.assignmentId,
      title,
      topic,
      launchPlan,
      aggregate,
      completed: aggregate !== null,
      publishedAt:
        typeof item.publishedAt === "number" ? item.publishedAt : null,
      lessonSlug: item.lessonSlug,
    });
  }
  // Historical completed work: a completed attempt whose assignment is no
  // longer in the published list (typically closed after the student
  // finished). Kept so completed work is never hidden, but not re-launchable
  // and with no lessonSlug, so it lands in the trailing "Other" group under a
  // safe, non-leaking label.
  if (resultsMap !== null) {
    for (const aggregate of resultsMap.values()) {
      if (seen.has(aggregate.assignmentId)) continue;
      out.push({
        assignmentId: aggregate.assignmentId,
        title: "Assignment no longer listed",
        topic: null,
        launchPlan: null,
        aggregate,
        completed: true,
        publishedAt: null,
        lessonSlug: null,
      });
    }
  }
  return out;
}

// Deterministic within-domain ordering (Blueprint section 15): unfinished
// before completed, then newest published first (null publishedAt last),
// then lessonSlug ascending (null last), then assignmentId ascending as the
// final stable fallback.
function compareMyScienceItems(a: MyScienceItem, b: MyScienceItem): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  const ap = a.publishedAt ?? -Infinity;
  const bp = b.publishedAt ?? -Infinity;
  if (ap !== bp) return bp - ap;
  const as = a.lessonSlug ?? "\uffff";
  const bs = b.lessonSlug ?? "\uffff";
  if (as !== bs) return as < bs ? -1 : 1;
  if (a.assignmentId < b.assignmentId) return -1;
  if (a.assignmentId > b.assignmentId) return 1;
  return 0;
}

function renderMyScience(
  mount: HTMLElement,
  items: ReadonlyArray<AssignmentsListForStudentItem>,
  resultsMap: ReadonlyMap<string, StudentResultAggregate> | null,
  launch: ((plan: LaunchPlan) => void) | undefined,
): void {
  const doc = mount.ownerDocument;
  const work = buildMyScienceItems(items, resultsMap);
  if (work.length === 0) {
    renderMyScienceEmpty(mount);
    return;
  }
  // When results are unavailable the surface degrades: cards render without a
  // status chip, score, or completed-tier treatment so nothing is mislabeled.
  // Domain grouping needs only the manifest, so it is preserved.
  const degraded = resultsMap === null;

  // Bucket by domain. Render a section only when it holds at least one item
  // (empty domains are omitted, Blueprint section 15).
  const byTopic = new Map<LessonTopic | "other", MyScienceItem[]>();
  for (const it of work) {
    const key: LessonTopic | "other" = it.topic ?? "other";
    const bucket = byTopic.get(key);
    if (bucket) bucket.push(it);
    else byTopic.set(key, [it]);
  }

  const order: Array<LessonTopic | "other"> = [
    ...STUDENT_DOMAIN_ORDER,
    "other",
  ];
  for (const key of order) {
    const bucket = byTopic.get(key);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort(compareMyScienceItems);

    const section = doc.createElement("section");
    section.className = "my-science-domain";
    section.setAttribute("data-testid", "my-science-domain");
    section.setAttribute("data-domain", key);

    const heading = doc.createElement("h2");
    heading.setAttribute("data-testid", "my-science-domain-heading");
    heading.textContent =
      key === "other" ? OTHER_DOMAIN_HEADING : TOPIC_LABEL[key];
    section.appendChild(heading);

    const list = doc.createElement("ul");
    list.className = "shell-list";
    list.setAttribute("data-testid", "my-science-list");
    for (const it of bucket) {
      list.appendChild(renderMyScienceCard(doc, it, launch, degraded));
    }
    section.appendChild(list);
    mount.appendChild(section);
  }
}

function renderMyScienceCard(
  doc: Document,
  item: MyScienceItem,
  launch: ((plan: LaunchPlan) => void) | undefined,
  degraded: boolean,
): HTMLElement {
  const li = doc.createElement("li");
  li.setAttribute("data-testid", "my-science-card");

  const heading = doc.createElement("h3");
  heading.setAttribute("data-testid", "my-science-card-title");
  // Titles are manifest/user-authored content routed through textContent
  // (never innerHTML); no launch URL is ever built from the title.
  heading.textContent = item.title;
  li.appendChild(heading);

  const showResult = !degraded && item.completed && item.aggregate !== null;
  // Sprint 28.6H (Finding 17): OBJECTIVE status only - "Completed" for finished
  // work, "Ready to Begin" for unfinished. The score below carries the actual
  // performance; no subjective judgment is shown.
  const status: MyScienceStatus = item.completed ? "completed" : "ready";

  // Status is carried by visible text (never color alone). In the degraded
  // state we know neither completion nor status, so no chip is shown rather
  // than a misleading one.
  if (!degraded) {
    li.setAttribute("data-status", status);
    // All completed work is visually quieter than unfinished work (Task 7);
    // it stays visible and interactive (completed is not unavailable).
    if (showResult) li.setAttribute("data-complete", "true");
    li.appendChild(renderStatusChip(doc, status, "my-science-card-status"));
  }

  if (showResult && item.aggregate) {
    const agg = item.aggregate;
    // Sprint 28.6H (Finding 16): compact score line - "100% · 10/10" - rather
    // than the taller "Best score 100% (10 / 10)". The percentage is the value
    // the student came for (prominent); the raw fraction is quiet context.
    const score = doc.createElement("p");
    score.setAttribute("data-testid", "my-science-card-score");
    const strong = doc.createElement("strong");
    strong.textContent = `${agg.bestPercentage}%`;
    score.appendChild(strong);
    const raw = doc.createElement("span");
    raw.className = "my-science-card-score-raw";
    raw.textContent = ` · ${agg.bestScore}/${agg.bestMaxScore}`;
    score.appendChild(raw);
    li.appendChild(score);

    const attempts = doc.createElement("p");
    attempts.setAttribute("data-testid", "my-science-card-attempts");
    attempts.textContent =
      agg.attemptCount === 1 ? "1 attempt" : `${agg.attemptCount} attempts`;
    li.appendChild(attempts);
  }

  // Launch action. Reuses the certified assignment launcher URL and the
  // shared primary-action testid (assignments-launch) so the same styling
  // and the same launch/authorization path apply. Historical items (no live
  // assignment record) carry no launch URL and render no action; their
  // result is still shown so the student can see how they did.
  if (item.launchPlan !== null) {
    const plan = item.launchPlan;
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-testid", "assignments-launch");
    // The DOM launch attribute is always the CANONICAL target (never the
    // differentiated artifact URL and never the opaque launchRef): the observable
    // launch target stays non-leaking and byte-identical to pre-differentiation
    // behavior for the canonical population. The differentiated routing and the
    // launchRef transport happen inside the injected launch executor at click
    // time, from the closed-over plan, never from a DOM attribute.
    btn.setAttribute("data-assignment-launch-url", plan.canonicalUrl);
    btn.textContent = "Open assignment";
    // The accessible name includes the lesson title (Blueprint section 16).
    btn.setAttribute("aria-label", `Open assignment: ${item.title}`);
    btn.addEventListener("click", () => {
      if (launch) launch(plan);
    });
    li.appendChild(btn);
  }

  return li;
}

// -----------------------------------------------------------------------------
// Active administrator stub
// -----------------------------------------------------------------------------

export const makeActiveAdministratorSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "You are signed in as a platform administrator.");
    renderParagraph(
      mount,
      "Administrator tools are not yet available in this build.",
    );
    renderSignOut(mount, deps.onSignOut);
  };

// -----------------------------------------------------------------------------
// Suspended
// -----------------------------------------------------------------------------

export const makeSuspendedSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "Your account is not available right now.");
    renderParagraph(
      mount,
      "Your LyfeLabz account has been temporarily suspended. You will not be able to reach the teacher tools until this is resolved.",
    );
    renderParagraph(
      mount,
      `If you believe this is a mistake, contact your school administrator or LyfeLabz support at ${SUPPORT_EMAIL}.`,
    );
    renderSignOut(mount, deps.onSignOut);
  };

// -----------------------------------------------------------------------------
// Archived
// -----------------------------------------------------------------------------

export const makeArchivedSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "This account has been archived.");
    renderParagraph(
      mount,
      "This LyfeLabz account is no longer active. You will not be able to reach the teacher tools with this account.",
    );
    renderParagraph(
      mount,
      "If you need to return to LyfeLabz, contact your school administrator to have a new account provisioned.",
    );
    renderSignOut(mount, deps.onSignOut);
  };

// -----------------------------------------------------------------------------
// Error surface
// -----------------------------------------------------------------------------

type ErrorCopy = {
  readonly headline: string;
  readonly body: string;
  readonly showRetry: boolean;
  readonly showRefresh: boolean;
  readonly showSignOut: boolean;
  readonly showSupport: boolean;
};

const ERROR_COPY: Readonly<
  Record<
    "authInitFailed"
    | "userRecordUnreadable"
    | "userRecordMissing"
    | "recordShapeInvalid"
    | "networkUnavailable",
    ErrorCopy
  >
> = Object.freeze({
  authInitFailed: {
    headline: "We could not start your sign-in session.",
    body: "Something went wrong before we could confirm who you are. Refresh the page and try again. If this keeps happening, sign out and sign back in.",
    showRetry: false,
    showRefresh: true,
    showSignOut: true,
    showSupport: true,
  },
  userRecordUnreadable: {
    headline: "We could not load your account.",
    body: "Your account exists, but we could not read your account record right now. This is usually a temporary connection problem.",
    showRetry: true,
    showRefresh: false,
    showSignOut: true,
    showSupport: false,
  },
  userRecordMissing: {
    headline: "Your account record was not found.",
    body: "You are signed in, but we do not have an account record for you yet. If you just requested access, wait a moment and try again. If the problem persists, contact your school administrator.",
    showRetry: true,
    showRefresh: false,
    showSignOut: true,
    showSupport: true,
  },
  recordShapeInvalid: {
    headline: "Your account record needs attention.",
    body: "We found your account record but it is not in the expected shape. This is a platform issue, not something you caused. Please contact support and include your email address.",
    showRetry: false,
    showRefresh: false,
    showSignOut: true,
    showSupport: true,
  },
  networkUnavailable: {
    headline: "You appear to be offline.",
    body: "We could not reach LyfeLabz. Check your connection and try again.",
    showRetry: true,
    showRefresh: false,
    showSignOut: false,
    showSupport: false,
  },
});

export const makeErrorSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (session, mount) => {
    if (session.kind !== "error") return;
    const copy = ERROR_COPY[session.reason];
    renderHeader(mount);
    renderHeadline(mount, copy.headline);
    renderParagraph(mount, copy.body);

    if (copy.showRetry) {
      const retry = renderPrimaryButton(
        mount,
        "Try again",
        async () => {
          setButtonPending(retry, "Trying");
          try {
            await deps.onRefreshSession();
          } catch {
            clearButtonPending(retry, "Try again");
          }
        },
        "retry",
      );
    }
    if (copy.showRefresh) {
      renderPrimaryButton(
        mount,
        "Refresh",
        () => {
          window.location.reload();
        },
        "refresh",
      );
    }
    if (copy.showSignOut) {
      renderSignOut(mount, deps.onSignOut);
    }
    if (copy.showSupport) {
      const support = mount.ownerDocument.createElement("p");
      support.className = "shell-small";
      support.textContent = `Contact support at ${SUPPORT_EMAIL} with your email address.`;
      mount.appendChild(support);
    }
  };

// -----------------------------------------------------------------------------
// Loading surface (shared indicator inside the shell)
// -----------------------------------------------------------------------------

export function renderLoadingSurface(mount: HTMLElement): void {
  clear(mount);
  renderHeader(mount);
  renderLoadingIndicator(mount, "Loading your account");
}

export type { RouteSurface } from "../router";
