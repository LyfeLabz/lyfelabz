# LyfeLabz Firestore Query and Index Strategy

Version 1.0
Status: Canonical query and indexing reference
Scope: Query patterns, composite index planning, read and write optimization, and operational guidance for the LyfeLabz Firestore data model

This document is documentation only. It does not generate `firestore.indexes.json`, Security Rules, Cloud Functions, or any implementation code. Every recommendation is a design commitment that downstream artifacts must conform to.

This document assumes the reader is already familiar with:

- LYFELABZ_PLATFORM_DOMAIN_MODEL.md
- LYFELABZ_PLATFORM_ARCHITECTURE.md
- LYFELABZ_FIRESTORE_DATA_MODEL.md

This is the second of three preconditions for implementation approval established in the Firestore Data Model, Section 13. It resolves Condition Two (index plan precedes query code) and provides shared vocabulary for Condition One (rollup strategy) and Condition Three (denormalization discipline).

---

## 1. Query Philosophy

The following principles guide every query and index decision in this document. Where later sections make a choice, they defer to these principles.

### 1.1 Optimize for the Common Teacher Workflow

The single most frequent read pattern in the platform is a teacher opening a dashboard for one of their classes. Every index and denormalization decision privileges that path. Rarer workflows, such as multi-year historical reports, may accept higher latency or additional index cost, but the classroom-day path must be fast.

### 1.2 Reads Dominate Writes

A submission is written once and read many times. A class roster is written at term start and read every class period thereafter. The model already denormalizes for reads (Data Model Section 12.3). The query strategy continues that posture: prefer indexed reads that resolve in one round trip over normalized reads that require joins.

### 1.3 Every Query Is Predictable

Every query the platform issues must be enumerable, indexable, and reviewable. Ad hoc queries composed at runtime from user input are forbidden. This is a design constraint, not a coding style: it protects the platform from unindexed-query outages and from cost surprises.

### 1.4 Avoid Collection Scans

No production query issues an unfiltered read against a growing collection. Every query begins with an ownership filter (`schoolId`, `teacherId`, `studentId`, `classId`, or `assignmentId`) that bounds the result set to a known, small population.

### 1.5 Prefer Explicit Ownership Filtering

Every top-level document in the model carries the ownership fields required to answer authorization on its own (Data Model Section 8.1). Queries mirror that structure: the first `where` clause is always an ownership clause. This keeps queries symmetrical with Security Rules and prevents accidental cross-tenant leakage even before rules evaluate.

### 1.6 Avoid Unnecessary Composite Indexes

Every composite index has a cost: build time on deploy, write amplification on every document that matches it, and cognitive load when the index list is reviewed. The strategy proposes composite indexes only where a query cannot be served by an equality filter on a single indexed field or a single range clause. Indexes are added deliberately, not speculatively.

### 1.7 Design for Maintainability

A query strategy that a future engineer cannot understand will be quietly replaced by ad hoc queries under deadline pressure. Every query in Section 2 is named, motivated, and mapped to the index that serves it. Indexes without a named consumer in this document are candidates for removal (Section 9.3).

### 1.8 Time Is a First-Class Query Dimension

Dashboards paginate by recency. Portfolios browse by term. Audit views scan by time window. Every collection that grows with activity carries a canonical timestamp field (`createdAt`, `submittedAt`, or `occurredAt`) that is available as the last clause of every list query. Time is never inferred from document IDs.

### 1.9 Aggregates Are Never Computed on Read

Class averages, teacher-wide completion rates, and school-wide analytics are never computed by scanning submissions at request time. Aggregation is a rollup responsibility, defined by the separate rollup strategy document (Data Model Section 13.1). The query strategy names the read points that will consume rollups, so the rollup document can size them correctly.

### 1.10 Pagination Is Non-Negotiable

Every list query returns a bounded page. No production surface renders an unbounded list. Cursors use the last document snapshot, never numeric offsets. This is a hard rule because Firestore charges per document read, and unbounded lists convert one careless UI into an unbounded cost.

---

## 2. Major Query Categories

This section enumerates every query the platform is expected to issue in Version 1. For each query, it names the collection, the filters, the ordering, the expected frequency, the expected result size, and the performance considerations. Section 3 maps these queries to composite indexes.

Frequency labels are used consistently:

- Continuous: every navigation or refresh within a session.
- High: many times per user per day.
- Moderate: a few times per user per day.
- Occasional: a few times per user per week or less.
- Rare: administrative or audit paths only.

### 2.1 Teacher Queries

#### 2.1.1 My Classes

Collection: `classes`
Filters: `teacherId == currentUserId`, `status == active`
Order: `createdAt desc`
Page size: All classes for a teacher, typically 4-8.
Frequency: Continuous. Every teacher session opens with this query.
Scale: A teacher owns fewer than 20 classes across a career at a school.
Performance considerations: Single indexed equality plus filter plus order. A composite index on `(teacherId, status, createdAt)` serves this cleanly. Cache the result for the session.

#### 2.1.2 My Archived Classes

Collection: `classes`
Filters: `teacherId == currentUserId`, `status == archived`
Order: `createdAt desc`
Page size: 20 with cursor.
Frequency: Occasional. Historical grade views.
Scale: Bounded by career length. Small.
Performance considerations: Same composite index as Section 2.1.1.

#### 2.1.3 Classes I Co-Teach (deferred)

Reserved for the future `coTeacherIds` field noted in the Data Model. Would require a separate composite index using `array-contains`. Not built until the co-teacher feature is scoped.

#### 2.1.4 My Assignments for a Class

Collection: `assignments`
Filters: `classId == selectedClassId`, `status in (published, closed)`
Order: `createdAt desc`
Page size: 20 with cursor.
Frequency: High. The primary teacher-view surface.
Scale: A class accumulates on the order of 100 assignments per year.
Performance considerations: Composite index on `(classId, status, createdAt)`. The `status` filter is important because teachers should not see other teachers' draft assignments (a case that arises when the platform later supports co-teaching).

#### 2.1.5 My Draft Assignments

Collection: `assignments`
Filters: `teacherId == currentUserId`, `status == draft`
Order: `updatedAt desc`
Page size: 20.
Frequency: Moderate.
Scale: Small at any moment.
Performance considerations: Composite index on `(teacherId, status, updatedAt)`.

#### 2.1.6 Submissions for an Assignment (Teacher Review Queue)

Collection: `submissions`
Filters: `assignmentId == selectedAssignmentId`
Order: `submittedAt desc`
Page size: 30 (typical class size).
Frequency: High. This is the grading surface.
Scale: One page usually holds the entire class.
Performance considerations: A single-field index on `assignmentId` plus `submittedAt` ordering. If the teacher filters by review flag, a composite `(assignmentId, flaggedForReview, submittedAt)` is added.

#### 2.1.7 Recent Submissions in My Classes

Collection: `submissions`
Filters: `teacherId == currentUserId`, `status == submitted`
Order: `submittedAt desc`
Page size: 25.
Frequency: High. Teacher home page.
Scale: Bounded by recent activity. First page always small.
Performance considerations: Composite index on `(teacherId, status, submittedAt)`. This is one of the most valuable indexes in the system and justifies its cost.

#### 2.1.8 Class Roster

Collection: `enrollments`
Filters: `classId == selectedClassId`, `status == active`
Order: by student display name (client side after fetch).
Page size: 40 with cursor.
Frequency: High.
Scale: Class size, typically 20-30.
Performance considerations: Composite index on `(classId, status)` plus a stable secondary sort by `enrolledAt`. Sort by student name is done client side to avoid duplicating student names on enrollment documents.

#### 2.1.9 Assignments Referencing a Lesson

Collection: `assignments`
Filters: `teacherId == currentUserId`, `lessonSlug == selectedLessonSlug`
Order: `createdAt desc`
Frequency: Occasional. Curriculum planning.
Scale: Small.
Performance considerations: Composite index on `(teacherId, lessonSlug, createdAt)`.

### 2.2 Student Queries

#### 2.2.1 My Classes

Collection: `enrollments`
Filters: `studentId == currentUserId`, `status == active`
Order: `enrolledAt desc`
Frequency: Continuous.
Scale: Six to eight classes.
Performance considerations: Composite index on `(studentId, status, enrolledAt)`. The student then reads each class document by ID in a small batch; those reads are cached aggressively.

#### 2.2.2 My Assignments

Because a student is enrolled in several classes, the student home page must display assignments across all of them. Two approaches were considered:

- Issue one assignments query per class and merge client side.
- Denormalize `enrolledStudentIds` onto assignments and query by `array-contains`.

Recommended: issue one query per class, with a small parallel fan-out (2.2.2a). The alternative denormalization would create write amplification every time enrollment changed and would cap class size at Firestore's `array-contains` limits. Because a student's active class count is bounded and small (under 10), fan-out is acceptable and preserves data-model integrity.

##### 2.2.2a My Assignments (per class)

Collection: `assignments`
Filters: `classId == C`, `status == published`, `availableAt <= now`
Order: `dueAt asc`
Page size: 20.
Frequency: Continuous.
Scale: Small.
Performance considerations: Composite index on `(classId, status, availableAt)` with a secondary consideration for `dueAt` ordering. Because Firestore requires the range field to be the last ordering clause, the platform issues the query as `where classId == C and status == published and availableAt <= now order by availableAt`, then sorts by `dueAt` client side within the small result. The alternative index `(classId, status, dueAt)` is added only if analysis shows the client-side sort exceeds a threshold.

#### 2.2.3 My Submissions

Collection: `submissions`
Filters: `studentId == currentUserId`
Order: `submittedAt desc`
Page size: 20 with cursor.
Frequency: Moderate. Student portfolio.
Scale: Grows with the school year. A single student may reach a few hundred submissions per year.
Performance considerations: Composite index on `(studentId, submittedAt)`.

#### 2.2.4 My Submission for an Assignment

Collection: `submissions`
Filters: `studentId == currentUserId`, `assignmentId == selectedAssignmentId`
Frequency: Continuous during work.
Scale: Zero or one document.
Performance considerations: Composite index on `(studentId, assignmentId)`, which also serves the uniqueness check at write time (Data Model Section 5.6).

#### 2.2.5 My Submissions in a Class

Collection: `submissions`
Filters: `studentId == currentUserId`, `classId == C`
Order: `submittedAt desc`
Frequency: Occasional. Class-scoped portfolio.
Scale: Bounded by class assignment count.
Performance considerations: Composite index on `(studentId, classId, submittedAt)`.

### 2.3 Lesson Queries

#### 2.3.1 Lesson Lookup by Slug and Version

Collection: `lessons`
Filters: `slug == S`, `version == V`
Frequency: Continuous. Every assignment and every submission resolves the lesson.
Scale: Exactly one document.
Performance considerations: Composite index on `(slug, version)` or, equivalently, storage of `(slug, version)` as a compound field that becomes the document's business key. Application-layer cache is aggressive because lesson documents are immutable (Data Model Section 6.4).

#### 2.3.2 Lessons by Grade

Collection: `lessons`
Filters: `grade == G`, `retiredAt == null`
Order: `unit asc`, `slug asc`
Frequency: Moderate. Teacher assignment browser.
Scale: Bounded by curriculum size, currently under 100 per grade.
Performance considerations: Composite index on `(grade, retiredAt, unit)`. `retiredAt == null` is expressed as a missing-field filter, or by storing an explicit `status` field on the lesson (recommended for query clarity).

#### 2.3.3 Lessons by Unit

Collection: `lessons`
Filters: `grade == G`, `unit == U`, `status == published`
Order: `slug asc`
Frequency: Occasional.
Scale: Small.
Performance considerations: Composite index on `(grade, unit, status, slug)`.

#### 2.3.4 Lessons by Standard

Collection: `lessons`
Filters: `standards array-contains standardCode`, `status == published`
Order: `grade asc`
Frequency: Rare. Standards mapping views.
Scale: Small.
Performance considerations: Single `array-contains` index on `standards`. Composite indexes involving `array-contains` are limited to one array field; the platform accepts a client-side sort if needed.

### 2.4 Assignment Queries

#### 2.4.1 Active Assignments in a School

Collection: `assignments`
Filters: `schoolId == S`, `status == published`
Order: `createdAt desc`
Page size: 50 with cursor.
Frequency: Rare. Administrative dashboards.
Scale: Bounded by school size.
Performance considerations: Composite index on `(schoolId, status, createdAt)`.

#### 2.4.2 Assignments by Lesson Across the Platform (deferred)

Reserved for future curriculum-analytics dashboards. Not indexed in Version 1.

### 2.5 Submission Queries

The submission queries defined in Section 2.1 and Section 2.2 are the primary paths. Two additional administrative paths are enumerated here for completeness.

#### 2.5.1 Submissions in a School Over a Time Window

Collection: `submissions`
Filters: `schoolId == S`, `submittedAt >= T1`, `submittedAt <= T2`
Order: `submittedAt desc`
Page size: 50 with cursor.
Frequency: Rare. Administrative and compliance queries.
Scale: Bounded by window, which the caller must keep short.
Performance considerations: Composite index on `(schoolId, submittedAt)`. The strategy explicitly forbids unbounded windows on this query.

#### 2.5.2 Flagged Submissions for a Teacher

Collection: `submissions`
Filters: `teacherId == currentUserId`, `flaggedForReview == true`
Order: `submittedAt desc`
Frequency: Moderate.
Scale: Small.
Performance considerations: Composite index on `(teacherId, flaggedForReview, submittedAt)`.

### 2.6 Audit Event Queries

#### 2.6.1 Recent Activity for an Actor

Collection: `auditEvents`
Filters: `actorUserId == U`
Order: `occurredAt desc`
Page size: 50 with cursor.
Frequency: Rare.
Scale: Bounded by activity.
Performance considerations: Composite index on `(actorUserId, occurredAt)`.

#### 2.6.2 History for a Target

Collection: `auditEvents`
Filters: `targetType == T`, `targetId == I`
Order: `occurredAt desc`
Frequency: Rare.
Scale: Bounded.
Performance considerations: Composite index on `(targetType, targetId, occurredAt)`.

#### 2.6.3 Events in a School Over a Window

Collection: `auditEvents`
Filters: `schoolId == S`, `occurredAt >= T1`, `occurredAt <= T2`
Order: `occurredAt desc`
Frequency: Rare.
Scale: Bounded by window.
Performance considerations: Composite index on `(schoolId, occurredAt)`.

### 2.7 Query Ownership Matrix

Every query above begins with an equality filter on one of: `teacherId`, `studentId`, `classId`, `assignmentId`, `schoolId`, `actorUserId`, or `targetId`. This is not coincidence: it is the enforcement mechanism for Section 1.5. Any future query that does not begin with one of those filters must be reviewed as a candidate anti-pattern (Section 8).

---

## 3. Composite Index Strategy

Firestore builds single-field indexes automatically. Composite indexes must be declared. This section names the composite indexes the platform will require, groups them by collection, and identifies indexes that intentionally will not be created. It does not produce index definitions in JSON; that artifact is downstream and must conform to this section.

### 3.1 Indexes Required

#### 3.1.1 classes

- `(teacherId, status, createdAt desc)` — serves Sections 2.1.1 and 2.1.2.
- `(schoolId, status, createdAt desc)` — serves administrative class listings.
- `(schoolId, joinCode)` — serves join-code lookup during student enrollment, scoped by school to prevent cross-tenant join-code collisions.

#### 3.1.2 enrollments

- `(studentId, status, enrolledAt desc)` — serves Section 2.2.1.
- `(classId, status, enrolledAt asc)` — serves Section 2.1.8.
- `(studentId, classId)` — serves the pre-write existence check that prevents duplicate enrollment.
- `(schoolId, status, enrolledAt desc)` — reserved for administrative roster reports; deferred until first use.

#### 3.1.3 assignments

- `(classId, status, createdAt desc)` — serves Section 2.1.4.
- `(classId, status, availableAt asc)` — serves Section 2.2.2a.
- `(teacherId, status, updatedAt desc)` — serves Section 2.1.5.
- `(teacherId, lessonSlug, createdAt desc)` — serves Section 2.1.9.
- `(schoolId, status, createdAt desc)` — serves Section 2.4.1.

#### 3.1.4 submissions

- `(assignmentId, submittedAt desc)` — serves Section 2.1.6.
- `(assignmentId, flaggedForReview, submittedAt desc)` — serves the flagged variant of Section 2.1.6.
- `(teacherId, status, submittedAt desc)` — serves Section 2.1.7.
- `(teacherId, flaggedForReview, submittedAt desc)` — serves Section 2.5.2.
- `(studentId, submittedAt desc)` — serves Section 2.2.3.
- `(studentId, classId, submittedAt desc)` — serves Section 2.2.5.
- `(studentId, assignmentId)` — serves Section 2.2.4 and the uniqueness check at write time.
- `(schoolId, submittedAt desc)` — serves Section 2.5.1.

#### 3.1.5 lessons

- `(grade, status, unit asc, slug asc)` — serves Section 2.3.2 and 2.3.3.
- `(slug, version desc)` — serves Section 2.3.1 and version resolution when the caller has only the slug.
- `standards array-contains` (single-field) — serves Section 2.3.4.

#### 3.1.6 users

- `(schoolId, role, displayName asc)` — serves administrative user listings.
- `(schoolId, role, status, createdAt desc)` — serves user-provisioning dashboards.

#### 3.1.7 auditEvents

- `(actorUserId, occurredAt desc)` — serves Section 2.6.1.
- `(targetType, targetId, occurredAt desc)` — serves Section 2.6.2.
- `(schoolId, occurredAt desc)` — serves Section 2.6.3.

### 3.2 Indexes Intentionally Not Created

The following indexes are attractive but deliberately not built. Each entry names the temptation, the reason it is rejected, and the alternative.

- `(schoolId, teacherId, ...)` on submissions or assignments. Tempting for cross-teacher administrative dashboards, but every actual dashboard is either teacher-scoped or school-scoped. The pair adds cost without a named consumer.
- `(classId, studentId, ...)` on submissions. `studentId` and `classId` together already determine the assignment set. Queries that need both should query by `assignmentId` (Section 2.1.6) or by `studentId` plus `classId` (Section 2.2.5).
- `(teacherId, classId, ...)` on assignments or submissions. `teacherId` is derivable from `classId` because a class has one teacher. Filtering on `classId` alone is sufficient for teacher-scoped views into a class.
- Global sort by `updatedAt` on submissions. Recently edited submissions across the platform is not a user-facing surface, and enabling it would encourage collection-scanning administrative code.
- `array-contains` composite indexes on lessons combining `standards` with `grade` or `unit`. Firestore permits only one array field per composite index; the platform accepts a small client-side filter to keep the index shape simple.
- Indexes purely for descending time. Firestore treats ascending and descending indexes as distinct; the strategy commits to `desc` on time fields wherever recency is the natural read direction, and does not duplicate the ascending variant unless a specific ascending consumer exists.

### 3.3 Index Naming and Ownership

Every composite index declared in the downstream `firestore.indexes.json` must trace to a named query in Section 2. Indexes without a named consumer are removed on the next quarterly review (Section 9.3). This rule is why Section 2 numbers every query.

### 3.4 Rollup Indexes Reserved

The rollup strategy document will introduce summary collections (working name: `assignmentRollups`, `classRollups`, `schoolRollups`). This document reserves those names and commits that any index on them will be enumerated in this document at the same time the rollup shape is finalized. Composite indexes on rollups are not created before the rollup shape is documented.

---

## 4. Read Optimization

Reads dominate the cost model. This section names the mechanisms that keep reads inexpensive at scale.

### 4.1 Application-Layer Caching

- User document. Read once per session, cached in application memory for the session. Never re-read on route change.
- School document. Read once per session, cached.
- Lesson documents. Immutable after publication (Data Model Section 6.4). Cached indefinitely per version. A cache keyed by `(slug, version)` avoids the majority of lesson reads across a school day.
- Class documents. Cached with a short TTL (minutes) inside a session because they change rarely during a class period.

The application-layer cache is a design commitment, not an implementation detail: the query strategy assumes it exists.

### 4.2 Cursor-Based Pagination

Every list query described in Section 2 pages with a cursor derived from the last document in the previous page. Numeric offsets are forbidden because they are billed as reads for every skipped document. Cursors are also stable across concurrent writes.

### 4.3 Lazy Loading

Teacher dashboards render the class list first, then lazily fetch per-class rollups on demand. Student home pages render enrolled classes first, then lazily fetch per-class assignment lists. This preserves perceived speed and defers reads until the user demonstrates interest.

### 4.4 Incremental Loading and Prefetch

- Teacher review queue prefetches the next page cursor when the current page renders, so scrolling never blocks on a network round trip.
- Student assignment views prefetch the lesson document metadata as soon as the assignment card enters the viewport.

Prefetching is bounded by the caching policy in Section 4.1: it never triggers redundant reads.

### 4.5 Dashboard Summaries

Aggregations are never computed on read (Section 1.9). Dashboards read summary documents produced by the rollup pipeline. When a rollup is unavailable (for example, a class created ten seconds ago), the dashboard shows a "computing" affordance rather than fanning out reads to compute a value inline.

### 4.6 Avoiding Duplicate Reads

- Requests scoped to a class do not re-read the class document once cached for the session.
- Requests scoped to an assignment do not re-read the assignment document during a single submission session.
- Query result documents are consumed as-is; the platform does not re-`get()` a document already returned by a query.

### 4.7 Snapshot Listeners Used Deliberately

Real-time listeners are used only where the user's mental model expects live updates: the teacher review queue during an active class, and a student's own in-progress submission. Listeners on other surfaces are converted to explicit refresh, because each listener charges reads for every change to any document matching the listener and can produce runaway costs.

### 4.8 Bundle-Optional Static Reads

For lesson metadata queries browsed during teacher assignment creation (Section 2.3.2), Firestore bundles are considered as an optimization. If adopted, the bundle is regenerated at each curriculum publication and served through a static file, eliminating repeated reads of the lesson catalog. Not required in Version 1; named here so the option is not forgotten.

---

## 5. Write Optimization

Writes are less frequent than reads but require careful shaping to avoid contention.

### 5.1 Immutable Documents Where Possible

Lessons and finalized submissions are immutable (Data Model Sections 1.3 and 3.7). Immutable documents never contend for writes and can be cached without invalidation logic.

### 5.2 Append-Only Records

Audit events are append only (Data Model Section 3.8). Writes are distributed across document IDs; no single audit document is updated. This eliminates contention entirely.

### 5.3 One Writer per Document

Every document in the model has an identifiable single-writer role at any moment. A submission is written by its owning student (until finalization) or by the platform (finalization). An assignment is written by its owning teacher. A class is written by its owning teacher. Multi-writer contention is not part of the model.

### 5.4 Transactional Updates for Invariants

The narrow set of writes that must respect a cross-document invariant use Firestore transactions:

- Enrolling a student. The write to `enrollments` must occur only if no active enrollment already exists for `(studentId, classId)`.
- Finalizing a submission. The status transition from `submitted` to `finalized` must happen exactly once.
- Rotating a join code. The write to `classes` must invalidate the previous code in the same transaction.

Transactions are scoped narrowly to reduce retry probability.

### 5.5 Server-Side Finalization

Finalization events (submission finalization, assignment closing, rollup emission) are performed by server-side authority rather than client-side writes. This centralizes the write, allows the platform to validate state, and produces an audit event alongside the mutation. The specific server-side surface (Cloud Functions, Cloud Run, or scheduled jobs) is a downstream implementation decision.

### 5.6 Avoiding Fanout Writes

Publishing an assignment does not write a per-student document. Students see the assignment through queries (Section 2.2.2a), not through a duplicated per-student copy. This preserves publication as a single write regardless of class size.

### 5.7 Batched Writes for Bulk Operations

Term-start rostering, bulk class creation, and end-of-year archival are performed with batched writes, bounded to Firestore's per-batch limit and executed by server-side jobs. Bulk operations produce a single audit event summarizing the operation plus per-document audit events when the operation touches ownership fields.

### 5.8 Denormalization at Write, Not on Read

The denormalized fields on submissions and assignments (Data Model Section 12.3) are populated at write time from immutable sources. The write path is the only place these fields are computed. Reads never repair or recompute denormalized fields. This is the discipline that keeps the denormalizations honest.

### 5.9 No Client-Side Timestamps for Ordering

Every timestamp used for ordering (`createdAt`, `submittedAt`, `occurredAt`) is server-authoritative. Client clocks are unreliable, and query ordering that depends on client clocks produces confusing UIs. Server timestamps also prevent trivial time-based tampering by students.

### 5.10 Idempotent Writes

Every write is designed so that a retry is safe. Enrollment creation checks for an existing enrollment. Submission creation uses a stable `(studentId, assignmentId)` key. Finalization writes a status transition, not an unconditional overwrite. Idempotency is a query-strategy concern because it determines whether the read that precedes a write is redundant or load-bearing.

---

## 6. Scaling Review

The Data Model targets hundreds of schools within five years. This section stresses the query strategy against a larger target and identifies mitigations before they are needed.

Assumed scale for this section:

- 500 schools
- 5,000 teachers
- 100,000 students
- 10,000,000 submissions (approximately two years of activity at 100 submissions per student per year, retained live)

### 6.1 Teacher Path

Every teacher query is scoped by `teacherId`. A single teacher's data grows independently of platform size. Queries at 500-school scale are indistinguishable from Version 1 queries. No mitigation required.

### 6.2 Student Path

Every student query is scoped by `studentId`. Same conclusion as Section 6.1. No mitigation required.

### 6.3 Class-Scoped Reads

Teacher review queues query submissions by `assignmentId` (Section 2.1.6). The result set is bounded by class size and does not grow with platform size. No mitigation required.

### 6.4 School-Scoped Administrative Reads

Administrative queries filter by `schoolId`. Result sets grow with school size, not platform size. A single school's activity remains bounded. School-scoped queries with time windows (Section 2.5.1, Section 2.6.3) remain fast because the ordering field is indexed.

### 6.5 Cross-School Platform Analytics

The strategy does not support unbounded cross-school analytics in the operational path. Cross-school analytics is exported to a warehouse (BigQuery is the natural sink because it integrates with Firestore) and served from there. This is a design boundary: the operational database is not the analytics database.

### 6.6 Submissions Collection at 10M Documents

At 10M documents, indexed queries remain fast because Firestore query cost is proportional to the result page, not the collection size. Two concerns require named mitigations:

- Index build time on deploy. Adding a new composite index to the submissions collection at 10M documents can take hours. Mitigation: freeze the submissions index list during high-traffic windows, and add indexes during scheduled maintenance.
- Retention. Live submissions retained forever compound storage cost. Mitigation: after a policy-defined retention window (default: three years), submissions are moved to cold storage or exported and pruned. Rollups retain summary data indefinitely; raw responses are prunable.

### 6.7 Audit Events at Platform Scale

Audit event volume grows with total platform activity. Mitigation: retention policy caps the live collection at 24 months by default; older events are exported to cold storage. The Section 3.1.7 indexes remain valid at any live-collection size because they are always paired with a bounded time window or a specific target ID.

### 6.8 Anticipated Bottlenecks

- Hot join-code lookup at term start. Multiple students may enter the same join code within seconds. The lookup query is read-only and non-contending; the write is a single new enrollment. Bottleneck is at the class document only if enrollment updates a counter on it; Section 5.6 avoids that pattern.
- Assignment publication burst. A teacher publishing to five classes simultaneously produces five assignment writes; no shared document. No bottleneck.
- Rollup computation at end of period. Rollup jobs may momentarily read millions of submissions. Mitigation: incremental rollups triggered by submission finalization write into aggregate documents, so no periodic scan is required. The rollup strategy document is the authoritative treatment.

### 6.9 Cost Ceilings

Because every list query paginates and every dashboard depends on rollups, per-user daily read cost is bounded by session activity, not by data-set size. The strategy is therefore expected to scale cost linearly with active users, not with cumulative content.

---

## 7. Future Compatibility

This section confirms that the query strategy can absorb likely future features without a rewrite.

### 7.1 AI Tutoring and Feedback

AI tutoring sessions and AI feedback documents inherit the same ownership fields as submissions (`studentId`, `classId`, `teacherId`, `schoolId`). New collections adopt the same query shape as their neighbors and require analogous composite indexes named at introduction. No existing indexes change.

### 7.2 Districts

A district rollup layer sits above schools. School-scoped queries continue to work unchanged. District-scoped administrative queries add composite indexes on `(districtId, ...)` for the affected collections. Because `districtId` is added to schools first and denormalized to downstream documents only where a district-scoped query is named, most collections need no new indexes.

### 7.3 Analytics and Warehousing

Cross-cutting analytics ships submissions and audit events to BigQuery via a Firestore export or a change-data-capture pipeline. Warehouse queries are unconstrained by Firestore index shape. Operational queries remain narrow and indexed as described in Section 3.

### 7.4 Standards Reporting

Standards reporting is served by rollups keyed by `(standardCode, classId)` or `(standardCode, schoolId)`. The lesson document already carries `standards`, so the rollup can attribute submissions to standards through the frozen `lessonVersion`. The query strategy commits that standards reporting will be built on rollups, not on live submission scans.

### 7.5 Google Classroom and Canvas Integration

External roster imports write to the reserved `rosters` collection (Data Model Section 2.8) with the same ownership fields as `enrollments`. Query shape is identical: `(schoolId, ...)`, `(classId, ...)`. Reconciliation between rosters and enrollments is a server-side job and does not introduce new operational query patterns.

### 7.6 Teacher-Created Lessons

Teacher-authored lessons share the `lessons` collection with a `source` field discriminator. Existing lesson queries add an equality filter on `source` when needed. Composite indexes gain a `source` prefix at introduction time.

### 7.7 Parent Accounts

Parent accounts read submissions for their linked students. The parent-student relationship lives in a small `relationships` collection queried by `(parentUserId, status)`. Submission reads reuse Section 2.2.3's index. No new submission indexes are required.

### 7.8 Compatibility Summary

Every named future feature introduces new collections and possibly new indexes, but does not require restructuring the indexes enumerated in Section 3. That property is the primary value of this document.

---

## 8. Query Anti-Patterns

The following patterns are forbidden in production code. Each is explained so a future engineer can recognize it under deadline pressure.

### 8.1 Collection Scans

A query without an equality filter on an ownership field will, at scale, degenerate into a scan of the entire collection. This is forbidden even on collections that are currently small. If the query is needed for a use case, the use case is served by a rollup or a warehouse export, not by an operational scan.

### 8.2 Client-Side Filtering of Large Result Sets

Fetching 1,000 submissions to display 20 that match a filter is forbidden. The filter must be expressed as a query clause. If Firestore cannot express the filter (for example, negative match on multiple fields), the strategy is revisited: either the data shape changes, or the surface is redesigned.

### 8.3 Ownership-Agnostic Lookups

Queries that begin with a non-ownership filter (for example, "all assignments with status published") are forbidden in operational code. Section 2.7 makes this rule enforceable by review: every operational query must trace to a named query in Section 2, and every named query begins with an ownership filter.

### 8.4 Unbounded Time Windows

School-scoped and audit queries with unbounded time windows (Section 2.5.1, Section 2.6.3) are forbidden. Callers must supply a bounded window. UIs that expose a time picker enforce a maximum window length.

### 8.5 Real-Time Listeners on Broad Queries

A snapshot listener attached to "all submissions in a class" fires on every write to every matching document. This is not the intended cost model for real-time reads. Listeners are permitted only on narrow queries (Section 4.7).

### 8.6 Repeated Point Reads Inside a Loop

Iterating a query result and calling `get()` on each returned document is forbidden. Every field required to render the result must be present on the returned document, either directly or through a well-defined denormalization (Data Model Section 12.3). If a field is missing, the fix is a data-model change, not a per-document lookup.

### 8.7 Client-Composed Query Predicates

Query predicates are never composed from user input strings. Every predicate the platform issues is authored in code and reviewed against Section 2. This eliminates a class of indexing surprises and a class of security exposures at once.

### 8.8 Cross-Collection Joins Emulated in Code

A UI that requires joining two collections is a signal that a denormalization is missing or that a rollup should exist. Emulating the join in application code, even once, is forbidden because it becomes a template for future code and quietly costs many reads.

### 8.9 Numeric Offsets

`offset` and `limit-with-offset` patterns are forbidden (Section 4.2). Cursors only.

### 8.10 Aggregations Computed on Read

Class averages, completion counts, and score histograms are never computed by scanning submissions on read (Section 1.9). Rollups only.

---

## 9. Operational Guidance

This section describes how the strategy is maintained.

### 9.1 Slow-Query Monitoring

Firestore latency and read-count metrics are surfaced per collection and per index. Any query whose median latency exceeds a defined threshold or whose 95th-percentile read count exceeds the page size is flagged for review. The review either identifies a missing index, an anti-pattern, or a legitimate scale event.

### 9.2 Quarterly Index Review

Every quarter, the platform team compares the deployed composite index list against Section 3 of this document. Deviations require either an index removal or an update to this document. Undocumented indexes drift toward becoming forgotten dependencies; the review prevents that.

### 9.3 Removing Unused Indexes

An index that no named query in Section 2 consumes is removed on the next quarterly review, subject to a two-week grace period during which a consumer can be identified. The write-amplification cost of an unused index is not trivial at scale; unused indexes are a cost, not a hedge.

### 9.4 Testing New Query Patterns

A new query is added by:

1. Naming it in Section 2 with frequency, scale, and performance considerations.
2. Naming the required indexes in Section 3.
3. Reviewing that the query begins with an ownership filter and paginates.
4. Deploying indexes to the staging environment before merging code that issues the query.

Query patterns are not deployed to production before the indexes they require have finished building.

### 9.5 Performance Audits

Twice a year, the platform team performs a full audit:

- All Section 2 queries are replayed against a representative dataset.
- Latency, read count, and index-hit rate are measured.
- Any degradation is reconciled against activity growth and index changes.
- The audit report is filed against this document.

### 9.6 Load Testing New Features

Before any feature that introduces a new query pattern ships, it is exercised against a synthetic dataset at the Section 6 scale. Load testing is not optional for features that touch the submissions collection, because that is the highest-volume surface.

### 9.7 Deployment Discipline for Index Changes

Index additions are deployed independently of code that consumes them. Indexes are deployed first, monitored for build completion, then the consuming code is rolled out. Rollbacks preserve indexes rather than removing them, because a rollback plus removal is a two-failure sequence that is easy to conflate with an outage.

### 9.8 Documentation Currency

This document is treated as canonical. Any change to a Section 2 query, a Section 3 index, or a Section 8 anti-pattern requires a pull request that updates this document in the same change. Query strategy that lives only in code becomes tribal knowledge within a year; this document prevents that.

---

## 10. Readiness Assessment

Would I approve this query and indexing strategy for implementation if I were personally responsible for maintaining this Firestore database for the next five years?

Yes, subject to two dependencies that are already named in adjacent documents.

### 10.1 Dependency One: Rollup Strategy Document

Sections 1.9, 4.5, 6.6, 6.8, 7.4, and 8.10 depend on the rollup strategy document (Data Model Section 13.1). This document names the read points that will consume rollups. The rollup strategy document must define:

- The rollup collections and their shape.
- The trigger that produces each rollup.
- The refresh cadence and staleness tolerance.
- The retention policy for raw submissions once rollups exist.

Until the rollup strategy is documented, dashboards that depend on aggregates must be scoped to individual assignments (Section 2.1.6) or to short lists (Section 2.1.7), both of which are already indexable without rollups. This is a graceful degradation, not a blocker for implementation.

### 10.2 Dependency Two: Denormalization Discipline Checklist

Section 5.8 depends on the denormalization discipline checklist (Data Model Section 13.3). The composite indexes on submissions (Section 3.1.4) are safe only because the denormalized fields are immutable. If a future feature is allowed to mutate `classId` on an assignment, several indexes silently return stale data.

The checklist must therefore appear in the design-review process before any feature that touches ownership fields on assignments or submissions is scoped. This document reinforces Data Model Section 13.3 by making it concrete: the composite index list is the artifact that quietly breaks if the checklist is not enforced.

### 10.3 Approval

Subject to those two named dependencies, the query and indexing strategy in this document is approved as the canonical strategy for LyfeLabz Version 1 and is expected to remain the canonical strategy through the five year horizon.

Approval assumes:

- Every operational query traces to a named query in Section 2.
- Every deployed composite index traces to Section 3.
- Every forbidden pattern in Section 8 is caught in review before it reaches production.
- The rollup strategy and denormalization discipline documents are completed as separate deliverables before the platform scales beyond a single school.

With those assumptions in place, this strategy supports the platform through the transitions to districts, external LMS integration, AI-driven surfaces, standards reporting, and multi-year analytics without a structural rewrite.

---

End of document.
