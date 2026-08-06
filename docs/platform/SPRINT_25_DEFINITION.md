# Sprint 25 Definition - LMS Assignment Publication (Google Classroom)

Status: Proposed. Scope-of-record for Sprint 25. This document defines
what Sprint 25 does and does not attempt. The how-and-in-what-order
layer is `SPRINT_25_ARCHITECTURAL_BLUEPRINT.md`. The authorizing
decision is proposed as PDR-030 in
`PDR_030_LMS_ASSIGNMENT_PUBLICATION.md`. The surface reconciliation is
recorded in `ADR_LMS_PUBLICATION_SURFACE_RECONCILIATION.md`.

Companion documents:
- `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (Phase 9 placement)
- `SPRINT_24B_FINAL_CERTIFICATION_REPORT.md` (production-certified foundation)
- `SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md` (surface ownership, provider guardrails)
- `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` (§8 internal sprint sequence; publication is LMS Sprint D)
- `ASSIGN_EXPERIENCE.md` (the single canonical assignment workflow)
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-019, PDR-020)

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level
break, per repository standard.

---

## 1. Context

Sprint 24B is production certified. A verified teacher can connect
Google Classroom, import a course into a LyfeLabz class, complete the
`needsSetup` seam, activate the class, and synchronize its roster. That
work is the certified foundation Sprint 25 builds on. Nothing in Sprint
25 modifies the Sprint 24B seam.

Sprint 25 delivers the next capability in the Phase 9 internal sequence
recorded in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §8: assignment
publication (LMS Sprint D). It publishes an existing LyfeLabz assignment
into a linked Google Classroom course as a one-way pointer to the
LyfeLabz surface where the work happens.

A substantial portion of the server contract for this capability already
exists in the certified tree and is reused rather than rebuilt. See §7.

## 2. Objectives

1. Let a teacher optionally send an existing LyfeLabz assignment to a
   linked Google Classroom course, from inside the one Assign dialog,
   as an extension of assigning - never as a separate workflow.
2. Make the live Google Classroom coursework write real by implementing
   the single provider-adapter method that is currently a stub.
3. Request the coursework publication scopes through incremental OAuth
   consent, at the moment the teacher first publishes, without minting a
   duplicate connection and without disturbing the certified readonly
   connection.
4. Let the teacher choose a Google Classroom topic for the published
   coursework, reusing the existing topics callable.
5. Report publication outcome truthfully (succeeded or did not succeed)
   and make a failed publication retryable, with the LyfeLabz assignment
   authoritative in every case.
6. Certify the workflow end to end through a genuine browser run against
   the Emulator Suite with a Google Classroom API test double, and
   verify it in the backend, before Sprint 25 is declared complete.

## 3. Scope

In scope:

- Publishing an existing LyfeLabz assignment to a linked Google
  Classroom course.
- Google Classroom topic selection for the published coursework.
- Incremental OAuth consent for the coursework publication scopes.
- Publication status surfaced to the teacher (succeeded, did not
  succeed).
- Retry of a failed publication.
- The Assign dialog extension for LMS-linked class rows (topic selector
  and an opt-in publish toggle), per `ASSIGN_EXPERIENCE.md` §5.
- Browser certification and backend verification.

## 4. Non-goals

Explicitly out of scope for Sprint 25. Each remains reachable as its own
later decision record or sprint:

- Grade synchronization from Google Classroom to LyfeLabz.
- Student submission synchronization in either direction.
- Automatic synchronization of any kind.
- Scheduled or background synchronization or publication.
- Multiple LMS providers (Canvas, Schoology, Microsoft Teams for
  Education).
- Google Classroom Add-ons or deep-link content publishing (PDR-027).
- Batch or multi-course publishing from a single action.
- A new audit framework or new audit event kinds.
- New Firestore collections, unless a required shape is discovered that
  the reserved `lmsAssignmentPublications` collection cannot carry. None
  is anticipated.
- A new user role, custom claim key, or lifecycle field (prohibited by
  PDR-019f).
- Any publication surface outside the one Assign dialog.
- Bidirectional publication (prohibited by PDR-019d).
- Student-facing Google Classroom workflows of any kind. Sprint 25 is a
  teacher-initiated publish only; the student experience is unchanged.
- Any broader redesign of the Assign workflow. Sprint 25 adds two
  additive affordances to the existing dialog and changes nothing else
  about assigning.

## 5. UX principles

The defining principle of Sprint 25:

**Publishing to Google Classroom is not a separate workflow. It is an
optional extension of assigning.**

The teacher continues to think "I am assigning this lesson." She never
thinks "I am publishing something to Google Classroom." Google Classroom
is one more delivery destination for an assignment she already made.

Sprint 25 preserves every existing LyfeLabz principle:

- **Teach First, Configure Second.** Publication is an optional
  configuration on a row the teacher already sees while assigning. It is
  never a gate in front of teaching.
- **One Meaningful Decision Per Screen.** The only new decision is a
  single opt-in toggle per LMS-linked class row, plus an optional topic.
  The teacher decides where to assign; she does not separately decide
  where to publish.
- **Save Teachers Time.** The topic is prefilled from the teacher's
  last-used topic. The toggle remembers nothing that would surprise her.
  Consent is requested once, only when first needed.
- **Integrate Rather Than Duplicate.** Sprint 25 adds affordances to the
  existing Assign dialog and reuses the existing publish callable, topic
  callable, connection lifecycle, and token store. It builds no parallel
  surface.
- **Calm Software.** A failed publication never blocks the assignment,
  never blames the teacher, never shows a stack trace, and never asks
  her to contact an administrator. It degrades to a plain-language line
  and a retry.

Derived UX rules:

- The topic selector and publish toggle appear only on rows for classes
  that are LMS-linked and `active`. On every other row they are absent,
  not shown as disabled controls (`ASSIGN_EXPERIENCE.md` §5).
- The publish toggle is off by default until the teacher opts in for
  that class (`TEACHER_EXPERIENCE_PHILOSOPHY.md` §3.5).
- Activation and publication are separate. Activation without
  publication is a supported state. Publication without an activated
  LyfeLabz assignment is refused (`ASSIGN_EXPERIENCE.md`, Sprint 9D
  Reconciliation Notice).
- The dialog remains one dialog. There is no publish wizard, no Google
  Classroom settings panel, and no LMS-specific dialog.

## 6. Architecture principles

Sprint 25 preserves every load-bearing platform invariant:

- **Server-side authority.** Every publication is server-mediated. The
  client passes only LyfeLabz identifiers and the LyfeLabz assignment
  URL. The server resolves the link, connection, token, provider, and
  upstream call.
- **Provider neutrality (PDR-019h).** No Google-specific concept enters
  the client contract or the vendor-neutral core. The adapter owns every
  Google concept. A second provider would be a second adapter.
- **Server-only tokens (PDR-019e).** OAuth access and refresh tokens are
  held server-side only and never cross the callable boundary.
- **One-way publication (PDR-019d).** LyfeLabz publishes to the LMS. The
  LMS never authors a LyfeLabz assignment. Publication is a side effect
  of the LyfeLabz assignment record.
- **Additive schema (PDR-019g).** Sprint 25 introduces no new collection
  and no renamed field. It populates the reserved
  `lmsAssignmentPublications` collection and sets the reserved additive
  `assignments/{assignmentId}.lmsPublicationRef` mirror pointer.
- **Append-only audit (PDR-013).** Sprint 25 emits only the reserved
  `lms.assignmentPublished` and `lms.publishFailed` events through the
  canonical `writeAuditEvent` helper. No new audit kind.
- **Privacy is not widened (PDR-019k).** No student PII is read or
  written by the publish path. Audit payloads and log lines carry no
  student data, no Google email, and no token.
- **Browser-first certification.** The workflow is proven through a
  genuine browser run, not through injected state or direct callable
  invocation.
- **Backend verification before completion.** The callable ledger,
  publication record, mirror pointer, audit chain, zero Secret Manager
  access, and zero token leakage are verified before sign-off.
- **Preservation Mode.** The static instructional repository at the
  repository root is untouched. Platform work lives under `platform/**`,
  `app/**`, and `docs/platform/**`.

## 7. Reuse posture

Sprint 25 reuses the following certified components rather than
duplicating them. This list is authoritative; an implementation that
rebuilds any of these instead of reusing it is out of specification.

- **Reuse** the `lmsAssignmentsPublish` callable
  (`platform/functions/src/lms/assignments-publish.ts`). Its signature,
  ownership checks, publication-record write, mirror-pointer update,
  audit emission, and graceful-failure path are certified-shaped and
  unchanged by Sprint 25.
- **Reuse** the `lmsAssignmentPublications` collection, its typed refs,
  the `LmsAssignmentPublicationCreationWrite` type, and the additive
  `assignments/{assignmentId}.lmsPublicationRef` field. No schema change.
- **Reuse** the Firestore Rules already covering
  `lmsAssignmentPublications`. Verify scoping; do not rewrite.
- **Reuse** the reserved audit vocabulary `lms.assignmentPublished` and
  `lms.publishFailed`. No new event kind.
- **Reuse** `lmsClassesListTopics` and the topics scope for the topic
  selector.
- **Reuse** `lmsConnectionsBegin` and `lmsConnectionsComplete` as the
  connection lifecycle for incremental consent. No new connection
  callable is introduced. These two callables and the adapter `beginOAuth`
  method do require a bounded additive change, not pure reuse: today
  `lmsConnectionsBegin` accepts only `{ providerId, redirectUri }` and
  `beginOAuth` requests a fixed readonly scope set, and
  `lmsConnectionsComplete` creates a connection record. Incremental
  consent requires (a) carrying a requested capability or scope selector
  into `begin` / `beginOAuth`, and (b) merging the granted scopes into
  the caller's existing connection on `complete` rather than creating a
  second connection. This is an extension of the existing callables, not
  a new callable and not a second connection. See the blueprint §7 and §8.
- **Reuse** the server-only token store, provider registry, and the
  Google Classroom adapter shell. The adapter shell already carries the
  certified import-time profile verification (the imported Classroom
  owner is checked against the stored token bundle identity). The
  connection-widening identity revalidation Sprint 25 requires (the
  existing token bundle identity checked against the new OAuth grant
  identity) is a new implementation that follows the same security
  principle; no reusable helper for that comparison exists in the
  certified tree.
- **Reuse** the Assign dialog, the per-class row model, and the
  authoritative assignment lifecycle callables (`assignmentsCreateDraft`,
  `assignmentsPublish`) that already create the LyfeLabz assignment
  before any LMS-side publication.
- **Reuse** the existing client wiring seams `createLmsCallables`,
  `createAssignmentsCallables`, and `createListClassLinks`, provided to
  the Assign surface per the reconciliation ADR rather than duplicated.

The genuinely new engineering work is narrow:

1. Implement the live Google Classroom coursework write in the adapter
   method that is currently a stub.
2. Request the coursework publication scopes through incremental consent
   and widen the existing connection's scope set on grant.
3. Add the topic selector and opt-in publish toggle to LMS-linked rows
   in the Assign dialog and wire the confirm path to the existing publish
   callable.
4. Certify and verify.

## 8. Success criteria

Sprint 25 is successful when all of the following hold under the
Emulator Suite with a Google Classroom API test double:

- A verified teacher, assigning a lesson to an LMS-linked `active`
  class, can opt in to publish and select a topic from within the one
  Assign dialog.
- On first publish, the teacher grants the coursework scopes through a
  genuine incremental OAuth consent. The existing connection's scope set
  widens. No duplicate connection is created.
- On success, a Google Classroom coursework item appears in the linked
  course under the chosen topic, pointing at the LyfeLabz assignment URL.
- The LyfeLabz assignment record is authoritative and is created and
  published before the LMS-side publication is attempted.
- `assignments/{assignmentId}.lmsPublicationRef` is set on success, a
  `succeeded` record is written to `lmsAssignmentPublications`, and
  exactly one `lms.assignmentPublished` audit event is emitted.
- On a publication failure, the LyfeLabz assignment is intact, a
  `failed` record is written, exactly one `lms.publishFailed` audit
  event is emitted, and the teacher is offered a retry with a
  plain-language message that carries no PII.
- Activation without publication remains supported; publication without
  an activated LyfeLabz assignment is refused.
- Non-LMS class rows are unchanged. The workflow is one dialog whether or
  not any class is LMS-linked.
- No student PII, Google email, or token appears on any teacher surface,
  in any audit payload, or in any log line.
- Zero Secret Manager access during certification. Tokens are resolved
  server-side only.
- `npm --prefix app run verify` and the functions test suite are green.

## 9. Certification requirements

Sprint 25 is not complete until both certifications below pass.

- **Browser certification.** One continuous genuine run through the real
  teacher shell against the Emulator Suite, with no auth injection, no
  Firestore patching, and no direct callable invocation. The scenario
  table is defined in `SPRINT_25_ARCHITECTURAL_BLUEPRINT.md`.
- **Backend verification.** Emulator-bound verification of the callable
  ledger, publication records, the mirror pointer, the audit chain, the
  absence of student PII and tokens, and zero Secret Manager access. The
  checklist is defined in `SPRINT_25_ARCHITECTURAL_BLUEPRINT.md`.

Three levels of validation are kept distinct and must not be conflated:

1. **Engineering validation.** Unit and integration tests, plus
   emulator runs, exercising the callables and the adapter against a
   Google Classroom API test double. This proves the code paths, not the
   teacher workflow.
2. **Genuine browser certification.** One continuous run through the real
   teacher shell against the Emulator Suite. The upstream Google
   Classroom calls resolve against a real or explicitly certified test
   environment or test double. This proves the workflow in the certified
   environment.
3. **Production rollout prerequisites.** The operational gates in §10.
   These are outside the sprint and are not certification.

Sprint 25 certification may claim the workflow works end to end in the
certified environment (levels 1 and 2). It must not present test-double
behavior as production certification. It must not claim that Google OAuth
verification is complete, that broad production rollout is authorized,
that grade or submission synchronization exists, or any behavior of a
second provider. Production certification of live Google Classroom
publication is a post-rollout activity gated on §10.

## 10. Production rollout prerequisites (not implementation blockers)

The following are release gates, not engineering blockers. Sprint 25 is
fully implementable and certifiable in the Emulator Suite without any of
them. They govern production rollout only and are tracked separately.

- Google OAuth verification for the coursework publication scopes, which
  lifts the unverified-app warning and the sensitive-scope user cap.
- Production Secret Manager posture and rotation for the publication
  scope grant, consistent with the Sprint 23F and Sprint 24B deploy
  gates.
- The deployment runbook checklist that governs any production release.

Engineering proceeds against the certified environment. Rollout waits on
these prerequisites without holding the sprint.

## 11. Rollback posture

Sprint 25 rollback is a Hosting redeploy plus a Functions redeploy of
the prior known-good bundle. The additive Firestore state written by
Sprint 25 (`lmsAssignmentPublications` records and the
`lmsPublicationRef` mirror pointer) survives rollback and remains valid
under the pre-Sprint-25 code, because both are additive and read only by
the publish path. Rollback deletes no document. Detail is in the
blueprint.

*End of definition.*
