# LyfeLabz Class Snapshot Experience

Status: Canonical product specification for the class Snapshot surface.
Companion documents: TEACHER_JOURNEY.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, ASSIGN_EXPERIENCE.md, PRESENT_MODE_ARCHITECTURE.md, SNAPSHOT_ARCHITECTURE.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md.

This document is a product design specification. It is not an architecture specification, a sprint plan, or an implementation guide. It defines what Snapshot should feel like from the teacher's perspective. Where a moment implies an architectural implication, that implication is left to `SNAPSHOT_ARCHITECTURE.md` and to the sprint specification that owns the surface. Every principle here defers to the certified platform architecture in every case of conflict.

Snapshot is the first thing a teacher sees when she opens a class. It is the surface she looks at more often than any other surface inside the Teacher Platform. This document names the shape that surface should take.

---

## 1. Purpose

Snapshot exists so a teacher can absorb what she needs to know about a class in the seconds she has between one instructional moment and the next.

Snapshot is the class-scoped expression of "preparation before analytics." It sits at the top of every class workspace. It is the first surface a class opens on, before any spreadsheet, before any assignment detail, before any data.

If a future sprint proposes a new teacher surface that answers a between-classes or during-class question, that surface must first be measured against Snapshot. A question Snapshot already answers does not need a second surface. A question Snapshot cannot answer without becoming a dashboard is a signal to reconsider the question, not to make Snapshot heavier.

Snapshot is the teacher's between-moments surface. That is its only job.

### Product Rules

- Snapshot is the first surface every class opens on.
- Snapshot is a between-moments surface. It is not a report and it is not a dashboard.
- New teacher surfaces that answer a between-classes or during-class question must reconcile with Snapshot before proposing an alternate surface.
- This document complements the certified architecture. It never overrides it.

---

## 2. Product Philosophy

LyfeLabz complements Google Classroom and PowerSchool. It does not replace them.

Google Classroom remains the assignment and communication hub where it is in use. PowerSchool remains the gradebook of record. LyfeLabz is the instructional companion between them. Snapshot inherits that posture: it is not a gradebook, it is not a communication surface, and it is not an assignment-management surface. It is a preparation surface that helps a teacher walk into her next moment ready.

Teachers prepare. Teachers teach. Teachers move on.

That is the shape of the day Snapshot is designed for. A teacher who opens Snapshot is between the door and the whiteboard, or between the whiteboard and the next block, or between the last bell and the parent email she is about to answer. She has seconds. She needs answers. She does not need more work.

Snapshot exists to reduce cognitive load, not to increase it.

Every element on the surface is measured against a single question: does this element let the teacher walk into her next moment better prepared than she was a second ago? Elements that pass belong. Elements that do not are noise, and noise on a preparation surface is a failure mode, not a feature.

Snapshot should feel like glancing at a seating chart, not like opening a dashboard. A seating chart is understood at a glance because it is spatial, familiar, and low-density. Snapshot inherits that posture: familiar, low-density, understood at a glance, and immediately actionable in the teacher's own way.

The teacher decides what to do with what Snapshot tells her. LyfeLabz never nags a student on her behalf, never emails a parent for her, and never suggests an intervention. Snapshot gives the teacher information. The teacher gives the classroom judgment.

### Product Rules

- Snapshot complements Google Classroom and PowerSchool. It does not compete with them.
- Snapshot exists to reduce cognitive load.
- Every element on the surface earns its place by helping the teacher walk into her next moment better prepared.
- Snapshot informs. The teacher decides.
- Snapshot never acts on the teacher's behalf. It does not email, notify, nag, or intervene.
- Snapshot should feel like a seating chart, not a dashboard.

---

## 3. When Teachers Use Snapshot

Snapshot is used in short, repeated moments across the school day. Its shape is derived from those moments.

**Before class.** The teacher opens Snapshot in the two or three minutes before students walk in. She is standing near the door, coffee in one hand, laptop open on the podium. She wants to know whether the assignment she scheduled this morning actually released, and whether the class is in the shape she expects. She does not want a report.

**During attendance.** The teacher takes attendance in PowerSchool. She glances at Snapshot to reconcile who she sees in the room against who has already opened today's work. She does not need Snapshot to take attendance for her; PowerSchool does that. She needs Snapshot to answer a different question at the same time.

**While students are working.** The teacher circulates. Between conversations with students, she returns to her podium and glances at Snapshot. She wants to know who is stuck, who has already finished, and who has not yet started. She uses that information to decide where to walk next.

**After Present Mode.** The teacher exits Present Mode. The Teacher Workspace returns to exactly where she left it. If she was on a class, that class opens on its Snapshot. She scans it before returning her attention to the room.

**After collecting assignments.** The teacher wants to know whether the last assignment landed for this class. She opens the class. Snapshot answers that question at the top of the surface. She does not need to open the spreadsheet to see the shape of the class's engagement.

**Between class blocks.** The four minutes between blocks are among the most valuable in the day. Snapshot is designed to be scanned inside those four minutes. If it cannot be scanned inside those four minutes, it is too heavy.

**End of day.** The teacher opens Snapshot once more. She confirms that a student she noticed earlier eventually engaged, or that the class ended today in the shape she expected. Snapshot is often enough on its own at the end of the day. She rarely needs the spreadsheet.

### Product Rules

- Snapshot is used in moments measured in seconds, not minutes.
- Snapshot is designed for the four-minute passing period as its hardest use case.
- Snapshot is used before class, during class, and after class. Each use is a glance, not a study.
- Snapshot never asks the teacher to attend to it. She attends to the room; Snapshot supports her attention.

---

## 4. Teacher Questions Snapshot Should Answer

Snapshot answers a small, closed set of teacher questions. Every element on the surface exists because it helps answer one of them.

- Who is here today and who is not?
- Who has not opened today's assignment yet?
- Who still needs help?
- Who is stuck on the same idea?
- Who has already finished?
- Who has fallen behind since I last looked?
- Who should I check in with next?
- Did the assignment I scheduled this morning actually release?

Snapshot does not answer:

- How is the class performing this quarter?
- What is this student's mastery trend across the year?
- What percentage of standards have been demonstrated?
- Who is my highest performing student?
- What is my class average?
- Who should be regrouped for differentiation?
- What is my longitudinal engagement rate?

Analytics language is deliberately absent from Snapshot. Snapshot is a preparation surface, not a performance-review surface. The distinction is load-bearing: the questions Snapshot answers are questions a teacher asks about right now. The questions Snapshot does not answer are questions a teacher asks about a period of time. Right now is a preparation question. A period of time is an analytics question. Preparation belongs to Snapshot. Analytics belongs one level deeper, or elsewhere entirely.

The set of answered questions may grow as the platform grows. New questions are added to Snapshot only when they can be answered inside the same seconds-long glance without changing the shape of the surface. Questions that cannot be answered in a glance belong to the spreadsheet-style class workspace beneath Snapshot, or to a future surface owned by the Analytics phase.

### Product Rules

- Snapshot answers right-now questions. It does not answer period-of-time questions.
- The set of answered questions is small and closed by design.
- New questions are added only when they can be answered inside the same glance.
- Analytics vocabulary is prohibited on the Snapshot surface.

---

## 5. Design Principles

Snapshot is disciplined by a small set of design principles that keep it a preparation surface no matter how the platform grows around it.

**Understood in five seconds.** A teacher who has never seen Snapshot before should understand it in five seconds. A teacher who uses it every day should absorb it in less than one. No element on the surface may require training, tooltips, or explanation. If an element needs a legend, it does not belong on Snapshot.

**Seating-chart posture.** Snapshot should feel like glancing at a seating chart. Familiar, spatial, low-density, low-motion. It should not feel like a dashboard, an inbox, or a management console. Density is the enemy. White space is a feature.

**Above the fold.** Snapshot fits inside a single viewport at every supported breakpoint. There is no scroll to read Snapshot. Scrolling is where the spreadsheet lives, one level deeper. A Snapshot that requires scroll to answer its own questions is not a Snapshot.

**No charts unless they reduce effort.** Charts are permitted only when they demonstrably reduce cognitive effort compared to the same information rendered as counts, chips, or short lines of text. A bar chart that shows something a number already showed is noise. A sparkline that reveals a shape a number cannot is a candidate for inclusion. The default answer to "should we add a chart?" is no.

**No unnecessary clicks.** The primary Snapshot experience is a scan. Clicks are permitted only when they take the teacher into the spreadsheet-style workspace beneath Snapshot, or into a lesson the teacher wants to review. Snapshot never opens a modal over itself. Snapshot never asks the teacher to configure it.

**Preserve context.** Switching between classes preserves the shape of the Snapshot. Every class's Snapshot uses the same layout, the same vocabulary, and the same organization. A teacher who reads first block's Snapshot has already learned second block's Snapshot.

**Names as spatial anchors.** Where a Snapshot element identifies students, it identifies them by name in a stable order. Names are not sortable-by-metric on the primary surface. Sorting by metric is a spreadsheet behavior. Stable order is a seating-chart behavior.

**No private data on projection surfaces.** Snapshot is not a projection surface. It is a teacher-workspace surface. Even so, Snapshot never renders accommodations, private notes, or supports on any element it displays. Those live in Settings. The projector-safety contract for Present Mode applies to Snapshot's design posture: never render on a Snapshot what a projector might reveal.

**Refresh is quiet.** Snapshot updates without demanding attention. New information arrives without shaking the layout, without flashing counts, and without pulling focus from wherever the teacher is looking. Motion is used sparingly and only where it communicates change more clearly than stillness.

**Empty states are legible.** A class with no assignment surfaced today, a class with no students yet, and a class in an unusual state all render a plain, obvious Snapshot that names the situation and offers the one right next action. A blank Snapshot is a defect. A quiet Snapshot is a feature.

**LyfeLabz remembers preferences.** Where Snapshot exposes teacher-configurable views, the configuration is remembered per teacher, not per class and not per session. This mirrors the memory posture already established by the Assign Experience.

**One canonical Snapshot.** There is one Snapshot shape across every class the teacher owns. Divergent per-class Snapshots are prohibited. Grade-specific or block-specific variations are handled by data, not by parallel implementations.

### Product Rules

- Snapshot is understood in five seconds and absorbed in less than one.
- Snapshot fits above the fold. Scrolling belongs to the spreadsheet.
- Charts are the exception, never the default.
- Snapshot never asks the teacher to configure it in the moment.
- Every class's Snapshot uses the same layout, vocabulary, and organization.
- Snapshot never renders accommodations, private notes, or supports.
- Motion is used sparingly and only where stillness would be less clear.
- Empty states are legible, plain, and offer the one right next action.
- There is one canonical Snapshot shape across every class.

---

## 6. Snapshot Inside the Class Workspace

Snapshot is the first tab, the first pane, and the first surface inside every class workspace. The class workspace is the surface that opens when a teacher selects a class from the left-side panel of the Teacher Workspace, per Teacher Experience Philosophy §3.3.

Selecting a class opens on Snapshot. Snapshot is not reached by clicking a Snapshot control on a deeper surface. It is the surface every class opens on.

The spreadsheet-style workspace named in Teacher Journey §5 and §6 and Teacher Experience Philosophy §3.6 sits one level deeper than Snapshot. A teacher who needs the spreadsheet reaches it from Snapshot with a single gesture. A teacher who does not need the spreadsheet never sees it.

The relationship is compositional. Snapshot is the between-moments surface. The spreadsheet is the planning-period surface. Preparation before analytics is expressed structurally in that order.

Snapshot never becomes a switchable view of the spreadsheet, and the spreadsheet never becomes a mode of Snapshot. They are separate surfaces that share the same class context.

Snapshot never redirects the teacher to a different class, a different workspace, or a different application. Selecting a specific student from a Snapshot element opens that student's row in the class workspace, still inside the same class. Selecting an assignment reference on Snapshot opens the assignment column inside the same class workspace. Every navigation from Snapshot stays inside the class the teacher opened.

### Product Rules

- Snapshot is the surface every class opens on.
- The spreadsheet-style workspace sits one level deeper than Snapshot.
- Snapshot and the spreadsheet are separate surfaces, not modes of each other.
- Every navigation from Snapshot stays inside the same class workspace.

---

## 7. Relationship to Adjacent Teacher Surfaces

Snapshot composes with the other certified teacher surfaces. It does not overlap with them.

**Curriculum.** Curriculum is a control panel for surfacing lessons across every class. Snapshot is a preparation surface for one class. Curriculum owns what is available. Snapshot reports on what has happened with what was made available. Snapshot never modifies availability. The Assign Experience remains the single canonical origin of assignment records; Snapshot reads, never re-creates.

**Assign Experience.** The Assign Experience is the one-dialog day for scheduling. Snapshot reads the outcome of that scheduling for one class, at a glance. When Snapshot references an assignment, it references the record produced by the Assign Experience. Snapshot exposes no alternate assign control. Snapshot does not reopen the Assign dialog. If a teacher decides she needs to change an assignment based on what Snapshot showed her, she uses the Assign Experience through its own entry points on the curriculum surface.

**Present Mode.** Present Mode is a structurally separate presentation surface that never loads teacher-scoped data. Snapshot never appears in Present Mode. Snapshot never links into Present Mode. Present Mode entry lives on the left-side panel, not on Snapshot. The privacy contract that keeps Snapshot free of accommodations is the same posture that keeps Present Mode free of every teacher-scoped signal.

**Settings.** Accommodations, private student supports, and teacher preferences live in Settings. Snapshot never renders any of them. A teacher who needs to reference a private accommodation opens Settings; she does not find it on Snapshot.

**Class workspace (spreadsheet).** The spreadsheet-style workspace lives one level deeper than Snapshot and is described in Teacher Journey §5 and §6 and Teacher Experience Philosophy §3.6. Snapshot never duplicates a spreadsheet capability. The spreadsheet never duplicates a Snapshot capability. They compose.

**Google Classroom and PowerSchool.** Snapshot never reads from Google Classroom and never writes to Google Classroom. Snapshot never posts a grade, never records attendance, and never mutates a PowerSchool record. Snapshot lives alongside those tools. It does not integrate with them. When the ratified LMS integration architecture (`LMS_INTEGRATION_ARCHITECTURE.md`, PDR-019) is implemented, LMS state (connection status, LMS class names, LMS topics, publication outcomes, LMS roster deltas) remains a Settings concern, not a Snapshot concern; Snapshot is not amended by the LMS phase.

### Product Rules

- Snapshot reads. It does not create, modify, or reopen assignments.
- Snapshot has no Present Mode entry point.
- Snapshot never renders accommodations or private notes.
- Snapshot never duplicates a spreadsheet capability, and the spreadsheet never duplicates a Snapshot capability.
- Snapshot does not integrate with Google Classroom or PowerSchool.

---

## 8. Things Snapshot Should Never Become

Snapshot is at continuous risk of becoming something it is not. The following list is load-bearing. It names the shapes Snapshot must never take, so that a future sprint proposing any of them is measured against a written rule.

Snapshot must never become:

- **A long-term analytics surface.** Longitudinal views across weeks, quarters, or school years belong to the Analytics phase or to a future surface. Snapshot answers right-now questions only.
- **A teacher evaluation tool.** Snapshot never renders a metric that would be used to evaluate a teacher's practice. That is not the platform's job and it is not Snapshot's job.
- **A student ranking system.** Students are never sorted by score, by engagement, or by any composite metric on Snapshot. Names are anchors, not leaderboard positions.
- **An administrative reporting surface.** Administrators do not read Snapshot. Snapshot is a teacher surface for one teacher's class. School and district rollups are Analytics-phase concerns, and Administrator Platform concerns.
- **A data warehouse.** Snapshot never becomes an export target, a pivot table, or a query builder.
- **A Power BI-style dashboard.** Density, filters, cross-filters, drill-through views, and configurable widgets are dashboard behaviors. Snapshot rejects them.
- **A behavior tracking platform.** Snapshot never records or renders behavioral signals about a student that are not evidence of engagement with a LyfeLabz lesson. LyfeLabz is not a behavior tool.
- **A gradebook replacement.** PowerSchool is the gradebook of record. Snapshot never computes a grade, never posts a grade, and never displays a grade of record. Points earned on a LyfeLabz assignment are instructional evidence, not a report card.
- **A learning management system.** Assign, submit, review, communicate, notify, and grade in one place is an LMS shape. LyfeLabz declines that shape by design. Snapshot does not become the surface that quietly assembles it.
- **A notification hub.** Snapshot never sends email, never sends a push notification, and never surfaces a list of platform-generated messages. Snapshot is a glance, not an inbox.
- **A recommendation engine.** Snapshot never suggests interventions, never proposes groupings, and never nudges the teacher to take a specific action with a specific student. Snapshot informs. The teacher decides.
- **A configuration surface.** Snapshot is not configured in the moment. Preferences that affect Snapshot live in Settings, are remembered, and are rarely revisited.
- **A parent-facing surface.** Parent access is a Future Extension. Snapshot is not the surface that eventually opens to parents.
- **A projection surface.** Snapshot is not safe to project. Present Mode is the surface designed for projection.

Every item in this list has a common origin: each is a shape that peer platforms have grown into over time. LyfeLabz declines them by writing them down.

### Product Rules

- The list of shapes Snapshot must never become is load-bearing and permanent.
- A sprint proposal that pushes Snapshot toward any of these shapes is a signal to reconsider the proposal.
- Adding a shape to Snapshot is not a matter of feature addition; it is a matter of identity, and identity requires an amendment to this document before implementation.

---

## 9. Future Expansion

The following possibilities are named so they are not silently invented later. Each is intentionally out of scope for the initial Snapshot build. Each is a candidate for later consideration, and each must be measured against Section 8 before it is scheduled.

**Cross-block glance.** A teacher who teaches multiple blocks of the same grade may eventually benefit from a Snapshot that compares blocks at a glance without becoming a dashboard. This is not proposed here. If it is scheduled, it must remain a preparation surface, not a comparison report.

**Same-lesson stuck signal.** A signal that shows when many students in the class are stuck on the same idea inside the same lesson. Currently answered as an individual right-now question ("who is stuck?"). If the same-idea aggregation becomes valuable, it must remain glanceable and remain free of analytics vocabulary.

**Read-only Snapshot for coaches or co-teachers.** A future co-teaching model may benefit from a shared Snapshot. This is deferred to the Teachers domain and to a future co-teaching architecture pass. It requires its own decision record.

**Historical Snapshot.** A Snapshot as it looked yesterday, or last week. This edges into analytics vocabulary and is deferred to the Analytics phase. If Snapshot ever gains a "yesterday" view, that view must remain a preparation surface for a teacher walking into today, not a performance report for a teacher looking backward.

**Snapshot on mobile.** The Teacher Platform is mobile-first by architectural mandate. Snapshot must work on a phone from day one. Additional mobile-specific behaviors (larger tap targets, one-column layout under 480px, and quiet-hours behavior) are refinements handled inside the same canonical Snapshot shape.

**Snapshot as a home surface.** A future teacher-home surface that shows a rolled-up preparation view across every class the teacher teaches today. Attractive in principle. Prohibited unless it can preserve the seating-chart posture at multi-class scale, which is a hard design problem and requires its own specification pass.

**AI-assisted preparation.** A future capability that summarizes what Snapshot already renders in natural language. Deferred to the certified AI decision path and to its own architecture pass. AI never becomes load-bearing for the Snapshot experience.

**Snapshot exports.** Prohibited. Export is a data-warehouse behavior. Snapshot informs the teacher in the moment; it does not become a source of exportable records. If a stakeholder needs an export, the Analytics phase is the correct surface.

Everything named as future expansion is honestly future. If a proposed feature cannot locate itself inside a moment named in Section 3 and cannot preserve every principle in Section 5, that is a signal to reconsider the feature, not to reshape Snapshot.

### Product Rules

- Future expansion is measured against Sections 3, 4, 5, and 8 before it is scheduled.
- Snapshot must work on mobile from day one.
- Snapshot exports are prohibited.
- AI never becomes load-bearing for Snapshot.
- A future capability that cannot preserve the seating-chart posture is a candidate for reconsideration, not for inclusion.

---

*End of Class Snapshot Experience. This document defines what Snapshot should feel like. It does not define implementation. Every principle here defers to the certified architecture, and every future Snapshot-related sprint must reconcile its surface with the moments described above.*
