# PDR-030: LMS Assignment Publication Consent and Scope

Status: Proposed. Authored as a standalone record so no certified
document is modified during planning. On ratification this record is
inserted into `LYFELABZ_PLATFORM_DECISIONS.md` as PDR-030 (the next
number after PDR-029), following the format of the records already in
that log. It authorizes the Sprint 25 implementation named in
`SPRINT_25_DEFINITION.md`.

This record extends PDR-019 (LMS Integration Posture) and PDR-020 (LMS
Phase Re-Sequencing and Initial Scope). It overrides neither. Where this
record and any load-bearing sub-decision of PDR-019 appear to conflict,
PDR-019 controls and this record is amended.

Style: no em dashes. Use " - " (spaced hyphen).

---

## Decision

LyfeLabz publishes an existing LyfeLabz assignment to a linked Google
Classroom course as a one-way pointer, initiated by the teacher from
inside the one Assign dialog, as an optional extension of assigning. The
coursework publication OAuth scopes are requested through incremental,
opt-in consent at the moment the teacher first publishes, and are added
to the teacher's existing connection rather than to a second connection.
Publication is never a standalone workflow.

## Status

Proposed for acceptance as the authorizing decision for Sprint 25 (LMS
Assignment Publication). Every load-bearing sub-decision of PDR-019
applies to Sprint 25 without exception. This record adds only the two
decisions Sprint 25 requires that PDR-019 and PDR-020 did not already
settle: the coursework consent posture and the coursework scope set.

## Background

PDR-020c authorized a narrow initial LMS scope (connection lifecycle,
discovery, import) and explicitly excluded assignment publication.
PDR-020's exclusion list also records that each excluded capability
remains reachable as its own subsequent sprint under the internal Phase
9 sequence in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §8, where
publication is LMS Sprint D. Expansion of the initial scope is
authorized by specification, never by implementation.

Sprint 24B advanced Phase 9 to deliver the activation seam and roster
synchronization, both production certified. Publication is the next
capability in the sequence.

The certified tree already contains the publication server contract: the
`lmsAssignmentsPublish` callable, the reserved `lmsAssignmentPublications`
collection and its rules, the additive `assignments.lmsPublicationRef`
field, the reserved `lms.assignmentPublished` and `lms.publishFailed`
audit vocabulary, the `lmsClassesListTopics` callable, and the declared
but unrequested coursework scopes. What is missing is the live upstream
write, the consent to obtain the coursework scopes, and the Assign
dialog affordances. This record authorizes the consent and scope
additions; the specification and blueprint authorize the rest.

Two decisions require a record:

1. Adding a new OAuth scope is an operationally significant act. The
   coursework scopes are write scopes that raise the OAuth verification
   bar (`TEACHER_PLATFORM_DOMAIN_ROADMAP.md`, Phase 9). The repository
   already classifies the existing Classroom readonly scopes as
   sensitive-scope grants subject to Google's unverified-app warning and
   100-user cap (`SPRINT_24B_DEPLOYMENT_AND_BROWSER_CERTIFICATION_RUNBOOK.md`).
   This record does not assert a further "restricted" classification for
   the coursework scopes beyond what the repository establishes; the
   authoritative classification is Google's own current OAuth
   documentation, confirmed as part of the rollout prerequisite in §030f.
   Recording the consent posture prevents a future contributor from
   expanding scope silently or requesting it up front.
2. The certified tree carries a publication wiring seam inside the
   Settings integrations client module. Recording that publication is an
   extension of Assign, and never a Settings workflow, closes a drift
   attempt of the form "the wiring already lives in Settings, so the
   surface belongs there."

## Alternatives Considered

- **Request the coursework scopes up front at connect time.** Rejected.
  It violates minimum-required-scope and opt-in-per-action posture. A
  teacher who only imports and synchronizes roster would be asked to
  grant a write scope she may never use. Incremental consent at first
  publish is the minimum-friction, minimum-privilege path.
- **Create a second connection for the coursework scopes.** Rejected. It
  duplicates account custody, complicates disconnect and rotation, and
  confuses the account-level Settings surface. Widening the existing
  connection's scope set preserves one connection per teacher per
  provider.
- **Expose publication as its own surface (a publish button in Settings,
  or a Google Classroom panel).** Rejected. It creates a second
  assignment-adjacent workflow and contradicts PDR-019d and the one
  Assign dialog. Publication is a side effect of assigning.
- **Authorize the scope addition by implementation, inside Sprint 25,
  without a decision record.** Rejected. Scope expansion is authorized by
  specification, never by implementation, per PDR-020. An OAuth scope
  change is exactly the kind of expansion that requires a record.
- **Defer publication until Google OAuth verification completes.**
  Rejected as a sequencing constraint on engineering. Verification is a
  production rollout prerequisite, not an implementation blocker. Sprint
  25 is fully implementable and certifiable in the Emulator Suite with a
  Google Classroom API test double. Verification gates rollout only.

## Decision detail

**PDR-030a. Publication is an extension of Assign, never a standalone
workflow.**

- The single origin of every assignment record is the Assign dialog
  (PDR-010, PDR-019d). Publication is an optional, opt-in side effect of
  assigning to an LMS-linked class, configured on the class row inside
  that one dialog.
- The teacher decides where to assign. She never separately decides
  where to publish. Google Classroom is one delivery destination for an
  assignment she already made.
- No publish wizard, no Google Classroom settings panel, no LMS-specific
  dialog, and no Settings-based publish affordance may be introduced.
  Settings > Integrations remains account-level only, as narrowed by
  Sprint 24B.
- Any existing client wiring seam for publication is provided to the
  Assign surface, not surfaced in Settings. This is recorded in
  `ADR_LMS_PUBLICATION_SURFACE_RECONCILIATION.md`.

**PDR-030b. Coursework publication scopes.**

- Publication requires the Google Classroom coursework scopes
  (`classroom.coursework.me` and `classroom.topics.readonly`) in
  addition to the readonly scopes already granted for discovery and
  roster.
- `classroom.coursework.me` is the minimum-required write scope: it
  scopes the write to the teacher's own coursework and is preferred over
  any broader coursework scope.
- No scope beyond the coursework scopes named here is authorized by this
  record. A broader scope requires a superseding record.

**PDR-030c. Incremental, opt-in consent.**

- The coursework scopes are requested through incremental OAuth consent
  at the moment the teacher first publishes, and only then.
- Consent uses the certified connection lifecycle callables
  (`lmsConnectionsBegin`, `lmsConnectionsComplete`). No new connection
  callable is introduced. These callables and the adapter `beginOAuth`
  method receive a bounded additive extension to carry and record the
  requested scope set; this is an extension of the existing lifecycle,
  not a new callable. The exact mechanics are in the blueprint §7.
- Previously granted scopes are preserved across the incremental grant.
  The teacher is not asked to re-grant readonly scopes.
- Consent never escalates silently. It is requested only for the
  coursework capability and only when the teacher chooses to publish.

**PDR-030d. Scope widening on the existing connection.**

- On grant, the teacher's existing connection scope set is widened. No
  second connection is created. The same connection identity, token
  reference, and account identity are retained. Because
  `lmsConnectionsComplete` today writes a connection creation record,
  achieving this requires the completion path to merge granted scopes
  into an existing connection when one exists, rather than create a
  duplicate. This is the bounded extension named in PDR-030c.
- The granted Google identity is revalidated against the LyfeLabz
  identity using the certified profile-match misconnection mitigation. A
  mismatch is refused with a plain-language message.

**PDR-030e. Inherited invariants.**

- One-way publication (PDR-019d): LyfeLabz publishes to the LMS; the LMS
  never authors a LyfeLabz assignment.
- Server-only tokens (PDR-019e): coursework tokens are held server-side
  only and never cross the callable boundary.
- No new role, claim, or lifecycle field (PDR-019f).
- Additive schema (PDR-019g): publication populates the reserved
  `lmsAssignmentPublications` collection and the reserved
  `lmsPublicationRef` mirror. No new collection, no renamed field.
- Append-only audit (PDR-013): publication emits only the reserved
  `lms.assignmentPublished` and `lms.publishFailed` events. No new audit
  kind.
- Privacy is not widened (PDR-019k): no student PII is read or written by
  the publish path; audit payloads and log lines carry no student data,
  no Google email, and no token.
- Vendor-neutral core (PDR-019h): every Google concept lives in the
  provider adapter; the core and the client contract stay
  provider-neutral.

**PDR-030f. Verification is a rollout prerequisite, not an
implementation blocker.**

- Google OAuth verification for the coursework scopes lifts the
  unverified-app warning and the sensitive-scope user cap. It is a
  production rollout gate.
- Sprint 25 engineering and certification proceed in the Emulator Suite
  with a Google Classroom API test double, independent of the
  verification timeline. Rollout waits on verification; the sprint does
  not.

## Rationale

Incremental, opt-in consent at first publish is the minimum-privilege,
minimum-friction path that matches the teacher's mental model: she asks
to publish, and only then is she asked to grant the capability that makes
publishing possible. Widening the existing connection keeps account
custody singular and keeps the Settings surface honest.

Recording publication as an extension of Assign, at the decision-log
level, preserves the single assignment workflow across every future
sprint and closes the drift attempt that a pre-existing wiring location
implies a surface location.

Separating verification from implementation lets engineering proceed on
its own timeline while the operational verification process runs in
parallel, without either blocking the other.

## Consequences

Benefits:

- The teacher gains an optional delivery destination without a new
  workflow, a new surface, or a new mental model.
- The platform reuses its certified publish callable, records, rules,
  audit vocabulary, topics callable, connection lifecycle, and token
  store. The new engineering surface is narrow.
- Scope growth is explicit, opt-in, minimum-required, and recorded.
- Account custody remains singular; one connection per teacher per
  provider.
- Engineering is not held hostage to the Google verification timeline.

Limitations:

- Broad production rollout waits on Google OAuth verification of the
  coursework scopes. This is an accepted operational constraint, tracked
  separately from the sprint.
- A teacher who declines the incremental consent cannot publish; she can
  still assign. Activation without publication is a supported state.
- Multi-account teachers hold multiple LyfeLabz identities and multiple
  connections; this is a pre-existing PDR-004 concern unchanged by this
  record.

## Future Reconsideration Criteria

- **PDR-030a** reconsidered only through a record that redefines the
  single-Assign-dialog origin (PDR-010, PDR-019d). It does not become
  negotiable through implementation or through the location of a wiring
  seam.
- **PDR-030b** reconsidered only when a publication capability requires a
  scope beyond the coursework scopes named here. Any broader scope is
  authored as a superseding record with its own verification assessment.
- **PDR-030c** and **PDR-030d** reconsidered only if the certified OAuth
  connection lifecycle or the server-only token boundary is itself
  redefined.
- **PDR-030e** reconsidered only through the formal-review path required
  for the parent PDR-019 sub-decisions it inherits.
- **PDR-030f** reconsidered only if the platform adopts a policy that
  ties engineering milestones to external verification timelines, which
  it does not today.

Reconsideration of any PDR-030 sub-decision requires the same level of
scrutiny as PDR-019 and PDR-020.

---

*End of proposed record. On ratification, insert as PDR-030 in
`LYFELABZ_PLATFORM_DECISIONS.md` and update any index that enumerates the
decision log.*
