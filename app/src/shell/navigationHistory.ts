import type { WorkspaceSurfaceKey } from "./navigation";

// Browser Back/Forward support. The smallest serializable history-state
// shape needed to restore meaningful teacher-shell navigation. Never
// carries DOM nodes, Session objects, callables, or display text - only
// stable identifiers already used elsewhere in the shell
// (WorkspaceSurfaceKey, classId, studentId) - so a value delivered
// through `popstate.state` can always be independently re-validated
// before anything acts on it. `event.state` reflects whatever an
// earlier `pushState`/`replaceState` call in this origin supplied, but
// is still treated as untrusted input here: a stale, foreign, or
// hand-crafted entry must fail closed, never throw or restore an
// unauthorized surface.
export type ShellHistoryState =
  | { readonly kind: "shell-surface"; readonly surface: WorkspaceSurfaceKey }
  | {
      readonly kind: "shell-student-detail";
      readonly surface: "classes";
      readonly classId: string;
      readonly studentId: string;
    };

const WORKSPACE_SURFACE_KEYS: ReadonlySet<string> = new Set([
  "classes",
  "curriculum",
  "settings",
]);

export function isWorkspaceSurfaceKey(
  value: unknown,
): value is WorkspaceSurfaceKey {
  return typeof value === "string" && WORKSPACE_SURFACE_KEYS.has(value);
}

// Strict, defensive parse of an arbitrary `popstate.state` value. This is
// the single choke point new history-state shapes must pass through, so
// a malformed, foreign, or pre-feature history entry is always ignored
// rather than guessed at.
export function parseShellHistoryState(
  value: unknown,
): ShellHistoryState | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "shell-surface" && isWorkspaceSurfaceKey(v.surface)) {
    return { kind: "shell-surface", surface: v.surface };
  }
  if (
    v.kind === "shell-student-detail" &&
    v.surface === "classes" &&
    typeof v.classId === "string" &&
    v.classId.length > 0 &&
    typeof v.studentId === "string" &&
    v.studentId.length > 0
  ) {
    return {
      kind: "shell-student-detail",
      surface: "classes",
      classId: v.classId,
      studentId: v.studentId,
    };
  }
  return null;
}

// Minimal URL representation. Firebase Hosting rewrites `/app/teacher`
// (and the other session-kind paths router.ts writes) to
// `/app/index.html`; a hash fragment is never sent to the server, so
// appending one here needs no new rewrite rule and cannot 404 on
// refresh or direct entry. Only stable opaque identifiers appear here -
// never a student's name or other display text.
export function hashForSurface(surface: WorkspaceSurfaceKey): string {
  return `#${surface}`;
}

export function hashForStudentDetail(
  classId: string,
  studentId: string,
): string {
  return `#classes/student/${encodeURIComponent(classId)}/${encodeURIComponent(studentId)}`;
}

export function parseSurfaceFromHash(hash: string): WorkspaceSurfaceKey | null {
  const clean = hash.startsWith("#") ? hash.slice(1) : hash;
  return isWorkspaceSurfaceKey(clean) ? clean : null;
}

export function urlWithHash(pathname: string, hash: string): string {
  return `${pathname}${hash}`;
}
