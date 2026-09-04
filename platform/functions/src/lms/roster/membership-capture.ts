import { FieldValue } from "firebase-admin/firestore";

import {
  PlatformError,
  classDocRef,
  computeExternalIdentityDocId,
  assertValidProviderAccountId,
  enrollmentDocRef,
  enrollmentStatusChangeDocRef,
  lmsClassLinksCollectionRef,
  lmsConnectionDocRef,
  lmsRosterMembershipCreationDocRef,
  lmsRosterMembershipReaffirmDocRef,
  lmsRosterMembershipRemovalDocRef,
  lmsRosterMembershipsCollectionRef,
  log,
  resolveActiveUserIdByExternalIdentityDocId,
  type EnrollmentStatusChangeWrite,
  type LmsClassLinkRecord,
  type LmsConnectionRecord,
  type LmsProviderId,
  type LmsRosterMembershipCreationWrite,
} from "../../shared";

import { getProviderAdapter } from "../providers/registry";
import type { LmsRosterStudent } from "../providers/provider";
import { resolveLiveCredential } from "../tokens/credential-resolver";
import { lmsRosterMembershipIdFor } from "../shared/ids";
import { enrollmentIdFor } from "../../enrollments/enrollments-join-by-code";

// Sprint 29G.5K - trusted Google Classroom roster-membership capture.
//
// This is the "LyfeLabz reflects Google Classroom membership" engine. It
// records which upstream Google accounts are members of ONE imported
// Classroom course into the server-only `lmsRosterMemberships` cache,
// keyed by the same SHA-256 identity hash the certified external-identity
// bridge uses. It runs at class-import time and on any later refresh
// opportunity, so a student's own later Google sign-in can be matched to a
// stored membership WITHOUT a teacher re-sync.
//
// It is deliberately NOT the enrollment reconciler (`sync-engine.ts`,
// `lmsClassesSyncRoster`), which remains certified and untouched. Capturing
// membership:
//   - NEVER creates a LyfeLabz user,
//   - NEVER creates an Auth claim,
//   - NEVER creates an enrollment for a not-yet-authenticated member.
//
// The ONLY enrollment side effect here is the safe REMOVAL direction: when
// a fresh, non-empty upstream roster no longer contains a previously-stored
// member who has already signed in and been enrolled, that member's active
// enrollment is withdrawn (`active -> withdrawn` only), honoring the
// certified enrollment lifecycle. An empty or failed upstream roster never
// removes memberships or withdraws enrollments.

export type RosterMembershipCaptureContext = {
  readonly classId: string;
  readonly linkId: string;
  readonly ownerUid: string;
  readonly schoolId: string;
  readonly providerId: LmsProviderId;
};

export type RosterMembershipCaptureSummary = {
  // Distinct upstream Google accounts observed in the fetched roster.
  readonly membersSeen: number;
  // Accounts newly recorded as `member` this capture (new document, or a
  // previously `removed` account that reappeared upstream).
  readonly added: number;
  // Accounts already recorded as `member` and observed again.
  readonly reaffirmed: number;
  // Previously `member` accounts absent from a fresh, non-empty upstream
  // roster, transitioned to `removed`.
  readonly removed: number;
  // Active enrollments withdrawn because their member was removed upstream.
  readonly withdrawnEnrollments: number;
  // Structural safety signal: an empty upstream roster suppresses all
  // removals so a transient/failed upstream read cannot mass-remove.
  readonly upstreamRosterEmpty: boolean;
};

export type RefreshClassRosterMembershipsInput = {
  readonly actor: {
    readonly uid: string;
    readonly schoolId: string;
    readonly districtId?: string;
  };
  readonly classId: string;
};

export type RefreshClassRosterMembershipsResult = RosterMembershipCaptureSummary & {
  readonly classId: string;
  readonly providerId: LmsProviderId;
  readonly linkId: string;
};

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// Compute the deduplicated set of canonical identity hashes for one
// upstream roster. Reuses the certified doc-id derivation, so a stored
// membership hash equals the doc id of the student's own `google.com`
// external identity mapping. The raw provider account id is validated and
// then immediately hashed; it is never persisted.
function hashUpstreamRoster(
  upstreamRoster: readonly LmsRosterStudent[],
): ReadonlySet<string> {
  const hashes = new Set<string>();
  for (const member of upstreamRoster) {
    const providerAccountId = assertValidProviderAccountId(
      member.providerAccountId,
    );
    hashes.add(
      computeExternalIdentityDocId({
        providerId: "google.com",
        providerAccountId,
      }),
    );
  }
  return hashes;
}

// Apply one roster capture against the persisted membership cache. The
// caller has already fetched the upstream roster (so an upstream failure
// performs no write - the fetch rejects before this runs).
export async function captureRosterMemberships(
  ctx: RosterMembershipCaptureContext,
  upstreamRoster: readonly LmsRosterStudent[],
): Promise<RosterMembershipCaptureSummary> {
  const upstreamRosterEmpty = upstreamRoster.length === 0;
  const upstreamHashes = hashUpstreamRoster(upstreamRoster);

  // Existing membership documents for this specific class link.
  const existingSnap = await lmsRosterMembershipsCollectionRef()
    .where("linkId", "==", ctx.linkId)
    .get();
  const existingByHash = new Map<
    string,
    { readonly status: string; readonly id: string }
  >();
  for (const doc of existingSnap.docs) {
    const data = doc.data();
    if (typeof data.identityHash === "string" && data.identityHash.length > 0) {
      existingByHash.set(data.identityHash, { status: data.status, id: doc.id });
    }
  }

  let added = 0;
  let reaffirmed = 0;
  let removed = 0;
  let withdrawnEnrollments = 0;

  // Deterministic ordering so replays produce identical write sequences.
  const orderedHashes = [...upstreamHashes].sort();
  for (const hash of orderedHashes) {
    const membershipId = lmsRosterMembershipIdFor(ctx.linkId, hash);
    const existing = existingByHash.get(hash);
    if (!existing) {
      const creation: LmsRosterMembershipCreationWrite = {
        classId: ctx.classId,
        linkId: ctx.linkId,
        ownerUid: ctx.ownerUid,
        schoolId: ctx.schoolId,
        providerId: ctx.providerId,
        identityHash: hash,
        status: "member",
        firstSeenAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      };
      await lmsRosterMembershipCreationDocRef(membershipId).set(creation);
      added += 1;
    } else if (existing.status !== "member") {
      // Previously removed and now present again upstream: re-affirm.
      await lmsRosterMembershipReaffirmDocRef(membershipId).update({
        status: "member",
        lastSeenAt: FieldValue.serverTimestamp(),
      });
      added += 1;
    } else {
      await lmsRosterMembershipReaffirmDocRef(membershipId).update({
        status: "member",
        lastSeenAt: FieldValue.serverTimestamp(),
      });
      reaffirmed += 1;
    }
  }

  // Removals: previously-member accounts absent from a fresh, NON-EMPTY
  // upstream roster. An empty roster suppresses removals entirely so a
  // transient upstream failure/empty page can never mass-remove membership
  // or mass-withdraw enrollments.
  if (!upstreamRosterEmpty) {
    const orderedExisting = [...existingSnap.docs].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    for (const doc of orderedExisting) {
      const data = doc.data();
      if (data.status !== "member") continue;
      if (upstreamHashes.has(data.identityHash)) continue;

      await lmsRosterMembershipRemovalDocRef(doc.id).update({
        status: "removed",
        removedAt: FieldValue.serverTimestamp(),
      });
      removed += 1;

      // If this removed member has already signed in and been enrolled,
      // withdraw the active enrollment (active -> withdrawn only). A member
      // who never signed in has no identity mapping and no enrollment.
      const studentUserId = await resolveActiveUserIdByExternalIdentityDocId(
        data.identityHash,
      );
      if (studentUserId !== null) {
        const enrollmentId = enrollmentIdFor(ctx.classId, studentUserId);
        const enrollmentSnap = await enrollmentDocRef(enrollmentId).get();
        if (enrollmentSnap.exists) {
          const enrollment = enrollmentSnap.data();
          if (enrollment && enrollment.status === "active") {
            const change: EnrollmentStatusChangeWrite = {
              status: "withdrawn",
              exitedAt: FieldValue.serverTimestamp(),
            };
            await enrollmentStatusChangeDocRef(enrollmentId).update(change);
            withdrawnEnrollments += 1;
          }
        }
      }
    }
  }

  return {
    membersSeen: upstreamHashes.size,
    added,
    reaffirmed,
    removed,
    withdrawnEnrollments,
    upstreamRosterEmpty,
  };
}

async function loadLinkedClassLink(
  classId: string,
): Promise<{ readonly link: LmsClassLinkRecord; readonly linkId: string }> {
  const snapshot = await lmsClassLinksCollectionRef()
    .where("classId", "==", classId)
    .where("status", "==", "linked")
    .limit(2)
    .get();
  if (snapshot.empty) {
    throw new PlatformError(
      "lms.classNotLinked",
      "This LyfeLabz class is not linked to an LMS class.",
    );
  }
  if (snapshot.size > 1) {
    throw new PlatformError(
      "lms.classLinkAmbiguous",
      "This LyfeLabz class has more than one active LMS link.",
    );
  }
  const doc = snapshot.docs[0];
  return { link: doc.data(), linkId: doc.id };
}

async function loadConnection(
  connectionId: string,
): Promise<LmsConnectionRecord> {
  const snapshot = await lmsConnectionDocRef(connectionId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "lms.connectionNotFound",
      "No connection matches this identifier.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "lms.connectionNotFound",
      "Connection record was empty.",
    );
  }
  return data;
}

// Public entry point: fetch the current upstream roster for one imported
// class and reconcile the trusted membership cache. Ownership is
// re-verified against the persisted records (defense-in-depth); the class
// need NOT be `active` (membership can be cached for a `needsSetup` class
// that has been linked but not yet had its grade/block confirmed), but it
// MUST be LMS-sourced and owned by the caller.
export async function refreshClassRosterMemberships(
  input: RefreshClassRosterMembershipsInput,
): Promise<RefreshClassRosterMembershipsResult> {
  const { actor, classId } = input;

  const classSnapshot = await classDocRef(classId).get();
  if (!classSnapshot.exists) {
    throw new PlatformError("lms.classNotFound", "Class was not found.");
  }
  const classRecord = classSnapshot.data();
  if (!classRecord) {
    throw new PlatformError("lms.classNotFound", "Class record was empty.");
  }
  if (classRecord.teacherId !== actor.uid) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own this class.",
    );
  }
  if (classRecord.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller schoolId does not match class schoolId.",
    );
  }
  if (classRecord.enrollmentSource !== "lms") {
    throw new PlatformError(
      "lms.classNotLinked",
      "Class is not sourced from an LMS.",
    );
  }

  const { link, linkId } = await loadLinkedClassLink(classId);
  if (link.ownerUid !== actor.uid || link.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own the LMS link for this class.",
    );
  }

  const connection = await loadConnection(link.connectionId);
  if (connection.teacherId !== actor.uid) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own the LMS connection backing this link.",
    );
  }
  if (connection.status !== "active") {
    throw new PlatformError(
      "lms.connectionNotActive",
      "LMS connection is not active.",
    );
  }
  if (connection.providerId !== link.providerId) {
    throw new PlatformError(
      "lms.connectionMismatch",
      "LMS connection does not match the class link's provider.",
    );
  }

  const bundle = await resolveLiveCredential(connection.tokenRef);
  const adapter = getProviderAdapter(connection.providerId);

  // Read + hash + reconcile. If the roster retrieval fails, the adapter
  // rejects and NO membership write occurs.
  const upstreamRoster = await adapter.listClassRoster({
    accessToken: bundle.accessToken,
    lmsClassId: link.lmsClassId,
  });

  const summary = await captureRosterMemberships(
    {
      classId,
      linkId,
      ownerUid: actor.uid,
      schoolId: classRecord.schoolId,
      providerId: link.providerId,
    },
    upstreamRoster,
  );

  safeLog(() =>
    log.info("lms.rosterMembershipsCaptured", {
      actorUserId: actor.uid,
      classId,
      providerId: link.providerId,
      linkId,
      membersSeen: summary.membersSeen,
      added: summary.added,
      reaffirmed: summary.reaffirmed,
      removed: summary.removed,
      withdrawnEnrollments: summary.withdrawnEnrollments,
      upstreamRosterEmpty: summary.upstreamRosterEmpty,
    }),
  );

  return {
    ...summary,
    classId,
    providerId: link.providerId,
    linkId,
  };
}
