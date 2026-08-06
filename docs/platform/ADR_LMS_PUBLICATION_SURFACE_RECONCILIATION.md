# ADR: Reconciliation of the Existing Publication Wiring with the Canonical Assign Dialog

Status: Proposed. Authored for Sprint 25 planning. No existing document
or source file is modified by this record. Implementation is authorized
by `SPRINT_25_DEFINITION.md` and the proposed PDR-030, once that PDR is
ratified into `LYFELABZ_PLATFORM_DECISIONS.md`.
Date: Sprint 25 planning.
Sprint context: Sprint 25 (LMS Assignment Publication).
Scope: Where assignment publication is initiated from, and how the
publication wiring already present in the Settings integrations client
module is reconciled with the single canonical Assign workflow.

Companion documents:
- `ASSIGN_EXPERIENCE.md` (single canonical assignment workflow)
- `SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md` §3 (surface ownership map)
- `PDR_030_LMS_ASSIGNMENT_PUBLICATION.md` (PDR-030a)
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-019d)

Style: no em dashes. Use " - " (spaced hyphen).

---

## 1. Executive Summary

The certified tree carries a publication wiring seam inside the Settings
integrations client module. The `lmsAssignmentsPublish` and
`lmsClassesListTopics` callables, an authoritative assignment lifecycle
seam (`assignmentsCreateDraft`, `assignmentsPublish`), and a class-links
reader are all defined in `app/src/settings/integrations/wire.ts`. The
in-code comments record that these seams are consumed by the Assign
Experience, not by a Settings surface.

Settings > Integrations, as narrowed by Sprint 24B, renders no publish
affordance and no class workflow. There is no rogue publish button. The
reconciliation question is therefore not "remove a competing surface." It
is "confirm that the single origin of publication is the Assign dialog,
and that the wiring seam's file location does not imply a Settings
surface."

The ratified decision:

1. The Assign dialog is the single origin of every assignment record and
   the single place a teacher can publish. This is unchanged from
   PDR-010, PDR-019d, and the Sprint 24B surface ownership map.
2. The publication wiring seam is provided to the Assign surface. Its
   historical location inside the Settings integrations module is a code
   organization detail, not a product surface. Sprint 25 provides these
   seams to the Assign dialog without duplicating a second callable
   binding.
3. Settings > Integrations remains account-level only. No publish
   affordance is ever added there.

## 2. Context

Sprint 8-series LMS work authored the publication callable and its
client wiring inside the Settings integrations module, at a time when
the integrations surface was the working home for LMS client code.
Sprint 24B then narrowed Settings > Integrations to account-level
connection management (connected account, status, reconnect, disconnect)
and moved every class workflow to the Classes surface.

The publication wiring survived that narrowing as a defined seam on the
integrations callable interface, but no teacher-facing publish control
was surfaced in Settings. The seam's stated consumer, in its own code
comments, is the Assign Experience.

The risk this ADR closes is drift: a future contributor could read the
seam's location and conclude that publication belongs in Settings, or
could build a second publish entry point there, creating two
assignment-adjacent workflows. PDR-019d and the one Assign dialog forbid
that.

## 3. Decision

**3.1 Single origin.** The Assign dialog is the single origin of every
assignment record and the single place a teacher initiates publication.
Publication is an opt-in side effect of assigning to an LMS-linked class,
configured on the class row inside that one dialog, per
`ASSIGN_EXPERIENCE.md` §5 and PDR-030a. No second publish surface exists.

**3.2 Seam provision, not duplication.** The existing wiring seams -
the `lmsAssignmentsPublish` binding, the `lmsClassesListTopics` binding,
the authoritative assignment lifecycle bindings, and the class-links
reader - are provided to the Assign surface. Sprint 25 does not create a
second `httpsCallable` binding for publication. It reuses the existing
bindings. Whether the shared seam is relocated to a neutral client
module or provided to Assign from its current location is an
implementation-time code organization choice, bounded by two rules:

- No teacher-facing publish or topic affordance is rendered in Settings.
- No duplicate callable binding for publication or topics is introduced.

**3.3 Settings stays account-level.** Settings > Integrations continues
to own only account-level connection management. It renders no publish
toggle, no topic selector, no assignment control, and no class workflow.
This preserves the Sprint 24B surface ownership map without change.

**3.4 No behavior change to the callables.** The reconciliation is about
where publication is initiated and how the client seam is organized. It
introduces no change to the `lmsAssignmentsPublish` callable, the
publication records, the rules, or the audit vocabulary.

## 4. Alternatives Considered

- **Leave the seam in Settings and surface a publish control there.**
  Rejected. It creates a second assignment-adjacent workflow and
  contradicts PDR-019d, PDR-030a, and the one Assign dialog. The teacher
  would have to decide where to publish, which the platform explicitly
  refuses to ask.
- **Delete the existing wiring seam and rebuild it under the Assign
  surface.** Rejected as duplication. The seam is certified-shaped and
  its consumer is already the Assign Experience. Rebuilding it would
  duplicate architecture Sprint 25 is meant to reuse.
- **Do nothing and rely on convention.** Rejected. The seam's file
  location is a standing drift attractor. A short record naming the
  single origin and the provision rule closes the ambiguity permanently.

## 5. Consequences

Benefits:

- The single Assign workflow is preserved and its single-origin property
  is recorded at the ADR level.
- Sprint 25 reuses the existing publication and topics wiring rather than
  duplicating it.
- Settings > Integrations stays honest as an account-level surface.
- Future contributors have an explicit anchor: publication is initiated
  from Assign, never from Settings, regardless of where the wiring seam
  physically lives.

Limitations:

- If the wiring seam is relocated to a neutral module, imports in the
  Settings and Assign client trees update accordingly. This is a bounded,
  mechanical code organization change with no behavior change and no
  Firestore, rules, or callable impact.

## 6. Compliance

This record is consistent with:

- **PDR-010** and **PDR-019d.** The Assign dialog is the single origin of
  assignment records; publication is a side effect, not an alternate
  path.
- **PDR-030a.** Publication is an extension of Assign, never a standalone
  workflow, and never a Settings affordance.
- **Sprint 24B surface ownership map.** Settings > Integrations is
  account-level only; class and assignment workflows live on their
  certified surfaces.
- **Provider neutrality (PDR-019h).** The reconciliation touches no
  provider-specific concept.

*End of record.*
