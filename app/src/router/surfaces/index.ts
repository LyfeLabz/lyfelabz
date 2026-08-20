import type { RouteSurface } from "../router";
import type { ListClasses } from "../../classes/listClasses";
import type { CreateClass } from "../../classes/createClass";
import type { ActivateClass } from "../../classes/activateClass";
import type { SyncRoster } from "../../classes/syncRoster";
import type { ImportFromClassroomDeps } from "../../classes/importFromClassroom";
import type {
  TeacherDefaultGrade,
  UpdateTeacherDefaultGrade,
} from "../../teacherPreferences/types";
import type {
  AssignmentsCallables,
  IntegrationsDeps,
} from "../../settings/integrations/types";
import type { CurriculumAssignmentDetailSeam } from "../../shell/surfaces/curriculum";
import type { AssignmentSummaryCallable } from "../../assignments/summary/types";
import type {
  AssignmentsListForStudentCallable,
  AssignmentsListForStudentItem,
} from "../../assignments/studentList/types";
import { buildAssignmentLaunchUrl } from "../../assignments/studentList/launch";
import type {
  StudentResultsListCallable,
  StudentResultAggregate,
  StudentStatusKey,
} from "../../assignments/studentResults/types";
import {
  aggregateByAssignment,
  STUDENT_STATUS_LABELS,
} from "../../assignments/studentResults/aggregate";
import { mountTeacherShell } from "../../shell/shell";
import {
  clear,
  clearButtonPending,
  renderErrorBanner,
  renderHeader,
  renderHeadline,
  renderLoadingIndicator,
  renderParagraph,
  renderPrimaryButton,
  renderReturnLink,
  renderSignOut,
  setButtonPending,
  type OnSignOut,
} from "./shared";

// Route surface factory dependencies. Route surfaces receive these
// once from the entry point via createRouteTable so that the surfaces
// themselves stay pure DOM builders with no Firebase imports.
export type SurfaceDeps = {
  readonly onSignOut: OnSignOut;
  readonly onSignIn: () => Promise<void>;
  readonly onRefreshSession: () => Promise<void>;
  readonly onRequestVerification: (input: {
    readonly role: "teacher";
    readonly schoolId: string;
    readonly displayName: string;
  }) => Promise<void>;
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
  // Sprint 17 Slice 4: launch a lesson from the activeStudent surface.
  // Injected so tests can assert the exact URL without stubbing
  // window.location. The entry point wires window.location.assign; the
  // launcher URL is composed inside the surface from the certified item
  // fields so identifier leakage cannot be introduced at the wire.
  readonly onLaunchAssignment?: (url: string) => void;
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
  // Sprint 24B Phase 2B.2: getters for the resolved `defaultGrade`
  // preference and the best-effort update seam. Same getter pattern as
  // the other per-active-teacher dependencies so per-session state can
  // rebind across reruns without rebuilding the route table.
  readonly defaultGrade?: () => TeacherDefaultGrade | null;
  readonly updateDefaultGrade?: () => UpdateTeacherDefaultGrade | null;
  // Sprint 24B Phase 2B.4: getter for the certified `classesActivate`
  // seam. Rebound per active-teacher session so cross-session state
  // cannot leak.
  readonly activateClass?: () => ActivateClass | null;
  // Sprint 24B Phase 2B.8: getter for the certified
  // `lmsClassesSyncRoster` seam. Same rebind semantics as the other
  // per-active-teacher dependencies.
  readonly syncRoster?: () => SyncRoster | null;
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
      "Your account has been created. Choose the option below that describes you.",
    );

    // ------------------------------------------------------------
    // Teacher path (preserved verbatim). Existing test IDs stay put.
    // ------------------------------------------------------------
    const teacherSection = doc.createElement("section");
    teacherSection.setAttribute("data-testid", "teacher-section");
    teacherSection.className = "shell-section";
    const teacherHead = doc.createElement("h2");
    teacherHead.textContent = "I am a teacher.";
    teacherSection.appendChild(teacherHead);
    const teacherIntro = doc.createElement("p");
    teacherIntro.textContent =
      "A LyfeLabz administrator will verify that you teach at your school. Verification usually takes one school day.";
    teacherSection.appendChild(teacherIntro);

    const form = doc.createElement("form");
    form.setAttribute("data-testid", "verification-form");
    form.className = "shell-form";

    const nameLabel = doc.createElement("label");
    nameLabel.textContent = "Your name";
    const nameInput = doc.createElement("input");
    nameInput.type = "text";
    nameInput.required = true;
    nameInput.autocomplete = "name";
    nameInput.setAttribute("data-testid", "display-name");
    nameLabel.appendChild(nameInput);

    const schoolLabel = doc.createElement("label");
    schoolLabel.textContent = "School identifier";
    const schoolInput = doc.createElement("input");
    schoolInput.type = "text";
    schoolInput.required = true;
    schoolInput.setAttribute("data-testid", "school-id");
    schoolLabel.appendChild(schoolInput);

    form.appendChild(nameLabel);
    form.appendChild(schoolLabel);
    teacherSection.appendChild(form);

    const teacherErrorHost = doc.createElement("div");
    teacherErrorHost.setAttribute("data-testid", "teacher-error-host");
    teacherSection.appendChild(teacherErrorHost);

    const teacherBtn = renderPrimaryButton(
      teacherSection,
      "Request Verification",
      async () => {
        const displayName = nameInput.value.trim();
        const schoolId = schoolInput.value.trim();
        clear(teacherErrorHost);
        if (!displayName || !schoolId) {
          renderErrorBanner(
            teacherErrorHost,
            "Enter your name and school identifier to request verification.",
          );
          return;
        }
        setButtonPending(teacherBtn, "Requesting verification");
        try {
          await deps.onRequestVerification({
            role: "teacher",
            schoolId,
            displayName,
          });
          setButtonPending(teacherBtn, "Request sent");
          window.setTimeout(() => {
            void deps.onRefreshSession();
          }, TRANSITION_MESSAGE_MS);
        } catch (err) {
          clearButtonPending(teacherBtn, "Request Verification");
          renderErrorBanner(teacherErrorHost, describeVerificationError(err));
        }
      },
      "request-verification",
    );
    // Also expose the classic banner for legacy tests that read from the
    // mount root.
    const teacherBannerMirror = doc.createElement("div");
    teacherBannerMirror.setAttribute("data-testid", "teacher-error-mirror");
    teacherBannerMirror.style.display = "none";
    teacherSection.appendChild(teacherBannerMirror);

    mount.appendChild(teacherSection);

    // ------------------------------------------------------------
    // Student path.
    // ------------------------------------------------------------
    const studentSection = doc.createElement("section");
    studentSection.setAttribute("data-testid", "student-section");
    studentSection.className = "shell-section";
    const studentHead = doc.createElement("h2");
    studentHead.textContent = "I am a student.";
    studentSection.appendChild(studentHead);
    const studentIntro = doc.createElement("p");
    studentIntro.textContent =
      "Enter your name and the class join code your teacher shared with you. If your teacher uses Google Classroom, use the Google Classroom option below instead.";
    studentSection.appendChild(studentIntro);

    const studentForm = doc.createElement("form");
    studentForm.setAttribute("data-testid", "student-form");
    studentForm.className = "shell-form";

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
    codeHint.textContent =
      "Eight characters, made from the digits 0-9 and the letters A-F.";
    codeLabel.appendChild(codeHint);

    studentForm.appendChild(sNameLabel);
    studentForm.appendChild(codeLabel);
    studentSection.appendChild(studentForm);

    const studentErrorHost = doc.createElement("div");
    studentErrorHost.setAttribute("data-testid", "student-error-host");
    studentSection.appendChild(studentErrorHost);

    const studentBtn = renderPrimaryButton(
      studentSection,
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

    // ------------------------------------------------------------
    // Google Classroom (LMS) path. A distinct affordance beneath the
    // manual join-code form. The two trust boundaries stay separate: the
    // manual path requires a valid join code; the LMS path requires a
    // server-confirmed LMS enrollment and asserts nothing about roster,
    // class, school, or Google identity. The student never types or
    // selects a class or a school here. Errors render into a dedicated
    // host so the manual and LMS flows never contaminate each other.
    // ------------------------------------------------------------
    const lmsDivider = doc.createElement("p");
    lmsDivider.className = "shell-small";
    lmsDivider.setAttribute("data-testid", "lms-divider");
    lmsDivider.textContent = "Or, if your teacher uses Google Classroom:";
    studentSection.appendChild(lmsDivider);

    const lmsErrorHost = doc.createElement("div");
    lmsErrorHost.setAttribute("data-testid", "lms-error-host");
    studentSection.appendChild(lmsErrorHost);

    const lmsBtn = renderPrimaryButton(
      studentSection,
      "I'm in a Google Classroom class",
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
          clearButtonPending(lmsBtn, "I'm in a Google Classroom class");
          renderErrorBanner(lmsErrorHost, describeLmsOnboardingError(err));
        }
      },
      "lms-onboarding",
    );
    lmsBtn.setAttribute("aria-label", "I'm in a Google Classroom class");

    mount.appendChild(studentSection);

    renderSignOut(mount, deps.onSignOut);
  };

function describeVerificationError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message)
      : "";
  if (code.includes("permission") || code.includes("unauthenticated")) {
    return "Your account is not eligible to request verification. Sign out and try again with your school Google account.";
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return "We could not send your request. Check your connection and try again.";
  }
  if (message) {
    return message.slice(0, 240);
  }
  return "We could not send your request. Try again in a moment.";
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
      return "Your class isn't ready in LyfeLabz yet. Ask your teacher to update the class roster, then try again.";
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
    const createClass =
      deps.createClass !== undefined ? deps.createClass() : null;
    const importFromClassroom =
      deps.importFromClassroom !== undefined
        ? deps.importFromClassroom()
        : null;
    const defaultGrade =
      deps.defaultGrade !== undefined ? deps.defaultGrade() : null;
    const updateDefaultGrade =
      deps.updateDefaultGrade !== undefined
        ? deps.updateDefaultGrade()
        : null;
    const activateClass =
      deps.activateClass !== undefined ? deps.activateClass() : null;
    const syncRoster =
      deps.syncRoster !== undefined ? deps.syncRoster() : null;
    mountTeacherShell(session, mount, {
      onSignOut: deps.onSignOut,
      listClasses: deps.listClasses,
      onLaunchPresentMode: deps.onLaunchPresentMode,
      integrations,
      assignments,
      assignmentDetail,
      assignmentSummary,
      createClass,
      importFromClassroom,
      defaultGrade,
      updateDefaultGrade,
      activateClass,
      syncRoster,
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

type StudentView = "assignments" | "results";

// Distinct status glyphs so an indicator is legible without color
// (PDR-024l). The visible text label is always the primary carrier of
// meaning; the glyph is decorative and marked aria-hidden.
const STATUS_GLYPHS: Readonly<Record<StudentStatusKey, string>> = Object.freeze(
  {
    ready: "○", // hollow circle
    improving: "◐", // half-filled circle
    wellDone: "●", // filled circle
    perfect: "★", // star
  },
);

export const makeActiveStudentSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (session, mount) => {
    if (session.kind !== "activeStudent") return;
    const doc = mount.ownerDocument;
    renderHeader(mount);
    renderHeadline(mount, `Welcome, ${session.displayName}.`);
    renderParagraph(
      mount,
      "You are signed in to LyfeLabz. Choose My Assignments to see published work, or My Results to review your scores.",
    );

    const assignmentsCallable =
      typeof deps.studentAssignmentsList === "function"
        ? deps.studentAssignmentsList()
        : null;
    const resultsCallable =
      typeof deps.studentResultsList === "function"
        ? deps.studentResultsList()
        : null;
    const launch = deps.onLaunchAssignment;

    // Session-scoped success caches so switching tabs does not re-fetch,
    // plus a shared in-flight promise so the two views never double-invoke
    // the backend for the same data. A failed read clears the in-flight
    // memo and is never cached, so a retry re-invokes the callable.
    let assignmentsCache: ReadonlyArray<AssignmentsListForStudentItem> | null =
      null;
    let resultsCache: ReadonlyMap<string, StudentResultAggregate> | null = null;
    let assignmentsInFlight: Promise<ReadonlyArray<
      AssignmentsListForStudentItem
    > | null> | null = null;
    let resultsInFlight: Promise<ReadonlyMap<
      string,
      StudentResultAggregate
    > | null> | null = null;

    const getAssignments = (): Promise<ReadonlyArray<
      AssignmentsListForStudentItem
    > | null> => {
      if (assignmentsCache !== null) return Promise.resolve(assignmentsCache);
      if (assignmentsCallable === null) return Promise.resolve(null);
      if (assignmentsInFlight === null) {
        const callable = assignmentsCallable;
        assignmentsInFlight = callable().then(
          (response) => {
            assignmentsCache = response.items;
            assignmentsInFlight = null;
            return assignmentsCache;
          },
          (err) => {
            assignmentsInFlight = null;
            throw err;
          },
        );
      }
      return assignmentsInFlight;
    };

    const getResults = (): Promise<ReadonlyMap<
      string,
      StudentResultAggregate
    > | null> => {
      if (resultsCache !== null) return Promise.resolve(resultsCache);
      if (resultsCallable === null) return Promise.resolve(null);
      if (resultsInFlight === null) {
        const callable = resultsCallable;
        resultsInFlight = callable().then(
          (response) => {
            // Single-student self-aggregation over the caller's own
            // attempts. No cross-student data is read or computed.
            resultsCache = aggregateByAssignment(response.attempts);
            resultsInFlight = null;
            return resultsCache;
          },
          (err) => {
            resultsInFlight = null;
            throw err;
          },
        );
      }
      return resultsInFlight;
    };

    // Non-rejecting variants used where the data is auxiliary to a view
    // (status decoration on My Assignments; title/launch join on My
    // Results). A failure of the auxiliary read degrades gracefully rather
    // than failing the primary view.
    const getResultsSafe = async (): Promise<ReadonlyMap<
      string,
      StudentResultAggregate
    > | null> => {
      try {
        return await getResults();
      } catch {
        return null;
      }
    };
    const getAssignmentsSafe = async (): Promise<ReadonlyArray<
      AssignmentsListForStudentItem
    > | null> => {
      try {
        return await getAssignments();
      } catch {
        return null;
      }
    };

    // Nav (WAI-ARIA tablist) + a single panel host the active view renders
    // into. Selection is conveyed by aria-selected and visible text, never
    // color alone.
    const panel = doc.createElement("div");
    panel.setAttribute("data-testid", "student-panel");
    panel.setAttribute("role", "tabpanel");
    panel.id = "student-panel";
    panel.tabIndex = 0;

    let renderAssignmentsView: () => void = () => undefined;
    let renderResultsView: () => void = () => undefined;
    // The currently selected view. An async view load only commits to the
    // shared panel when its view is still active, so a slow read that
    // resolves after the student switched tabs cannot clobber the other
    // view (PDR-024i two-surface menu integrity).
    let activeView: StudentView = "assignments";

    const nav = doc.createElement("div");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "Student views");
    nav.setAttribute("data-testid", "student-nav");

    const tabs: Partial<Record<StudentView, HTMLButtonElement>> = {};

    const select = (view: StudentView): void => {
      activeView = view;
      for (const key of ["assignments", "results"] as const) {
        const tab = tabs[key];
        if (!tab) continue;
        const selected = key === view;
        tab.setAttribute("aria-selected", selected ? "true" : "false");
        tab.tabIndex = selected ? 0 : -1;
      }
      panel.setAttribute(
        "aria-labelledby",
        view === "assignments" ? "student-tab-assignments" : "student-tab-results",
      );
      if (view === "assignments") renderAssignmentsView();
      else renderResultsView();
    };

    const makeTab = (
      view: StudentView,
      label: string,
      testId: string,
      id: string,
    ): HTMLButtonElement => {
      const tab = doc.createElement("button");
      tab.type = "button";
      tab.id = id;
      tab.textContent = label;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "student-panel");
      tab.setAttribute("data-testid", testId);
      tab.addEventListener("click", () => {
        select(view);
        tab.focus();
      });
      // Roving-tabindex arrow navigation between the two tabs.
      tab.addEventListener("keydown", (event) => {
        const key = event.key;
        if (
          key === "ArrowRight" ||
          key === "ArrowLeft" ||
          key === "Home" ||
          key === "End"
        ) {
          event.preventDefault();
          const other: StudentView =
            view === "assignments" ? "results" : "assignments";
          const target =
            key === "Home"
              ? "assignments"
              : key === "End"
                ? "results"
                : other;
          select(target as StudentView);
          tabs[target as StudentView]?.focus();
        }
      });
      tabs[view] = tab;
      nav.appendChild(tab);
      return tab;
    };

    makeTab("assignments", "My Assignments", "nav-assignments", "student-tab-assignments");
    makeTab("results", "My Results", "nav-results", "student-tab-results");

    mount.appendChild(nav);
    mount.appendChild(panel);
    renderReturnLink(mount);
    renderSignOut(mount, deps.onSignOut);

    // --- My Assignments view -------------------------------------------
    renderAssignmentsView = (): void => {
      clear(panel);
      if (assignmentsCallable === null && assignmentsCache === null) {
        // The callable seam is unavailable (for example the entry point
        // has not yet wired it, or the session transition raced the route
        // table). Fall back to a calm empty state; do not prompt retry
        // against a missing dependency.
        renderAssignmentsEmpty(panel);
        return;
      }
      renderLoadingIndicator(panel, "Loading your assignments");
      Promise.all([getAssignments(), getResultsSafe()]).then(
        ([items, statusByAssignment]) => {
          if (activeView !== "assignments") return;
          clear(panel);
          const launchable = filterLaunchableItems(items ?? []);
          if (launchable.length === 0) {
            renderAssignmentsEmpty(panel);
            return;
          }
          renderAssignmentsList(panel, launchable, launch, statusByAssignment);
        },
        () => {
          if (activeView !== "assignments") return;
          clear(panel);
          renderAssignmentsError(panel, renderAssignmentsView);
        },
      );
    };

    // --- My Results view -----------------------------------------------
    renderResultsView = (): void => {
      clear(panel);
      if (resultsCallable === null && resultsCache === null) {
        renderResultsEmpty(panel);
        return;
      }
      renderLoadingIndicator(panel, "Loading your results");
      Promise.all([getResults(), getAssignmentsSafe()]).then(
        ([aggregates, items]) => {
          if (activeView !== "results") return;
          clear(panel);
          if (aggregates === null || aggregates.size === 0) {
            renderResultsEmpty(panel);
            return;
          }
          renderResultsList(panel, aggregates, items ?? [], launch);
        },
        () => {
          if (activeView !== "results") return;
          clear(panel);
          renderResultsError(panel, renderResultsView);
        },
      );
    };

    // Default landing is My Assignments (PDR-024i order preserved).
    select("assignments");
  };

function filterLaunchableItems(
  items: ReadonlyArray<AssignmentsListForStudentItem>,
): ReadonlyArray<AssignmentsListForStudentItem> {
  // Belt-and-suspenders: wire.ts already discards malformed items, but
  // the launcher URL builder is the last gate before an identifier is
  // encoded into a URL. Any item that cannot produce a valid launch URL
  // is dropped here so no button can render without a working target.
  const out: AssignmentsListForStudentItem[] = [];
  for (const item of items) {
    if (buildAssignmentLaunchUrl(item) !== null) out.push(item);
  }
  return out;
}

// Build the accessible status chip: a decorative glyph (aria-hidden) plus
// the canonical PDR-024l label as visible text, so status is never
// conveyed by color alone.
function renderStatusChip(
  doc: Document,
  status: StudentStatusKey,
  testId: string,
): HTMLElement {
  const chip = doc.createElement("span");
  chip.className = "student-status";
  chip.setAttribute("data-testid", testId);
  chip.setAttribute("data-status", status);
  const glyph = doc.createElement("span");
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = STATUS_GLYPHS[status];
  const label = doc.createElement("span");
  label.className = "student-status-label";
  label.textContent = STUDENT_STATUS_LABELS[status];
  chip.appendChild(glyph);
  chip.appendChild(doc.createTextNode(" "));
  chip.appendChild(label);
  return chip;
}

function renderAssignmentsEmpty(mount: HTMLElement): void {
  const p = mount.ownerDocument.createElement("p");
  p.setAttribute("data-testid", "assignments-empty");
  p.textContent =
    "No assignments are open for you right now. Check back after your teacher publishes one.";
  mount.appendChild(p);
}

function renderAssignmentsError(
  mount: HTMLElement,
  onRetry: () => void,
): void {
  const banner = renderErrorBanner(
    mount,
    "We could not load your assignments. Check your connection and try again.",
  );
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

function renderAssignmentsList(
  mount: HTMLElement,
  items: ReadonlyArray<AssignmentsListForStudentItem>,
  launch: ((url: string) => void) | undefined,
  statusByAssignment: ReadonlyMap<string, StudentResultAggregate> | null,
): void {
  const doc = mount.ownerDocument;
  const list = doc.createElement("ul");
  list.setAttribute("data-testid", "assignments-list");
  list.className = "shell-list";
  for (const item of items) {
    const url = buildAssignmentLaunchUrl(item);
    if (url === null) continue;
    const li = doc.createElement("li");
    li.setAttribute("data-testid", "assignments-item");

    const heading = doc.createElement("h2");
    heading.setAttribute("data-testid", "assignments-item-title");
    // Titles are user-authored content routed through Element.textContent
    // (never innerHTML). No launch URL is constructed from the title.
    heading.textContent = item.title;
    li.appendChild(heading);

    // Status decoration. Only rendered when the caller-scoped result read
    // is available, so a missing or failed results read degrades to the
    // launch-only card rather than mislabeling attempted work. An
    // assignment with no completed attempt derives Ready to Begin.
    if (statusByAssignment !== null) {
      const aggregate = statusByAssignment.get(item.assignmentId);
      const status: StudentStatusKey = aggregate ? aggregate.status : "ready";
      // Sprint 28.5B (B4): flag strongly-completed work (a best score that
      // derives Well Done! or Perfect Score) so the stylesheet can quiet the
      // card and let the eye settle on unfinished work first. This is
      // presentation only: the card stays visible, its title/status/label
      // and accessible name are unchanged, its Open assignment control and
      // launch URL are unchanged, and no authorization, lifecycle, or backend
      // state is affected. Only rendered when the caller-scoped results read
      // succeeded (status is known); a degraded launch-only card is never
      // marked complete.
      if (status === "perfect" || status === "wellDone") {
        li.setAttribute("data-complete", "true");
      }
      li.appendChild(renderStatusChip(doc, status, "assignments-item-status"));
    }

    const btn = doc.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-testid", "assignments-launch");
    btn.setAttribute("data-assignment-launch-url", url);
    btn.textContent = "Open assignment";
    btn.addEventListener("click", () => {
      if (launch) launch(url);
    });
    li.appendChild(btn);

    list.appendChild(li);
  }
  mount.appendChild(list);
}

// -----------------------------------------------------------------------------
// My Results rendering
// -----------------------------------------------------------------------------

function renderResultsEmpty(mount: HTMLElement): void {
  const p = mount.ownerDocument.createElement("p");
  p.setAttribute("data-testid", "results-empty");
  p.textContent = "You have not completed any assignments yet.";
  mount.appendChild(p);
}

function renderResultsError(mount: HTMLElement, onRetry: () => void): void {
  const banner = renderErrorBanner(
    mount,
    "We could not load your results. Check your connection and try again.",
  );
  banner.setAttribute("data-testid", "results-error");
  const retry = renderPrimaryButton(
    mount,
    "Try again",
    () => {
      onRetry();
    },
    "results-retry",
  );
  retry.setAttribute("aria-label", "Try again");
}

function renderResultsList(
  mount: HTMLElement,
  aggregates: ReadonlyMap<string, StudentResultAggregate>,
  assignments: ReadonlyArray<AssignmentsListForStudentItem>,
  launch: ((url: string) => void) | undefined,
): void {
  const doc = mount.ownerDocument;
  // Index the current assignment list by assignmentId for the title and
  // launch-target join. Both reads are caller-scoped; no cross-student
  // data is involved.
  const byId = new Map<string, AssignmentsListForStudentItem>();
  for (const item of assignments) byId.set(item.assignmentId, item);

  const list = doc.createElement("ul");
  list.setAttribute("data-testid", "results-list");
  list.className = "shell-list";

  for (const aggregate of aggregates.values()) {
    const item = byId.get(aggregate.assignmentId) ?? null;
    const launchUrl = item ? buildAssignmentLaunchUrl(item) : null;

    const li = doc.createElement("li");
    li.setAttribute("data-testid", "results-item");

    const heading = doc.createElement("h2");
    heading.setAttribute("data-testid", "results-item-title");
    // Title-join behavior: when the current assignment record is
    // available, use its title; otherwise fall back to a safe,
    // understandable label rather than exposing an internal id
    // (blueprint §5.4 title-join fallback). Titles are user-authored and
    // routed through textContent (never innerHTML).
    heading.textContent = item ? item.title : "Assignment no longer listed";
    li.appendChild(heading);

    li.appendChild(
      renderStatusChip(doc, aggregate.status, "results-status"),
    );

    const best = doc.createElement("p");
    best.setAttribute("data-testid", "results-best-score");
    best.textContent = `Best score: ${aggregate.bestScore} / ${aggregate.bestMaxScore}`;
    li.appendChild(best);

    const count = doc.createElement("p");
    count.setAttribute("data-testid", "results-attempt-count");
    count.textContent =
      aggregate.attemptCount === 1
        ? "1 attempt completed"
        : `${aggregate.attemptCount} attempts completed`;
    li.appendChild(count);

    // Improve My Score is offered on every less-than-perfect best score
    // (PDR-024k), but only when a launchable target exists (fail closed;
    // a result whose assignment is no longer listed cannot be relaunched,
    // blueprint §5.4). It reuses the existing launch path; it never begins
    // a session directly.
    if (aggregate.canImprove && launchUrl !== null) {
      const improve = doc.createElement("button");
      improve.type = "button";
      improve.setAttribute("data-testid", "results-improve");
      improve.setAttribute("data-assignment-launch-url", launchUrl);
      improve.textContent = "Improve My Score";
      improve.setAttribute("aria-label", "Improve My Score");
      improve.addEventListener("click", () => {
        if (launch) launch(launchUrl);
      });
      li.appendChild(improve);
    }

    list.appendChild(li);
  }
  mount.appendChild(list);
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
      "If you believe this is a mistake, contact your school administrator or LyfeLabz support at teachers@lyfelabz.example.",
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
      support.textContent =
        "Contact support at teachers@lyfelabz.example with your email address.";
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
