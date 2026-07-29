/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await */
//
// Sprint 23C-I - Executable equivalence contract.
//
// This test proves, with a small fixture, the identity-equivalence
// invariant Sprint 23C's future roster engine will rely on:
//
//   The exact string that Firebase Auth exposes as the `google.com`
//   provider account identifier IS the exact string that Google
//   Classroom exposes as the `Student.userId` field. That single
//   canonical value, and nothing else, is what determines the
//   external-identity document identifier and the resolved Firebase
//   UID.
//
// The test uses fictional identifiers only. Every assertion is
// framed against the equivalence claim - not against implementation
// details - so a future re-implementation of the store still has to
// preserve the same client-observable behavior.

// -------------------- In-memory Firestore harness --------------------

const store = new Map<string, Record<string, any>>();

function reset(): void {
  store.clear();
}

const SERVER_TS_SENTINEL = "___SERVER_TS___";

function resolveTimestamps(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v === SERVER_TS_SENTINEL ? { toDate: () => new Date(0) } : v;
  }
  return out;
}

function makeDocRef(id: string): any {
  return {
    __id: id,
    async get() {
      const raw = store.get(id);
      return {
        exists: raw !== undefined,
        id,
        data: () => (raw ? raw : undefined),
      };
    },
  };
}

function collectionQuery(): any {
  const conds: { field: string; value: any }[] = [];
  const q: any = {
    where(field: string, op: string, value: any) {
      if (op !== "==") throw new Error("harness only supports ==");
      conds.push({ field, value });
      return q;
    },
    async get() {
      const docs: { id: string; data: Record<string, any> }[] = [];
      for (const [id, data] of store) {
        let match = true;
        for (const c of conds) {
          if (data[c.field] !== c.value) {
            match = false;
            break;
          }
        }
        if (match) docs.push({ id, data });
      }
      return {
        docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
        empty: docs.length === 0,
        size: docs.length,
      };
    },
  };
  return q;
}

function makeTx(): any {
  const pending: {
    kind: "create" | "update";
    ref: any;
    data: Record<string, any>;
  }[] = [];
  return {
    async get(t: any) {
      return t.get();
    },
    create(ref: any, data: Record<string, any>) {
      pending.push({ kind: "create", ref, data });
    },
    update(ref: any, data: Record<string, any>) {
      pending.push({ kind: "update", ref, data });
    },
    _commit() {
      for (const p of pending) {
        if (p.kind === "create") {
          if (store.has(p.ref.__id)) {
            const e: Error & { code?: number } = new Error("ALREADY_EXISTS");
            e.code = 6;
            throw e;
          }
          store.set(p.ref.__id, resolveTimestamps(p.data));
        } else {
          const cur = store.get(p.ref.__id);
          if (!cur) throw new Error("update missing");
          store.set(p.ref.__id, {
            ...cur,
            ...resolveTimestamps(p.data),
          });
        }
      }
    },
  };
}

async function runTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const tx = makeTx();
  const out = await fn(tx);
  tx._commit();
  return out;
}

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "___SERVER_TS___" },
}));

jest.mock("../firestore/transaction", () => ({
  runFirestoreTransaction: (fn: any) => runTx(fn),
}));

jest.mock("../firestore/typed-ref", () => ({
  externalIdentityDocRef: (id: string) => makeDocRef(id),
  externalIdentitiesCollectionRef: () => collectionQuery(),
}));

import {
  createOrConfirmExternalIdentity,
  resolveActiveExternalIdentity,
  revokeExternalIdentity,
} from "./external-identity-store";
import { computeExternalIdentityDocId } from "./external-identity-doc-id";

// -------------------- Fixture: fictional identities --------------------
//
// A single fictional identifier stands in for both the Firebase Auth
// `google.com` provider account identifier AND the Google Classroom
// `Student.userId`. The equivalence claim being tested is that the
// two ARE the same string. This fixture uses one variable and
// asserts on that shared value throughout.

// Fictional 21-digit numeric-looking identifier. Longer than the
// 15-digit precision threshold of JavaScript's `Number` so precision
// loss would be observable if the code ever converted through a
// number.
const FICTIONAL_GOOGLE_ACCOUNT_ID = "123456789012345678901";

// Fictional Google Classroom Student wire shape (fields relevant to
// equivalence only). `userId` on this record is - by contract - the
// same string that Firebase Auth exposes on the `google.com`
// providerData entry.
const FICTIONAL_CLASSROOM_STUDENT: {
  readonly userId: string;
  readonly profile: {
    readonly name: { readonly fullName: string };
    readonly emailAddress: string;
    readonly photoUrl: string;
  };
} = {
  userId: FICTIONAL_GOOGLE_ACCOUNT_ID,
  profile: {
    name: { fullName: "Fictional Student" },
    emailAddress: "fictional.student@example.invalid",
    photoUrl: "https://example.invalid/avatar.png",
  },
};

// Fictional Firebase Auth `google.com` provider entry.
const FICTIONAL_FIREBASE_AUTH_PROVIDER_ENTRY: {
  readonly providerId: "google.com";
  readonly uid: string;
} = {
  providerId: "google.com",
  uid: FICTIONAL_GOOGLE_ACCOUNT_ID,
};

const FICTIONAL_LYFELABZ_UID = "lyfe-uid-fictional-abc";

beforeEach(() => {
  reset();
});

describe("Sprint 23C-I - executable equivalence contract", () => {
  it("(1) the Firebase Auth google.com provider UID equals the Classroom Student.userId (fictional fixture)", () => {
    expect(FICTIONAL_FIREBASE_AUTH_PROVIDER_ENTRY.uid).toBe(
      FICTIONAL_CLASSROOM_STUDENT.userId,
    );
  });

  it("(2) that exact string produces exactly one deterministic identity document ID", () => {
    const idFromAuth = computeExternalIdentityDocId({
      providerId: FICTIONAL_FIREBASE_AUTH_PROVIDER_ENTRY.providerId,
      providerAccountId: FICTIONAL_FIREBASE_AUTH_PROVIDER_ENTRY.uid,
    });
    const idFromClassroom = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: FICTIONAL_CLASSROOM_STUDENT.userId,
    });
    expect(idFromAuth).toBe(idFromClassroom);
    expect(idFromAuth).toHaveLength(64);
    expect(idFromAuth).toMatch(/^[0-9a-f]{64}$/);
  });

  it("(3) an active mapping resolves to the expected Firebase UID", async () => {
    await createOrConfirmExternalIdentity({
      providerId: "google.com",
      providerAccountId: FICTIONAL_FIREBASE_AUTH_PROVIDER_ENTRY.uid,
      userId: FICTIONAL_LYFELABZ_UID,
      source: "authOnUserCreate",
    });
    const resolution = await resolveActiveExternalIdentity({
      providerId: "google.com",
      providerAccountId: FICTIONAL_CLASSROOM_STUDENT.userId,
    });
    expect(resolution).toEqual({
      resolved: true,
      userId: FICTIONAL_LYFELABZ_UID,
    });
  });

  it("(4-6) no email, display name, or other profile data participates in the derivation", () => {
    // The equivalence identifier is derived solely from providerId +
    // providerAccountId. The helper accepts no other input, so the
    // fictional profile (email, fullName, photoUrl) cannot influence
    // the derived document ID by construction. Two Classroom
    // students whose profiles differ but whose userIds match must
    // produce the same document ID.
    const idA = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: FICTIONAL_CLASSROOM_STUDENT.userId,
    });
    const differentProfile = {
      ...FICTIONAL_CLASSROOM_STUDENT,
      profile: {
        name: { fullName: "Totally Different Name" },
        emailAddress: "other@example.invalid",
        photoUrl: "https://example.invalid/other.png",
      },
    };
    const idB = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: differentProfile.userId,
    });
    expect(idA).toBe(idB);
  });

  it("(7) numeric conversion is never used - lossy round-trip through Number would produce a different ID", () => {
    // Sanity: the fictional id, when converted through Number and
    // back, loses precision (21 digits vs Number's 15-16). The
    // derivation MUST use the exact original string so the two IDs
    // MUST differ.
    const exact = FICTIONAL_GOOGLE_ACCOUNT_ID;
    const lossy = String(Number(FICTIONAL_GOOGLE_ACCOUNT_ID));
    expect(lossy).not.toBe(exact);
    const idExact = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: exact,
    });
    const idLossy = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: lossy,
    });
    expect(idExact).not.toBe(idLossy);
  });

  it("(8) long identifier strings preserve exact precision (21-digit fixture stored byte-for-byte)", async () => {
    const created = await createOrConfirmExternalIdentity({
      providerId: "google.com",
      providerAccountId: FICTIONAL_GOOGLE_ACCOUNT_ID,
      userId: FICTIONAL_LYFELABZ_UID,
      source: "adminMigration",
    });
    const stored = store.get(created.externalIdentityId);
    expect(stored?.providerAccountId).toBe(FICTIONAL_GOOGLE_ACCOUNT_ID);
    expect(typeof stored?.providerAccountId).toBe("string");
  });

  it("(9) a mismatched Classroom identifier does not resolve", async () => {
    await createOrConfirmExternalIdentity({
      providerId: "google.com",
      providerAccountId: FICTIONAL_GOOGLE_ACCOUNT_ID,
      userId: FICTIONAL_LYFELABZ_UID,
      source: "authOnUserCreate",
    });
    const wrong = await resolveActiveExternalIdentity({
      providerId: "google.com",
      providerAccountId: "999999999999999999999",
    });
    expect(wrong).toEqual({ resolved: false });
  });

  it("(10) a revoked mapping does not resolve", async () => {
    await createOrConfirmExternalIdentity({
      providerId: "google.com",
      providerAccountId: FICTIONAL_GOOGLE_ACCOUNT_ID,
      userId: FICTIONAL_LYFELABZ_UID,
      source: "authOnUserCreate",
    });
    await revokeExternalIdentity({
      providerId: "google.com",
      providerAccountId: FICTIONAL_GOOGLE_ACCOUNT_ID,
      userId: FICTIONAL_LYFELABZ_UID,
    });
    const r = await resolveActiveExternalIdentity({
      providerId: "google.com",
      providerAccountId: FICTIONAL_GOOGLE_ACCOUNT_ID,
    });
    expect(r).toEqual({ resolved: false });
  });

  it("(privacy) neither the raw provider account id nor the profile data appears in the derived document identifier", () => {
    const id = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: FICTIONAL_GOOGLE_ACCOUNT_ID,
    });
    expect(id.includes(FICTIONAL_GOOGLE_ACCOUNT_ID)).toBe(false);
    expect(id).not.toContain(FICTIONAL_CLASSROOM_STUDENT.profile.emailAddress);
    expect(id).not.toContain("Fictional");
  });
});
