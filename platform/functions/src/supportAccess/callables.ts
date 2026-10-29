import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  classDocRef,
  enrollmentDocRef,
  isTransactionContention,
  log,
  normalizeEmail,
  platformCallable,
  requireDistrictContext,
  runFirestoreTransaction,
  studentSupportGrantDocRef,
  studentSupportGrantIdFor,
  studentSupportGrantRevokeDocRef,
  studentSupportGrantWriteDocRef,
  studentSupportGrantsCollectionRef,
  userRecordDocRef,
  usersByEmailQuery,
  writeAuditEventInTransaction,
  type ClassRecord,
  type StudentSupportGrantRecord,
  type UserRecord,
} from "../shared";
import { getAdminAuth } from "../shared/auth/admin";
import { createRosterDisplayNameResolver } from "../enrollments/resolve-roster-display-name";
import { authorizeStudentScopedRead, type StudentScopedReadActor } from "./authorize";

// Student Support Access (PDR-032, docs/platform/STUDENT_SUPPORT_ACCESS.md
// section 3). Grant management for the server-only `studentSupportGrants`
// collection.
//
//   supportAccessGrant         { classId, studentId, granteeEmail }      owner
//   supportAccessGrantMany     { classId, studentIds[], granteeEmails[] } owner
//   supportAccessRevoke        { grantId }                               owner
//   supportAccessRevokeMany    { grantIds[] }                            owner
//   supportAccessListForClass  { classId }                               owner
//   supportAccessListMine      {}                                        grantee
//
// Every call requires an authenticated, active teacher
// (`requireDistrictContext`). No request accepts an ownership key. Grant and
// revoke write their audit event in the same transaction as the record
// change, and only when the status actually changes. The bulk callables run
// the same per-grant transaction bodies (`applyGrantInTransaction`,
// `applyRevokeInTransaction`) as the single ones.

const ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;
const GRANT_ID_PATTERN = /^[a-zA-Z0-9_-]{5,800}$/;
const OWNERSHIP_KEYS = ["uid", "userId", "teacherId", "ownerTeacherId", "granteeUid", "schoolId", "districtId"] as const;
const MAX_EMAIL_LENGTH = 320;
// A bulk email entry longer than this is a malformed request, not a
// per-recipient failure, so the payload stays bounded.
const MAX_RAW_EMAIL_LENGTH = 1024;

// Server-side bulk caps (STUDENT_SUPPORT_ACCESS.md section 3.1). Counted on
// the raw arrays, before de-duplication, so the work per call is bounded.
export const SUPPORT_ACCESS_GRANT_MANY_MAX_STUDENTS = 40;
export const SUPPORT_ACCESS_GRANT_MANY_MAX_RECIPIENTS = 10;
export const SUPPORT_ACCESS_REVOKE_MANY_MAX_GRANTS = 200;
// Grants revoked per transaction: two writes each (record + audit), far
// below Firestore's 500-write transaction limit.
const REVOKE_MANY_CHUNK = 50;

export type SupportGrantView = {
  readonly grantId: string;
  readonly classId: string;
  readonly studentId: string;
  readonly studentDisplayName: string;
  readonly granteeDisplayName: string;
  readonly granteeEmail: string | null;
  readonly grantedAt: number | null;
};

export type SharedStudentView = {
  readonly grantId: string;
  readonly classId: string;
  readonly classTitle: string;
  readonly studentId: string;
  readonly studentDisplayName: string;
  readonly ownerDisplayName: string;
  // The class's authoritative `block`, read from the class record at list
  // time (never copied into the grant). Null if the record has none.
  readonly classBlock: string | null;
};

function invalid(message: string): never {
  throw new PlatformError("supportAccess.invalidRequest", message);
}

function asPayload(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    invalid("Request payload must be a structured object.");
  }
  const payload = data as Record<string, unknown>;
  for (const key of OWNERSHIP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      invalid(`Field "${key}" is not permitted on the request.`);
    }
  }
  return payload;
}

function readId(payload: Record<string, unknown>, key: string, pattern = ID_PATTERN): string {
  const value = payload[key];
  if (typeof value !== "string" || !pattern.test(value)) invalid(`${key} is invalid.`);
  return value;
}

// A non-empty array of at most `max` raw entries. Returns it as-is; callers
// validate and de-duplicate entries.
function readArray(payload: Record<string, unknown>, key: string, max: number): readonly unknown[] {
  const value = payload[key];
  if (!Array.isArray(value) || value.length === 0) invalid(`${key} must be a non-empty list.`);
  if (value.length > max) invalid(`${key} may contain at most ${max} entries.`);
  return value;
}

// Every entry must be a well-formed id; duplicates collapse, first order kept.
function readIdList(payload: Record<string, unknown>, key: string, max: number, pattern = ID_PATTERN): string[] {
  const ids = new Set<string>();
  for (const value of readArray(payload, key, max)) {
    if (typeof value !== "string" || !pattern.test(value)) invalid(`${key} contains an invalid id.`);
    ids.add(value);
  }
  return Array.from(ids);
}

function normalizeGranteeEmail(email: string): string | undefined {
  const raw = email.trim();
  const normalized = normalizeEmail(raw);
  if (normalized === undefined || raw.length > MAX_EMAIL_LENGTH || !normalized.includes("@")) return undefined;
  return normalized;
}

function enrollmentIsActive(
  enrollment: { status?: unknown; classId?: unknown; studentId?: unknown; schoolId?: unknown } | undefined,
  classId: string,
  studentId: string,
  schoolId: string,
): boolean {
  return (
    enrollment !== undefined &&
    enrollment.status === "active" &&
    enrollment.classId === classId &&
    enrollment.studentId === studentId &&
    enrollment.schoolId === schoolId
  );
}

async function loadGrantableClass(classId: string, actor: StudentScopedReadActor): Promise<ClassRecord> {
  const classRecord = await loadOwnedClass(classId, actor);
  if (classRecord.status !== "active") {
    throw new PlatformError("supportAccess.classNotActive", "Support access needs an active class.");
  }
  return classRecord;
}

async function requireTeacher(request: CallableRequest<unknown>): Promise<StudentScopedReadActor> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError("role-forbidden", "Caller must be an active teacher.");
  }
  return { uid: context.uid, schoolId: context.schoolId, districtId: context.districtId };
}

async function loadOwnedClass(classId: string, actor: StudentScopedReadActor): Promise<ClassRecord> {
  const snap = await classDocRef(classId).get();
  const data = snap.exists ? snap.data() : undefined;
  if (!data || data.teacherId !== actor.uid || data.schoolId !== actor.schoolId) {
    throw new PlatformError("classes.forbidden", "Caller does not own this class.");
  }
  return data;
}

function displayNameOf(user: UserRecord | undefined, fallback: string): string {
  const name = typeof user?.displayName === "string" ? user.displayName.trim().replace(/\s+/g, " ") : "";
  return name.length > 0 ? name : fallback;
}

async function readUser(uid: string): Promise<UserRecord | undefined> {
  const snap = await userRecordDocRef(uid).get();
  const data = snap.exists ? snap.data() : undefined;
  return data !== undefined && data.authUid === uid ? data : undefined;
}

function millis(value: unknown): number | null {
  const ts = value as { toMillis?: () => number } | undefined;
  if (ts === undefined || ts === null || typeof ts.toMillis !== "function") return null;
  const ms = ts.toMillis();
  return Number.isFinite(ms) ? ms : null;
}

// A stored record is trusted only when its id and frozen fields agree.
function grantMatchesId(grantId: string, data: StudentSupportGrantRecord | undefined): data is StudentSupportGrantRecord {
  return (
    data !== undefined &&
    grantId === studentSupportGrantIdFor(data.classId, data.studentId, data.granteeUid)
  );
}

// Same-school teacher lookup. Every non-match (unknown, another school,
// inactive, non-teacher, ambiguous, or the caller) is one uniform refusal, so
// the only thing a teacher can learn is whether an email belongs to an active
// teacher at their own school.
//
// `users/{uid}.email` is copied verbatim from the Firebase Auth record at
// provisioning and has no normalized twin, so the equality queries match the
// entered email as typed and lowercased. When neither matches (a record
// stored with different capitalization), ONE Firebase Auth `getUserByEmail`
// lookup resolves the identity case-insensitively, the same canonical
// email-to-identity path the operator bootstrap tools use. Its uid is only a
// candidate: the canonical `users/{uid}` record must pass every check below.
// No scan, no migration, no new field.
async function resolveGrantee(email: string, actor: StudentScopedReadActor): Promise<{ uid: string; user: UserRecord }> {
  const raw = email.trim();
  const normalized = normalizeGranteeEmail(email);
  if (normalized === undefined) invalid("granteeEmail is invalid.");
  const lookups = Array.from(new Set([normalized, raw]));
  const snaps = await Promise.all(lookups.map((value) => usersByEmailQuery(value).get()));
  const matches = new Map<string, UserRecord>();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!data) continue;
      if (doc.id === actor.uid) continue;
      if (data.authUid !== doc.id) continue;
      if (data.status !== "active" || data.role !== "teacher") continue;
      if (data.schoolId !== actor.schoolId) continue;
      if (normalizeEmail(data.email) !== normalized) continue;
      matches.set(doc.id, data);
    }
  }
  if (matches.size === 0) {
    const authUid = await getAdminAuth()
      .getUserByEmail(normalized)
      .then((record) => record.uid)
      .catch(() => null);
    if (authUid !== null && authUid !== actor.uid) {
      const data = (await userRecordDocRef(authUid).get()).data();
      if (
        data !== undefined &&
        data.authUid === authUid &&
        data.status === "active" &&
        data.role === "teacher" &&
        data.schoolId === actor.schoolId &&
        normalizeEmail(data.email) === normalized
      ) {
        matches.set(authUid, data);
      }
    }
  }
  if (matches.size !== 1) {
    throw new PlatformError(
      "supportAccess.granteeUnavailable",
      "No other active teacher at your school matches that email.",
    );
  }
  const [[uid, user]] = Array.from(matches.entries()) as [[string, UserRecord]];
  return { uid, user };
}

function transactionConflict(err: unknown): never {
  if (isTransactionContention(err)) {
    throw new PlatformError("supportAccess.writeConflict", "Another update was in progress. Please try again.", err);
  }
  throw err;
}

// ---------- shared grant / revoke transaction bodies ----------

// Outcome of one grant inside a transaction. `inconsistent`: a record exists
// under this id whose frozen fields disagree with its id or with the caller,
// so nothing is written.
type GrantApplyOutcome = "shared" | "alreadyShared" | "inconsistent";

// The one grant transaction body, shared by `supportAccessGrant` and
// `supportAccessGrantMany`. `existing` is the record read in THIS
// transaction (Firestore requires every read before any write). An active
// grant is left untouched (no rewrite, no audit), so active access and its
// `grantedAt` are never disturbed by a repeat.
function applyGrantInTransaction(
  tx: Transaction,
  actor: StudentScopedReadActor,
  pair: { readonly grantId: string; readonly classId: string; readonly studentId: string; readonly granteeUid: string },
  existing: StudentSupportGrantRecord | undefined,
): GrantApplyOutcome {
  const { grantId, classId, studentId, granteeUid } = pair;
  if (existing !== undefined) {
    if (
      !grantMatchesId(grantId, existing) ||
      existing.ownerTeacherId !== actor.uid ||
      existing.schoolId !== actor.schoolId ||
      existing.districtId !== actor.districtId
    ) {
      return "inconsistent";
    }
    if (existing.status === "active") return "alreadyShared";
  }
  tx.set(studentSupportGrantWriteDocRef(grantId), {
    classId,
    studentId,
    ownerTeacherId: actor.uid,
    granteeUid,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    status: "active",
    grantedAt: FieldValue.serverTimestamp(),
    grantedBy: actor.uid,
  });
  writeAuditEventInTransaction(tx, {
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "supportAccess.granted",
    targetType: "studentSupportGrant",
    targetId: grantId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: { classId, studentId, granteeUid },
  });
  return "shared";
}

// `notFound` covers a missing record and one naming another owner alike, so
// a caller never learns whether another teacher's grant id exists.
type RevokeApplyOutcome = "revoked" | "alreadyRevoked" | "notFound";

// The one revoke transaction body, shared by `supportAccessRevoke` and
// `supportAccessRevokeMany`.
function applyRevokeInTransaction(
  tx: Transaction,
  actor: StudentScopedReadActor,
  grantId: string,
  existing: StudentSupportGrantRecord | undefined,
): RevokeApplyOutcome {
  if (
    !grantMatchesId(grantId, existing) ||
    existing.ownerTeacherId !== actor.uid ||
    existing.schoolId !== actor.schoolId ||
    existing.districtId !== actor.districtId
  ) {
    return "notFound";
  }
  if (existing.status === "revoked") return "alreadyRevoked";
  tx.update(studentSupportGrantRevokeDocRef(grantId), {
    status: "revoked",
    revokedAt: FieldValue.serverTimestamp(),
    revokedBy: actor.uid,
  });
  writeAuditEventInTransaction(tx, {
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "supportAccess.revoked",
    targetType: "studentSupportGrant",
    targetId: grantId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: { classId: existing.classId, studentId: existing.studentId, granteeUid: existing.granteeUid },
  });
  return "revoked";
}

async function readGrantsInTransaction(
  tx: Transaction,
  grantIds: readonly string[],
): Promise<Array<StudentSupportGrantRecord | undefined>> {
  const snaps = await Promise.all(grantIds.map((grantId) => tx.get(studentSupportGrantDocRef(grantId))));
  return snaps.map((snap) => (snap.exists ? snap.data() : undefined));
}

// ---------- supportAccessGrant ----------

// `outcome` is additive (V2): V1 clients read only `grant`.
export type SupportAccessGrantResponse = {
  readonly grant: SupportGrantView;
  readonly outcome: "shared" | "alreadyShared";
};

async function grantHandler(request: CallableRequest<unknown>): Promise<SupportAccessGrantResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data);
  const classId = readId(payload, "classId");
  const studentId = readId(payload, "studentId");
  const granteeEmail = payload.granteeEmail;
  if (typeof granteeEmail !== "string") invalid("granteeEmail is invalid.");

  const classRecord = await loadGrantableClass(classId, actor);
  const enrollmentSnap = await enrollmentDocRef(`${classId}__${studentId}`).get();
  const enrollment = enrollmentSnap.exists ? enrollmentSnap.data() : undefined;
  if (!enrollmentIsActive(enrollment, classId, studentId, classRecord.schoolId)) {
    throw new PlatformError("supportAccess.studentNotEnrolled", "That student is not active in this class.");
  }

  const grantee = await resolveGrantee(granteeEmail, actor);
  const grantId = studentSupportGrantIdFor(classId, studentId, grantee.uid);

  let outcome: GrantApplyOutcome = "alreadyShared";
  try {
    outcome = await runFirestoreTransaction(async (tx) => {
      const [existing] = await readGrantsInTransaction(tx, [grantId]);
      return applyGrantInTransaction(tx, actor, { grantId, classId, studentId, granteeUid: grantee.uid }, existing);
    });
  } catch (err) {
    transactionConflict(err);
  }
  if (outcome === "inconsistent") {
    throw new PlatformError("supportAccess.notFound", "Support access record is inconsistent.");
  }

  const resolveName = createRosterDisplayNameResolver({ classId, schoolId: actor.schoolId, districtId: actor.districtId });
  const student = await resolveName(studentId);
  const stored = await studentSupportGrantDocRef(grantId).get();
  log.info("supportAccess.granted", { actorUserId: actor.uid, grantId, changed: outcome === "shared" });
  return {
    grant: {
      grantId,
      classId,
      studentId,
      studentDisplayName: student.displayName,
      granteeDisplayName: displayNameOf(grantee.user, "Teacher"),
      granteeEmail: normalizeEmail(grantee.user.email) ?? null,
      grantedAt: millis(stored.exists ? stored.data()?.grantedAt : undefined),
    },
    outcome,
  };
}

// ---------- supportAccessGrantMany ----------

// Why one pair was not shared. Recipient failures are deliberately coarse:
// `granteeUnavailable` is the same uniform refusal the single grant uses
// (unknown, another school, inactive, non-teacher, ambiguous, or the caller);
// `invalidEmail` means only that the text is not an email address.
export type SupportAccessGrantFailureReason =
  | "invalidEmail"
  | "granteeUnavailable"
  | "studentNotEnrolled"
  | "recordInconsistent"
  | "writeConflict"
  | "unavailable";

export type SupportAccessGrantManyResult = {
  readonly studentId: string;
  // The recipient as entered, normalized (trimmed and lowercased).
  readonly granteeEmail: string;
  readonly outcome: "shared" | "alreadyShared" | "failed";
  // Present only when the pair is (now) shared.
  readonly grantId: string | null;
  readonly granteeDisplayName: string | null;
  readonly reason: SupportAccessGrantFailureReason | null;
};

export type SupportAccessGrantManyResponse = {
  readonly classId: string;
  readonly results: readonly SupportAccessGrantManyResult[];
  readonly summary: { readonly shared: number; readonly alreadyShared: number; readonly failed: number };
};

type ResolvedRecipient =
  | { readonly ok: true; readonly email: string; readonly uid: string; readonly user: UserRecord }
  | { readonly ok: false; readonly email: string; readonly reason: "invalidEmail" | "granteeUnavailable" };

function readGranteeEmails(payload: Record<string, unknown>): string[] {
  const emails = new Set<string>();
  for (const value of readArray(payload, "granteeEmails", SUPPORT_ACCESS_GRANT_MANY_MAX_RECIPIENTS)) {
    if (typeof value !== "string" || value.length > MAX_RAW_EMAIL_LENGTH) invalid("granteeEmails contains an invalid entry.");
    const trimmed = value.trim();
    if (trimmed.length === 0) invalid("granteeEmails contains an empty entry.");
    emails.add(normalizeGranteeEmail(trimmed) ?? trimmed);
  }
  return Array.from(emails);
}

async function resolveRecipient(email: string, actor: StudentScopedReadActor): Promise<ResolvedRecipient> {
  if (normalizeGranteeEmail(email) === undefined) return { ok: false, email, reason: "invalidEmail" };
  try {
    const { uid, user } = await resolveGrantee(email, actor);
    return { ok: true, email, uid, user };
  } catch (err) {
    if (err instanceof PlatformError && err.code === "supportAccess.granteeUnavailable") {
      return { ok: false, email, reason: "granteeUnavailable" };
    }
    throw err;
  }
}

// Class ownership and class status apply to the whole request and refuse it
// with the single grant's codes. Everything per student or per recipient is
// a per-pair outcome, so one bad entry never blocks the valid pairs. Each
// student's pairs commit in their own transaction (at most 10 grants and 10
// audit events), so a failure is confined to that student and every result
// reports exactly what committed. Students run one at a time to bound load.
async function grantManyHandler(request: CallableRequest<unknown>): Promise<SupportAccessGrantManyResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data);
  const classId = readId(payload, "classId");
  const studentIds = readIdList(payload, "studentIds", SUPPORT_ACCESS_GRANT_MANY_MAX_STUDENTS);
  const emails = readGranteeEmails(payload);

  const classRecord = await loadGrantableClass(classId, actor);

  const [recipients, enrollmentSnaps] = await Promise.all([
    Promise.all(emails.map((email) => resolveRecipient(email, actor))),
    Promise.all(studentIds.map((studentId) => enrollmentDocRef(`${classId}__${studentId}`).get())),
  ]);
  const enrolled = new Set<string>();
  studentIds.forEach((studentId, i) => {
    const snap = enrollmentSnaps[i];
    const enrollment = snap !== undefined && snap.exists ? snap.data() : undefined;
    if (enrollmentIsActive(enrollment, classId, studentId, classRecord.schoolId)) enrolled.add(studentId);
  });

  // Distinct emails resolve to distinct uids (the match requires the stored
  // email to equal the entered one), but grant ids are de-duplicated anyway
  // so no record is ever written twice in one request.
  const outcomes = new Map<string, GrantApplyOutcome | "writeConflict" | "unavailable">();
  for (const studentId of studentIds) {
    if (!enrolled.has(studentId)) continue;
    const pairs = new Map<string, { grantId: string; classId: string; studentId: string; granteeUid: string }>();
    for (const recipient of recipients) {
      if (!recipient.ok) continue;
      const grantId = studentSupportGrantIdFor(classId, studentId, recipient.uid);
      pairs.set(grantId, { grantId, classId, studentId, granteeUid: recipient.uid });
    }
    if (pairs.size === 0) continue;
    const list = Array.from(pairs.values());
    try {
      // Outcomes are returned, not accumulated, so an SDK retry of the
      // transaction function never leaves stale results behind.
      const applied = await runFirestoreTransaction(async (tx) => {
        const existing = await readGrantsInTransaction(tx, list.map((p) => p.grantId));
        return list.map((pair, i) => applyGrantInTransaction(tx, actor, pair, existing[i]));
      });
      list.forEach((pair, i) => outcomes.set(pair.grantId, applied[i] ?? "unavailable"));
    } catch (err) {
      const reason = isTransactionContention(err) ? "writeConflict" : "unavailable";
      if (reason === "unavailable") log.error("supportAccess.grantManyStudentFailed", { actorUserId: actor.uid, classId, studentId, cause: err instanceof Error ? err.name : "unknown" });
      for (const pair of list) outcomes.set(pair.grantId, reason);
    }
  }

  const results: SupportAccessGrantManyResult[] = [];
  const summary = { shared: 0, alreadyShared: 0, failed: 0 };
  for (const studentId of studentIds) {
    for (const recipient of recipients) {
      const failed = (reason: SupportAccessGrantFailureReason): SupportAccessGrantManyResult => ({
        studentId,
        granteeEmail: recipient.email,
        outcome: "failed",
        grantId: null,
        granteeDisplayName: null,
        reason,
      });
      let result: SupportAccessGrantManyResult;
      if (!recipient.ok) {
        result = failed(recipient.reason);
      } else if (!enrolled.has(studentId)) {
        result = failed("studentNotEnrolled");
      } else {
        const grantId = studentSupportGrantIdFor(classId, studentId, recipient.uid);
        const outcome = outcomes.get(grantId) ?? "unavailable";
        if (outcome === "shared" || outcome === "alreadyShared") {
          result = {
            studentId,
            granteeEmail: recipient.email,
            outcome,
            grantId,
            granteeDisplayName: displayNameOf(recipient.user, "Teacher"),
            reason: null,
          };
        } else {
          result = failed(outcome === "inconsistent" ? "recordInconsistent" : outcome);
        }
      }
      summary[result.outcome] += 1;
      results.push(result);
    }
  }

  log.info("supportAccess.grantedMany", {
    actorUserId: actor.uid,
    classId,
    students: studentIds.length,
    recipients: recipients.length,
    ...summary,
  });
  return { classId, results, summary };
}

// ---------- supportAccessRevoke ----------

export type SupportAccessRevokeResponse = { readonly grantId: string; readonly status: "revoked" };

async function revokeHandler(request: CallableRequest<unknown>): Promise<SupportAccessRevokeResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data);
  const grantId = readId(payload, "grantId", GRANT_ID_PATTERN);

  let outcome: RevokeApplyOutcome = "alreadyRevoked";
  try {
    outcome = await runFirestoreTransaction(async (tx) => {
      const [existing] = await readGrantsInTransaction(tx, [grantId]);
      return applyRevokeInTransaction(tx, actor, grantId, existing);
    });
  } catch (err) {
    transactionConflict(err);
  }
  if (outcome === "notFound") {
    throw new PlatformError("supportAccess.notFound", "Support access was not found.");
  }
  log.info("supportAccess.revoked", { actorUserId: actor.uid, grantId, changed: outcome === "revoked" });
  return { grantId, status: "revoked" };
}

// ---------- supportAccessRevokeMany ----------

export type SupportAccessRevokeManyResult = {
  readonly grantId: string;
  readonly outcome: "revoked" | "alreadyRevoked" | "failed";
  // `notFound` is uniform for a missing grant and another owner's grant.
  readonly reason: "notFound" | "writeConflict" | "unavailable" | null;
};

export type SupportAccessRevokeManyResponse = {
  readonly results: readonly SupportAccessRevokeManyResult[];
  readonly summary: { readonly revoked: number; readonly alreadyRevoked: number; readonly failed: number };
};

// Each grant is checked against the caller exactly as the single revoke does;
// a grant the caller does not own is a per-grant `notFound` and never
// written. Grants commit in transactions of `REVOKE_MANY_CHUNK`, one at a
// time, so a failure is confined to its chunk.
async function revokeManyHandler(request: CallableRequest<unknown>): Promise<SupportAccessRevokeManyResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data);
  const grantIds = readIdList(payload, "grantIds", SUPPORT_ACCESS_REVOKE_MANY_MAX_GRANTS, GRANT_ID_PATTERN);

  const results: SupportAccessRevokeManyResult[] = [];
  for (let start = 0; start < grantIds.length; start += REVOKE_MANY_CHUNK) {
    const chunk = grantIds.slice(start, start + REVOKE_MANY_CHUNK);
    try {
      const applied = await runFirestoreTransaction(async (tx) => {
        const existing = await readGrantsInTransaction(tx, chunk);
        return chunk.map((grantId, i) => applyRevokeInTransaction(tx, actor, grantId, existing[i]));
      });
      chunk.forEach((grantId, i) => {
        const outcome = applied[i] ?? "notFound";
        results.push(
          outcome === "notFound"
            ? { grantId, outcome: "failed", reason: "notFound" }
            : { grantId, outcome, reason: null },
        );
      });
    } catch (err) {
      const reason = isTransactionContention(err) ? "writeConflict" : "unavailable";
      if (reason === "unavailable") log.error("supportAccess.revokeManyChunkFailed", { actorUserId: actor.uid, cause: err instanceof Error ? err.name : "unknown" });
      for (const grantId of chunk) results.push({ grantId, outcome: "failed", reason });
    }
  }

  const summary = { revoked: 0, alreadyRevoked: 0, failed: 0 };
  for (const result of results) summary[result.outcome] += 1;
  log.info("supportAccess.revokedMany", { actorUserId: actor.uid, requested: grantIds.length, ...summary });
  return { results, summary };
}

// ---------- supportAccessListForClass ----------

export type SupportAccessListForClassResponse = {
  readonly classId: string;
  readonly grants: readonly SupportGrantView[];
};

async function listForClassHandler(request: CallableRequest<unknown>): Promise<SupportAccessListForClassResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data);
  const classId = readId(payload, "classId");
  await loadOwnedClass(classId, actor);

  const snap = await studentSupportGrantsCollectionRef().where("classId", "==", classId).get();
  const rows: Array<{ id: string; data: StudentSupportGrantRecord }> = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!grantMatchesId(doc.id, data)) continue;
    if (data.status !== "active") continue;
    if (data.classId !== classId) continue;
    if (data.ownerTeacherId !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId || data.districtId !== actor.districtId) continue;
    rows.push({ id: doc.id, data });
  }

  const resolveName = createRosterDisplayNameResolver({ classId, schoolId: actor.schoolId, districtId: actor.districtId });
  const grants: SupportGrantView[] = await Promise.all(
    rows.map(async ({ id, data }) => {
      const [student, grantee] = await Promise.all([resolveName(data.studentId), readUser(data.granteeUid)]);
      return {
        grantId: id,
        classId,
        studentId: data.studentId,
        studentDisplayName: student.displayName,
        granteeDisplayName: displayNameOf(grantee, "Teacher"),
        granteeEmail: normalizeEmail(grantee?.email) ?? null,
        grantedAt: millis(data.grantedAt),
      };
    }),
  );
  grants.sort(
    (a, b) =>
      a.studentDisplayName.localeCompare(b.studentDisplayName) ||
      a.granteeDisplayName.localeCompare(b.granteeDisplayName) ||
      (a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0),
  );
  return { classId, grants };
}

// ---------- supportAccessListMine ----------

function classBlockOf(classRecord: ClassRecord): string | null {
  const block = classRecord.status === "needsSetup" ? undefined : classRecord.block;
  return typeof block === "string" && block.trim().length > 0 ? block.trim() : null;
}

export type SupportAccessListMineResponse = { readonly students: readonly SharedStudentView[] };

async function listMineHandler(request: CallableRequest<unknown>): Promise<SupportAccessListMineResponse> {
  const actor = await requireTeacher(request);
  asPayload(request.data ?? {});

  const snap = await studentSupportGrantsCollectionRef().where("granteeUid", "==", actor.uid).get();
  const candidates: Array<{ id: string; data: StudentSupportGrantRecord }> = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!grantMatchesId(doc.id, data)) continue;
    if (data.status !== "active" || data.granteeUid !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId || data.districtId !== actor.districtId) continue;
    candidates.push({ id: doc.id, data });
  }

  // Only grants that pass the full read check right now are listed, so the
  // list never offers a student whose Student Detail would be refused.
  const students: SharedStudentView[] = [];
  for (const { id, data } of candidates) {
    let classRecord: ClassRecord;
    try {
      const access = await authorizeStudentScopedRead(actor, data.classId, data.studentId);
      if (access.via !== "grant") continue;
      classRecord = access.classRecord;
    } catch {
      continue;
    }
    const resolveName = createRosterDisplayNameResolver({
      classId: data.classId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
    });
    const [student, owner] = await Promise.all([resolveName(data.studentId), readUser(classRecord.teacherId)]);
    students.push({
      grantId: id,
      classId: data.classId,
      classTitle: classRecord.title,
      studentId: data.studentId,
      studentDisplayName: student.displayName,
      ownerDisplayName: displayNameOf(owner, "Teacher"),
      classBlock: classBlockOf(classRecord),
    });
  }
  students.sort(
    (a, b) =>
      a.studentDisplayName.localeCompare(b.studentDisplayName) ||
      a.classTitle.localeCompare(b.classTitle) ||
      (a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0),
  );
  log.info("supportAccess.listedMine", { actorUserId: actor.uid, count: students.length });
  return { students };
}

export const supportAccessGrant = platformCallable(grantHandler);
export const supportAccessGrantMany = platformCallable(grantManyHandler);
export const supportAccessRevoke = platformCallable(revokeHandler);
export const supportAccessRevokeMany = platformCallable(revokeManyHandler);
export const supportAccessListForClass = platformCallable(listForClassHandler);
export const supportAccessListMine = platformCallable(listMineHandler);

// Exported for direct unit testing without going through the callable wrapper.
export const __supportAccessHandlers = {
  grant: grantHandler,
  grantMany: grantManyHandler,
  revoke: revokeHandler,
  revokeMany: revokeManyHandler,
  listForClass: listForClassHandler,
  listMine: listMineHandler,
};
