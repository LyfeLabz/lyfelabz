import { createHash } from "node:crypto";
import type { UserRecord } from "firebase-admin/auth";
import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { getAdminFirestore } from "../shared/firestore/admin";
import { getAdminAuth } from "../shared/auth/admin";
import { computeExternalIdentityDocId } from "../shared/identity/external-identity-doc-id";
import { writeAuditEventInTransaction } from "../shared/audit/write-audit-event";
import { PlatformError } from "../shared/errors/platform-error";

export const RELATIONSHIPS = "supportRecipientRelationships";
export const AUTHORIZATIONS = "supportStudentAuthorizations";
export const ACCOUNT_BOUNDARIES = "supportAccountBoundaries";
export type SupportActor = { uid: string; schoolId: string; districtId: string };
export type VerifiedGoogle = { email: string; identity: string };
export type RecipientRelationship = {
  ownerTeacherId: string; email: string | null; schoolId: string; districtId: string;
  status: "pending" | "active" | "revoked"; revision: number; authorizedAt?: Timestamp;
  recipientUid: string | null; googleIdentity: string | null;
};
export type PendingAuthorization = {
  relationshipId: string; ownerTeacherId: string; classId: string; studentId: string;
  schoolId: string; districtId: string; status: "pending" | "activated" | "revoked";
  revision: number; grantId: string | null; authorizedAt?: Timestamp;
};
export function supportRecordId(...parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(["support-v2.1", ...parts])).digest("hex");
}
export function legacyRelationshipId(owner: SupportActor, recipientUid: string): string {
  return supportRecordId("legacy-uid", owner.uid, owner.schoolId, owner.districtId, recipientUid);
}
export function normalizeSupportEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@weston\.org$/.test(email) ? email : null;
}
export function verifiedGoogleIdentity(user: UserRecord): VerifiedGoogle {
  const google = user.providerData.filter(p => p.providerId === "google.com");
  const email = user.email?.trim().toLowerCase();
  if (user.disabled || !user.emailVerified || !email || google.length !== 1 || !google[0].uid || google[0].email?.trim().toLowerCase() !== email) {
    throw new PlatformError("supportAccess.forbidden", "A verified Google identity is required.");
  }
  return { email, identity: computeExternalIdentityDocId({ providerId: "google.com", providerAccountId: google[0].uid }) };
}
export function relationshipMatchesActor(r: RecipientRelationship, actor: SupportActor, identity: VerifiedGoogle): boolean {
  return r.status !== "revoked" && r.email === identity.email && r.schoolId === actor.schoolId && r.districtId === actor.districtId &&
    (r.recipientUid === null || r.recipientUid === actor.uid) && (r.googleIdentity === null || r.googleIdentity === identity.identity);
}
function emailFingerprint(email: unknown): string | undefined {
  return typeof email === "string" && email.trim() ? supportRecordId("recipient-email", email.trim().toLowerCase()) : undefined;
}

// Class creation, binding and recipient removal coordinate on these server-only
// records. Fingerprints retain restrictions across Firebase account recreation;
// they are never an onboarding gate, identity role or student-read authority.
export async function readAccountBoundary(tx: Transaction, uid: string): Promise<boolean> {
  return (await tx.get(getAdminFirestore().collection(ACCOUNT_BOUNDARIES).doc(uid))).data()?.restricted === true;
}
export function touchAccountBoundary(tx: Transaction, uid: string, restricted: boolean, identity?: VerifiedGoogle | null, canonicalEmail?: unknown): void {
  const emailHash = emailFingerprint(canonicalEmail);
  tx.set(getAdminFirestore().collection(ACCOUNT_BOUNDARIES).doc(uid), {
    restricted, updatedAt: FieldValue.serverTimestamp(),
    ...(identity ? { googleIdentity: identity.identity } : {}), ...(emailHash ? { emailHash } : {}),
  }, { merge: true });
}
type Boundary = { uid: string; data: DocumentData };
export async function recipientBoundaryRecords(tx: Transaction, uid: string, identity?: VerifiedGoogle | null): Promise<Boundary[]> {
  const db = getAdminFirestore();
  const own = await tx.get(db.collection(ACCOUNT_BOUNDARIES).doc(uid));
  const canonical = (await tx.get(db.collection("users").doc(uid))).data();
  const records = new Map<string, Boundary>();
  if (own.exists) records.set(uid, { uid, data: own.data() ?? {} });
  const fingerprints: Array<[string, unknown]> = [
    ["googleIdentity", identity?.identity], ["googleIdentity", own.data()?.googleIdentity],
    ["emailHash", emailFingerprint(canonical?.email)], ["emailHash", own.data()?.emailHash],
  ];
  const seen = new Set<string>();
  for (const [field, value] of fingerprints) {
    if (typeof value !== "string" || seen.has(`${field}:${value}`)) continue;
    seen.add(`${field}:${value}`);
    const matches = await tx.get(db.collection(ACCOUNT_BOUNDARIES).where(field, "==", value).limit(201));
    if (matches.size > 200) throw new PlatformError("supportAccess.unavailable", "Support identity needs operator review.");
    for (const row of matches.docs) records.set(row.id, { uid: row.id, data: row.data() });
  }
  return [...records.values()];
}
export async function hasValidLegacySupportGrant(actor: SupportActor, tx: Transaction, ownerUid?: string, candidate?: { classId: string; studentId: string }): Promise<boolean> {
  const db = getAdminFirestore();
  let query = db.collection("studentSupportGrants").where("granteeUid", "==", actor.uid).where("status", "==", "active");
  if (ownerUid !== undefined) query = query.where("ownerTeacherId", "==", ownerUid);
  const grants = candidate
    ? { docs: [await tx.get(db.collection("studentSupportGrants").doc(`${candidate.classId}__${candidate.studentId}__${actor.uid}`))] }
    : await tx.get(query.limit(201));
  if (grants.docs.length > 200) throw new PlatformError("supportAccess.unavailable", "Support authorization needs operator review.");
  for (const d of grants.docs) {
    const g = d.data();
    if (!g || g.status !== "active" || g.granteeUid !== actor.uid ||
      (ownerUid !== undefined && g.ownerTeacherId !== ownerUid) || typeof g.classId !== "string" || typeof g.studentId !== "string" || typeof g.ownerTeacherId !== "string" ||
      g.schoolId !== actor.schoolId || g.districtId !== actor.districtId || d.id !== `${g.classId}__${g.studentId}__${actor.uid}`) continue;
    const [c, e, o] = await Promise.all([
      tx.get(db.collection("classes").doc(g.classId)), tx.get(db.collection("enrollments").doc(`${g.classId}__${g.studentId}`)),
      tx.get(db.collection("users").doc(g.ownerTeacherId)),
    ]);
    if (c.data()?.status === "active" && c.data()?.teacherId === g.ownerTeacherId && c.data()?.schoolId === actor.schoolId &&
      e.data()?.status === "active" && e.data()?.classId === g.classId && e.data()?.studentId === g.studentId && e.data()?.schoolId === actor.schoolId &&
      o.data()?.status === "active" && o.data()?.role === "teacher" && o.data()?.schoolId === actor.schoolId) return true;
  }
  return false;
}
export async function supportTeachingRestricted(actor: SupportActor, tx: Transaction): Promise<boolean> {
  const db = getAdminFirestore();
  const restricted = await readAccountBoundary(tx, actor.uid);
  const owned = await tx.get(db.collection("classes").where("teacherId", "==", actor.uid).limit(1));
  if (!owned.empty) return false; // Every status counts, including archived.
  if (restricted) return true;
  const relations = await tx.get(db.collection(RELATIONSHIPS).where("recipientUid", "==", actor.uid).where("status", "==", "active").limit(201));
  if (relations.size > 200) throw new PlatformError("supportAccess.unavailable", "Support authorization needs operator review.");
  if (relations.docs.some(d => {
    const r = d.data() as RecipientRelationship;
    return r.schoolId === actor.schoolId && r.districtId === actor.districtId;
  })) return true;
  if (await hasValidLegacySupportGrant(actor, tx)) return true;

  const auth = await getAdminAuth().getUser(actor.uid);
  const canonical = (await tx.get(db.collection("users").doc(actor.uid))).data();
  let identity: VerifiedGoogle | null = null;
  try { identity = verifiedGoogleIdentity(auth); } catch { /* Restriction can still match immutable provisioned email. */ }
  if ((await recipientBoundaryRecords(tx, actor.uid, identity)).some(record => record.data.restricted === true)) return true;
  if (identity) {
    const mapping = (await tx.get(db.collection("externalIdentities").doc(identity.identity))).data();
    if (mapping?.status === "active" && mapping.userId !== actor.uid) {
      throw new PlatformError("supportAccess.forbidden", "Your Google identity requires administrator review.");
    }
  }
  const emails = new Set([auth.email, canonical?.email].filter((v): v is string => typeof v === "string" && v.trim().length > 0).map(v => v.trim().toLowerCase()));
  for (const email of emails) {
    const pending = await tx.get(db.collection(RELATIONSHIPS).where("email", "==", email).limit(201));
    if (pending.size > 200) throw new PlatformError("supportAccess.unavailable", "Support authorization needs operator review.");
    if (pending.docs.some(d => { const r = d.data() as RecipientRelationship; return r.status !== "revoked" && r.schoolId === actor.schoolId && r.districtId === actor.districtId && (r.recipientUid === null || r.recipientUid === actor.uid); })) return true;
  }
  // A legacy support account may be recreated before its first V2.1 visit.
  // Never infer data access or create a designation for the new UID. Current
  // valid grants on a same-email active old account only prevent self-service
  // teaching escalation; historically revoked grants are excluded.
  for (const email of new Set([canonical?.email, ...emails].filter((v): v is string => typeof v === "string"))) {
    const users = await tx.get(db.collection("users").where("email", "==", email).limit(201));
    if (users.size > 200) throw new PlatformError("supportAccess.unavailable", "Teacher identity needs operator review.");
    for (const user of users.docs) {
      const old = user.data();
      if (user.id === actor.uid || old.authUid !== user.id || old.status !== "active" || old.role !== "teacher" || old.schoolId !== actor.schoolId) continue;
      const oldClasses = await tx.get(db.collection("classes").where("teacherId", "==", user.id).limit(1));
      if (oldClasses.empty && await hasValidLegacySupportGrant({ ...actor, uid: user.id }, tx)) return true;
    }
  }
  return false;
}
async function retainTeachingRestriction(tx: Transaction, actor: SupportActor): Promise<void> {
  const db = getAdminFirestore();
  const previous = (await tx.get(db.collection(ACCOUNT_BOUNDARIES).doc(actor.uid))).data();
  if (previous?.restricted === true && typeof previous.emailHash === "string" && typeof previous.googleIdentity === "string") return;
  const canonical = (await tx.get(db.collection("users").doc(actor.uid))).data();
  let identity: VerifiedGoogle | null = null;
  try { identity = await readVerifiedGoogleIdentity(actor.uid); }
  catch (err) {
    if (!(err instanceof PlatformError) && (err as { code?: string }).code !== "auth/user-not-found") throw err;
  }
  touchAccountBoundary(tx, actor.uid, true, identity, canonical?.email);
  if (previous?.restricted !== true) writeAuditEventInTransaction(tx, {
    actorUserId: actor.uid, actorRole: "teacher", action: "supportAccess.teachingRestricted",
    targetType: "supportAccountBoundary", targetId: actor.uid, schoolId: actor.schoolId, districtId: actor.districtId,
  });
}
export async function assertTeachingAllowed(actor: SupportActor): Promise<void> {
  const denied = await getAdminFirestore().runTransaction(async tx => {
    if (!await supportTeachingRestricted(actor, tx)) return false;
    await retainTeachingRestriction(tx, actor);
    return true;
  });
  if (denied) throw new PlatformError("supportAccess.forbidden", "Teaching operations require separately authorized teacher capabilities.");
}
export async function createClassWithSupportBoundary(actor: SupportActor, ref: DocumentReference, data: DocumentData): Promise<void> {
  const denied = await getAdminFirestore().runTransaction(async tx => {
    if (await supportTeachingRestricted(actor, tx)) {
      await retainTeachingRestriction(tx, actor);
      return true;
    }
    const existing = await tx.get(ref);
    if (existing.exists) throw new PlatformError("classes.conflict", "This class already exists. Reload and try again.");
    touchAccountBoundary(tx, actor.uid, false);
    tx.create(ref, data);
    return false;
  });
  if (denied) throw new PlatformError("supportAccess.forbidden", "Support recipients cannot create classes.");
}
export async function readVerifiedGoogleIdentity(uid: string): Promise<VerifiedGoogle> {
  return verifiedGoogleIdentity(await getAdminAuth().getUser(uid));
}
export async function ownerRevocationAt(tx: Transaction, recipientUid: string, owner: SupportActor, identity?: VerifiedGoogle | null): Promise<Timestamp | undefined> {
  const records = await recipientBoundaryRecords(tx, recipientUid, identity);
  let latest: Timestamp | undefined;
  for (const record of records) {
    const raw = record.data.ownerRevocations as unknown;
    if (raw === undefined) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PlatformError("supportAccess.forbidden", "Support authorization is unavailable.");
    const value = (raw as Record<string, unknown>)[supportRecordId(owner.uid, owner.schoolId, owner.districtId)];
    if (value === undefined) continue;
    if (!(value instanceof Timestamp)) throw new PlatformError("supportAccess.forbidden", "Support authorization is unavailable.");
    if (latest === undefined || value.seconds > latest.seconds || (value.seconds === latest.seconds && value.nanoseconds > latest.nanoseconds)) latest = value;
  }
  return latest;
}
export function issuedAfterRevocation(issuedAt: unknown, revokedAt: Timestamp | undefined): boolean {
  if (revokedAt === undefined) return true;
  return issuedAt instanceof Timestamp && (issuedAt.seconds > revokedAt.seconds || (issuedAt.seconds === revokedAt.seconds && issuedAt.nanoseconds > revokedAt.nanoseconds));
}
export function revokeRecipientOwner(tx: Transaction, recipientUid: string, owner: SupportActor): void {
  const key = supportRecordId(owner.uid, owner.schoolId, owner.districtId);
  tx.set(getAdminFirestore().collection(ACCOUNT_BOUNDARIES).doc(recipientUid), { ownerRevocations: { [key]: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}


export async function readGrantCutoff(recipientUid: string, owner: SupportActor): Promise<Timestamp | undefined> {
  const snap = await getAdminFirestore().collection(ACCOUNT_BOUNDARIES).doc(recipientUid).get();
  const key = supportRecordId(owner.uid, owner.schoolId, owner.districtId);
  const revocations: unknown = snap.data()?.ownerRevocations;
  if (revocations === undefined) return undefined;
  if (!revocations || typeof revocations !== "object" || Array.isArray(revocations)) {
    throw new PlatformError("supportAccess.forbidden", "Support authorization is unavailable.");
  }
  const cutoff = (revocations as Record<string, unknown>)[key];
  if (cutoff !== undefined && !(cutoff instanceof Timestamp)) {
    throw new PlatformError("supportAccess.forbidden", "Support authorization is unavailable.");
  }
  return cutoff;
}
