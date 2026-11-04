import type { UserRecord } from "firebase-admin/auth";
import { normalizeSupportEmail, relationshipMatchesActor, supportRecordId, verifiedGoogleIdentity, type RecipientRelationship } from "./recipient-policy";

const google = (overrides: Record<string, unknown> = {}): UserRecord => ({ uid: "support", email: "Para@weston.org", emailVerified: true, disabled: false, providerData: [{ providerId: "google.com", uid: "google-subject", email: "para@weston.org" }], ...overrides } as unknown as UserRecord);
const actor = { uid: "support", schoolId: "school", districtId: "district" };
const relation: RecipientRelationship = { ownerTeacherId: "owner", email: "para@weston.org", schoolId: "school", districtId: "district", status: "pending", revision: 1, recipientUid: null, googleIdentity: null };

describe("support recipient identity policy", () => {
  test.each(["para@weston.org", " Para@WESTON.ORG ", "para.name+support@weston.org"])("accepts and normalizes %s", email => expect(normalizeSupportEmail(email)).toBe(email.trim().toLowerCase()));
  test.each(["para@weston.org.evil.test", "para@sub.weston.org", "para@west0n.org", "para@@weston.org", "para@weston", "para @weston.org", ".para@weston.org", "para..name@weston.org", "para@school.org", "", null])("rejects %s", email => expect(normalizeSupportEmail(email)).toBeNull());
  test("identifiers are deterministic, unambiguous and contain no email", () => {
    expect(supportRecordId("a", "bc")).not.toBe(supportRecordId("ab", "c"));
    expect(supportRecordId("owner", "para@weston.org")).toMatch(/^[a-f0-9]{64}$/);
    expect(supportRecordId("owner", "para@weston.org")).toBe(supportRecordId("owner", "para@weston.org"));
  });
  test("accepts only the server Google identity with a matching verified email", () => expect(verifiedGoogleIdentity(google()).email).toBe("para@weston.org"));
  test.each([
    { emailVerified: false }, { disabled: true }, { providerData: [] },
    { providerData: [{ providerId: "password", uid: "subject", email: "para@weston.org" }] },
    { providerData: [{ providerId: "google.com", uid: "subject", email: "other@weston.org" }] },
    { providerData: [{ providerId: "google.com", uid: "", email: "para@weston.org" }] },
    { email: "changed@weston.org" },
    { providerData: [{ providerId: "google.com", uid: "one", email: "para@weston.org" }, { providerId: "google.com", uid: "two", email: "para@weston.org" }] },
  ])("refuses invalid identity %j", overrides => expect(() => verifiedGoogleIdentity(google(overrides))).toThrow());
  test("deleted and recreated accounts cannot inherit an existing binding", () => {
    const identity = verifiedGoogleIdentity(google());
    expect(relationshipMatchesActor(relation, actor, identity)).toBe(true);
    expect(relationshipMatchesActor({ ...relation, recipientUid: "deleted-uid", googleIdentity: identity.identity }, actor, identity)).toBe(false);
    expect(relationshipMatchesActor({ ...relation, recipientUid: actor.uid, googleIdentity: "previous-google-identity" }, actor, identity)).toBe(false);
  });
  test.each([{ status: "revoked" as const }, { schoolId: "other" }, { districtId: "other" }, { email: "different@weston.org" }])("refuses revoked or mismatched scope %j", change => expect(relationshipMatchesActor({ ...relation, ...change }, actor, verifiedGoogleIdentity(google()))).toBe(false));
});
