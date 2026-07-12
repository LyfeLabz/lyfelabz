# LyfeLabz Teacher Journey

Status: Canonical product narrative.
Companion documents: TEACHER_EXPERIENCE_PHILOSOPHY.md, PRESENT_MODE_ARCHITECTURE.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, IDENTITY_AND_ONBOARDING_SPECIFICATION.md.

## Sprint 9D Reconciliation Notice

The onboarding and teacher-workspace moments in this narrative are subordinate to `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` and PDR-024. Apply the following while reading:

- **First-time verified teachers receive an optional, non-blocking Welcome Guide, not a setup wizard.** The teacher's goal at first sign-in is to prepare tomorrow's lesson, not to configure software.
- **The Teacher Workspace is not a Learning Management System.** No calendar, planner, curriculum-mapping tool, gradebook, messaging system, recommendation engine, or analytics dashboard is introduced by the pilot.
- **Activation and publication are separate.** Publication sends the assignment to Google Classroom; activation controls access inside LyfeLabz.
- **Google Classroom remains the assignment hub for LMS-linked classes.** LyfeLabz never asks a student to check a second assignment list.
- **Calm software.** No email, push, marketing, or engagement notifications.

Where the narrative and the specification conflict, the specification controls.

---

## Sprint 9C Reconciliation Notice

The identity, verification, class creation, and onboarding moments in this narrative are subordinate to `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` and PDR-023. Apply the following while reading:

- Class creation lives in the `Classes` workspace under `+ Add Class`, offering exactly two options: **Import from Google Classroom** or **Create Class Manually**. `Settings` is never used for class creation.
- Google Classroom is the preferred onboarding path. Join codes exist only for manual classes.
- Teacher verification prefers a one-time institution-bound verification code; the Request Teacher Access workflow is the fallback. Verification is completed once and then becomes invisible.
- The global header is uniform across surfaces. Identity is never hidden inside the hamburger menu.

Where the narrative and the specification appear to conflict, the specification controls.

---

This document is a narrative. It is not an architecture specification, a sprint plan, or an implementation guide. It describes what it should feel like to teach with LyfeLabz across an ordinary school day. Every principle it names defers to the certified architecture. Where a moment implies an implementation detail, that detail is left to the sprint specification that owns the surface.

---

## 1. Purpose

The Teacher Journey exists so future contributors can understand why the Teacher Workspace was shaped the way it was.

The Teacher Platform is not a dashboard we are decorating with features. It is a companion that a science teacher opens between the copier and the bell, keeps in a browser tab through six classes, and closes at the end of the day without ever feeling that it took time away from teaching.

If a future sprint proposes a surface, a control, or a workflow, it should be measured against the moments in this document. A feature that fits naturally into one of these moments belongs. A feature that requires a teacher to change how their day already works probably does not.

The document is deliberately concrete. It follows one teacher through one day. That teacher is a composite drawn from the Grade 6 and Grade 7 classroom modes already encoded in the repository, and from the workflow decisions recorded in TEACHER_EXPERIENCE_PHILOSOPHY.md and TEACHER_PLATFORM_DOMAIN_ROADMAP.md.

### Product Rules

- Teacher-facing decisions are validated against a real moment in a teacher's day, not against a competitor's feature list.
- A feature that cannot be located inside this journey is a candidate for removal, not a candidate for a new surface.
- This document complements the certified architecture. It never overrides it.

---

## 2. Core Philosophy

Teachers already know what they are teaching.

They arrive at school with a scope and sequence in mind, a memory of where their last class ended, and a list of small logistical decisions to settle before students walk in. LyfeLabz is not there to plan their instruction. It is there to make the logistics of delivering that instruction fast, predictable, and unobtrusive.

Curriculum is the teacher's home. Everything else is a supporting surface.

The Teacher Platform manages instruction. Canonical LyfeLabz delivers instruction. Present Mode is the moment those two meet in front of a class. Analytics, when they arrive, sit beneath a Snapshot that tells the teacher what they actually need to know before the door opens.

LyfeLabz complements Google Classroom and PowerSchool. It does not compete with them. A teacher should be able to move between Gmail, Google Classroom, PowerSchool, their agenda slides, and LyfeLabz throughout the day without feeling that any single tool is asking them to abandon the others.

Preparation comes before analytics. A teacher's day is a sequence of preparations, not a sequence of reports. The Snapshot before a class is more valuable than the spreadsheet after it.

Defaults reflect the most common classroom workflow and remain easy to override. The platform remembers preferences instead of guessing at them. Teachers stay in control of scheduling. LyfeLabz never assumes today's schedule on a teacher's behalf.

### Product Rules

- Curriculum is the primary landing experience. The teacher's home is a curriculum, not a dashboard.
- The Teacher Platform manages instruction. Canonical LyfeLabz delivers it. The two surfaces stay structurally distinct.
- Preparation comes before analytics.
- Defaults reflect the common case. Overrides are one gesture away.
- The platform remembers preferences instead of making assumptions.
- Teachers keep control of scheduling. The platform does not decide when today begins.
- Google Classroom and PowerSchool remain the district-owned hubs. LyfeLabz complements them.

---

## 3. Before the First Bell

It is 7:12 a.m. The teacher is at her classroom desk with a coffee. Her laptop has four tabs already open: Gmail, Google Classroom, PowerSchool, and the agenda slides she keeps for the week. She opens LyfeLabz as a fifth tab.

She does not want a welcome screen. She does not want a training video. She wants the curriculum.

The Curriculum landing page loads. It is recognizable. It looks like LyfeLabz. Grade 6 and Grade 7 lessons appear as familiar lesson cards, organized the way she has organized them in her head. She sees at a glance where instruction was yesterday and where it needs to be today.

She knows her plan. First block is Grade 7, mid-Ecosystems. Third and fourth blocks are Grade 6, opening Wave Behavior. She does not need LyfeLabz to tell her that. She needs LyfeLabz to make today's lessons available to her students before students arrive.

She opens the assignment dialog. One dialog. Not a wizard, not a sequence of screens. The dialog shows each of her classes as an independently configurable row. The default assignment date is Today. She does not have to type today's date and she does not have to reconfirm it. Each row shows a release time she can accept or change.

She sets the first block Grade 7 lesson to release at the start of first block. She sets the Grade 6 blocks to release just before third block. She does not want the Grade 6 assignment to appear in Google Classroom while the Grade 7 class is still working, and LyfeLabz does not force her to make that trade-off.

She confirms once. The dialog closes. The dialog does not congratulate her.

She notices that the classes she prefers to schedule first appear at the top of the dialog. That is not a coincidence. LyfeLabz remembered a preference she set weeks ago. She has forgotten she set it. That is the correct feeling.

She switches back to Gmail. A parent has emailed about accommodations for a student who transferred in last week. She replies. She switches to PowerSchool to enter a grade she forgot to record yesterday. She switches back to LyfeLabz. Her workspace is exactly where she left it. Nothing has reset. Nothing has expired her session on her.

### Product Rules

- The primary landing experience is the curriculum, not a dashboard.
- Scheduling for the whole day happens in one dialog. Each class is independently configurable inside that dialog.
- The default assignment date is always Today, and never has to be re-entered.
- Release time is a teacher decision every day. LyfeLabz does not assume today's schedule.
- The dialog remembers preferences (class order, common release times) without asking again.
- LyfeLabz stays open as one tab among many. It does not fight for focus.
- Nothing in the workspace resets while the teacher is in another tab.

---

## 4. Teaching a Lesson

The bell rings. First block Grade 7 walks in.

The teacher moves through her opening routine at the whiteboard. She does not need LyfeLabz for the first six minutes of class. When she is ready to project the lesson, she clicks Present Mode.

The screen changes. The Teacher Workspace is gone. The canonical LyfeLabz curriculum page fills the projector. It looks exactly like the curriculum a student sees on their own device, because it is exactly that curriculum. The grade and topic filters work the way they always have. She browses to today's Ecosystems lesson. She opens it. The lesson looks like a LyfeLabz lesson, because it is one.

She does not see her students' names on the projected screen. She does not see any scores. She does not see accommodations. She does not see teacher notes. She does not see an activation control. She sees a lesson.

That is not a coincidence either. Present Mode is a structurally separate surface. It cannot leak teacher-scoped data because it never loads teacher-scoped data. The classroom projector is safe by construction, not by conditional rendering.

She teaches. She scrolls through the Explore section. A student asks a question about a related lesson in Grade 8. She uses the grade filter and shows the related resource for a minute. She returns to today's lesson. Present Mode does not restrict what she can browse. It only restricts what it can expose.

Ten minutes before the bell, she exits Present Mode. The teacher workspace returns exactly where it was, on the same class, in the same tab. She had never really left the workspace. She had just handed the projector a safer, simpler version of the same curriculum.

### Product Rules

- Present Mode launches the canonical LyfeLabz experience. It does not duplicate it.
- Present Mode is a structurally separate surface. Privacy is a property of the boundary, not of a rendering condition.
- Present Mode never loads names, scores, accommodations, notes, or activation controls.
- All curriculum resources remain browsable in Present Mode, regardless of activation.
- Entering and exiting Present Mode does not disturb the teacher's workspace context.
- The teacher may enter and exit Present Mode many times during a day. That is the intended pattern.

---

## 5. Between Classes

The bell rings. The teacher has four minutes.

She switches to the Teacher Workspace tab and clicks the class she just taught. She does not want a spreadsheet. She wants to know whether the assignment landed.

The class opens on a Snapshot. The Snapshot answers exactly one question. What do I need to know before I teach this class again, or before the next class walks in.

Who finished the last assignment. Who did not. Which students hit a wall inside the lesson. Whether anything is worth flagging before the next block.

That is all. It is not a report. It is not analytics. It fits above the fold and it can be absorbed in the time it takes to erase the whiteboard.

If she wants more, she can go one level deeper. The spreadsheet-style class workspace is there. Students as rows, assignments as columns, scores and other data behind each cell. She rarely opens it between classes. She almost always opens it during her planning period.

The Snapshot is the first thing a class ever shows her. The spreadsheet is the second. That order is deliberate. Preparation comes before analytics.

She notices one student appears to have started but never finished the previous assignment. She makes a mental note to check in with that student during the next block. She does not need LyfeLabz to send an email on her behalf.

Second block walks in. She switches classes. The new class opens on its own Snapshot. She scans it. She teaches.

### Product Rules

- Every class opens on a Snapshot before it opens on data.
- The Snapshot answers "what do I need to know before I teach this class." It does not answer "how is this class performing."
- The Snapshot fits above the fold and reads in seconds.
- The spreadsheet-style workspace exists one level deeper. It is not the first screen.
- The Snapshot never surfaces private accommodations or notes on a shared screen. Those live in Settings.
- Moving between classes preserves the pattern. Every class works the same way.
- The Snapshot never displays LMS state. Connection status, LMS class names, LMS topic names, LMS publication outcomes, and LMS roster deltas are not between-moments concerns. LMS state lives in Settings. This preserves the between-moments posture Snapshot was designed for and honors the ratified LMS integration architecture (PDR-019l, `LMS_EXPERIENCE.md` §4).

---

## 6. Planning Period

Fifth block is her planning period. She has forty-seven minutes.

She uses the first ten minutes to answer parent emails. She uses the next ten to enter attendance in PowerSchool. She opens the LyfeLabz tab.

Now the spreadsheet matters. She opens the Grade 7 class, moves past the Snapshot, and looks at the assignment columns. She wants to see how yesterday's assignment went across the whole class. She scans a column. A cluster of students missed the same question. She makes a note in her paper planner. She may reteach that idea tomorrow.

She opens the Grade 6 class. She scans another column. She notices two students have not started an assignment that released two days ago. She does not want LyfeLabz to nag them for her. She wants LyfeLabz to make it easy for her to notice, and then she wants to handle it herself.

She switches back to Google Classroom to leave a comment on one student's post. She switches back to LyfeLabz. Nothing has moved.

She thinks about tomorrow's lessons. She opens the Curriculum landing page. She browses through the Grade 6 Wave Behavior sequence. She previews a lesson. The preview is the canonical lesson, opened cleanly. She does not have to guess what the lesson looks like from a thumbnail. She sees it exactly as her students will.

She does not schedule tomorrow's assignments now. That is a decision she prefers to make in the morning, based on how today actually went. LyfeLabz does not push her to schedule ahead. Teachers keep control of scheduling.

She closes her laptop with three minutes left in the planning period. She still has time to walk to the copier.

### Product Rules

- The spreadsheet-style workspace lives one level below the Snapshot. It is where a teacher looks when the Snapshot is not enough.
- Assignment columns exist so a teacher can scan a class, not so a teacher can drill into a single student.
- The planning period is when analytics matter most. The rest of the day, preparation matters more.
- Previewing a lesson opens the canonical lesson. There is no separate teacher preview.
- LyfeLabz does not push scheduling. The teacher schedules when the teacher chooses to schedule.
- LyfeLabz is one tab among many. It never demands the whole planning period.

---

## 7. After School

The last bell rings. The teacher stays for twenty minutes. A student comes in to make up a quiz. Another asks for help with an investigation. She sits at her desk.

She opens LyfeLabz once more. She wants to confirm that today's assignments are closed the way she expected, and she wants to check whether the two Grade 6 students she noticed earlier ever started the assignment.

She opens the Grade 6 class. The Snapshot answers her question in a glance. One of the two students finished during class. The other did not. She makes a note to talk to that student tomorrow.

She does not open the spreadsheet. She does not need to. The Snapshot is enough.

She closes the laptop. She has been in and out of LyfeLabz maybe a dozen times today. She has not spent more than a few minutes inside it at any one time. That is what a healthy relationship with a teaching platform looks like.

Nothing about her day depended on LyfeLabz being open. Everything about her day was easier because it was.

### Product Rules

- The end of the day is not a report ritual. It is a small confirmation.
- The Snapshot is often enough on its own. Depth is available but not demanded.
- LyfeLabz is measured by how little of a teacher's day it consumes, not by how much.
- Every session ends cleanly. There is no "logout to save" moment.

---

## 7A. Opting Into Google Classroom

Some time after her first week on LyfeLabz, the teacher decides she does not want to invite students by join code for the class that already exists in Google Classroom. She opens Settings.

Settings has a section called Integrations. She has never opened it. She opens it now. The section is quiet. It lists one supported provider today, Google Classroom. It says, in plain language, what LyfeLabz will and will not do if she connects: LyfeLabz will read the list of classes she teaches, will read the rosters of the classes she chooses to import, and will publish LyfeLabz assignments to Google Classroom when she asks it to. LyfeLabz will never post, comment, message, email, or grade on her behalf. LyfeLabz will never read the streams, announcements, comments, or non-LyfeLabz assignments from Google Classroom. She can disconnect at any moment.

She confirms. Google's own OAuth screen appears. She grants the scopes. She returns to Settings and sees a connection card that shows the connection is active. Nothing has changed in her Classes list. Nothing has changed on Curriculum. Nothing has changed for her students. She has only opened a door.

She closes Settings and continues her afternoon. The next morning, in the same preparation moment described in Chapter 3, she opens the Assignment Dialog. Her Google Classroom-linked classes appear with two additional affordances on their rows: a topic selector and an "Also publish to Google Classroom" toggle. Everything else about the dialog is the same. The one-dialog rhythm she has already learned is preserved. She confirms. The confirmation reads: "The LyfeLabz assignment was scheduled. Publishing to Google Classroom succeeded." She goes to the whiteboard.

The opting-in moment is small on purpose. It sits inside Settings, not on Curriculum, not on Classes, and not on Snapshot. A teacher who does not open Settings has never encountered LMS integration. A teacher who opens it has the same option, the same explanation, and the same one-click reversal every time.

### Product Rules

- LMS integration is opt-in and lives inside Settings. It does not appear on Curriculum, Classes, Snapshot, or Present Mode.
- Connecting an LMS is a small, deliberate moment. LyfeLabz never enrolls a teacher in an integration by default.
- The one-dialog Assign rhythm is preserved. LMS-linked class rows receive additive affordances inside the same dialog.
- Publishing is a side effect of confirming the dialog. It is never a second workflow.
- Disconnecting is always available and never destroys LyfeLabz data.

---

## 8. Guiding Product Rules

The individual chapters above each end with rules discovered from a moment. This chapter consolidates them into the product rules that govern the teacher experience as a whole. Every rule below appears at least once in the journey. None is invented here.

**Curriculum is the home.** The Teacher Workspace opens on the curriculum. The curriculum looks like LyfeLabz. It is recognizable, scannable, and organized the way teachers already think about their year.

**Preparation before analytics.** The platform's first job is to answer "what do I need to know before I teach." Its second job is to answer "how is this class performing." Both are important. The order matters.

**The Snapshot precedes the spreadsheet.** Every classroom surface leads with a Snapshot. Detail is one level deeper. This is the structural expression of preparation before analytics.

**One dialog for the day.** Scheduling for every class happens in a single dialog. Each class is an independently configurable row inside that dialog. The default date is Today. Release time is a per-day teacher decision.

**Defaults reflect the common case.** Overrides are always one gesture away. The platform never forces a teacher to make a decision it can safely default.

**LyfeLabz remembers, and does not assume.** Preferences a teacher has set are remembered. Schedules a teacher has not set are never assumed. There is no automatic release inferred from a school bell schedule.

**Present Mode is separate by construction.** Present Mode launches the canonical LyfeLabz experience. It cannot leak teacher-scoped data because it does not load it. The boundary is the guarantee, not the styling.

**One canonical curriculum.** There is one lesson experience. The Teacher Workspace references it, Present Mode launches it, students receive it. Duplicate implementations are prohibited.

**Complement, do not replace.** Google Classroom remains the assignment and communication hub where it is in use. PowerSchool remains the gradebook of record. LyfeLabz is the instructional companion between them.

**Teachers are never trapped.** LyfeLabz lives in one tab among many. It never demands the teacher's full attention. It never resets the workspace on tab switch. It never requires a session ritual to close cleanly.

**Reduce clicks, honestly.** Every added click is a cost. Every removed click is a benefit only if it does not remove a decision the teacher wanted to make. Scheduling reduces to one dialog. Presenting reduces to one action. Reviewing between classes reduces to one Snapshot.

**Private data stays private.** Student accommodations and notes never appear on projection surfaces or on shared views. Settings owns them.

**Preservation over novelty.** The instructional experience does not change to accommodate the platform. The platform is built around the instructional experience.

---

## 9. Future Vision

The journey above describes the day we are building toward. Not every moment in it is built yet. Some moments describe philosophy rather than implementation, and this section names which is which so future contributors do not confuse the two.

The Curriculum landing page is real today. It is the Sprint 6D surface, backed by the canonical curriculum manifest introduced in Sprint 6D.0. It is the primary teacher landing experience and it will remain so.

The persistent left-side navigation is real today. It is the Sprint 6C surface. Present Mode and Settings are present as disabled coming-soon entries under the same contract used elsewhere in the workspace. That is intentional. Their runtime is deferred until each surface's architecture is certified and its implementation sprint runs.

Present Mode has a certified architecture (PRESENT_MODE_ARCHITECTURE.md). Its runtime is deferred. The privacy guarantees described in Chapter 4 are the guarantees the architecture already commits to. When Present Mode is implemented, it must satisfy them.

Curriculum activation exists today as a per-mount UI-only client state on the Curriculum landing page. Persistent curation semantics land in the Assignment Foundation phase (Phase 5). The teacher-facing verb ("activate," "surface," or another) is a copy-review decision recorded when that phase begins. The schema name remains `assignments/{assignmentId}` per PDR-010.

The one-dialog scheduling experience described in Chapter 3 is not yet built. It is the target shape of the Assignment Foundation surface. Its architecture is anticipated by TEACHER_EXPERIENCE_PHILOSOPHY.md §3.5 and by TEACHER_PLATFORM_DOMAIN_ROADMAP.md Phase 5. When the phase begins, this document is one of the inputs it must satisfy.

The Snapshot described in Chapter 5 is not yet built. It is the target shape of the first screen inside a class workspace. The class workspace itself spans Phases 4 through 7 in the roadmap. The Snapshot is not a new architectural domain. It is a UX contract on top of the enrollment, assignment, submission, and analytics domains. It reads only what those domains authorize. It never becomes an authoritative record of its own.

The spreadsheet-style workspace described in Chapter 6 is the deeper surface named in §3.6 of the philosophy. Its schema and callable contracts belong to the sprint specifications for Phases 4 through 7. Nothing in this document schedules those phases.

Google Classroom publication of assignments is anticipated by the philosophy and by PDR-015. It is not scheduled. It is not part of the current sprint sequence. When it is scheduled, it will pass through its own architecture pass.

Accommodations and private student supports are named in §3.7 of the philosophy. Their data model is not defined. They require their own architecture specification before any implementation sprint. The narrative in Chapter 3 (the parent email about a transferred student's accommodations) describes the intended posture: the teacher configures supports in Settings, students receive them automatically, peers never see them. That posture is philosophy. Its implementation is deferred.

The rest of the future is honestly future. A teacher-facing analytics landing surface, longitudinal views across school years, parent surfaces, district rollups, and AI-assisted feedback are all reserved by the roadmap under Future Extensions. None of them belong inside the moments this document describes. If a future feature cannot be located inside a moment in this journey, it is a signal to reconsider the feature, not to add a moment.

The Teacher Journey will grow. New moments will be added when new phases certify. Existing moments should not be edited casually. When they are edited, the edit is a product decision worth recording alongside the certified architecture.

### Product Rules

- The Curriculum landing page is the built anchor. Every future teacher-facing surface composes against it.
- Present Mode's privacy guarantees are load-bearing. They cannot be relaxed by an implementation sprint.
- The one-dialog scheduling experience is the target shape of the Assignment Foundation surface.
- The Snapshot is a UX contract on top of certified domains. It is not a new authoritative record.
- Accommodations require their own architecture pass. The journey names the posture; the implementation is deferred.
- Features that do not fit inside a moment in this journey are candidates for removal, not new moments.

---

*End of Teacher Journey. This document describes what teaching with LyfeLabz should feel like. It does not define implementation. Every principle here defers to the certified architecture, and every future teacher-facing sprint must reconcile its surface with the moments described above.*
