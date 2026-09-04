// Sprint 23C-I - External identity module re-exports.
//
// External callers should prefer importing from the top-level
// `shared/index.ts` re-export barrel. This inner index is provided
// so tests and adjacent modules can also import directly from
// `shared/identity` without reaching for individual filenames.

export {
  assertValidProviderAccountId,
  assertValidProviderId,
  computeExternalIdentityDocId,
  type ExternalIdentityDocIdInput,
} from "./external-identity-doc-id";

export {
  createOrConfirmExternalIdentity,
  listActiveExternalIdentityHashesForUser,
  listExternalIdentitiesForUser,
  reconcileExternalIdentityForUser,
  resolveActiveExternalIdentity,
  resolveActiveUserIdByExternalIdentityDocId,
  restoreExternalIdentity,
  revokeExternalIdentity,
  type CreateOrConfirmInput,
  type CreateOrConfirmOutcome,
  type CreateOrConfirmResult,
  type ExternalIdentityResolution,
  type ReconcileForUserInput,
  type ReconcileForUserPerProviderResult,
  type ReconcileForUserResult,
  type RestoreInput,
  type RestoreOutcome,
  type RestoreResult,
  type RevokeInput,
  type RevokeOutcome,
  type RevokeResult,
} from "./external-identity-store";
