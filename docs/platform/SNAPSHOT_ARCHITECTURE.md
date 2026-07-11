# Snapshot Architecture

Status: Architecture only. Implementation is deferred to Sprint 7.
Companion documents: CLASS_SNAPSHOT_EXPERIENCE.md, TEACHER_JOURNEY.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, ASSIGN_EXPERIENCE.md, PRESENT_MODE_ARCHITECTURE.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, PLATFORM_CONTRACTS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, PLATFORM_STATE_MACHINE.md.

This document defines the Snapshot surface at the architecture level. It is implementation-neutral. No runtime code ships as part of this sprint. Snapshot remains an unbuilt surface until its implementation sprint is scheduled. The class workspace continues to be a downstream consumer of the Enrollment, Assignment, and Submission domains, in the order recorded by `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`.

Every architectural decision in this document defers to the certified platform architecture and to the certified decision log in every case of conflict.

---

## 1. Purpose

Snapshot is the class-scoped preparation surface that opens by default when a teacher selects a class from the Teacher Workspace left-side navigation. Its purpose is narrow and load-bearing:

- Give a teacher a between-moments view of one class that answers a small, closed set of right-now questions.
- Compose against the certified Enrollment, Assignment, and Submission domains without introducing a parallel authoritative record.
- Preserve the surface boundary between the Teacher Workspace and the canonical instructional experience.
- Preserve the privacy contract that keeps accommodations, teacher notes, and student-private records off any surface a teacher opens between moments.

Snapshot is not a new domain. It is a UX contract on top of certified domains. This is the same posture Teacher Journey §9 already records for the Snapshot surface, and this architecture inherits that posture rather than restating it as a new authority.

---

## 2. Relationship to Teacher Journey

The Teacher Journey names Snapshot as the surface a class opens on between classes (Teacher Journey §5) and confirms its role at the end of the day (Teacher Journey §7). This architecture is the specification that lets those moments become real without inflating the platform.

Snapshot is the structural expression of the Teacher Journey's guiding rule: preparation before analytics. It is the first surface a class shows. The spreadsheet-style workspace is the second. That order is not accidental. It is the load-bearing decision this architecture preserves.

Snapshot must fit the Journey's rules for teacher-facing surfaces:

- It reads in seconds.
- It fits above the fold.
- It never surfaces accommodations or private notes.
- Moving between classes preserves the pattern.
- It never demands the teacher's full attention.

Where the Teacher Journey and this document appear to disagree, the Teacher Journey controls, and this document must be amended.

---

## 3. Relationship to Teacher Workspace

Snapshot renders inside the Teacher Workspace shell defined by Teacher Experience Philosophy §3.3 and §4.1. It is a workspace surface. It is not a new shell, a new router, or a new authenticated surface.

Snapshot consumes the Canonical Session Object produced by the Canonical Session Bootstrap defined in `LYFELABZ_PLATFORM_ARCHITECTURE.md` §16.2 and §16.7. It does not re-derive identity, role, status, or `schoolId`. A Snapshot component that reaches around the Canonical Session Object to re-read Firebase Authentication, custom claims, or the caller's `users/{uid}` record is a defect.

Snapshot renders through the shared workspace outlet, under the canonical workspace-surface identifier convention recorded by `PLATFORM_CONTRACTS.md` §7. It is not a new top-level navigation item on the left-side panel; it is the default surface of the Classes item's per-class workspace. Selecting a class from the Classes section opens the class workspace, and the class workspace opens on Snapshot.

Snapshot's mount lifecycle follows the Teacher Workspace convention already established: the surface headline receives focus when the surface mounts (per `PLATFORM_CONTRACTS.md` §10), and the workspace's cross-cutting affordances (identity card, sign-out control, left-side navigation) remain visible around it.

---

## 4. Relationship to Assign Experience

The Assign Experience is the single canonical origin of assignment records (Assign Experience §10). Snapshot is a downstream reader of those records.

Snapshot never creates an assignment record. Snapshot never opens the Assignment Dialog. Snapshot never exposes an alternate assign control. If a teacher decides she needs to change an assignment based on what Snapshot showed her, she uses the Assign Experience through its own entry points on the Curriculum surface. This preserves the Assign Experience's rule that assigning is one workflow.

Snapshot's data contract with Assign is asymmetric on purpose. Assign writes. Snapshot reads. Snapshot never becomes a shadow write path for the assignment lifecycle.

---

## 5. Relationship to Present Mode

Present Mode is a structurally separate presentation surface that never loads teacher-scoped data. It shares nothing at runtime with Snapshot.

Snapshot never renders inside Present Mode. Snapshot never links to Present Mode entry. Present Mode entry lives on the left-side navigation (`PRESENT_MODE_ARCHITECTURE.md` §3), not on Snapshot.

Snapshot inherits Present Mode's privacy posture as a design floor: any data that Present Mode forbids on a projector must also be absent from any Snapshot element that might appear on a projector by accident. Snapshot is not intended for projection, and no Snapshot control invites projection. The Teacher Workspace remains a teacher-only surface.

Snapshot does not display LMS state. The ratified LMS integration architecture (`LMS_INTEGRATION_ARCHITECTURE.md`, PDR-019, `LMS_EXPERIENCE.md` §4) locates LMS connection status, LMS class name badges, LMS topic names, LMS publication outcomes, and LMS roster deltas in Settings, not on Snapshot. The additive `lmsRosterRef` and `lmsPublicationRef` fields recorded in the Firestore Data Model are present on the enrollment and assignment records Snapshot reads, but Snapshot never renders them.

---

## 6. Navigation Placement

Snapshot's navigation contract:

- The left-side navigation exposes the Classes section (Teacher Experience Philosophy §3.3).
- Selecting an individual class from Classes opens that class's workspace inside the Teacher Workspace outlet.
- The class workspace opens on Snapshot by default. Snapshot is not opened by a separate control.
- The spreadsheet-style workspace is reached from Snapshot with a single gesture. Snapshot never becomes a mode of the spreadsheet, and the spreadsheet never becomes a mode of Snapshot.
- Selecting a specific student affordance on Snapshot opens that student's row inside the same class workspace's spreadsheet surface.
- Selecting an assignment affordance on Snapshot opens the corresponding assignment column inside the same class workspace's spreadsheet surface.
- Every Snapshot navigation stays inside the same class. Snapshot never redirects the teacher to a different class, a different workspace, or a different application.

No new workspace-surface identifier is proposed by this document. The Snapshot surface is the initial view of the class workspace under the existing `classes` navigation identifier. If the implementation sprint later determines that a workspace-surface identifier is required to disambiguate Snapshot from the spreadsheet within the same class workspace, that identifier is registered through the amendment process in `PLATFORM_CONTRACTS.md` §13 before implementation.

---

## 7. State Management Philosophy

Snapshot state is derived, not authoritative. It is not a new source of truth.

- The Canonical Session Object is the sole source of identity, role, status, and `schoolId`.
- The upstream domain records (Enrollment, Assignment, Submission) are the sole sources of the operational facts Snapshot renders.
- Snapshot never stores a rollup, a summary, or an intermediate state that it treats as authoritative.
- Snapshot never mutates an upstream record. Every Snapshot interaction is a read or a navigation.
- Client-side derivation from Firestore reads is permitted for shaping the surface. Cross-student aggregation must be server-mediated per the Analytics rule already recorded in `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §3.8 and §5.

Snapshot's client-side state is scoped to the mount lifecycle of the surface. It does not persist across mounts through the Session Object, through Firestore, or through browser storage.

---

## 8. Refresh Philosophy

Snapshot is quiet by default. It does not demand the teacher's attention on update.

The refresh model is asymmetric:

- On mount, Snapshot resolves the freshest reasonable view of the class the teacher just opened. This is the between-moments surface's most important instant.
- While mounted, Snapshot updates with new information as it arrives, without shaking layout, flashing counts, or pulling focus. Motion is used sparingly and only where it communicates change more clearly than stillness.
- Snapshot does not auto-refresh on a fixed interval. Fixed-interval polling is a dashboard behavior. Snapshot rejects it.
- Snapshot re-fetches on visibility change (the teacher returns to the tab from another tab) so that a teacher who has been in Gmail, PowerSchool, Present Mode, or Google Classroom returns to a current view.
- Snapshot never blocks the teacher on a refresh. If new data has not arrived, the previously rendered state remains visible, and the surface indicates its freshness quietly if at all.

The specific mechanism (Firestore listeners, one-shot reads, callable-mediated fetches, or a mix) is deferred to the implementation sprint. Whichever mechanism is chosen must satisfy the quiet-refresh contract and the read patterns recorded in Section 15.

---

## 9. Caching Philosophy

Snapshot caches for smoothness, not for authority.

- Cross-tab or cross-session caching of Snapshot data is prohibited. Snapshot is not a data warehouse and does not carry data across sessions.
- Cross-class caching of Snapshot data inside the same session is permitted where it demonstrably reduces cognitive effort during rapid class switching (for example, the four minutes between blocks during which a teacher may open two classes in sequence).
- Cached data is always subordinate to a fresh read. On any disagreement between cache and a fresh read, the fresh read wins.
- The cache is memory-scoped to the current tab. `localStorage` is not authorized for Snapshot caching. `sessionStorage` is not authorized for Snapshot payloads. Neither storage mechanism is a Snapshot substrate.
- No Snapshot cache is ever an authorization boundary. Authorization remains enforced by Firestore Rules and Cloud Functions, per `PLATFORM_CONTRACTS.md` §5.

The specific cache shape and lifetime are deferred to the implementation sprint. Any choice must fail safely under `PLATFORM_CONTRACTS.md` §11 and must never cause a stale view to render as the primary view without a visible pathway to a fresh read.

---

## 10. Offline Expectations

Snapshot is online-first by design. Its purpose is answered by a live view of the class.

- Snapshot renders a legible empty or degraded state when offline. It never renders a stale view as if it were current.
- Snapshot never accepts writes offline. There are no Snapshot writes.
- Offline degradation must fail safely: the surface continues to render, the class name and class context remain visible, and the surface names the connectivity condition in plain language.
- Offline-first behavior for canonical lesson content remains the responsibility of the canonical instructional experience per `LYFELABZ_PLATFORM_ARCHITECTURE.md` §13. Snapshot is not the surface that delivers offline lesson content.

Deep offline support for the class workspace, if it is ever justified, requires its own architecture pass and its own decision record. It is not proposed here.

---

## 11. Performance Expectations

Snapshot's performance target is set by its use pattern, not by an abstract latency budget.

- Snapshot must be understood in seconds inside a four-minute passing period on a school Chromebook connected to school Wi-Fi. Every performance decision is measured against that scenario.
- Snapshot must render an initial, non-empty, useful frame quickly enough that a teacher does not feel she is waiting on it. Loading skeletons that dominate the surface are a failure mode.
- Snapshot must update quietly. Update-time reflow is a failure mode.
- Snapshot must scale to the largest realistic class size for Version 1 without changing shape. Classroom size at Version 1 is bounded by the enrollment model already recorded in `LYFELABZ_PLATFORM_ARCHITECTURE.md` §7. Snapshot's read patterns must remain acceptable at ten times that scale, per the platform's scalable-by-design principle.
- Snapshot must remain performant on mobile. The mobile viewport is a first-class target, not a degraded variant. Mobile performance parity is required by the platform's mobile-first mandate.

Concrete latency, bundle-size, and paint-time budgets are deferred to the implementation sprint. Those budgets are set with reference to this section rather than in place of it.

---

## 12. Privacy Model

Snapshot's privacy model is the class-workspace expression of the platform's privacy contract.

- Snapshot renders no accommodation, no private student support, no teacher note, and no teacher preference. Accommodations live in Settings (Teacher Experience Philosophy §3.7).
- Snapshot renders no data about students outside the class the teacher opened. Cross-class visibility on a class Snapshot is a defect.
- Snapshot renders no data about teachers other than the caller. Peer-teacher visibility is not a Snapshot concern.
- Snapshot renders no administrator-only data.
- Snapshot renders student names only where those names are already visible to the caller through the certified read patterns of Enrollment, Assignment, and Submission. Snapshot never introduces a new avenue for name exposure.
- Snapshot never renders raw storage values, cache contents, debug output, deployment identifiers, or internal route metadata.

Snapshot's design posture treats the projector-safety floor recorded in `PLATFORM_CONTRACTS.md` §9 as a minimum, even though Snapshot is not a projection surface. This is deliberate. A teacher-workspace surface that a teacher may open in front of a student who is standing at her desk is one instant of inattention away from being projector-visible.

Private student information, including accommodations and modifications, remains subject to its own architecture pass per Teacher Experience Philosophy §3.7. Snapshot does not authorize any implementation of that pass.

---

## 13. Security Expectations

Snapshot's security posture is enforced at the platform boundary, not at the Snapshot surface.

- Authorization is enforced by Firestore Rules and by Cloud Functions, per `LYFELABZ_PLATFORM_ARCHITECTURE.md` §11 and `PLATFORM_CONTRACTS.md` §5.
- Client-side gating on the Snapshot surface is UX only. It is never a security boundary.
- Snapshot performs no privileged read. Every Snapshot read is authorized by the caller's Canonical Session posture as it already exists.
- Snapshot introduces no new role, no new claim, no new lifecycle field, and no new audit vocabulary term.
- Snapshot never bypasses a server-mediated callable to reach an aggregate view. Cross-student aggregation is server-mediated per Analytics rules.
- Snapshot renders nothing about a class the caller does not own. Class ownership is defined by the Classroom domain (`TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §3.4) and enforced by rules.
- Snapshot never persists state to a location that could be read by a subsequent, differently authorized session. Session-scoped memory only, per Section 9.

Snapshot's security posture is inherited, not invented.

---

## 14. Data Ownership

Snapshot owns no authoritative records.

- Enrollment records remain owned by the Enrollment domain.
- Assignment records remain owned by the Assignment domain and produced exclusively by the Assign Experience.
- Submission records remain owned by the Submission domain and produced exclusively by the server-mediated finalization transaction.
- Any rollup that Snapshot renders is a derived view of upstream records. Any persisted rollup, if one is ever required to satisfy the read patterns in Section 15 without violating the aggregation rule in Section 13, is an Analytics-domain artifact per `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §3.8. Snapshot never introduces its own authoritative collection.

Snapshot is a UX contract layered on domains that already exist. This posture is a first-class architectural constraint, not an implementation preference.

---

## 15. Firestore Read Patterns

Snapshot's Firestore read patterns are shaped by the upstream domains it composes. The patterns below are architecturally described, not implemented.

- **Class context read.** Snapshot resolves the class the teacher just opened using the class identifier already carried by the class workspace mount. This is a single-class scope. No cross-class read is performed by Snapshot at any time.
- **Enrollment scope.** Snapshot reads the enrollment records that resolve the roster for the class, restricted to `active` enrollments unless the surface intentionally exposes another enrollment state (for example, a transferred student who submitted before transfer). Reads are scoped by class and by the caller's teacher ownership.
- **Assignment scope.** Snapshot reads the assignment records surfaced to the class, restricted to the assignments relevant to the right-now questions the surface answers. The scope is bounded (for example, today's assignment set, or the most recently active assignment set), not open-ended history.
- **Submission scope.** Snapshot reads the submission records for the class's students against the in-scope assignments. Reads are scoped by class and by the caller's teacher ownership. Cross-student aggregation is server-mediated.
- **No cross-class read.** Snapshot performs no read that spans classes. Cross-class rollups are Analytics-phase concerns.
- **No cross-teacher read.** Snapshot performs no read against another teacher's classes.
- **No client-list of teachers, classes, or students outside the class the teacher opened.** Every list is scoped by the class in view.

Whether a specific read is a live listener, a one-shot read, or a callable-mediated fetch is an implementation-sprint decision. The choice must satisfy the refresh philosophy (Section 8), the caching philosophy (Section 9), and the performance expectations (Section 11), and must never expand the read patterns above.

If any Snapshot read pattern requires a persisted rollup to remain acceptable at scale, that rollup is introduced under the Analytics domain, not under Snapshot, and its authoring path is server-mediated per `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §3.8.

---

## 16. Cloud Function Responsibilities

Snapshot introduces no new authoritative callable. It is a reader.

Cloud Functions serve Snapshot only where server-mediated authority is required:

- **Cross-student aggregation.** If a Snapshot element requires aggregation across the class's students beyond what the client is permitted to compute, the aggregation is a server-mediated callable. This is the same rule the Analytics domain already carries.
- **Persisted rollup writes.** If a persisted rollup is introduced (see Section 15), its author is a server-mediated writer owned by the Analytics domain, not by Snapshot.
- **Rate-limited or protected fetches.** If a Snapshot read pattern requires rate limiting or protection beyond what Firestore Rules can express, that path is fronted by a callable rather than by a direct client read.

Snapshot never mints a claim, never mutates a lifecycle field, and never writes an authoritative record. The five Sprint 2 callables and every domain-owned callable already recorded in `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` remain the sole authoritative write paths. Snapshot's Cloud Function responsibilities are read-side only.

Whether any of the read-side callables above are required at Snapshot's initial implementation is deferred to the implementation sprint. If none are required, none are introduced. Server-mediated authority is a tool, not a default.

---

## 17. Platform Contracts Required Later

Snapshot's cross-cutting technical agreements are inherited from `PLATFORM_CONTRACTS.md`. The following contracts govern Snapshot without amendment:

- Naming and namespace pattern (`PLATFORM_CONTRACTS.md` §4). Any shared client-side key introduced later by Snapshot must follow the `lyfelabz.<feature>.<purpose>` pattern and be registered in the contract registry before use.
- Browser storage contracts (`PLATFORM_CONTRACTS.md` §5). Snapshot does not persist to `sessionStorage`, `localStorage`, cookies, URL parameters, or URL fragments.
- Versioned client-side schema contracts (`PLATFORM_CONTRACTS.md` §6). Any structured client-side payload Snapshot ever shares with another surface must be versioned.
- Route and navigation contracts (`PLATFORM_CONTRACTS.md` §7). Snapshot introduces no parallel router and no duplicate workspace shell.
- Public and authenticated surface boundary (`PLATFORM_CONTRACTS.md` §8). Snapshot never bridges into the canonical public instructional experience with teacher-scoped data.
- Privacy and projector-safety contracts (`PLATFORM_CONTRACTS.md` §9). Snapshot honors the projector-safety floor as its design minimum.
- Accessibility contracts (`PLATFORM_CONTRACTS.md` §10). Snapshot is fully keyboard operable, focus-visible, and screen-reader coherent. Focus lands on the surface headline when the surface mounts.
- Safe-failure contracts (`PLATFORM_CONTRACTS.md` §11). Snapshot fails safely to a legible empty state.

New platform contracts required by Snapshot's implementation sprint (for example, a Snapshot-specific workspace-surface identifier, or a new cross-cutting refresh convention) are added through the amendment process in `PLATFORM_CONTRACTS.md` §13. Implementation alone cannot create a platform contract.

---

## 18. Failure Handling

Snapshot fails legibly.

- If the class context cannot be resolved, Snapshot renders a plain, obvious surface that names the situation and returns the teacher to the class list without silently redirecting her.
- If the Enrollment, Assignment, or Submission scope reads fail, Snapshot renders the elements it can render and names the elements it cannot in plain language. It does not crash. It does not render a blank surface.
- If the network is unavailable, Snapshot degrades per Section 10.
- If a caller lacks the authorization to view the class (for example, a session that lost teacher role between mounts), Snapshot renders no class data and yields to the Teacher Workspace's standard failure state per `LYFELABZ_PLATFORM_ARCHITECTURE.md` §16.5.
- If a Snapshot payload is malformed or partial, the surface must ignore the malformed portion and continue rendering per `PLATFORM_CONTRACTS.md` §11.
- If a client-side error occurs inside Snapshot, the error boundary limits the failure to Snapshot. The class workspace's shell, the left-side navigation, the identity card, and the sign-out control remain reachable.

Silent failure is prohibited. Every meaningful Snapshot failure is observable through the platform's existing observability posture (`LYFELABZ_PLATFORM_ARCHITECTURE.md` §2 and §11). No new audit vocabulary term is introduced.

---

## 19. Scalability Considerations

Snapshot must scale by design.

- Snapshot read patterns are bounded at Version 1 by a single class per surface mount. This is the primary scalability posture. A class scope is bounded by the enrollment model.
- Every Snapshot read pattern must remain acceptable at ten times current usage, per the platform's scalable-by-design principle.
- Cross-student aggregation is server-mediated. Client-side aggregation across the class's students that scales linearly with class size is permitted only where the class-size ceiling makes the linear cost trivial. Where the cost is not trivial, aggregation moves to a server-mediated path per Section 16.
- Snapshot never fans out reads across classes for a rollup view. A future teacher-home surface that aggregates across a teacher's classes is a Future Extension per `CLASS_SNAPSHOT_EXPERIENCE.md` §9 and is not proposed here.
- Cache smoothing (Section 9) is subordinate to authority. Snapshot never scales by trading correctness for speed.
- Snapshot's mobile scalability is a first-class target. Mobile viewports do not receive a degraded read pattern.

Snapshot is designed to remain acceptable when a school grows from two teachers to twenty and from two grades to seven. The design does not assume classroom size, and it does not assume that a teacher teaches only one grade.

---

## 20. Future Extensibility

Snapshot's future extensibility is bounded by the Class Snapshot Experience §8 (things Snapshot must never become) and §9 (future expansion). Every extensibility hook this architecture reserves must remain inside those bounds.

- New Snapshot elements are additive. They compose against the same upstream domains and honor the same read, cache, refresh, and privacy patterns.
- New Snapshot elements that would require a new authoritative record, a new claim, a new lifecycle field, or a new audit vocabulary term are architecture amendments, not implementation work.
- New Snapshot elements that would require a new cross-cutting client-side key, storage mechanism, or navigation convention are additions to `PLATFORM_CONTRACTS.md`, not additions to Snapshot alone.
- New Snapshot elements that would require cross-class or longitudinal reads are Analytics-domain concerns, not Snapshot concerns.
- A future teacher-home Snapshot (a cross-class preparation view) is deferred to its own architecture pass and remains subject to the seating-chart posture recorded in `CLASS_SNAPSHOT_EXPERIENCE.md` §9.
- A future read-only Snapshot for co-teachers is deferred to the co-teaching architecture pass named in `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §3.3.
- A future historical Snapshot is deferred to Analytics.
- Snapshot never grows an export path. Export is a data-warehouse behavior and is out of scope.

Future extensibility is a discipline, not a promise. Snapshot's shape is defended by the Class Snapshot Experience and by this architecture. A future capability that cannot preserve the shape is a candidate for reconsideration.

---

## 21. Deferred Implementation Detail

Every decision below is intentionally deferred until Sprint 7. This architecture does not choose among the options for any of them.

- The specific Firestore read mechanism for each read pattern (live listener, one-shot read, callable-mediated fetch, or a mix).
- The specific cache shape, lifetime, and invalidation trigger.
- The specific refresh trigger for visibility-change re-fetching.
- The concrete visual composition of Snapshot elements. Chart use, if any, is bounded by `CLASS_SNAPSHOT_EXPERIENCE.md` §5.
- The concrete performance budgets that satisfy Section 11.
- The concrete mobile layout below 480px, between 480px and 720px, and above 720px.
- Whether Snapshot introduces a workspace-surface identifier distinct from the class workspace's identifier.
- Whether any server-mediated aggregation callable is required at initial implementation.
- Whether any persisted rollup owned by the Analytics domain is required to make Snapshot's read patterns acceptable at scale.
- The precise empty and degraded state visuals.
- The precise focus management within the surface after mount, beyond focusing the surface headline.

Every deferred detail is scoped to Sprint 7. None expands the certified architecture, adds a Firestore record, adds a callable, adds a claim, adds a lifecycle field, or adds an audit vocabulary term. If any implementation decision later requires one of those changes, it is a formal architecture amendment and requires its own decision record.

---

*End of Snapshot Architecture. This document defines the Snapshot surface at the architecture level. Implementation is deferred to Sprint 7, which must reference this document and `CLASS_SNAPSHOT_EXPERIENCE.md` before proposing surface shape or read behavior.*
