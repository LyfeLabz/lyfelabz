# Roster Display Name Implementation Contract

**Status:** Canonical implementation contract. Ratified under Sprint 10A step F-4.
**Date:** 2026-07-12
**Anchor decision:** PDR-028 in `LYFELABZ_PLATFORM_DECISIONS.md`.
**Implements:** PDR-003 (verified teacher identity), PDR-005 (single teacher-of-record per class), PDR-011 (personal-data minimization and retention), PDR-019 (LMS integration posture, roster authority), PDR-023 (Identity and Onboarding Architecture), PDR-025 (District Security Boundary Implementation Contract).
**Reconciles:** `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, `LMS_EXPERIENCE.md`, `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`, `LYFELABZ_PLATFORM_ARCHITECTURE.md`.
**Governs:** Server-side implementation of teacher-readable roster display names across users, enrollments, roster placeholders, Google profile interaction, LMS roster refresh, teacher roster resolution, and the Firestore, Cloud Function, and audit ownership of every writer that produces a name a teacher will read.

This document is an engineer-facing implementation contract. It does not redesign product behavior, introduce new user-facing features, expand roster surface area beyond the certified architecture, or amend the certified identity, LMS, or district posture. It translates the certified architecture into one normative rule set that a future implementation sprint MUST follow.

Where this contract and any earlier document conflict on implementation detail for display names, this contract prevails. Where this contract and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` conflict on identity behavior, or this contract and `LMS_INTEGRATION_ARCHITECTURE.md` conflict on roster authority, or this contract and `LMS_EXPERIENCE.md` conflict on teacher-facing product behavior, the certified specifications prevail and this contract MUST be reconciled.

---

## 1. Purpose

Teachers require readable student names on rosters. `LYFELABZ_ARCHITECTURE_REVIEW.md` §153 recorded that "student data" is not one bucket; display name in particular is a distinct data tier from email, submission text, and free-response answers. The certified corpus locates display-name statements across `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.1 (`users/{uid}.displayName`), §3.4 (`enrollments/{enrollmentId}.displayNameOverride`), `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §11 through §17 (identity provisioning, roster placeholders), `LMS_INTEGRATION_ARCHITECTURE.md` §7 (roster authority) and §7.5 (placeholder enrollments), `LMS_EXPERIENCE.md` §5 (LMS name-change refresh) and §12 (class-name display override), `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (self-update allowlist), `LYFELABZ_FIREBASE_SECURITY_MODEL.md` §539 and §589 (identity is not a display name), `LYFELABZ_PLATFORM_ARCHITECTURE.md` §229 (durable identities), and the Sprint 3 shell specifications. The independent Fable review recorded a fourth primary finding: canonical ownership of teacher-readable display names is distributed and, in one direction, circular (the display name a teacher reads on a roster may be resolved from the user, from the enrollment override, or from the placeholder, and the "authoritative" answer is not uniformly named).

Sprint 10A F-4 collapses those statements into one implementation contract so engineers do not have to reconstruct the ownership, resolution, and synchronization model from many partial statements.

This document is the single source of truth for:

- which document holds the canonical display name for a signed-in student, a signed-in teacher, and a signed-in administrator,
- which document holds the per-class display-name override for a signed-in student,
- which document holds the roster placeholder name for a not-yet-signed-in student,
- how a teacher-visible roster resolves a display name for a given enrollment,
- how a Google profile display-name change interacts with the canonical LyfeLabz display name,
- how an LMS roster-reported display-name change interacts with the canonical LyfeLabz display name and the placeholder name,
- which Cloud Function owns each write that produces a teacher-readable name,
- which Firestore collections own which pieces of display-name state,
- which security boundaries every display-name write and every display-name read MUST enforce,
- what remains explicitly deferred to a later implementation sprint.

## 2. Scope

This contract governs:

- Canonical ownership of `users/{uid}.displayName` for every role.
- Canonical ownership of `enrollments/{enrollmentId}.displayNameOverride` as a per-class presentation override.
- Canonical ownership of the roster-placeholder display name recorded on a not-yet-resolved LMS roster entry.
- The single teacher-facing roster resolution rule that composes these three sources.
- The interaction between the Google Authentication profile display name and the LyfeLabz canonical display name at first sign-in, on subsequent sign-in, and on user-initiated profile change.
- The interaction between the LMS-reported roster display name and the canonical LyfeLabz display name, including the "students whose display name in the LMS has changed since the last refresh" delta named in `LMS_EXPERIENCE.md` §5.
- Cloud Function ownership for every callable that writes a display-name field.
- Firestore collection ownership and immutability posture for every display-name field.
- Firestore Security Rules expectations for reads and writes that carry a display-name field.
- Audit event vocabulary for display-name changes.
- The error contract for the callables named here.
- Composite index expectations where a display-name field participates in a listing.

It does not govern:

- The visual presentation of a name on a specific teacher surface. That remains owned by `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`, `CLASS_SNAPSHOT_EXPERIENCE.md`, `LMS_EXPERIENCE.md`, and the Sprint 3 shell specifications.
- The identity lifecycle. Provisioning, verification, activation, roster placeholder resolution, and identity matching remain owned by `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §11 through §17.
- The roster authority rule. LMS-linked classes' roster authority is Google Classroom; manual classes' roster authority is LyfeLabz. This contract only records how names sourced under each authority land in canonical fields.
- District enforcement. Every callable named here also complies with `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`; the district rules are not restated in full below.
- The assessment session and attempt pipeline. Attempts carry stable internal references, not display names, per `ASSESSMENT_PIPELINE_SPECIFICATION.md` §466 and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`.
- The Google Classroom publication and deep-link paths. Those remain owned by `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`; a display-name change never propagates through the deep-link URL or a Classroom coursework record.
- The parent, districtAdministrator, schoolAdministrator, and future co-teacher roles. Reserved by `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.1 and out of scope until authorized by a superseding PDR.

## 3. Authority and Precedence

This contract implements the following canonical documents:

- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` (identity, provisioning, roster authority, roster placeholder lifecycle; ratified under PDR-023).
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-003, PDR-005, PDR-011, PDR-015, PDR-018, PDR-019, PDR-023, PDR-025, PDR-026, PDR-027, PDR-028).
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` (canonical shapes of `users/{uid}` and `enrollments/{enrollmentId}`).
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md` (identity-is-not-a-display-name posture; rule-layer enforcement).
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (single-purpose, atomic, idempotent callable posture).
- `LMS_INTEGRATION_ARCHITECTURE.md` (LMS-linked classes' roster authority; placeholder enrollments; refresh callable).
- `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` (Sprint sequence for roster reconciliation).
- `LMS_EXPERIENCE.md` (teacher-facing refresh confirmation surface, per-class override language).
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` (student assignment and results experience; teacher workspace philosophy).
- `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (district enforcement).
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (personal-data minimization on attempts).
- `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` (Classroom is not a display-name authority for LyfeLabz).

Precedence rules:

1. Where this contract and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` conflict on identity behavior, the specification prevails and this contract MUST be reconciled.
2. Where this contract and `LMS_INTEGRATION_ARCHITECTURE.md` conflict on roster authority, the architecture prevails and this contract MUST be reconciled.
3. Where this contract and `LMS_EXPERIENCE.md` conflict on teacher-facing product behavior for refresh confirmation or per-class override language, the experience document prevails and this contract MUST be reconciled.
4. Where this contract and any older implementation document (data model, security model, charter, index strategy) conflict on display-name implementation, this contract prevails and the older document MUST be reconciled with a narrow Sprint 10A F-4 notice.
5. Where this contract intersects with `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`, both apply. District enforcement is additive.
6. Where existing implementation code diverges from this contract, the code MUST be reconciled during the sprint that lands the display-name callables. This contract never treats older implementation code as authoritative.

## 4. Terminology

- **Canonical identity.** The `users/{uid}` document keyed by the Firebase Auth UID. The authoritative record of a person. Identity is not a display name (`LYFELABZ_FIREBASE_SECURITY_MODEL.md` §589 and §608).
- **Canonical display name.** The `users/{uid}.displayName` field. The authoritative teacher-readable name for a signed-in person across LyfeLabz.
- **Per-class display-name override.** The `enrollments/{enrollmentId}.displayNameOverride` field. An optional per-(student, class) presentation override. Applies to student roster rendering in exactly one class.
- **Roster placeholder.** A pre-identity roster entry produced by LMS import for a student who has not yet signed into LyfeLabz. Carries a placeholder name sourced from the roster authority; carries no `users/{uid}` document.
- **Placeholder name.** The teacher-readable name recorded on a roster placeholder. Sourced from the LMS at import time; refreshed by the LMS refresh callable; supplanted at first sign-in when the placeholder resolves.
- **Google profile display name.** The `displayName` field on the Firebase Auth record for a signed-in user. Sourced from Google at sign-in. Not authoritative for LyfeLabz.
- **LMS-reported display name.** The student name Google Classroom returns for a roster entry. Not authoritative for LyfeLabz beyond the placeholder-name path in §11.
- **Teacher roster.** Any teacher-facing listing of enrolled students in a class. The roster displays a per-enrollment resolved name computed under §12.
- **Roster authority.** The certified per-class attribute (`google_classroom` or `lyfelabz`) that names the upstream source of roster membership (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §9). This contract records how each authority's names land in canonical fields but does not amend the authority rule.
- **Display-name write.** Any Firestore write that mutates `users/{uid}.displayName`, `enrollments/{enrollmentId}.displayNameOverride`, or a roster placeholder name.
- **Display-name read.** Any Firestore read that returns a value the client will render as a person's name. All such reads flow through the resolver in §12; no client surface concatenates a name from other fields.

## 5. Canonical Identity Versus Display Identity

Identity and display are permanently separate.

- **Canonical identity** is the `users/{uid}` document under `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.1. The join key from Firebase Auth to the domain record is `authUid`. Identity resolves permissions, ownership, and audit attribution. No display-name field participates in an authorization decision.
- **Display identity** is the resolved teacher-readable name produced by §12. Display is presentation only. No security rule and no callable branches on a display-name value.
- Renaming a person MUST NOT affect the person's identity, `authUid`, `districtId`, `schoolId`, `role`, or any historical audit event. The prior display name is not preserved on the user document; the audit stream records the transition.

Read this section as the load-bearing corollary of `LYFELABZ_FIREBASE_SECURITY_MODEL.md` §589 and §608: a public display name is not an identity, and no callable in this contract permits a display name to grant, widen, or narrow authorization.

## 6. Canonical Ownership of Display Names

The following ownership matrix is canonical. Every writer of a teacher-readable name appears here. Every field that a teacher-facing roster reads appears here.

| Field | Purpose | Sole authoritative writer | Read audience | Applies to |
| --- | --- | --- | --- | --- |
| `users/{uid}.displayName` | Canonical display name for a signed-in person | The user (self-update, `usersUpdateProfile` callable OR self-write under the Sprint 2 rules allowlist per §14) AND server, on onboarding activation (`teachersCompleteVerification`, `studentsCompleteOnboarding`, `usersFirstSignInActivation`) | The user; owning teacher on a roster; the resolved viewer per role scoping in `LYFELABZ_FIREBASE_SECURITY_MODEL.md` | Every role: `teacher`, `student`, `platformAdministrator`, and every future role at activation |
| `enrollments/{enrollmentId}.displayNameOverride` | Optional per-(student, class) presentation override | The owning teacher via `enrollmentsSetDisplayNameOverride` AND the enrolling student via `enrollmentsSetDisplayNameOverride` (self-restricted to their own enrollment) | Owning teacher; enrolled student; server | The single enrollment named by `enrollmentId`; never widens to another class |
| Roster placeholder name (in `rosterPlaceholders/*` or an equivalent per-class placeholder subcollection, see §7) | Teacher-readable name for a not-yet-signed-in student on an LMS-linked class | Server-only: `lmsClassImport` (initial write), `lmsClassRefresh` (name-change reconciliation), `usersFirstSignInActivation` (terminal supplant) | Owning teacher; server | Only LMS-linked classes; never for manual classes |

Load-bearing invariants:

- `users/{uid}.displayName` is the single authoritative display name for a signed-in person. No other collection duplicates it. `enrollments/{enrollmentId}.displayNameOverride` is a presentation adjustment, not a duplicate.
- The per-class override never becomes the canonical display name. It never propagates to `users/{uid}.displayName`. It never propagates to another enrollment. It never appears on a teacher-scoped view of a different class.
- The roster placeholder name is not a display name for a LyfeLabz identity. Once the placeholder resolves to a real enrollment (§11.3), the placeholder name is retired; the resolved enrollment renders under §12 against the newly provisioned `users/{uid}.displayName`.
- No Cloud Function outside this ownership matrix writes a display-name field. Every callable elsewhere in the LyfeLabz Cloud Function corpus that appears to need one MUST read via the resolver in §12; MUST NOT write a duplicate name into a submission, attempt, session, class, or audit document; and MUST NOT ask the client for a name.
- Attempts, sessions, submissions, and rollups carry `studentId` as an opaque reference. They MUST NOT carry a denormalized display-name copy. This restates `ASSESSMENT_PIPELINE_SPECIFICATION.md` §466 and `LYFELABZ_FIRESTORE_DATA_MODEL.md` §766 for the display-name surface.

## 7. Firestore Ownership Model

The following Firestore artifacts are canonical for display-name state. Each row lists the sole authorized writer, the read audience, and the immutability posture.

| Collection or field | Purpose | Written by | Readable by | Immutable after write |
| --- | --- | --- | --- | --- |
| `users/{uid}.displayName` | Canonical display name for a signed-in person | On activation: `teachersCompleteVerification`, `studentsCompleteOnboarding`, `usersFirstSignInActivation`. On subsequent change: `usersUpdateProfile` (or self-write under the Sprint 2 rules allowlist, see §14) | Owning user; owning teacher for enrolled students; server; Platform Administrator under audit | Overwritable by the sole authorized writer only. Every overwrite emits an audit event per §15 |
| `enrollments/{enrollmentId}.displayNameOverride` | Optional per-class override | `enrollmentsSetDisplayNameOverride` (owning teacher OR enrolled student) | Owning teacher; enrolled student; server | Overwritable by the sole authorized writer only. Clearing the override (set to null via a delete-field mutation) is a permitted write |
| Roster placeholder document (canonical location: a per-class subcollection or a top-level `rosterPlaceholders` collection; see §7.1) | Names an expected student on an LMS-linked class prior to first sign-in | `lmsClassImport`, `lmsClassRefresh` (both server-only) | Owning teacher; server | Overwritable by the two server writers only. Terminal state on placeholder resolution (§11.3): the placeholder document is transitioned to an inactive state (never hard-deleted) so that historical roster attribution survives |
| `auditEvents/{eventId}` | Append-only audit sink | Server only | Server; Platform Administrator | Yes |

Ownership rules:

- No callable other than those enumerated in the table writes any display-name field.
- No client role writes a display-name field directly. The Sprint 2 rules allowlist for `users/{uid}.displayName` self-write (Sprint 2 §4.4 and `SPRINT_2_COMPLETION_REPORT.md`) remains authoritative for the self-update case; every other write path routes through a callable.
- The roster placeholder is a class-scoped concept per `LYFELABZ_FIRESTORE_DATA_MODEL.md` Sprint 9C Reconciliation Notice; it is not a `users/{uid}` document.
- No callable in this contract writes to `classes/*`, `schools/*`, `districts/*`, `assessments/*`, `assessmentSessions/*`, `attempts/*`, `attemptRollups/*`, `assignmentRollups/*`, `assessmentAnswerKeys/*`, `assignments/*`, `lmsAssignmentPublications/*`, or `lmsClassLinks/*`.

### 7.1 Roster Placeholder Location

The canonical location of a roster placeholder document is not fixed by `LYFELABZ_FIRESTORE_DATA_MODEL.md` in Version 1; §3.4 records the enrollment concept but leaves the placeholder shape to the LMS integration architecture, and `LMS_INTEGRATION_ARCHITECTURE.md` §7.5 names the placeholder concept without fixing a collection. The implementation sprint that lands the LMS import path MUST choose exactly one location and record the choice as an operational appendix to this contract without a new PDR. The two authorized shapes are:

- **Enrollment-as-placeholder.** An `enrollments/{enrollmentId}` document written by `lmsClassImport` with `status === "awaitingFirstSignIn"` and a required `placeholderName` field. On resolution (§11.3), `usersFirstSignInActivation` transitions the document to `status === "active"`, populates `studentId`, and clears `placeholderName` (via a delete-field mutation).
- **Separate placeholder collection.** A `rosterPlaceholders/{placeholderId}` document written by `lmsClassImport` with `classId`, `schoolId`, `districtId`, `lmsRosterRef`, and `placeholderName` fields; on resolution, `usersFirstSignInActivation` transitions the placeholder to `status === "resolved"` and produces the canonical `enrollments/{enrollmentId}` under §3.4.

Either shape satisfies this contract. The chosen shape MUST be single-writer per §7 and MUST comply with the resolver in §12. The two shapes are enumerated to remove ambiguity from the sprint that lands the LMS import path; the choice is an implementation detail and does not require a new PDR.

## 8. Collection Relationships

The load-bearing relationships between display-name-carrying collections are:

- `users/{uid}` is the sole canonical carrier of a person's display name. One user, one canonical display name at a time.
- `enrollments/{enrollmentId}` references a single `users/{uid}` (once the enrollment is resolved to a signed-in student) OR carries the placeholder shape in §7.1. An enrollment never references two users.
- The per-class override on `enrollments/{enrollmentId}.displayNameOverride` is scoped to the single enrollment identified by `enrollmentId`. It never refers to another class and never propagates.
- The roster placeholder is scoped to a single (class, LMS roster entry). One placeholder per (class, LMS roster entry) pair. On resolution, exactly one `users/{uid}` and one active enrollment are produced.
- Renaming a person by overwriting `users/{uid}.displayName` does not require rewriting any enrollment, class, submission, or attempt record. The resolver in §12 always reads the current `users/{uid}.displayName` and the current per-class override.

## 9. Enrollment and Roster Resolution

Every teacher-facing roster resolves a per-enrollment display name through the same rule. No teacher surface computes a name from any other source, and no callable in this contract exposes a raw `users/{uid}.displayName` to a teacher without applying the per-enrollment override.

For an enrollment `E` naming a class `C` and a student `S`:

1. If `E.displayNameOverride` is a non-empty string, the resolved name is `E.displayNameOverride`.
2. Otherwise, if `E` resolves to a signed-in `users/{uid}` document `U` with a non-empty `U.displayName`, the resolved name is `U.displayName`.
3. Otherwise, if `E` is in the placeholder shape (§7.1) with a non-empty placeholder name, the resolved name is the placeholder name, and the teacher-facing surface MUST render the placeholder activation state per `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §11.
4. Otherwise, the resolver returns `null` and the teacher-facing surface MUST render a plain-language "Name unavailable" affordance. No callable MUST panic on this branch; the render is a stable degradation state.

The resolver never falls back to the Google profile display name, the email local-part, the LMS-reported display name, the `authUid`, or any other identifier as a display name.

## 10. Display-Name Synchronization Rules

The following rules are the load-bearing statement of "when does a display name change and who writes it".

### 10.1 On Provisioning

- `authOnUserCreate` writes the initial `users/{uid}` document at Firebase Auth create per `SPRINT_2_COMPLETION_REPORT.md` §59. The Firebase Auth record's `displayName`, when present, MAY be copied into `users/{uid}.displayName` at this write. This is the sole authorized read of the Google profile display name into a canonical field.
- Provisioning MUST NOT emit `users.displayNameChanged` on this initial write. The user record has just been created; no transition exists.

### 10.2 On Activation

- `teachersCompleteVerification` (verification-code redemption; `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §13.1), `studentsCompleteOnboarding` (student onboarding), and `usersFirstSignInActivation` (roster placeholder resolution; `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §11 and §17) each ratify a `users/{uid}.displayName` at the moment the identity transitions to `active` or `pendingVerification`.
- If the caller supplies a display name, the callable validates it under §13 and writes it. If the caller does not supply one, the callable retains the value already on `users/{uid}.displayName` (which may have been seeded by §10.1). Activation callables MUST NOT read the Google profile display name at activation time; the source of truth at activation is the payload plus the existing user document.
- Activation callables emit `users.displayNameChanged` only if the write changes the field value. An activation that leaves the field unchanged emits no display-name audit event.

### 10.3 On User-Initiated Rename

- `usersUpdateProfile` OR the Sprint 2 rules-allowlisted self-write is the sole authorized path for a signed-in user to change their own `users/{uid}.displayName`. Per §14, exactly one of these two paths lands per sprint; both are named here so no ambiguity exists during migration.
- The callable (or the Sprint 2 self-write followed by a `usersOnDisplayNameChange` document trigger, if the Sprint 2 self-write path is retained) MUST emit `users.displayNameChanged` on every value change.
- User-initiated rename MUST NOT modify any enrollment override. Overrides remain scoped to the enrolling teacher's (or the student's) per-class choice.

### 10.4 On Google Profile Change

- LyfeLabz MUST NOT read the Google profile display name after §10.1. A student or teacher who updates their name in Google after first sign-in does not automatically update `users/{uid}.displayName`.
- The teacher-facing product behavior on this branch is the identity control disclosure in `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §21 (upper-right identity affordance). No callable in this contract polls Google for a profile change, and no automatic reconciliation runs against a Google profile display-name delta.
- If a superseding decision authorizes a periodic Google profile re-read, it MUST route through `usersUpdateProfile` under an explicit user-initiated confirmation, MUST NOT run without user consent, and MUST amend this contract with a new PDR.

### 10.5 On LMS Refresh

- `lmsClassRefresh` MAY report a delta in the LMS-reported display name for an LMS roster entry. `LMS_EXPERIENCE.md` §5 names this delta ("students whose display name in the LMS has changed since the last refresh") and requires a teacher confirmation before any write.
- On teacher confirmation:
  - For an unresolved roster placeholder (§7.1): the callable updates the placeholder name and emits `roster.placeholderNameChanged`.
  - For a resolved enrollment (§11.3): the callable MUST NOT overwrite `users/{uid}.displayName`. The LyfeLabz identity's canonical name is authoritative. The teacher MAY apply a per-class override via `enrollmentsSetDisplayNameOverride` to reflect the LMS-reported name locally to that class; this remains an explicit teacher gesture and never an automatic write.
  - `lmsClassRefresh` MUST NOT write to `users/*` under any branch.

### 10.6 On Per-Class Override Change

- `enrollmentsSetDisplayNameOverride` is the sole authorized writer of `enrollments/{enrollmentId}.displayNameOverride`.
- Callers are: the owning teacher OR the enrolled student (self-restricted to their own enrollment). No other role is authorized.
- Setting to a non-empty string writes the override. Clearing the override is a permitted write and reverts the resolver in §9 to the canonical `users/{uid}.displayName`.
- Emits `enrollments.displayNameOverrideChanged` on every write.

### 10.7 On Placeholder Resolution

- `usersFirstSignInActivation` is the sole authorized writer of the transition from a roster placeholder to a resolved active enrollment. It MUST populate `users/{uid}.displayName` per §10.1 and §10.2, transition the placeholder per §7.1, and emit `roster.placeholderResolved`.

## 11. Google Profile Interaction

The Google profile is a source only, and only at first sign-in.

1. On first sign-in, `authOnUserCreate` fires and MAY seed `users/{uid}.displayName` with the Firebase Auth record's `displayName`.
2. On every subsequent sign-in, no read of the Google profile display name is authorized. The Firebase Auth record's `displayName` field MAY be present on the token and MAY be logged for observability, but MUST NOT be written into `users/{uid}.displayName` outside §10.1.
3. On an LMS-linked class, the Google identity (email address) is the load-bearing key for placeholder resolution per `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §16 (User ID as primary matcher, email as secondary validator). The Google profile display name plays no matching role.

Load-bearing consequence: a Google display-name change does not silently rename a LyfeLabz identity. A student who renames themselves in Google after first sign-in continues to appear under their LyfeLabz `users/{uid}.displayName` on every teacher roster until they explicitly rename themselves via §10.3 or a teacher applies an override via §10.6.

### 11.1 Placeholder Name Sourcing at Import

- `lmsClassImport` MUST read the LMS-reported display name (the Google Classroom roster entry's student name) at import time and write it as the placeholder name per §7.1.
- Placeholder-name text is subject to §13.

### 11.2 Placeholder Name Refresh

- `lmsClassRefresh` MAY update a placeholder name on teacher confirmation per §10.5. It MUST NOT update a placeholder name silently.

### 11.3 Placeholder Resolution

- On first sign-in matched to a placeholder (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §17), `usersFirstSignInActivation` provisions the canonical `users/{uid}` (if not already present from §10.1), writes `users/{uid}.displayName` per §10.1 and §10.2, and transitions the placeholder per §7.1.
- The placeholder name is retired at resolution. It is not preserved on the enrollment.
- The audit stream records the transition (`roster.placeholderResolved`) with `placeholderName` as an opaque payload field for one-time reconciliation. Audit events are append-only per `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8.

## 12. Teacher Roster Behavior

The teacher-facing roster is the load-bearing consumer of §9. The following rules are canonical for every teacher-facing surface that displays a per-enrollment name.

- **Single resolver.** Every teacher-facing view of a roster (Classes, Snapshot, Assign, LMS Experience refresh confirmation, Attempt teacher views, and every future teacher surface) calls the single resolver in §9. No teacher surface concatenates a name from other fields.
- **No client fallback.** A client MUST NOT infer a display name from an email local-part, from a Google profile display name observed elsewhere, from an LMS-reported name observed on a prior refresh, or from any cached value beyond the current server read. If the resolver returns `null` (§9.4), the surface renders "Name unavailable".
- **Sort order.** Client-side sort by resolved name is permitted per `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` §147. Server-side sort by `users/{uid}.displayName` is permitted per §377 and does not compose the per-class override; server-side sort MUST NOT be used on any surface that renders the resolver output, because the two orders may disagree. The teacher-facing roster sorts client-side after the resolver runs.
- **Placeholder rendering.** A roster entry in the placeholder shape MUST be rendered with the certified `Awaiting first sign-in` activation state (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §11). Activation state is never conveyed by color alone (`PLATFORM_CONTRACTS.md` accessibility rules).
- **Historical consistency.** A teacher-facing view of a historical roster (a prior term, a withdrawn student, an archived class) resolves per §9 against the current `users/{uid}.displayName` and the current `enrollments/{enrollmentId}.displayNameOverride`. Historical enrollments are not renamed by a subsequent user rename; the resolver simply returns the current values. This preserves attribution without freezing a display name.
- **Personal data minimization.** No teacher-facing surface exposes a display name for a person who is not a member of the class in question. Cross-class display-name reads are refused at the security-rule layer per `LYFELABZ_FIREBASE_SECURITY_MODEL.md` and per the district boundary in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §17.

## 13. Historical Consistency Expectations

- Overwriting `users/{uid}.displayName` is a live rename. Every subsequent read (including reads that populate a teacher's roster of a historical class, an archived class, or an attempt owner column) returns the new value.
- The prior canonical display name is not preserved on `users/{uid}`. The append-only `auditEvents/*` collection records every transition per §15; the historical value is recoverable from the audit stream for compliance and administrative purposes.
- A per-class override survives a canonical rename. Clearing an override remains an explicit teacher or student gesture per §10.6.
- Roster placeholder names are frozen at their most recent server-write; they are updated only through the two callable paths in §10.5 and §11.2.
- No attempt, session, submission, rollup, or analytics document carries a denormalized display-name copy. This restates §6 and `ASSESSMENT_PIPELINE_SPECIFICATION.md` §466.

### 13.1 Display-Name Validation

Every callable that writes a display-name field MUST validate the value under a shared normalizer:

- Trim leading and trailing whitespace.
- Collapse internal runs of whitespace to a single space.
- Refuse empty (post-trim) values with `displayName.empty`.
- Refuse values whose post-trim length exceeds a bounded maximum (canonical bound: 60 code points) with `displayName.tooLong`. The 60 code-point bound aligns with the teacher-facing header truncation in `SPRINT_3_STEP_5_SPECIFICATION.md` §127 (24-character truncation) plus headroom for administrative and international names.
- Refuse control characters, zero-width joiners outside normalization ranges, and any character not permitted by the shared normalizer.
- The shared normalizer is the sole authorized producer of a persisted display-name value. No callable inlines its own validator.

## 14. Cloud Function Ownership Matrix

Every callable and every server trigger that writes a display-name field is listed here. Where an older document names a callable slot at the concept level, the concrete name below is canonical for this contract.

| Callable or trigger | Trigger | Owner responsibility | Idempotent? |
| --- | --- | --- | --- |
| `authOnUserCreate` | Firebase Auth `onCreate` | Sole authorized producer of the initial `users/{uid}` document per `SPRINT_2_COMPLETION_REPORT.md`. MAY seed `users/{uid}.displayName` from the Firebase Auth record. Emits no `users.displayNameChanged` event on the initial write | Yes |
| `teachersCompleteVerification` | Callable, teacher | Verification-code redemption per `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §13.1. Ratifies `users/{uid}.displayName` on activation. Emits `users.displayNameChanged` if the value changed | Yes |
| `studentsCompleteOnboarding` | Callable, student | Student onboarding per `SPRINT_2_COMPLETION_REPORT.md` §63. Ratifies `users/{uid}.displayName` on activation. Emits `users.displayNameChanged` if the value changed | Yes |
| `usersFirstSignInActivation` | Callable, authenticated | Roster placeholder resolution per `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §11 and §17. Provisions `users/{uid}` if needed, writes `users/{uid}.displayName` per §10.2, transitions the placeholder per §7.1, emits `roster.placeholderResolved` and (if the display-name value changed) `users.displayNameChanged` | Yes |
| `usersUpdateProfile` | Callable, self | User-initiated rename. Sole authorized non-activation writer of `users/{uid}.displayName`. Runs the validator in §13.1. Emits `users.displayNameChanged` on every value change. The Sprint 2 rules-allowlisted self-write (`users/{uid}` self-update allowlist restricted to `displayName`; `SPRINT_2_COMPLETION_REPORT.md` §75) is preserved for backwards compatibility during the transition; the implementation sprint that lands `usersUpdateProfile` MUST choose exactly one of the two paths and reconcile the other. See §14.1 | Yes |
| `enrollmentsSetDisplayNameOverride` | Callable, teacher OR self student | Sole authorized writer of `enrollments/{enrollmentId}.displayNameOverride`. Runs the validator in §13.1. Emits `enrollments.displayNameOverrideChanged` on every write, including clears | Yes |
| `lmsClassImport` | Callable, teacher | Named in `LMS_INTEGRATION_ARCHITECTURE.md` §7. Sole authorized producer of roster placeholders on import. Writes the placeholder name per §11.1 | Yes |
| `lmsClassRefresh` | Callable, teacher | Named in `LMS_INTEGRATION_ARCHITECTURE.md` §7.1 and `LMS_EXPERIENCE.md` §5. Sole authorized writer of a placeholder-name refresh (§11.2). Under no branch writes to `users/*`. Emits `roster.placeholderNameChanged` per confirmed name-change delta | Yes |

Ownership rules:

- No callable other than those enumerated writes any display-name field.
- Every callable additionally satisfies the district enforcement contract in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12.
- Every callable is single-purpose. `usersUpdateProfile` MUST NOT bundle role, schoolId, districtId, or claim mutations.
- `lmsClassRefresh` MUST NOT write to `users/*`, `enrollments/*` (beyond the enrollment-as-placeholder shape in §7.1), or any display-name field on a resolved enrollment. Overriding an LMS-reported name on a resolved enrollment is an explicit teacher gesture through `enrollmentsSetDisplayNameOverride`.

### 14.1 Convergence on `usersUpdateProfile`

The Sprint 2 rules-allowlisted self-write for `users/{uid}.displayName` and the callable path `usersUpdateProfile` are enumerated as two candidate implementations of the same responsibility. The implementation sprint that lands the display-name rename path MUST choose exactly one:

- **Option A (recommended).** Retain the Sprint 2 rules-allowlisted self-write; add a document trigger `usersOnDisplayNameChange` that emits `users.displayNameChanged` on every field-value transition. This preserves the existing rules-layer boundary and centralizes the audit event on a server trigger.
- **Option B.** Introduce `usersUpdateProfile` as the sole authorized rename path; tighten the Sprint 2 rules-allowlisted self-write to deny `displayName` self-mutation and require the callable. The callable runs the validator in §13.1 and emits the audit event inline.

Either option satisfies this contract. The chosen option MUST be recorded in an operational appendix without a new PDR. Under both options, the resolver in §9 and the ownership matrix in §6 remain unchanged.

## 15. Firestore Security Rule Expectations

The following invariants MUST hold at the Security Rules layer. They restate the ownership matrix in §6 into rule-layer enforcement.

- **`users/{uid}`.** `get` allowed for self; `get` allowed for the owning teacher of any class in which the user is a resolved enrollment (existing scoping per `LYFELABZ_FIREBASE_SECURITY_MODEL.md`); `get` allowed for `platformAdministrator` under audit. `update` restricted per §14.1 (self-restricted allowlist limited to `displayName`, OR denied at the rule layer with all writes routed through `usersUpdateProfile`). `create`, `list`, `delete` denied for client roles.
- **`enrollments/{enrollmentId}`.** Existing scoping preserved. Additive rule: `update` on `displayNameOverride` allowed only via callable (`enrollmentsSetDisplayNameOverride`). No direct client `update` of `displayNameOverride` is authorized under any role.
- **Roster placeholder documents (per §7.1).** Server-only for writes. Reads restricted to the owning teacher and to `platformAdministrator` under audit. No student role reads a roster placeholder.
- **`auditEvents/{eventId}`.** Append-only, server-only per `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8. Every rule permits neither `update` nor `delete` under any role, including `platformAdministrator`.
- **Cross-district reads.** Every display-name read that crosses a district boundary is refused per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §17.
- **Cross-class reads.** A teacher MUST NOT read `users/{uid}.displayName` for a student who is not enrolled in one of the caller's classes. The rule layer enforces this through the existing enrollment-scoped scoping.

## 16. Error Contract

Callables that write a display-name field MUST return stable error identifiers. The following identifiers are canonical. Where an identifier already exists in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §17 or `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §25, that name is preserved.

- `unauthenticated`
- `account-inactive`
- `role-forbidden`
- `district-mismatch`
- `displayName.empty`
- `displayName.tooLong`
- `displayName.invalidCharacter`
- `displayName.unchanged` (informational; the callable MAY return this instead of no-op silently to make the client behavior explicit)
- `enrollments.notFound`
- `enrollments.forbidden`
- `roster.placeholderNotFound`
- `roster.placeholderAlreadyResolved`

Callables MUST NOT leak an unrelated user's display name, an unrelated class identifier, or any student's Personally Identifying Information in an error payload.

## 17. Required Indexes

The composite indexes named here MUST exist for display-name resolution and roster listing paths. Names use the existing `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` §3.1 convention.

- `users`: existing `(schoolId, role, displayName asc)` index per `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` §377 is preserved. This contract does not introduce a new `users` index. Note: this index sorts by canonical `displayName` only; it MUST NOT be used to render a per-class roster because the per-class override in §9 is not composed by this index.
- `enrollments`: existing indexes named in `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` §3.1.3 are preserved. This contract does not introduce a new `enrollments` index. The per-class roster resolver in §12 sorts client-side after the resolver runs.
- Roster placeholder documents (per §7.1): the implementation sprint that chooses the placeholder shape MUST enumerate any composite index required to list a class's placeholders alongside its resolved enrollments. The index MUST be recorded in an operational appendix without a new PDR.
- `auditEvents`: reuses the indexes in `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` §3.1.7. No new index is introduced.

## 18. Required Emulator Tests

The implementation sprint that lands the display-name callables MUST include emulator tests covering, at a minimum:

- `authOnUserCreate` seeds `users/{uid}.displayName` when the Firebase Auth record carries one; does not emit `users.displayNameChanged` on the initial write.
- `teachersCompleteVerification`, `studentsCompleteOnboarding`, and `usersFirstSignInActivation` each ratify `users/{uid}.displayName` on activation; emit `users.displayNameChanged` only when the value changed.
- `usersUpdateProfile` (or the Sprint 2 self-write plus the `usersOnDisplayNameChange` trigger, per §14.1) writes the value only through the shared validator; refuses `displayName.empty`, `displayName.tooLong`, and `displayName.invalidCharacter`.
- `usersUpdateProfile` refuses cross-user writes with `role-forbidden`; refuses account-inactive callers with `account-inactive`.
- `enrollmentsSetDisplayNameOverride` writes only the target enrollment; refuses cross-teacher and cross-student callers with `enrollments.forbidden`; refuses non-existent enrollments with `enrollments.notFound`; clears the override on an empty payload after a permitted delete-field gesture; emits `enrollments.displayNameOverrideChanged` on every write.
- `lmsClassImport` writes exactly one placeholder per LMS roster entry with the LMS-reported name; runs the shared validator on the placeholder name.
- `lmsClassRefresh` writes a placeholder-name update only on teacher confirmation; emits `roster.placeholderNameChanged` per confirmed delta; MUST NOT write to `users/*` under any branch; MUST NOT overwrite a resolved enrollment's canonical display name.
- `usersFirstSignInActivation` resolves a placeholder to a signed-in student, populates `users/{uid}.displayName` per §10.1 and §10.2, transitions the placeholder per §7.1, emits `roster.placeholderResolved`.
- The resolver in §9 returns the per-class override when present; returns `users/{uid}.displayName` when the override is absent and the enrollment is resolved; returns the placeholder name when the enrollment is in the placeholder shape; returns `null` when none apply.
- No callable in this contract writes to `classes/*`, `assignments/*`, `assessmentSessions/*`, `attempts/*`, `attemptRollups/*`, `assignmentRollups/*`, `assessmentAnswerKeys/*`, `lmsAssignmentPublications/*`, or `lmsClassLinks/*`. (Static write-path assertion.)
- Cross-district display-name reads are refused per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §17.

The tests themselves are not written in Sprint 10A F-4.

## 19. Required Unit Tests

The implementation sprint MUST include unit tests covering, at a minimum:

- The shared display-name normalizer trims, collapses whitespace, enforces the length bound, and refuses control characters; produces stable output under repeated application.
- The resolver in §9 is a pure function of `(enrollment, user, placeholder)` and never reads from any other source.
- The audit event vocabulary in §20 matches the identifiers emitted by each callable and trigger; no callable emits a non-vocabulary display-name event.
- The Google profile display name is not read outside `authOnUserCreate`. (Static import graph assertion against the Firebase Auth `displayName` field.)
- No callable outside §14 writes any display-name field. (Static write-path assertion against `users/{uid}.displayName`, `enrollments/{enrollmentId}.displayNameOverride`, and the roster placeholder shape chosen in §7.1.)

The tests themselves are not written in Sprint 10A F-4.

## 20. Audit Event Requirements

All display-name transitions MUST emit an `auditEvents/{eventId}` document under the canonical shape in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8 (required fields: `actorUserId`, `actorRole`, `action`, `targetType`, `targetId`, `occurredAt`; conditionally required `schoolId`; where the event resolves to a district, `districtId` MUST also be recorded per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §16).

Required event vocabulary:

| Transition | Canonical `action` | Actor | Target | Notes |
| --- | --- | --- | --- | --- |
| Canonical display name changed | `users.displayNameChanged` | Self, or server (`teachersCompleteVerification`, `studentsCompleteOnboarding`, `usersFirstSignInActivation`) | `users/{uid}` | Records `previousDisplayName` and `newDisplayName` as opaque payload fields for one-time reconciliation; NEVER exposed on any teacher-facing surface |
| Per-class override changed | `enrollments.displayNameOverrideChanged` | Teacher OR student (self) | `enrollments/{enrollmentId}` | Records `previousOverride` and `newOverride`; NEVER exposed on any student surface for another student |
| Roster placeholder name refreshed | `roster.placeholderNameChanged` | Teacher (via `lmsClassRefresh`) | Placeholder document (per §7.1) | Records the confirmed delta; NEVER auto-applies |
| Roster placeholder resolved | `roster.placeholderResolved` | Self (student), server-mediated | Placeholder document (per §7.1) | Records `placeholderName` as an opaque one-time-reconciliation payload; the placeholder document is transitioned per §7.1, never hard-deleted |

The vocabulary above extends the existing identity vocabulary (`teachers.verificationApproved`, `teachers.verificationDenied`, `enrollments.created`, `enrollments.conflict`, `auth.userProvisioned`) with four additional identifiers scoped to display-name changes. No second audit sink is created.

The `auditEvents` collection is append-only. No callable and no rule permits update or delete, including for `platformAdministrator`.

## 21. Engineering Implementation Checklist

The implementation sprint that lands the display-name callables MUST address:

1. A shared display-name normalizer per §13.1. Sole authorized producer of a persisted display-name value.
2. A single resolver per §9. Sole authorized consumer for every teacher-facing per-enrollment name render.
3. The convergence decision per §14.1 (Option A or Option B). Record the choice in an operational appendix.
4. The roster placeholder shape choice per §7.1. Record the choice in an operational appendix.
5. Firestore Security Rules updated to enforce §15.
6. Composite indexes reviewed and reconciled per §17.
7. Callable implementations for `enrollmentsSetDisplayNameOverride`, `usersUpdateProfile` (if Option B), and `usersOnDisplayNameChange` (if Option A) per §14.
8. Server-mediated audit-event emission per §20 for every callable and trigger that writes a display-name field.
9. Emulator tests per §18 and unit tests per §19.
10. Deployment validation: staging environment MUST run the full rules-test matrix and the emulator suite before rules and callables are promoted to production.
11. Observability: latency histograms per callable, error-rate dashboards per error identifier in §16, and an oncall runbook for the placeholder-resolution path.
12. Runbook additions: any operational reconciliation procedure for a display-name-related migration MUST be added to a later sprint's runbook (not this one).

## 22. Explicit Non-Goals

This contract does not introduce:

- A separate legal-name field, a preferred-pronouns field, a family-name field, or any additional personal-name field beyond the canonical `users/{uid}.displayName` and the per-class `enrollments/{enrollmentId}.displayNameOverride`. Extensions require a new PDR.
- Automatic reconciliation of a Google profile display-name change into `users/{uid}.displayName`. Permanent under §10.4.
- Automatic reconciliation of an LMS-reported display-name change into `users/{uid}.displayName` for a resolved enrollment. Permanent under §10.5.
- A teacher-facing rename of another user's canonical `users/{uid}.displayName`. Teachers apply per-class overrides via §10.6; they do not rewrite another user's canonical name.
- A student surface for viewing another student's display name outside the certified shared-class scoping.
- A denormalized display-name copy on any attempt, session, submission, rollup, class, or assignment document. Permanent under §6 and `ASSESSMENT_PIPELINE_SPECIFICATION.md` §466.
- A display-name-based authorization decision. Permanent under §5.
- A parent, districtAdministrator, schoolAdministrator, or co-teacher display-name surface. Reserved.
- A publication of a canonical display name into Google Classroom. Permanent under `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` §8.2 (no student identifier in the deep-link URL) and by the absence of any callable authorized to write into Classroom under this contract.

Any of the above requires a new PDR that supersedes the relevant section of this contract.

## 23. Open Implementation Gaps

The following are the only implementation gaps that cannot be resolved from the certified architecture. Each is narrow and non-blocking under the safe defaults recorded above.

- **G-10A-14. Convergence on `usersUpdateProfile`.** The Sprint 2 rules-allowlisted self-write and the callable `usersUpdateProfile` are enumerated as two candidate implementations of the same responsibility (§14.1). The implementation sprint MUST choose exactly one and record the choice in an operational appendix. Safe default: retain the Sprint 2 self-write and add the `usersOnDisplayNameChange` trigger.
- **G-10A-15. Roster placeholder shape.** The enrollment-as-placeholder shape and the separate `rosterPlaceholders/*` collection are enumerated as two candidate implementations (§7.1). The implementation sprint MUST choose exactly one and record the choice in an operational appendix. Safe default: enrollment-as-placeholder, because it composes with the existing `enrollments/{enrollmentId}` scoping and the existing security rules.
- **G-10A-16. Display-name length bound.** The 60 code-point bound in §13.1 aligns with the teacher-facing header truncation in `SPRINT_3_STEP_5_SPECIFICATION.md` §127 (24 characters) with headroom. The implementation sprint MAY finalize the bound based on the observed distribution of imported LMS names; any change under 200 code points is a §13.1 tuning and does not require a new PDR. A change above 200 code points MUST be authorized by a new PDR.
- **G-10A-17. Google profile re-read policy.** No periodic re-read of the Google profile display name is authorized (§10.4). If operational evidence indicates teachers need a user-initiated "refresh from Google" gesture, the implementation sprint MAY add one under an explicit user confirmation only; a superseding decision is required to authorize the gesture. Safe default: no re-read.
- **G-10A-18. Audit-event payload retention.** Audit events under §20 record `previousDisplayName`/`newDisplayName` and `previousOverride`/`newOverride` as opaque payload fields. The retention window for these payloads is bounded by `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8 and PDR-011. If a superseding compliance decision requires a shorter or longer window for personal-name audit payloads specifically, the sprint that ratifies the change MUST amend this contract.

No blocking gap remains. Implementation of the display-name paths can proceed against this contract with the five narrow decisions above deferred to their appropriate future scope.

---

## Change Log

- 2026-07-12 - Initial issuance under Sprint 10A step F-4. Ratified by PDR-028.
