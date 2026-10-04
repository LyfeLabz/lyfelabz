// Per-tab student navigation mode.
//
// A student tab is in one of two explicit navigation modes, recorded in
// sessionStorage at the only two places a student leaves My Science:
//
//   "assignment"  set by the authenticated student launch boundary (the My
//                 Science launcher and the `/app/a/{id}` arrival, both through
//                 browserLaunch.ts) immediately before navigating into
//                 `/app/lessons/**`.
//   "explore"     set when the student chooses Explore LyfeLabz on My Science,
//                 immediately before the browser follows that link to the
//                 public catalog.
//
// Each transition overwrites the other, so an assignment launched after
// exploring is assignment delivery again, and exploring after an assignment is
// exploration. Sign-out removes the mode. A missing, unreadable, or unknown
// value means "no student mode": every page keeps its normal navigation.
//
// Consumers (each duplicates KEY and the values as literals; the tests pin the
// copies together):
//   - the shared runtime shim (assets/lyfelabz-assessment-runtime.js) turns the
//     lesson header's catalog link into Back to My Science in assignment mode;
//   - the public catalog (index.html) reveals its Back to My Science link in
//     explore mode.
//
// The value carries no identity, assignment, answer, or assessment data: only
// one of the fixed literals below. It is per-tab (sessionStorage, never
// localStorage) and does not influence launch grants, revision identity,
// differentiation, Current, or Classroom behavior.

export const STUDENT_NAV_MODE_KEY = "lyfelabz.studentNav.v1";

export type StudentNavMode = "assignment" | "explore";

// The global student exit. A real navigation target, never history.back().
export const MY_SCIENCE_PATH = "/app/student";

// The LyfeLabz catalog a student explores from My Science: the public index
// served at the site root (the same destination as the existing "Return to
// public lessons" links). `/app/lessons/index.html` is the application shell,
// not a catalog.
export const EXPLORE_CATALOG_PATH = "/";

type StorageHost = Pick<Window, "sessionStorage">;

function storageOf(win: StorageHost): Storage | null {
  try {
    return win.sessionStorage ?? null;
  } catch {
    // Storage can throw (blocked site data). Pages then keep their normal
    // navigation; the assignment fragment remains valid evidence on its own.
    return null;
  }
}

function writeMode(win: StorageHost, mode: StudentNavMode | null): void {
  try {
    const storage = storageOf(win);
    if (storage === null) return;
    if (mode === null) storage.removeItem(STUDENT_NAV_MODE_KEY);
    else storage.setItem(STUDENT_NAV_MODE_KEY, mode);
  } catch {
    // Best effort; never blocks a launch, an exploration link, or sign-out.
  }
}

export function enterAssignmentDelivery(win: StorageHost): void {
  writeMode(win, "assignment");
}

export function enterStudentExploration(win: StorageHost): void {
  writeMode(win, "explore");
}

export function clearStudentNavigation(win: StorageHost): void {
  writeMode(win, null);
}

export function readStudentNavigation(win: StorageHost): StudentNavMode | null {
  try {
    const value = storageOf(win)?.getItem(STUDENT_NAV_MODE_KEY) ?? null;
    return value === "assignment" || value === "explore" ? value : null;
  } catch {
    return null;
  }
}
