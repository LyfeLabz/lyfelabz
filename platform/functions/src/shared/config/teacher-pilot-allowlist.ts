import { PlatformError } from "../errors/platform-error";
import { getAdminFirestore } from "../firestore/admin";

// Sprint 29C - Teacher Pilot Authorization Guardrail.
//
// A narrow, server-side, belt-and-suspenders control at the teacher
// approval boundary. The existing admin approval flow remains the primary
// authorization mechanism; this guardrail adds a second, independent gate
// so that an authenticated Google user cannot become a teacher merely
// because a Platform Administrator accidentally approves them. Teacher
// activation now requires BOTH:
//
//   1. an explicit `platformAdministrator` approval (unchanged), and
//   2. membership in the pilot allowlist checked here.
//
// Configuration source: a single protected Firestore document,
// `platformConfig/teacherPilotAllowlist`, whose body is `{ emails: string[] }`.
// The document is denied to every client role at the Rules layer (mirroring
// `assessmentAnswerKeys`, `externalIdentities`, and `auditEvents`); only
// Cloud Function code running under Admin SDK authority reads it. Pilot
// email addresses therefore never reach a client bundle, a callable
// response, a URL, or Firestore data readable by students or teachers.
// Membership is edited by changing this one document (Console or an
// Admin-credentialed script); no frontend or function redeploy is required
// to change pilot membership.
//
// Identity source: the caller supplies only a target UID to the approval
// callable. The email compared here is read server-side from the
// authoritative `users/{uid}` record, which is populated by
// `authOnUserCreate` from the Google/Firebase Auth record. A client can
// never supply the email that is matched, so allowlist membership cannot be
// spoofed from the request payload.
//
// Fail-closed: a missing document, a missing/empty/malformed `emails`
// field, or an absent target email all refuse activation. During the pilot
// the document must be populated before any new teacher can be approved.

export const PLATFORM_CONFIG_COLLECTION = "platformConfig";
export const TEACHER_PILOT_ALLOWLIST_DOC_ID = "teacherPilotAllowlist";

// Canonical read shape of `platformConfig/teacherPilotAllowlist`. Every
// field is optional so a malformed or partially-populated document is
// tolerated by the reader and resolved by failing closed.
//
// Sprint 29G.5C - `pilotSchoolId` (Option C from the 29G.5B architecture
// review) names the canonical pilot school that direct allowlisted teacher
// activation assigns server-side. It lives on the same protected document
// as `emails` so the Weston pilot school is never hard-coded into business
// logic and can be changed by editing one protected config document. The
// document remains denied to every client role at the Rules layer.
export type TeacherPilotAllowlistDoc = {
  readonly emails?: unknown;
  readonly pilotSchoolId?: unknown;
};

// Normalize an email for allowlist comparison: trim surrounding whitespace
// and lowercase. Returns `undefined` for any value that is not a non-empty
// string, so a missing or malformed identity fails closed at the call site.
// No domain or fuzzy matching is performed; comparison is exact-match on the
// normalized value.
export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

// Non-secret administrative refusal. The message intentionally does not
// name the allowlist, its size, or any member so neither the error nor the
// logs reveal pilot membership.
function refuse(): never {
  throw new PlatformError(
    "teachers.pilotNotAllowlisted",
    "This account is not authorized for the teacher pilot.",
  );
}

// Read the pilot allowlist and assert that `email` is a member. Throws
// `teachers.pilotNotAllowlisted` when the account is not permitted, when the
// configuration document is absent or malformed, or when no verified email
// is available. Resolves silently when the account is permitted.
//
// This function performs no mutation. Callers invoke it BEFORE any teacher
// status/claims write so a refusal leaves no partial activation behind.
export async function assertTeacherPilotAllowlisted(
  email: string | undefined,
): Promise<void> {
  const candidate = normalizeEmail(email);
  if (candidate === undefined) {
    // No server-trusted, verified email to match. Fail closed rather than
    // authorize an identity we cannot confirm.
    refuse();
  }

  const snapshot = await getAdminFirestore()
    .collection(PLATFORM_CONFIG_COLLECTION)
    .doc(TEACHER_PILOT_ALLOWLIST_DOC_ID)
    .get();

  if (!snapshot.exists) refuse();

  const data = snapshot.data() as TeacherPilotAllowlistDoc | undefined;
  const rawEmails = data?.emails;
  if (!Array.isArray(rawEmails) || rawEmails.length === 0) refuse();

  const allowlisted = rawEmails.some(
    (entry) => normalizeEmail(entry) === candidate,
  );
  if (!allowlisted) refuse();
}

// Non-secret refusal used when the pilot school is not configured. Kept
// distinct from the allowlist refusal so operators can tell an
// unconfigured pilot school apart from a non-allowlisted teacher without
// either error revealing protected configuration contents.
function refusePilotSchoolUnconfigured(): never {
  throw new PlatformError(
    "teachers.pilotSchoolUnconfigured",
    "The teacher pilot school is not configured.",
  );
}

// Resolve the canonical pilot `schoolId` from the protected
// `platformConfig/teacherPilotAllowlist` document. Returns the trimmed
// non-empty `pilotSchoolId`. Fails closed with
// `teachers.pilotSchoolUnconfigured` when the document is absent, when the
// field is missing, or when it is not a non-empty string, so a
// misconfigured pilot can never activate a teacher against an unknown or
// empty school. This performs no mutation and never returns a
// client-supplied value; the caller resolves the school and district
// entirely from server-trusted configuration and the canonical
// `schools/{schoolId}` record.
export async function resolvePilotSchoolId(): Promise<string> {
  const snapshot = await getAdminFirestore()
    .collection(PLATFORM_CONFIG_COLLECTION)
    .doc(TEACHER_PILOT_ALLOWLIST_DOC_ID)
    .get();

  if (!snapshot.exists) refusePilotSchoolUnconfigured();

  const data = snapshot.data() as TeacherPilotAllowlistDoc | undefined;
  const raw = data?.pilotSchoolId;
  if (typeof raw !== "string") refusePilotSchoolUnconfigured();
  const pilotSchoolId = raw.trim();
  if (pilotSchoolId.length === 0) refusePilotSchoolUnconfigured();

  return pilotSchoolId;
}
