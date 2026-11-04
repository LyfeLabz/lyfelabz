import { classesCreate } from "../classes/classes-create";
import { classesLmsCreate } from "../classes/classes-lms-create";
import { supportAccessGrant, supportAccessGrantMany, supportAccessRevoke, supportAccessListMine, supportAccessListForClass } from "./callables";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { compileFunction } from "node:vm";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";

let mockEmailLookups = 0;
let mockFailAudit: string | null = null;
jest.mock("../shared/audit/write-audit-event", () => {
  const actual = jest.requireActual("../shared/audit/write-audit-event");
  return { ...actual, writeAuditEventInTransaction: (tx: unknown, event: { targetId: string }) => {
    if (event.targetId === mockFailAudit) throw new Error("injected audit failure");
    return actual.writeAuditEventInTransaction(tx, event);
  } };
});
const mockAuthUsers = new Map<string, Record<string, unknown>>();
jest.mock("../shared/auth/admin", () => ({ getAdminAuth: () => ({
  getUser: (uid: string) => { const u = mockAuthUsers.get(uid); return u ? Promise.resolve(u) : Promise.reject(Object.assign(new Error("not found"), { code: "auth/user-not-found" })); },
  getUserByEmail: (email: string) => { mockEmailLookups++; const u = [...mockAuthUsers.values()].find(x => String(x.email).toLowerCase() === email); return u ? Promise.resolve(u) : Promise.reject(Object.assign(new Error("not found"), { code: "auth/user-not-found" })); },
}) }));
import { assertTeacherPilotAllowlisted } from "../shared/config/teacher-pilot-allowlist";
import { authorizeStudentScopedRead } from "./authorize";
import { AUTHORIZATIONS, ACCOUNT_BOUNDARIES, RELATIONSHIPS, legacyRelationshipId, supportRecordId, verifiedGoogleIdentity, assertTeachingAllowed, createClassWithSupportBoundary, type SupportActor } from "./recipient-policy";
import { __recipientAuthorization as h, saveRecipientAuthorization, reconcileRecipient, revokeAuthorization, recipientWorkspace, authorizeManyHandler, supportAccessMutationGeneration, supportAccessReconcileMine, supportAccessV21GrantMany, supportAccessV21RevokeAuthorization, supportAccessV21RemoveRecipient, supportAccessDrainRemovals } from "./recipient-authorizations";

const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT ?? "demo-student-support-v21";
if (enabled && (!project.startsWith("demo-") || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST!))) throw new Error("Local demo emulator required");
if (enabled && getApps().length === 0) initializeApp({ projectId: project });
const db = enabled ? getFirestore() : undefined!;
const suite = enabled ? describe : describe.skip;
let owner: SupportActor, recipient: SupportActor, classId: string, studentId: string, email: string;
const request = (actor: SupportActor, data: unknown): CallableRequest<unknown> => ({ data, auth: { uid: actor.uid, token: { role: "teacher", schoolId: actor.schoolId, districtId: actor.districtId } } } as unknown as CallableRequest<unknown>);
function addAuth(uid: string, address = email): void { mockAuthUsers.set(uid, { uid, email: address, emailVerified: true, disabled: false, providerData: [{ providerId: "google.com", uid: `google-${uid}`, email: address }] }); }
async function onboard(status = "active"): Promise<void> { addAuth(recipient.uid); await db.doc(`users/${recipient.uid}`).set({ authUid: recipient.uid, role: "teacher", status, schoolId: recipient.schoolId, email }); }
const grantId = () => `${classId}__${studentId}__${recipient.uid}`;
const relationId = () => supportRecordId(owner.uid, owner.schoolId, owner.districtId, email);
const authId = () => supportRecordId(relationId(), classId, studentId);
async function removeRelationship(): Promise<void> {
  const job = await h.closeRelationship(owner, relationId());
  while (await h.drainRemoval(job)) { /* finish the durable job in this test */ }
}
async function seedLegacy(status = "active"): Promise<void> { await db.doc(`studentSupportGrants/${grantId()}`).set({ classId, studentId, ownerTeacherId: owner.uid, granteeUid: recipient.uid, schoolId: owner.schoolId, districtId: owner.districtId, status, grantedAt: Timestamp.now(), grantedBy: owner.uid }); }

suite("Student Support V2.1 transactional authorization", () => {
  beforeEach(async () => {
    mockAuthUsers.clear(); mockFailAudit = null; mockEmailLookups = 0;
    const n = randomUUID().replace(/-/g, "");
    owner = { uid: `owner-${n}`, schoolId: `school-${n}`, districtId: `district-${n}` };
    recipient = { ...owner, uid: `recipient-${n}` }; classId = `class-${n}`; studentId = `student-${n}`; email = `para-${n}@weston.org`;
    const b = db.batch();
    b.set(db.doc(`schools/${owner.schoolId}`), { districtId: owner.districtId });
    b.set(db.doc(`users/${owner.uid}`), { authUid: owner.uid, status: "active", role: "teacher", schoolId: owner.schoolId });
    b.set(db.doc(`classes/${classId}`), { teacherId: owner.uid, schoolId: owner.schoolId, status: "active", title: "Synthetic science" });
    b.set(db.doc(`enrollments/${classId}__${studentId}`), { classId, studentId, schoolId: owner.schoolId, status: "active" });
    b.set(db.doc("platformConfig/teacherPilotAllowlist"), { emails: ["owner@weston.org"], pilotSchoolId: owner.schoolId });
    await b.commit();
  });
  test("never-onboarded sharing persists pending and cannot authorize reads", async () => {
    const result = await saveRecipientAuthorization(owner, classId, studentId, email);
    expect(result.status).toBe("pending");
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).exists).toBe(false);
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });
  });
  test("pending authorization never changes the pilot allowlist", async () => {
    const before = (await db.doc("platformConfig/teacherPilotAllowlist").get()).data();
    await saveRecipientAuthorization(owner, classId, studentId, email);
    await expect(assertTeacherPilotAllowlisted(email)).rejects.toMatchObject({ code: "teachers.pilotNotAllowlisted" });
    expect((await db.doc("platformConfig/teacherPilotAllowlist").get()).data()).toEqual(before);
  });
  test("provisioned recipient cannot reconcile before onboarding", async () => {
    await onboard("provisioned"); await saveRecipientAuthorization(owner, classId, studentId, email);
    await expect(supportAccessReconcileMine.run(request(recipient, {}))).rejects.toMatchObject({ details: { code: "account-inactive" } });
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).exists).toBe(false);
  });
  test("verified onboarding activates once, retries preserve the grant and audit", async () => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await onboard();
    await reconcileRecipient(recipient);
    const before = await db.doc(`studentSupportGrants/${grantId()}`).get();
    expect(before.data()?.status).toBe("active");
    await reconcileRecipient(recipient);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).updateTime).toEqual(before.updateTime);
    expect((await db.collection("auditEvents").where("targetId", "==", grantId()).get()).size).toBe(1);
  });
  test("existing active teacher receives active access immediately", async () => {
    await onboard(); expect((await saveRecipientAuthorization(owner, classId, studentId, email)).status).toBe("activated");
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).resolves.toMatchObject({ via: "grant" });
  });
  test("duplicate sharing is idempotent", async () => {
    await onboard(); await saveRecipientAuthorization(owner, classId, studentId, email);
    expect((await saveRecipientAuthorization(owner, classId, studentId, email)).alreadyShared).toBe(true);
    expect((await db.collection(AUTHORIZATIONS).where("relationshipId", "==", relationId()).get()).size).toBe(1);
  });
  test("bulk sharing reports valid pending pairs and malformed domains separately", async () => {
    const r = await authorizeManyHandler(request(owner, { classId, studentIds: [studentId, studentId], granteeEmails: [email, "para@sub.weston.org"] })) as { summary: unknown };
    expect(r.summary).toEqual({ pending: 1, shared: 0, alreadyShared: 0, failed: 1 });
  });
  test.each(["uid", "email", "schoolId", "districtId", "recipientUid"])("rejects forged identity field %s", async field => {
    await onboard(); await expect(supportAccessReconcileMine.run(request(recipient, { [field]: "forged" }))).rejects.toMatchObject({ details: { code: "supportAccess.invalidRequest" } });
  });
  test("pending student removal prevents later activation", async () => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await revokeAuthorization(owner, authId()); await onboard(); await reconcileRecipient(recipient);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).exists).toBe(false);
  });
  test("active student removal preserves the waiting workspace across reload", async () => {
    await onboard(); await saveRecipientAuthorization(owner, classId, studentId, email); await revokeAuthorization(owner, authId()); await reconcileRecipient(recipient);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).toBe("revoked");
    expect(await recipientWorkspace(recipient, [])).toEqual({ supportOnly: true, recognizedRecipient: true });
  });
  test("relationship removal prevents pending activation and ends designation", async () => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await removeRelationship(); await onboard(); await reconcileRecipient(recipient);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).exists).toBe(false);
    expect((await recipientWorkspace(recipient, [])).recognizedRecipient).toBe(false);
  });
  test("relationship removal revokes active access and does not grant teaching privileges", async () => {
    await onboard(); await saveRecipientAuthorization(owner, classId, studentId, email); await removeRelationship();
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).toBe("revoked");
    await expect(assertTeachingAllowed(recipient)).rejects.toMatchObject({ code: "supportAccess.forbidden" });
  });
  test("canonical revocation during a pending revision cannot be resurrected", async () => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await onboard(); await seedLegacy("revoked"); await reconcileRecipient(recipient);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).toBe("revoked");
  });
  test.each(["class", "enrollment", "owner", "school", "district"])("activation rechecks current %s", async kind => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await onboard();
    if (kind === "class") await db.doc(`classes/${classId}`).update({ status: "archived" });
    if (kind === "enrollment") await db.doc(`enrollments/${classId}__${studentId}`).update({ status: "withdrawn" });
    if (kind === "owner") await db.doc(`users/${owner.uid}`).update({ status: "suspended" });
    await reconcileRecipient(kind === "school" ? { ...recipient, schoolId: "another-school" } : kind === "district" ? { ...recipient, districtId: "another-district" } : recipient);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).exists).toBe(false);
  });
  test("existing valid grants seed a durable designation without rewriting grants", async () => {
    await onboard(); await seedLegacy(); const before = await db.doc(`studentSupportGrants/${grantId()}`).get();
    expect((await recipientWorkspace(recipient, [owner.uid])).supportOnly).toBe(true);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).updateTime).toEqual(before.updateTime);
    await db.doc(`studentSupportGrants/${grantId()}`).update({ status: "revoked" });
    expect((await recipientWorkspace(recipient, [])).supportOnly).toBe(true);
  });
  test("historically revoked grants do not create a relationship", async () => {
    await onboard(); await seedLegacy("revoked"); expect((await recipientWorkspace(recipient, [])).recognizedRecipient).toBe(false);
  });
  test("archived class owners retain teaching capabilities", async () => {
    await onboard(); await db.doc(`classes/archived-${recipient.uid}`).set({ teacherId: recipient.uid, schoolId: owner.schoolId, status: "archived" });
    await saveRecipientAuthorization(owner, classId, studentId, email);
    expect((await recipientWorkspace(recipient, [])).supportOnly).toBe(false);
    await expect(assertTeachingAllowed(recipient)).resolves.toBeUndefined();
  });
  test("direct class creation and concurrent activation cannot bypass the boundary", async () => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await onboard();
    const outcomes = await Promise.allSettled([reconcileRecipient(recipient), createClassWithSupportBoundary(recipient, db.doc(`classes/forged-${recipient.uid}`), { teacherId: recipient.uid, schoolId: owner.schoolId, status: "active" })]);
    expect(outcomes[1].status).toBe("rejected");
    expect((await db.doc(`classes/forged-${recipient.uid}`).get()).exists).toBe(false);
    expect((await db.doc(`${ACCOUNT_BOUNDARIES}/${recipient.uid}`).get()).data()?.restricted).toBe(true);
  });
  test("concurrent pending activation and revoke leave no active grant", async () => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await onboard();
    await h.bindRelationship(recipient, relationId(), verifiedGoogleIdentity(mockAuthUsers.get(recipient.uid) as never));
    await Promise.allSettled([h.activateAuthorization(recipient, authId(), verifiedGoogleIdentity(mockAuthUsers.get(recipient.uid) as never)), revokeAuthorization(owner, authId())]);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).not.toBe("active");
    await reconcileRecipient(recipient); expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).not.toBe("active");
  });
  test("another owner cannot revoke a guessed authorization", async () => {
    await saveRecipientAuthorization(owner, classId, studentId, email);
    await expect(revokeAuthorization({ ...owner, uid: "another-owner" }, authId())).rejects.toMatchObject({ code: "supportAccess.forbidden" });
  });
  test("interrupted activation rolls back its grant and resumes without duplicate audit", async () => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await onboard();
    mockFailAudit = grantId();
    await expect(reconcileRecipient(recipient)).rejects.toThrow("injected audit failure");
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).exists).toBe(false);
    expect((await db.doc(`${AUTHORIZATIONS}/${authId()}`).get()).data()?.status).toBe("pending");
    mockFailAudit = null; await reconcileRecipient(recipient);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).toBe("active");
  });
  test.each(["unverified", "nonGoogle", "mismatchedProvider", "changedEmail"])("cannot bind %s identity", async kind => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await onboard();
    const u = mockAuthUsers.get(recipient.uid)!;
    if (kind === "unverified") u.emailVerified = false;
    if (kind === "nonGoogle") u.providerData = [{ providerId: "password", uid: "password", email }];
    if (kind === "mismatchedProvider") u.providerData = [{ providerId: "google.com", uid: "google", email: "other@weston.org" }];
    if (kind === "changedEmail") { u.email = "changed@weston.org"; u.providerData = [{ providerId: "google.com", uid: "google", email: u.email }]; }
    await reconcileRecipient(recipient).catch(() => undefined);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).exists).toBe(false);
  });
  test("multiple owners remain independent when one removes its relationship", async () => {
    await onboard(); await saveRecipientAuthorization(owner, classId, studentId, email);
    const other = { ...owner, uid: `second-${owner.uid}` }; const otherClass = `second-${classId}`;
    await db.doc(`users/${other.uid}`).set({ authUid: other.uid, status: "active", role: "teacher", schoolId: other.schoolId });
    await db.doc(`classes/${otherClass}`).set({ teacherId: other.uid, schoolId: other.schoolId, status: "active" });
    await db.doc(`enrollments/${otherClass}__${studentId}`).set({ classId: otherClass, studentId, schoolId: other.schoolId, status: "active" });
    await saveRecipientAuthorization(other, otherClass, studentId, email);
    await removeRelationship();
    await expect(authorizeStudentScopedRead(recipient, otherClass, studentId)).resolves.toMatchObject({ via: "grant" });
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });
    expect((await recipientWorkspace(recipient, [])).supportOnly).toBe(true);
  });
  test("existing non-Weston grants retain access without rewriting their records", async () => {
    await onboard(); addAuth(recipient.uid, "legacy@example.org"); await seedLegacy();
    const before = await db.doc(`studentSupportGrants/${grantId()}`).get();
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).resolves.toMatchObject({ via: "grant" });
    expect((await recipientWorkspace(recipient, [owner.uid])).supportOnly).toBe(true);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).updateTime).toEqual(before.updateTime);
  });
  test("pending pagination reaches students beyond the first forty", async () => {
    const ids = Array.from({ length: 42 }, (_, i) => `page-${studentId}-${i}`);
    const b = db.batch();
    for (const sid of ids) b.set(db.doc(`enrollments/${classId}__${sid}`), { classId, studentId: sid, schoolId: owner.schoolId, status: "active" });
    await b.commit();
    for (const sid of ids) await saveRecipientAuthorization(owner, classId, sid, email);
    await onboard();
    const first = await reconcileRecipient(recipient);
    expect(first.remaining).toBe(true); expect(first.cursor).not.toBeNull();
    const second = await reconcileRecipient(recipient, first.cursor);
    expect(second.remaining).toBe(false);
    expect((await db.collection("studentSupportGrants").where("granteeUid", "==", recipient.uid).get()).size).toBe(42);
  });

  test.each(["manual", "LMS"])("direct public %s class creation is forbidden for a pending recipient", async kind => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await onboard();
    const endpoint = kind === "manual" ? classesCreate : classesLmsCreate;
    await expect(endpoint.run(request(recipient, { classId: `bypass-${classId}`, title: "Synthetic", grade: "7", block: "A" }))).rejects.toMatchObject({ details: { code: "supportAccess.forbidden" } });
    expect((await db.doc(`classes/bypass-${classId}`).get()).exists).toBe(false);
  });
  test("a science teacher still creates a class through the public endpoint", async () => {
    await expect(classesCreate.run(request(owner, { classId: `science-${classId}`, title: "Synthetic science", grade: "7", block: "A" }))).resolves.toMatchObject({ classId: `science-${classId}`, alreadyCreated: false });
    expect((await db.doc(`classes/science-${classId}`).get()).data()?.teacherId).toBe(owner.uid);
  });
  test("provider and email changes before binding cannot become a class-creation bypass", async () => {
    await saveRecipientAuthorization(owner, classId, studentId, email); await onboard();
    const u = mockAuthUsers.get(recipient.uid)!; u.providerData = []; u.email = "changed@weston.org";
    await expect(createClassWithSupportBoundary(recipient, db.doc(`classes/bypass-${classId}`), { teacherId: recipient.uid, schoolId: recipient.schoolId })).rejects.toMatchObject({ code: "supportAccess.forbidden" });
  });
  test("an activation outage reports the confirmed authorization as pending and resumes", async () => {
    await onboard(); mockFailAudit = grantId();
    const result = await authorizeManyHandler(request(owner, { classId, studentIds: [studentId], granteeEmails: [email] })) as { summary: unknown };
    expect(result.summary).toEqual({ shared: 0, pending: 1, alreadyShared: 0, failed: 0 });
    expect((await db.doc(`${AUTHORIZATIONS}/${authId()}`).get()).data()?.status).toBe("pending");
    mockFailAudit = null; await reconcileRecipient(recipient);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).toBe("active");
  });
  test("duplicate pending authorization never claims that student access is active", async () => {
    await authorizeManyHandler(request(owner, { classId, studentIds: [studentId], granteeEmails: [email] }));
    const result = await authorizeManyHandler(request(owner, { classId, studentIds: [studentId], granteeEmails: [email] })) as { summary: unknown };
    expect(result.summary).toEqual({ shared: 0, pending: 1, alreadyShared: 0, failed: 0 });
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).exists).toBe(false);
  });

  test("Remove teacher closes all of that owner's bindings after an email change", async () => {
    await onboard(); await saveRecipientAuthorization(owner, classId, studentId, email);
    const newEmail = `changed-${email}`; addAuth(recipient.uid, newEmail);
    await db.doc(`users/${recipient.uid}`).update({ email: newEmail });
    const secondStudent = `second-${studentId}`;
    await db.doc(`enrollments/${classId}__${secondStudent}`).set({ classId, studentId: secondStudent, schoolId: owner.schoolId, status: "active" });
    await saveRecipientAuthorization(owner, classId, secondStudent, newEmail);
    await removeRelationship(); await reconcileRecipient(recipient);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).toBe("revoked");
    expect((await db.doc(`studentSupportGrants/${classId}__${secondStudent}__${recipient.uid}`).get()).data()?.status).toBe("revoked");
    expect((await recipientWorkspace(recipient, [])).recognizedRecipient).toBe(false);
  });

  test("old unbound email authorizations cannot resurrect a removed recipient, but explicit reauthorization can", async () => {
    await onboard(); await saveRecipientAuthorization(owner, classId, studentId, email);
    const futureEmail = `future-${email}`; const futureStudent = `future-${studentId}`;
    await db.doc(`enrollments/${classId}__${futureStudent}`).set({ classId, studentId: futureStudent, schoolId: owner.schoolId, status: "active" });
    await saveRecipientAuthorization(owner, classId, futureStudent, futureEmail);
    await removeRelationship();
    addAuth(recipient.uid, futureEmail); await db.doc(`users/${recipient.uid}`).update({ email: futureEmail });
    await reconcileRecipient(recipient);
    const futureGrant = db.doc(`studentSupportGrants/${classId}__${futureStudent}__${recipient.uid}`);
    expect((await futureGrant.get()).exists).toBe(false);
    expect((await recipientWorkspace(recipient, [])).recognizedRecipient).toBe(false);
    await saveRecipientAuthorization(owner, classId, futureStudent, futureEmail);
    expect((await futureGrant.get()).data()?.status).toBe("active");
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).toBe("revoked");
  });

  test.each(["sameGoogle", "differentGoogle"])("account recreation (%s) cannot obtain science privileges or inherit grants", async kind => {
    await onboard(); await saveRecipientAuthorization(owner, classId, studentId, email);
    const oldAuth = mockAuthUsers.get(recipient.uid)!;
    await removeRelationship();
    const recreated = { ...recipient, uid: `recreated-${recipient.uid}` };
    mockAuthUsers.delete(recipient.uid);
    mockAuthUsers.set(recreated.uid, { ...oldAuth, uid: recreated.uid,
      ...(kind === "differentGoogle" ? { providerData: [{ providerId: "google.com", uid: "different-google-subject", email }] } : {}) });
    await db.doc(`users/${recreated.uid}`).set({ authUid: recreated.uid, role: "teacher", status: "active", schoolId: recreated.schoolId, email });
    await expect(classesCreate.run(request(recreated, { classId: `recreated-${classId}`, title: "Synthetic", grade: "7", block: "A" }))).rejects.toMatchObject({ details: { code: "supportAccess.forbidden" } });
    await reconcileRecipient(recreated);
    expect((await db.doc(`studentSupportGrants/${classId}__${studentId}__${recreated.uid}`).get()).exists).toBe(false);
  });
  test("legacy recreation cannot escape support restrictions before the first V2.1 visit", async () => {
    await onboard(); await seedLegacy();
    const recreated = { ...recipient, uid: `legacy-recreated-${recipient.uid}` };
    const oldAuth = mockAuthUsers.get(recipient.uid)!; mockAuthUsers.delete(recipient.uid);
    mockAuthUsers.set(recreated.uid, { ...oldAuth, uid: recreated.uid });
    await db.doc(`users/${recreated.uid}`).set({ authUid: recreated.uid, role: "teacher", status: "active", schoolId: recreated.schoolId, email });
    expect((await db.doc(`${ACCOUNT_BOUNDARIES}/${recipient.uid}`).get()).exists).toBe(false);
    await expect(assertTeachingAllowed(recreated)).rejects.toMatchObject({ code: "supportAccess.forbidden" });
    await db.doc(`studentSupportGrants/${grantId()}`).update({ status: "revoked" });
    await expect(assertTeachingAllowed(recreated)).rejects.toMatchObject({ code: "supportAccess.forbidden" });
  });
  test("legacy UID grants retain a durable relationship without an email identity migration", async () => {
    await onboard(); await seedLegacy();
    const auth = mockAuthUsers.get(recipient.uid)!; auth.providerData = [{ providerId: "password", uid: "legacy-password", email }];
    const before = await db.doc(`studentSupportGrants/${grantId()}`).get();
    expect((await recipientWorkspace(recipient, [owner.uid])).supportOnly).toBe(true);
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).updateTime).toEqual(before.updateTime);
    await db.doc(`studentSupportGrants/${grantId()}`).update({ status: "revoked" });
    expect((await recipientWorkspace(recipient, [])).supportOnly).toBe(true);
    await expect(assertTeachingAllowed(recipient)).rejects.toMatchObject({ code: "supportAccess.forbidden" });
  });

  test("legacy mutation rejects with refresh required and leaves V2 reads intact", async () => {
    await onboard();
    await expect(supportAccessGrant.run(request(owner, { classId, studentId, granteeEmail: email })))
      .rejects.toMatchObject({ details: { code: "supportAccess.refreshRequired" } });
    await expect(supportAccessGrantMany.run(request(owner, { classId, studentIds: [studentId], granteeEmails: [`unprovisioned-${email}`] })))
      .rejects.toMatchObject({ details: { code: "supportAccess.refreshRequired" } });
    await seedLegacy();
    await expect(supportAccessGrant.run(request(owner, { classId, studentId, granteeEmail: email })))
      .resolves.toMatchObject({ outcome: "alreadyShared" });
    await expect(supportAccessRevoke.run(request(owner, { grantId: grantId() })))
      .rejects.toMatchObject({ details: { code: "supportAccess.refreshRequired" } });
    mockAuthUsers.delete(recipient.uid);
    await expect(supportAccessListMine.run(request(recipient, {}))).resolves.toMatchObject({
      students: [expect.objectContaining({ grantId: grantId() })], workspace: { supportOnly: true },
    });
  });

  test("bulk operation retry is idempotent and stale share and revoke cannot touch a newer grant", async () => {
    await onboard();
    const input = { classId, studentIds: [studentId], granteeEmails: [email] };
    const initial = { ...input, operationId: randomUUID(), expectedGeneration: 0 };
    const revoke = { authorizationId: authId(), operationId: randomUUID(), expectedGeneration: 1 };
    await expect(supportAccessV21GrantMany.run(request(owner, initial))).resolves.toMatchObject({ summary: { shared: 1 } });
    await expect(supportAccessV21GrantMany.run(request(owner, initial))).resolves.toMatchObject({ summary: { alreadyShared: 1 } });
    await supportAccessV21RevokeAuthorization.run(request(owner, revoke));
    await expect(supportAccessV21GrantMany.run(request(owner, initial))).rejects.toMatchObject({ details: { code: "supportAccess.conflict" } });
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });
    await supportAccessV21GrantMany.run(request(owner, { ...input, operationId: randomUUID(), expectedGeneration: 2 }));
    await expect(supportAccessV21RevokeAuthorization.run(request(owner, revoke))).rejects.toMatchObject({ details: { code: "supportAccess.conflict" } });
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).resolves.toMatchObject({ via: "grant" });
  });

  test("legacy UID removal cuts off reads before the scheduled worker touches the grant", async () => {
    await onboard();
    await seedLegacy();
    await supportAccessV21RemoveRecipient.run(request(owner, {
      relationshipId: legacyRelationshipId(owner, recipient.uid), grantId: grantId(),
      operationId: randomUUID(), expectedGeneration: 0,
    }));
    const ref = db.doc(`studentSupportGrants/${grantId()}`);
    expect((await ref.get()).data()?.status).toBe("active");
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });
    await supportAccessDrainRemovals.run({ scheduleTime: new Date().toISOString() });
    await supportAccessDrainRemovals.run({ scheduleTime: new Date().toISOString() });
    expect((await ref.get()).data()?.status).toBe("revoked");
  });

  test("competing owner decisions from the same generation permit exactly one operation", async () => {
    await onboard();
    await saveRecipientAuthorization(owner, classId, studentId, email);
    const results = await Promise.allSettled([
      supportAccessV21RevokeAuthorization.run(request(owner, { authorizationId: authId(), operationId: randomUUID(), expectedGeneration: 0 })),
      supportAccessV21GrantMany.run(request(owner, { classId, studentIds: [studentId], granteeEmails: [email], operationId: randomUUID(), expectedGeneration: 0 })),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results).toContainEqual(expect.objectContaining({
      status: "rejected", reason: expect.objectContaining({ details: { code: "supportAccess.conflict" } }),
    }));
    if (results[0].status === "fulfilled") {
      await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });
    } else {
      await expect(authorizeStudentScopedRead(recipient, classId, studentId)).resolves.toMatchObject({ via: "grant" });
    }
  });

  test("removal denies undrained legacy reads and server pages preserve a newer share", async () => {
    await onboard();
    await saveRecipientAuthorization(owner, classId, studentId, email);
    const legacy = Array.from({ length: 41 }, (_, i) => `legacy-${studentId}-${i}`);
    const b = db.batch();
    for (const student of legacy) {
      b.set(db.doc(`enrollments/${classId}__${student}`), { classId, studentId: student, schoolId: owner.schoolId, status: "active" });
      b.set(db.doc(`studentSupportGrants/${classId}__${student}__${recipient.uid}`), {
        classId, studentId: student, ownerTeacherId: owner.uid, granteeUid: recipient.uid,
        schoolId: owner.schoolId, districtId: owner.districtId, status: "active", grantedAt: Timestamp.now(), grantedBy: owner.uid,
      });
    }
    await b.commit();
    const remove = { relationshipId: relationId(), operationId: randomUUID(), expectedGeneration: 0 };
    await supportAccessV21RemoveRecipient.run(request(owner, remove));
    const last = db.doc(`studentSupportGrants/${classId}__${legacy[40]}__${recipient.uid}`);
    expect((await last.get()).data()?.status).toBe("active");
    await expect(authorizeStudentScopedRead(recipient, classId, legacy[40])).rejects.toMatchObject({ code: "classes.forbidden" });
    await supportAccessV21GrantMany.run(request(owner, {
      classId, studentIds: [legacy[40]], granteeEmails: [email], operationId: randomUUID(), expectedGeneration: 1,
    }));
    const job = db.collection("supportRemovalJobs").doc(supportRecordId(owner.uid, owner.schoolId, owner.districtId, remove.operationId));
    for (let i = 0; i < 4; i++) await h.drainRemoval(job);
    expect((await job.get()).data()?.pending).toBe(false);
    await expect(authorizeStudentScopedRead(recipient, classId, legacy[40])).resolves.toMatchObject({ via: "grant" });
    await expect(authorizeStudentScopedRead(recipient, classId, legacy[0])).rejects.toMatchObject({ code: "classes.forbidden" });
    await supportAccessV21RemoveRecipient.run(request(owner, remove));
    await expect(authorizeStudentScopedRead(recipient, classId, legacy[40])).resolves.toMatchObject({ via: "grant" });
  });

  test("canceling an unbound invitation does not acknowledge whole-teacher removal", async () => {
    await onboard();
    await seedLegacy();
    mockAuthUsers.get(recipient.uid)!.emailVerified = false;
    await saveRecipientAuthorization(owner, classId, studentId, email);
    const mutate = (expectedGeneration: number, target: object) => supportAccessV21RemoveRecipient.run(request(owner, {
      ...target, expectedGeneration, operationId: randomUUID(),
    }));
    await expect(mutate(0, { relationshipId: relationId() })).rejects.toMatchObject({ details: { code: "supportAccess.conflict" } });
    await mutate(1, { relationshipId: relationId(), cancelInvitation: true });
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).resolves.toMatchObject({ via: "grant" });
    const batch = db.batch();
    const otherOwner = `other-${owner.uid}`;
    const otherClass = `other-${classId}`;
    batch.set(db.doc(`users/${otherOwner}`), { authUid: otherOwner, role: "teacher", status: "active", schoolId: owner.schoolId });
    batch.set(db.doc(`classes/${otherClass}`), { teacherId: otherOwner, status: "active", schoolId: owner.schoolId });
    batch.set(db.doc(`enrollments/${otherClass}__${studentId}`), { classId: otherClass, studentId, status: "active", schoolId: owner.schoolId });
    batch.set(db.doc(`studentSupportGrants/${otherClass}__${studentId}__${recipient.uid}`), {
      classId: otherClass, studentId, granteeUid: recipient.uid, ownerTeacherId: otherOwner,
      status: "active", schoolId: owner.schoolId, districtId: owner.districtId, grantedAt: Timestamp.now(),
    });
    for (let i = 0; i < 201; i++) {
      batch.set(db.collection(RELATIONSHIPS).doc(`extra-${recipient.uid}-${i}`), {
        ...owner, ownerTeacherId: `other-${i}`, recipientUid: recipient.uid, status: "active",
      });
    }
    await batch.commit();
    await mutate(2, { relationshipId: legacyRelationshipId(owner, recipient.uid), grantId: grantId() });
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).toBe("active");
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });
    await expect(authorizeStudentScopedRead(recipient, otherClass, studentId)).resolves.toMatchObject({ via: "grant" });
  });

  test("explicit grant-ID revoke overrides an earlier cleanup marker", async () => {
    await onboard();
    await seedLegacy();
    const remove = { relationshipId: legacyRelationshipId(owner, recipient.uid), grantId: grantId(), operationId: randomUUID(), expectedGeneration: 0 };
    await supportAccessV21RemoveRecipient.run(request(owner, remove));
    mockAuthUsers.get(recipient.uid)!.emailVerified = false;
    const share = (expectedGeneration: number) => supportAccessV21GrantMany.run(request(owner, {
      classId, studentIds: [studentId], granteeEmails: [email], operationId: randomUUID(), expectedGeneration,
    }));
    await expect(share(1)).resolves.toMatchObject({ summary: { pending: 1 } });
    const job = db.collection("supportRemovalJobs").doc(supportRecordId(owner.uid, owner.schoolId, owner.districtId, remove.operationId));
    while (await h.drainRemoval(job)) { /* drain older cleanup */ }
    expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.removalCutoff).toBeDefined();
    const revoke = { grantId: grantId(), operationId: randomUUID(), expectedGeneration: 2 };
    await supportAccessV21RevokeAuthorization.run(request(owner, revoke));
    await supportAccessV21RevokeAuthorization.run(request(owner, revoke));
    addAuth(recipient.uid);
    await supportAccessReconcileMine.run(request(recipient, {}));
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });
    await share(3);
    await expect(supportAccessV21RevokeAuthorization.run(request(owner, revoke))).rejects.toMatchObject({ details: { code: "supportAccess.conflict" } });
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).resolves.toMatchObject({ via: "grant" });
    await supportAccessV21RevokeAuthorization.run(request(owner, {
      authorizationId: authId(), operationId: randomUUID(), expectedGeneration: 4,
    }));
    mockAuthUsers.get(recipient.uid)!.emailVerified = false;
    await expect(share(5)).resolves.toMatchObject({ summary: { pending: 1 } });
    addAuth(recipient.uid);
    await Promise.all([
      supportAccessV21RevokeAuthorization.run(request(owner, {
        grantId: grantId(), operationId: randomUUID(), expectedGeneration: 6,
      })),
      supportAccessReconcileMine.run(request(recipient, {})),
    ]);
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  test("email change and re-share revoke the current grant through the owner UI", async () => {
    const newAuthorization = (address: string) =>
      supportRecordId(supportRecordId(owner.uid, owner.schoolId, owner.districtId, address), classId, studentId);
    const addresses = [email, `alias-${email}`].sort((a, b) => newAuthorization(b).localeCompare(newAuthorization(a)));
    email = addresses[0];
    const newEmail = addresses[1];
    await onboard();
    const share = (address: string, expectedGeneration: number) => supportAccessV21GrantMany.run(request(owner, {
      classId, studentIds: [studentId], granteeEmails: [address], operationId: randomUUID(), expectedGeneration,
    }));
    const list = () => supportAccessListForClass.run(request(owner, { classId, includeAuthorizations: true }));
    await share(email, 0);
    expect((await list()).grants).toEqual([expect.objectContaining({ authorizationId: authId(), status: "active" })]);
    const remove = {
      relationshipId: legacyRelationshipId(owner, recipient.uid), grantId: grantId(),
      operationId: randomUUID(), expectedGeneration: 1,
    };
    await supportAccessV21RemoveRecipient.run(request(owner, remove));
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });

    // The old row must sort last, as it did when it overwrote the wire map.
    expect(newAuthorization(newEmail) < authId()).toBe(true);
    addAuth(recipient.uid, newEmail);
    await db.doc(`users/${recipient.uid}`).update({ email: newEmail });
    await share(newEmail, 2);
    await supportAccessReconcileMine.run(request(recipient, {}));
    expect((await db.collection(RELATIONSHIPS).doc(relationId()).get()).data()?.status).toBe("active");
    expect((await list()).grants).toEqual([
      expect.objectContaining({ grantId: grantId(), authorizationId: newAuthorization(newEmail), status: "active" }),
      expect.objectContaining({ grantId: authId(), authorizationId: authId(), status: "superseded" }),
    ]);
    await expect(authorizeStudentScopedRead(recipient, classId, studentId)).resolves.toMatchObject({ via: "grant" });

    // Run the production UI and wire together. Only the Firebase browser
    // transport is replaced, with dispatch to the real callable .run methods.
    const app = resolve(__dirname, "../../../../app");
    const appRequire = createRequire(resolve(app, "package.json"));
    const { buildSync } = appRequire("esbuild");
    const { JSDOM } = appRequire("jsdom");
    const bundle = buildSync({
      stdin: { contents: [
        'export { createStudentSupportSeam } from "./src/supportAccess/wire";',
        'export { renderShareStudentProgressSection } from "./src/shell/surfaces/classSupportAccess";',
      ].join("\n"), resolveDir: app },
      bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
    }).outputFiles[0].text;
    const calls = {
      supportAccessMutationGeneration, supportAccessListForClass, supportAccessV21RevokeAuthorization,
    };
    const revokeRequests: unknown[] = [];
    const load = (name: string) => name === "firebase/functions" ? {
      httpsCallable: (_functions: unknown, callable: string) => async (data: unknown) => {
        if (callable === "supportAccessV21RevokeAuthorization") revokeRequests.push(data);
        return { data: await calls[callable as keyof typeof calls].run(request(owner, data)) };
      },
    } : appRequire(name);
    const module = { exports: {} };
    compileFunction(bundle, ["require", "module", "exports"])(load, module, module.exports);
    const { createStudentSupportSeam, renderShareStudentProgressSection } = module.exports as any;
    const dom = new JSDOM("<body></body>");
    try {
      const { document } = dom.window;
      const root = renderShareStudentProgressSection(document, {
        classId, seam: createStudentSupportSeam({}, null),
        students: [{ studentId, studentDisplayName: "Synthetic student" }], isConnected: () => true,
      });
      document.body.append(root);
      const active = `[data-grant-id="${grantId()}"] [data-testid="ss-access-remove-student"]`;
      const waitFor = async (ready: () => boolean) => {
        for (let attempt = 0; attempt < 200 && !ready(); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(ready()).toBe(true);
      };
      await waitFor(() => root.querySelector(active) !== null);
      expect(root.querySelector(`[data-grant-id="${authId()}"] [data-testid="ss-access-remove-student"]`).disabled).toBe(true);
      root.querySelector(active).click();
      root.querySelector('[data-testid="ss-access-student-confirm-yes"]').click();
      await waitFor(() => /Removed .+ access to/.test(root.textContent));
      expect(revokeRequests).toEqual([{ grantId: grantId(), operationId: expect.any(String), expectedGeneration: 3 }]);
      expect((await db.doc(`studentSupportGrants/${grantId()}`).get()).data()?.status).toBe("revoked");
      await supportAccessReconcileMine.run(request(recipient, {}));
      await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });
      await supportAccessV21RemoveRecipient.run(request(owner, remove));
      await expect(authorizeStudentScopedRead(recipient, classId, studentId)).rejects.toMatchObject({ code: "classes.forbidden" });
    } finally {
      dom.window.close();
    }
  });

  test.each([200, 201, 205])("canonical listing delivers %i legacy grants without Google binding", async count => {
    await onboard();
    mockAuthUsers.delete(recipient.uid);
    const batch = db.batch();
    for (let i = 0; i < count; i++) {
      const sid = `legacy-${studentId}-${i}`;
      batch.set(db.doc(`enrollments/${classId}__${sid}`), { classId, studentId: sid, schoolId: owner.schoolId, status: "active" });
      batch.set(db.doc(`studentSupportGrants/${classId}__${sid}__${recipient.uid}`), {
        classId, studentId: sid, ownerTeacherId: owner.uid, granteeUid: recipient.uid,
        schoolId: owner.schoolId, districtId: owner.districtId, status: "active", grantedAt: Timestamp.now(),
      });
    }
    await batch.commit();
    if (count === 205) mockFailAudit = legacyRelationshipId(owner, recipient.uid);
    const result = await supportAccessListMine.run(request(recipient, {}));
    expect(result.students).toHaveLength(count);
    expect(result.workspace).toMatchObject({ supportOnly: true, recognizedRecipient: count !== 205 });
  }, 30000);

  test("the full 400-pair pending bulk is bounded, idempotent, and creates no teacher accounts", async () => {
    const students = Array.from({ length: 40 }, (_, i) => `bulk-${studentId}-${i}`);
    const emails = Array.from({ length: 10 }, (_, i) => `bulk-${i}-${email}`);
    const batch = db.batch();
    for (const sid of students) batch.set(db.doc(`enrollments/${classId}__${sid}`), { classId, studentId: sid, schoolId: owner.schoolId, status: "active" });
    await batch.commit();
    const data = { classId, studentIds: students, granteeEmails: emails, operationId: randomUUID(), expectedGeneration: 0 };
    const first = await supportAccessV21GrantMany.run(request(owner, data)) as { summary: unknown };
    expect(first.summary).toEqual({ shared: 0, pending: 400, alreadyShared: 0, failed: 0 });
    expect(mockEmailLookups).toBe(10);
    await supportAccessV21GrantMany.run(request(owner, data));
    expect(mockEmailLookups).toBe(20);
    expect((await db.collection(AUTHORIZATIONS).where("classId", "==", classId).get()).size).toBe(400);
    expect((await db.collection("studentSupportGrants").where("classId", "==", classId).get()).size).toBe(0);
    expect((await db.collection("users").where("schoolId", "==", owner.schoolId).get()).size).toBe(1);
    await expect(supportAccessV21GrantMany.run(request(owner, { ...data, studentIds: [...students, students[0]] }))).rejects.toMatchObject({ details: { code: "supportAccess.invalidRequest" } });
    await expect(supportAccessV21GrantMany.run(request(owner, { ...data, granteeEmails: [...emails, emails[0]] }))).rejects.toMatchObject({ details: { code: "supportAccess.invalidRequest" } });
  });

});
