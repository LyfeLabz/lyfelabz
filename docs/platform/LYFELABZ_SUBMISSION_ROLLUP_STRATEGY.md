# LyfeLabz Submission Rollup Strategy

Assessment v2 - Submission Finalization and Teacher Review Rollups

Status: Strategy document. No implementation code, no Cloud Functions, no Security Rules, no Firestore schemas, no JSON.

This document is the third of three implementation preconditions identified during the Firestore Data Model readiness assessment. It follows the Firestore Data Model document and the Firestore Query and Index Strategy document. It defines how student submissions become authoritative historical records and how teacher dashboards read summarized state without scanning submission history at read time.

---

## 1. Submission Philosophy

Submissions in LyfeLabz are historical records of student thinking at a specific point in time. They are not editable documents, not draft state, and not analytics events. They exist to preserve what a student actually submitted, when they submitted it, and how it was scored.

The guiding principles are:

- Submissions are historical records. Once a submission is finalized it represents what the student produced. It is not rewritten to reflect later changes in scoring logic, rubrics, or lesson content.

- Finalized submissions are immutable. After finalization, the authoritative submission document is never updated by any actor. Corrections, regrades, and teacher annotations live in adjacent records, not by mutating the original.

- Students do not directly finalize authoritative records. A student action triggers finalization, but the authoritative record is produced by a trusted server-side process. The client cannot write directly to the authoritative collection.

- Teacher dashboards should not compute summaries by scanning submissions. Any dashboard that requires reading every submission to render is architecturally unfit for the platform's target scale. Summaries are precomputed and stored in rollup records that are cheap to read.

- Rollups exist to support workflow, not analytics. Rollups are optimized for the specific questions a teacher asks while running a class. They are not a general-purpose analytics warehouse and should not be repurposed for longitudinal research, standards reporting, or district-level analysis. Those needs are served by a separate downstream pipeline described in Section 10.

These principles are load-bearing. Every rule in the remainder of the document is a consequence of one or more of them.

---

## 2. Submission Lifecycle

A submission moves through a fixed sequence of stages. Each stage has a clear boundary and a clear responsible actor.

1. Student begins an assessment. The client renders the assessment for the student's current assignment. No submission record exists yet. Any in-progress state is local to the client or held in a short-lived working area that is not considered authoritative.

2. Student submits. The student takes the finalization action from the client. The client transmits the student's answers, Show Your Thinking response, and enough context to identify the class, assignment, and lesson.

3. Server-side finalization. A trusted server-side process receives the submission, validates that the student is a member of the referenced class, validates that the assignment is open, resolves the correct assessment version, computes the score, and produces the authoritative record. This step is the only step that can create an authoritative submission.

4. Authoritative submission is created. The finalization process writes the immutable submission record. From this moment forward the record represents historical truth.

5. Rollup records are updated. The same finalization process updates the rollup records that teacher dashboards and student views rely on. Rollup updates are part of the finalization transaction boundary described in Section 5, not a separate downstream job that could lag.

6. Teacher reviews work. The teacher opens their dashboard. The dashboard reads rollup records to render its summaries and reads individual submissions only when the teacher chooses to view a specific student's work.

7. Submission remains part of permanent class history. The submission stays in the class's historical record for the lifetime of the class. Class archival, described in Section 5, does not delete submissions.

The lifecycle does not include a draft stage, an editable stage, or a client-authored finalization stage. A submission either does not yet exist or is finalized. The `submitted` state exists only inside the server-side finalization transaction as the transient state before the `finalized` write commits; it is never observable to any reader. This reconciles the submission lifecycle across the Domain Model, the Firestore Data Model, and this document.

---

## 3. Authoritative Submission Record

The authoritative submission record is the permanent, immutable evidence of a student's completed assessment. Conceptually it captures the following categories of information. The exact field-level schema is deferred to implementation.

- Student identity reference. A stable reference to the student who submitted. The reference is by internal identifier, not by name, so that display-name changes never rewrite historical records.

- Class reference. A stable reference to the specific class in which the submission was made. A student in two classes with two teachers produces two independent submission histories.

- Assignment reference. A stable reference to the assignment instance the student was completing. This is not the lesson itself, and not the assessment version, but the specific teacher-issued assignment.

- Lesson reference. A stable reference to the lesson the assessment belongs to.

- Assessment version. The specific version of the assessment that was scored. Assessment content evolves; historical records must record which version the student actually saw and answered.

- Answers. The student's responses to each item, recorded in a form that can be redisplayed exactly as the student submitted them. Item ordering and randomization state, if any, are captured well enough to reproduce the student's experience.

- Show Your Thinking response. The student's open-response explanation, preserved verbatim.

- Score. The scored result at the moment of finalization. The score lives on the submission because the submission is the historical evidence; it does not live only on the rollup.

- Timestamps. The moment the student began, the moment the student submitted, and the moment the server finalized. These are distinct events and each is preserved.

- Finalization metadata. The identity of the finalization process, the assessment version resolver's decision, and any deterministic finalization details needed to audit the record later.

A record with these categories is sufficient to reconstruct what the student did, what version they did it against, when, in which class, and what score the platform assigned. That is the definition of an authoritative submission in LyfeLabz.

---

## 4. Rollup Records

Rollups are cheap-to-read documents that store precomputed summaries of submission activity. Their purpose is to answer specific workflow questions in a single read rather than by scanning the submissions collection.

Possible rollup scopes:

- Assignment-level rollup. One document per assignment record. Captures how many students have submitted, how many have not yet submitted, distribution of scores, and last activity timestamp. Answers the teacher question "how is this curation going right now."

- Student-level rollup. One document per student per class. Captures which assignment records the student has submitted, which are not-yet-submitted, most recent submission timestamp, and a compact per-record status. Answers the teacher question "what is this student's current standing" and the student question "what have I submitted."

- Class-level rollup. One document per class. Captures the class's overall submission activity, count of open assignment records, count of pending review items, and recent activity timestamp. Answers the teacher question "is anything new in this class."

- Teacher-level review queue. One document per teacher across all their classes. Captures pending review items across every class the teacher owns. Answers the teacher question "where should I look first this morning."

Version 1 recommendation. Ship three rollups: assignment-level, student-level, and teacher-level review queue. The class-level rollup is deferred because most of its useful information can be derived cheaply from the teacher-level review queue plus a small aggregation of the teacher's assignment-level rollups. Adding the class-level rollup later is compatible with this design and does not require rewriting the others.

Tradeoffs.

- More rollups means more write amplification at finalization time. Each additional rollup is another document that must be updated when a submission is finalized.

- Fewer rollups means teachers may need multiple reads to render a screen, and some questions become slow.

- The chosen three cover the highest-traffic workflow questions with the lowest write amplification. The teacher-level review queue is the most valuable of the three because it is what a teacher opens first.

Rollups are workflow surfaces, not analytics stores. They are optimized for teacher and student reads during a school day. Long-horizon reporting is handled by a separate pipeline as described in Section 10.

---

## 5. Rollup Update Rules

Rollups are always updated by the server-side finalization process, never by clients, and never by a background job that runs later. The reason is correctness: a teacher who refreshes the dashboard one second after a student submits must see the change, and a rollup that lags behind the submission by minutes will produce confusing and unauditable teacher experiences.

Update triggers:

- Successful finalization. When a submission is finalized, its containing assignment rollup, its student rollup, and its teacher review queue rollup are all updated as part of the same server-controlled operation. If any rollup update fails, the finalization operation is treated as failed and retried; the authoritative submission and its rollups do not diverge.

- Duplicate submission handling. If a student's client retries a submission after the server has already finalized one, the server recognizes the retry, does not create a second authoritative record, and does not double-count in rollups. Deduplication is keyed on the student, assignment, and a client-supplied idempotency marker.

- Resubmission policy. Whether a student may resubmit is an assignment-level policy. When resubmission is allowed and used, the prior authoritative submission is not mutated. A new authoritative submission is created and rollups are updated to reflect the current-attempt score and the count of attempts. The prior submission remains readable in class history.

- Assignment closure. When an assignment closes, the assignment-level rollup is marked closed and the teacher review queue is updated to reflect any outstanding review items. Closed assignments no longer accept new submissions; finalization requests against a closed assignment are rejected server-side.

- Class archival. When a class is archived, its rollups are marked archived. Rollups and submissions are preserved for historical access. Archival does not delete rollups and does not delete submissions.

Why server control is required. Client-controlled rollup updates would allow a malicious or buggy client to misreport class state, hide missing submissions, or inflate scores on a dashboard. Server control is the only place where the invariant "the rollup reflects the submissions" can be enforced. It is also the only place where the finalization transaction boundary can be honored, so that the submission and the rollups either both succeed or both fail.

---

## 6. Teacher Review Workflow

Teacher dashboards are the highest-traffic authenticated read surface on the platform. Their performance depends entirely on rollup discipline.

Workflow needs the rollups must support:

- Seeing new submissions. A teacher opens the dashboard and immediately sees a count and short list of items awaiting review, sourced from the teacher-level review queue rollup. This is a single-document read regardless of how many classes or students the teacher has.

- Reviewing student work. When the teacher chooses a specific submission to review, the client reads the authoritative submission directly. This is a targeted read, one document at a time, and it is acceptable because it is initiated by the teacher, not by the dashboard's initial render.

- Identifying not-yet-submitted work. The assignment-level rollup captures which students in the class have not yet submitted an open assignment record. The dashboard reads a small number of assignment rollups to render this view, rather than scanning submissions and computing the complement. This surface uses "not yet submitted," never "missing," "overdue," or "late," per PDR-010.

- Viewing assignment completion. The assignment-level rollup contains completion counts and score distribution. The dashboard renders these directly.

- Avoiding expensive reads. The dashboard never reads the submissions collection to render summary state. If a summary can only be produced by scanning submissions, either the rollup needs a new field or the summary is out of scope for a workflow dashboard and belongs in the analytics pipeline.

The workflow rule is: initial render is rollup-only. Only teacher-driven drilldowns read submissions.

---

## 7. Student Workflow

Students interact with submissions in a narrower set of ways than teachers. The rollup strategy supports:

- Submission confirmation. After a successful finalization, the client shows the student a confirmation that reflects the authoritative record. The confirmation is derived from the finalization response, not by re-reading rollups.

- Prior submissions. A student may view their own history within a class. This view is served by the student-level rollup for the summary, and by direct submission reads when the student opens a specific past submission.

- Whether resubmission is allowed. Resubmission eligibility is a property of the assignment. The client determines eligibility by reading the assignment plus the student's rollup for that class. It does not compute eligibility by scanning submissions.

- Classroom boundaries. A student sees only their own submissions in their own class. Cross-class visibility does not exist. A student who is in two classes sees two independent histories, one per class. The rollups are scoped per class, so this isolation follows from the data shape rather than from view-layer filtering.

Students never write to rollups, never finalize their own submissions directly, and never see other students' submission content.

---

## 8. Privacy and Security

The rollup strategy is designed with the same privacy posture as the underlying data model. The rollup layer must not weaken it.

- Student work is protected. Authoritative submissions are readable only by the student who produced them, the teacher who owns the class, and platform administrators with justified access. Rollups that contain any student-identifiable data inherit the same access boundaries.

- Class boundaries are enforced. A teacher can only read rollups for classes they own. A student can only read rollups scoped to their own membership. Cross-class reads are impossible by construction, not by view-layer omission.

- Teacher ownership. Teacher-level review queue rollups are scoped to the individual teacher. Co-teaching, when introduced later, is expressed by explicit shared ownership on the class, and rollups follow that ownership rather than being duplicated per teacher.

- Immutable submission history. Because authoritative submissions cannot be mutated, the historical record cannot be quietly rewritten by any actor. Rollups can be recomputed, but recomputation reads from the immutable submissions and cannot invent history.

- Auditability. Finalization metadata on each submission plus the append-only nature of the submission collection means that any dispute about a student's work can be resolved by reading the historical record. Rollups are derivable from that record; the record is the source of truth.

Rollups never store more student-identifiable content than the workflow they support requires. In particular, rollups do not store answers or Show Your Thinking responses. Those live only on the authoritative submission.

---

## 9. Scalability

Target scale: 100,000 students, 10 million submissions, many teachers checking dashboards daily.

Why the strategy scales:

- Teacher dashboard reads are O(1) per rendered surface. The initial render of a teacher dashboard reads the teacher-level review queue rollup and a bounded number of assignment-level rollups. It does not scan submissions and its cost does not grow with class size or historical submission count.

- Student dashboard reads are O(1) per class. A student's view of their own status in a class reads the student-level rollup for that class.

- Writes are bounded per submission. Each finalization writes one authoritative submission and updates a small fixed number of rollup documents. Write amplification is constant, not proportional to class size or historical submission count.

- Historical growth is on the submissions collection, which is never scanned by workflow reads. Growing to 10 million submissions does not slow down teacher dashboards because dashboards never touch the submissions collection at render time.

Bottlenecks and mitigations:

- Hot assignment rollups. A single assignment issued to a large class receives one rollup update per finalization. If a very large class submits nearly simultaneously, the assignment rollup becomes a write-contention hot spot. Mitigation: shard the assignment rollup into a small fixed number of subdocuments that are aggregated at read time on the client. Sharding is introduced only when observed contention warrants it and is compatible with the rest of the design.

- Teacher review queue growth. A teacher who never clears their queue will see it grow. Mitigation: the queue records a bounded window of recent pending items plus a count of anything older. It is not a full historical index and does not need to be one.

- Cold-start dashboard reads. The first read of a rollup after a long idle period will be uncached. Mitigation: this is acceptable because the read is a single document, not a scan.

- Backfill and recomputation. If a rollup is ever suspected to have drifted from the submissions, the submissions are the source of truth and the rollup can be recomputed from them. Recomputation is a background operation and does not block workflow reads.

The strategy avoids the two failure modes that would make the platform unshippable at scale: read-time aggregation over submissions, and unbounded document growth on any workflow surface.

---

## 10. Future Compatibility

The strategy is designed so that anticipated future capabilities can be added without rewriting the submission model or the rollup contracts.

- Rubrics. Rubric-based scoring adds structure to the score. The authoritative submission already records a score plus finalization metadata, so a rubric result is an extension of existing fields, not a new record type.

- Teacher comments. Teacher comments on student work are stored adjacent to the submission, not by mutating the submission. The immutability of the authoritative record is preserved.

- Standards reporting. Standards attainment reporting is derived from submissions, but not from workflow rollups. It is produced by the analytics pipeline described below, not by adding fields to teacher-facing rollups.

- AI feedback. AI-generated feedback on Show Your Thinking responses is stored adjacent to the submission with its own provenance and version metadata. It does not modify the student's original response.

- Parent views. Parent access is a scoped read against student-level rollups plus targeted reads of submissions the parent is authorized to see. It reuses the existing read surfaces.

- District reporting. District-level reporting is served by the analytics pipeline. Workflow rollups are not repurposed for district reporting because the two workloads have incompatible requirements.

- LMS export. LMS export reads the authoritative submissions collection, respects class ownership, and produces the export format the target LMS requires. It does not require changes to the submission model.

The separation of workflow rollups from an analytics pipeline is the key forward-compatibility decision. Workflow rollups stay small, fast, and focused on the school day. An analytics pipeline, when introduced, reads from the immutable submissions collection on its own schedule and serves reporting workloads without contending with dashboards.

---

## 11. Anti-Patterns

The following patterns are explicitly rejected and must not appear in Assessment v2 implementation.

- Computing dashboard summaries by scanning all submissions. Any dashboard whose initial render depends on reading the submissions collection is unfit for platform scale. Summaries live on rollups, or they are out of scope for a workflow dashboard.

- Allowing students to update finalized submissions. Authoritative submissions are immutable. Any workflow that requires editing a finalized record is expressed as a resubmission or as an adjacent annotation record, never as a mutation.

- Storing authoritative scores only in rollups. The rollup is a summary. The score lives on the submission because the submission is the historical evidence. A rollup that loses the score is a summary that has forgotten what it summarizes.

- Mixing analytics with workflow summaries. Rollups are for the current school day. Longitudinal analysis, standards attainment reporting, and district reporting belong in a separate pipeline. Adding analytics fields to workflow rollups grows their size, slows their reads, and couples unrelated release cycles.

- Allowing client-controlled finalization. Clients request finalization; they do not perform it. The client cannot write to authoritative submissions and cannot write to rollups. A design that permits either is a security failure.

- Rebuilding rollups from clients. Only the server-side finalization process and authorized backfill jobs write rollups. A client that recomputes a rollup and writes it back is a client that has been given the ability to lie about class state.

- Deleting submissions to correct scores. Regrades and corrections are expressed as adjacent records, not by deleting history. The immutability rule has no exceptions in the workflow layer.

- Per-teacher duplication for co-taught classes. Rollups follow class ownership. Co-teaching is expressed by shared ownership on the class, not by duplicating rollups per teacher.

---

## 12. Readiness Assessment

Would I approve this submission rollup strategy for implementation.

Yes.

The strategy satisfies the four requirements set at the top of this document. It preserves immutable finalized submissions by making authoritative records non-mutable and by placing all corrections in adjacent records. It preserves Cloud Function finalization by requiring server-side finalization and rejecting client-authored authoritative writes. It preserves teacher review efficiency by ensuring dashboards read rollups rather than scanning submissions. It preserves student privacy and classroom isolation by scoping every rollup to a class and by keeping student content off of rollups. It preserves scalable dashboard performance by keeping teacher-facing reads O(1) in the number of documents, independent of historical submission volume.

The remaining implementation decisions are internal to a later phase and do not require changes to this strategy. In particular, the choice of exactly which fields live on each rollup, the specific idempotency mechanism used at finalization, the sharding threshold for hot assignment rollups, and the analytics pipeline design are all deliberately left to their respective implementation documents. This document is the strategy they will be measured against.

With the Firestore Data Model, the Firestore Query and Index Strategy, and this Submission Rollup Strategy in place, the three implementation preconditions identified during the data model readiness assessment are satisfied. Assessment v2 implementation may proceed against these strategies without further architectural prerequisites.
