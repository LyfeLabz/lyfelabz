# LyfeLabz Assign Experience

Status: Canonical product specification for the teacher assignment workflow.
Companion documents: TEACHER_JOURNEY.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, PRESENT_MODE_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, ASSESSMENT_PIPELINE_SPECIFICATION.md.

## Sprint 9D Reconciliation Notice

The assignment workflow described in this document is subordinate to `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` and PDR-024 in the following respects:

- **Activation and publication are separate.** Activation determines whether students may access a lesson inside LyfeLabz. Publication sends the assignment to Google Classroom for a specific LMS-linked class. Activation without publication is a supported state. Publication without activation is refused.
- **Publication is per LMS-linked class row.** The per-class publication toggle continues to default off until the teacher opts in for that class, consistent with `TEACHER_EXPERIENCE_PHILOSOPHY.md` §3.5.
- **Google Classroom remains the student assignment hub.** LyfeLabz never asks a student to check a second assignment list. Assignment communication for LMS-linked classes flows through Google Classroom.

Where this document and the specification conflict, the specification controls.

---

## Sprint 9A Reconciliation Notice

The assignment behavior described in this document is governed by `ASSESSMENT_PIPELINE_SPECIFICATION.md` and PDR-021 for every assessment-bearing activity. Terminology and behavior reconciled:

- **One assignment belongs to exactly one class.** A teacher who assigns one activity to multiple classes triggers automatic per-class fan-out; the platform creates one assignment record per class. Teachers experience one workflow; the internal record shape is per-class.
- **Assignment windows and grace period.** Windows control who may begin an assessment. Students already working when a window closes receive a **one-hour grace period** for submission. No new sessions begin after close. Saved work in a live session is preserved even if the student does not submit within the grace period. The one-hour value is a platform default and a configurable operational constant; teachers do not set or override it.
- **Unlimited attempts by default.** Formative activities allow unlimited attempts. Every submitted attempt is preserved. Attempt caps are not offered on the initial teacher UI (see PDR-021c).
- **Attempts are the authoritative record.** The word "submission" throughout this document is read forward as **attempt**. The `submitted` state remains internal to the scoring transaction and is not a teacher-visible state.
- **Sessions are internal.** Autosaving, resuming, and expiring student sessions are platform behaviors. Teachers do not manage sessions.
- **Practice / Classroom toggle removed.** The pre-Sprint 9A student-facing mode toggle is removed. Assignment configuration does not include a Practice / Classroom mode. Behavior derives automatically from authentication and authorization.
- **Assessment revisions are internal.** Teachers do not select an assessment version. The platform automatically stamps every attempt with the internal revision identifier at submission time.

Where this document and the specification conflict, the specification controls.



This document is a product specification. It is not an architecture specification, a sprint plan, or an implementation guide. It defines what assigning a LyfeLabz resource should feel like from the teacher's perspective. Where a moment implies an architectural implication, that implication is left to the sprint specification that owns the surface, and always defers to the certified architecture.

Assigning a resource is the single most repeated logistical action a teacher performs inside LyfeLabz. It sits at the boundary between the Teacher Platform's job (managing instruction) and canonical LyfeLabz's job (delivering it). It also sits at the boundary between LyfeLabz and the tools a teacher already uses. This document names the shape that boundary should take.

---

## 1. Purpose

The Assign Experience exists so future implementation sprints have a shared understanding of the canonical teacher workflow for assigning LyfeLabz resources before any callable is written.

Assigning is one workflow. It should feel like preparing an entire day of instructional logistics in a single, focused moment, and then getting out of the teacher's way.

If a future sprint proposes a new assignment surface, a new assign control, a second assign dialog, or a variant assign workflow, it should be measured against this document. A proposal that fits inside this workflow belongs. A proposal that requires the teacher to learn a second way to assign the same thing is a signal to reconsider the proposal, not to add a second workflow.

This document is deliberately concrete. It describes the dialog, the row-by-row configuration, the confirmation, and the way an already-assigned lesson behaves the next time a teacher visits it. Everything named here is grounded in decisions already recorded in the Teacher Journey and the Teacher Experience Philosophy.

### Design Rules

- The Assign Experience is one workflow. LyfeLabz has one way to assign a LyfeLabz resource.
- Every future assignment surface, control, or callable must locate itself inside the moments in this document.
- This document complements the certified architecture. It never overrides it.

---

## 2. Design Philosophy

A teacher does not assign a lesson in isolation. A teacher assigns today.

Assigning is a preparation ritual. Between the copier and the bell, a teacher decides what will be available in each of her blocks and at what time. She rarely wants to configure one class in one dialog, close the dialog, reopen a different dialog for another class, and repeat that pattern five more times. What she wants is to sit down once, prepare an entire day of logistics, confirm, and walk to the whiteboard.

The Assign Experience is designed around this ritual.

One dialog schedules every selected class. Every class is selected by default because the common case is "make this available to every block that will meet today." Each class row is independently configurable because the common case is not the only case. The default assignment date is always Today because assigning today is what teachers do most. Release time and Google Classroom topic remember the teacher's last-used preferences because a teacher's schedule usually repeats. Points default to the total possible quiz score for the lesson because that is the value a teacher will type if LyfeLabz does not type it for her.

LyfeLabz remembers preferences. LyfeLabz does not assume today's schedule. Those two rules together preserve the teacher's control: the platform makes the common case fast without ever quietly making a decision the teacher wanted to make.

Assigning also honors the shape of the day around it. The teacher opens the Curriculum landing page, chooses a lesson, opens the dialog, confirms, and returns to exactly where she was. She is not launched into a different surface. She is not shown a congratulatory splash. She is not asked to name the assignment. Assigning is a moment inside curriculum, not a destination away from it.

Curriculum is a control panel, not a dashboard. The Assign Experience is the primary control on that panel.

### Design Rules

- Assigning is preparation. It is designed for the moment before a school day begins, not the moment between classes.
- One dialog handles the whole day. Teachers do not repeat the workflow per class.
- Common-case defaults are always applied. Overrides are always one gesture away.
- LyfeLabz remembers preferences. LyfeLabz does not assume today's schedule.
- Assigning returns the teacher to curriculum, not to a new surface.
- Curriculum is a control panel. The Assign Experience is its primary control.

---

## 3. Opening the Assignment Dialog

A teacher opens the Assignment Dialog from a curriculum resource. The most common entry is a lesson card on the Curriculum landing page, but every assignable LyfeLabz resource (lesson, investigation, simulation, extension, engineering challenge, and any future assignable resource type) shares the same entry pattern and the same dialog.

Every assignable card carries an Assign control. Selecting that control opens the Assignment Dialog for that resource. The dialog is a modal composed over the curriculum surface. The curriculum surface remains visible behind it. The teacher has not left curriculum; she has focused it.

The dialog is one dialog. There is no first step and no second step. There is no wizard. There is no "advanced options" panel that hides class configuration behind a second gesture. Every class the teacher is allowed to assign to appears in the dialog at once, and every configurable value for each of those classes appears alongside it.

The dialog opens quickly. It does not require a round trip to fetch state a teacher already saw a moment ago on the curriculum surface. The lesson identity, the teacher's class list, and the teacher's remembered preferences are all available the instant the dialog opens.

The dialog closes cleanly. If the teacher dismisses it without confirming, nothing is scheduled and nothing is remembered as a draft. The next time she opens it, she sees the dialog in the same shape she saw it the first time, informed by her remembered preferences.

The Assign control on a card that already carries an active assignment behaves differently, and is described in section 8.

### Design Rules

- Every assignable resource card carries an Assign control. There is exactly one shape for that control.
- The Assignment Dialog is one dialog. It is not a wizard.
- The dialog opens over curriculum. The teacher is focused, not relocated.
- The dialog opens quickly, with every value the teacher needs already populated.
- Dismissing without confirming schedules nothing and creates no draft state.

---

## 4. Preparing an Entire Day

The Assignment Dialog is designed around the assumption that a teacher is preparing every class that will meet today, at the same moment, in one focused step.

The dialog lists every class the teacher currently teaches. Each class appears as its own row. Every class is selected by default. This is the load-bearing decision that makes the workflow feel like preparing a day rather than assigning to one class at a time.

Selection is a single click. A teacher who does not want to assign a particular lesson to a particular class deselects that class's row with one gesture. There is no confirmation dialog for a deselection, and no separate "skip this class" workflow. Deselecting a class in the dialog is the exception path, and the exception path is exactly one click.

The class rows appear in the order the teacher prefers to see them. That order is a teacher preference, remembered from prior use. A teacher who prefers to review first block first sees first block first. A teacher who prefers to review by grade sees the classes grouped in that order. The dialog never sorts by name in a way that ignores what the teacher has already told it.

The default assignment date is always Today. It is prefilled. It is never blank, and it is never yesterday's date carried over from an earlier session. If the teacher wants to schedule an assignment for a future date, she changes the date once, at the top of the dialog, and the change applies to every class row unless she overrides an individual row. Changing the date does not clear any other value the teacher has already set.

The teacher does not name the assignment. The lesson is the assignment. Naming is not part of the workflow.

The teacher does not describe the assignment. Description is not part of the workflow.

The teacher does not attach files. Attachment is not part of the workflow.

Every field the dialog surfaces is a field the teacher is expected to review and either accept or override for today. Every field the dialog does not surface is a field the teacher does not need to think about.

### Design Rules

- Every class the teacher teaches appears as its own row in the dialog.
- Every class is selected by default. Deselection is a single click.
- Class row order reflects the teacher's remembered preference.
- The default assignment date is always Today. It is prefilled and never left blank.
- Changing the top-of-dialog date applies to every row unless a row has been individually overridden.
- The dialog does not ask for an assignment name, description, or attachments. The lesson is the assignment.

---

## 5. Configuring Individual Classes

Each class row is independently configurable. The row is not a summary; it is the working configuration for that class.

Every row exposes, at minimum, the values a teacher would reasonably want to review before assigning:

- The class identity, including grade and block, so the teacher can recognize the row at a glance.
- The release time for the assignment in that class. Release time is a per-day teacher decision. LyfeLabz never assumes it from a bell schedule.
- The Google Classroom topic under which the assignment should be published, where a Google Classroom integration is in use.
- The points that will be recorded for the resource. Points default to the total possible quiz score for the lesson.
- A single-click deselection for the row, in case the teacher does not want to assign this resource to this class today.

The release time is prefilled with the teacher's last-used release time for that class. LyfeLabz remembers preferences: a teacher who consistently releases first block Grade 7 at 7:45 sees 7:45 in that row every time she opens the dialog. The default is a memory, not a guess.

The Google Classroom topic is prefilled with the teacher's last-used topic. Where Google Classroom integration is not in use, the field is absent from the row. It is not shown as a disabled control.

The points value is prefilled with the total possible quiz score for the resource. If the resource does not have a quiz, the field is absent from the row.

Every prefilled value is editable in place. The teacher can change the release time in one row without changing it in any other row. She can change the Google Classroom topic in one row without changing it in any other row. She can change points in one row without changing them in any other row. There is no "sync across rows" toggle, because independent per-row configuration is the design.

Exceptions are handled inside the same dialog. A teacher who is releasing Grade 6 first thing in the morning to five blocks but wants to release the sixth block later does not open a second dialog for the sixth block. She changes the sixth-block row in place. Exceptions should never require a second workflow.

### Design Rules

- Each class row is independently configurable. Values in one row never quietly propagate to another.
- Release time is a per-day teacher decision. It is prefilled from the teacher's remembered preference, never inferred from a bell schedule.
- Google Classroom topic is prefilled from the teacher's remembered preference. It is absent when Google Classroom is not in use.
- Points default to the total possible quiz score. The field is absent when the resource has no quiz.
- Every prefilled value is editable in place.
- Exceptions are handled inside the same dialog. There is never a second dialog for edge cases.

### LMS-linked class row shape

When the ratified LMS integration architecture (`LMS_INTEGRATION_ARCHITECTURE.md`, PDR-019) is implemented, the shape of a class row for an LMS-linked class carries two additional affordances alongside the release time, points, and deselection controls already described:

- A Google Classroom topic selector, prefilled with the teacher's last-used topic for that class and populated from the linked LMS class's topics. Where a class is not LMS-linked, this control is absent from the row, not shown as a disabled control.
- An "Also publish to Google Classroom" toggle, off by default until the teacher opts in for that class. When on, confirming the dialog publishes the LyfeLabz assignment to the linked LMS as a side effect of scheduling, per PDR-019d.

The affordances are additive. Every rule in Section 5 continues to apply to LMS-linked rows: independent per-row configuration, prefill from remembered preferences, in-place edits, no propagation across rows, and no second workflow. The dialog remains one dialog. There is no "publish to Google Classroom" wizard, no "Google Classroom settings" secondary panel, and no LMS-specific dialog. The Assign Experience is one workflow whether or not any of the teacher's classes are LMS-linked.

Rows for classes that are not LMS-linked are unchanged.

---

## 6. Scheduling

Scheduling is the act of confirming the dialog.

The teacher clicks a single confirmation control at the bottom of the dialog. The dialog validates the rows that are selected. A row missing a required value (for example, a release time that a teacher explicitly cleared) is flagged in place, next to the field that needs the teacher's attention. The dialog does not scroll away from the teacher. The dialog does not open a modal on top of a modal.

If every selected row is valid, the dialog schedules those rows. Deselected rows are not scheduled and are not remembered as pending. From the teacher's perspective, scheduling is a single confirmation for the entire day.

Scheduling is a preparation action, not a delivery action. What "scheduled" means to LyfeLabz is that the assignment record exists, that the release time has been recorded, and that any external integrations (such as Google Classroom publication) will occur at the release time the teacher chose. The teacher does not need to think about the mechanics. She has confirmed a plan for today. LyfeLabz will hold the plan until the plan needs to become real.

A teacher who releases a lesson immediately does so by leaving the release time at, or setting it to, a value that has already passed. LyfeLabz does not distinguish between "immediate release" and "scheduled release" as a separate workflow. Immediate release is a scheduled release with a release time in the past.

A teacher who schedules a lesson for a future date does so by changing the date. Every other field behaves the same way. There is no "future" branch of the workflow, only a different date.

### Design Rules

- Scheduling is a single confirmation for the entire dialog.
- Validation errors surface in place, next to the field that needs attention.
- Deselected rows are not scheduled and are not saved as drafts.
- "Immediate release" and "scheduled release" are the same workflow, distinguished only by the release time the teacher chose.
- Scheduling for a future date is the same workflow, distinguished only by the date the teacher chose.

---

## 7. Confirmation

After scheduling, the teacher returns to exactly where she was.

The dialog closes. The curriculum surface is exactly the surface she was looking at when she opened the dialog. Her scroll position is preserved. Her filters are preserved. The lesson card she was working with is still visible.

The card she was working with updates in place to reflect the new state. The lesson card becomes:

✓ Assigned

rather than losing the Assign action. The visual change is small and unambiguous. The teacher can tell at a glance that the lesson has been scheduled without needing to open a report.

A concise confirmation summarizes what was scheduled. The confirmation names the resource, the classes it was scheduled for, and the release times, in as few lines as the shape of the day allows. The confirmation is quiet. It does not congratulate the teacher. It does not offer a call to action. It does not present a next-step ladder. It confirms what she already knows she did.

The confirmation is dismissible. The confirmation dismisses itself after a short delay if the teacher does not act on it. Nothing about it demands the teacher's attention.

Nothing about the Confirmation moment redirects the teacher. She is on the Curriculum landing page. She was on the Curriculum landing page before she opened the dialog. She will continue browsing curriculum, opening the next lesson she wants to schedule, or she will close the tab and walk to the whiteboard.

The Confirmation is not a report ritual. It is the closing punctuation on a preparation ritual.

### LMS-side publication outcomes

When a row's "Also publish to Google Classroom" toggle is on, the confirmation surface names the publication outcome alongside the LyfeLabz scheduling outcome. The LyfeLabz assignment is authoritative; publication is a side effect per PDR-019d. The confirmation reads either:

- "The LyfeLabz assignment was scheduled. Publishing to Google Classroom succeeded."
- "The LyfeLabz assignment was scheduled. Publishing to Google Classroom did not succeed."

The LyfeLabz record exists in either case. A failed publication does not undo the LyfeLabz assignment; it is a retryable side effect that the teacher may re-attempt from the class's assignment detail view. The confirmation surface never blames the teacher, never emits a stack trace, and never asks the teacher to contact an administrator without a plain-language description of what happened. This preserves the "return, do not redirect" rule.

### Design Rules

- After scheduling, the teacher returns to exactly where she was.
- The lesson card updates in place to a "✓ Assigned" state. It does not lose the Assign action.
- A concise confirmation summarizes what was scheduled. It is quiet, dismissible, and self-dismissing.
- The confirmation never redirects the teacher to a new surface.
- The confirmation is closing punctuation, not a next-step ladder.
- Where LMS publication was requested, the confirmation names the LMS-side outcome in one plain-language line. The LyfeLabz assignment is authoritative regardless of the LMS-side outcome.

---

## 8. Revisiting Existing Assignments

The Assign Experience is not a one-way workflow. A teacher who returns to a lesson she has already assigned must be able to review, adjust, or remove that assignment inside the same dialog she used to create it.

A lesson card that carries an active assignment shows:

✓ Assigned

in the position that the Assign action previously occupied. The state is visible without opening anything. A teacher browsing curriculum can tell at a glance which lessons she has scheduled for her classes.

Clicking:

✓ Assigned

reopens the Assignment Dialog with the current information already populated. The dialog is the same dialog. It is not a "manage assignment" dialog and it is not a "view assignment" screen. It is the Assign Experience, opened with today's state.

The teacher sees, per class row, exactly what she scheduled: which classes were included, what release time she chose, which Google Classroom topic she selected, and what points value she recorded. She can change any of them. She can deselect a class to remove the assignment for that class. She can add a class that she previously deselected. She can confirm the dialog again and the platform updates the assignments to match.

Removing an assignment is not a separate workflow. It is a deselection inside the same dialog. If a teacher wants to unassign a lesson from every class, she deselects every row and confirms. There is no dedicated Unassign control on the curriculum card. Unassign is not a first-class verb; it is the consequence of the teacher's edits.

Assignments that have already begun (a release time in the past) may not accept every kind of edit that a purely future assignment accepts. The Assign Experience defers the exact bounds of post-release edits to the Assignment Foundation phase, which owns the record's lifecycle. The teacher-facing rule is simple: LyfeLabz makes it obvious which edits are still available and does not offer edits that would silently disturb work already in progress.

The dialog closes with the same confirmation behavior described in section 7. The teacher returns to exactly where she was. The card continues to show:

✓ Assigned

unless every class was deselected, in which case the card returns to its unassigned state and the Assign action reappears.

### Design Rules

- Every lesson card carrying an active assignment shows "✓ Assigned" in the position that the Assign action previously occupied.
- Clicking "✓ Assigned" reopens the same Assignment Dialog with the current information populated.
- The dialog is the single workflow. There is no separate Manage or View surface.
- Removing an assignment for a class is a deselection inside the dialog. It is not a separate workflow.
- Post-release edit bounds are defined by the Assignment Foundation phase. The dialog only offers edits that will not silently disturb work in progress.
- Confirmation behavior after revisiting is identical to the initial-schedule behavior described in section 7.

---

## 9. Design Rules

Every section above ends with a small Design Rules block distilled from that moment. This chapter consolidates the rules that govern the Assign Experience as a whole. Every rule below appears at least once in a section above. None is invented here.

**Assigning is one workflow.** LyfeLabz has one way to assign a LyfeLabz resource, and one dialog through which that workflow runs.

**Preparation, not delivery.** The Assign Experience is designed for the moment before students arrive. It is a preparation ritual. It is not a between-classes triage.

**One dialog for the day.** Every class the teacher teaches appears as its own row inside a single dialog. The workflow is not repeated per class.

**Every class is selected by default.** The common case is "make this available to every block that will meet today." Deselection is a single click.

**Independent per-row configuration.** Each class row is independently configurable. No value in one row propagates quietly to another.

**Today is the default date.** The default assignment date is always Today. It is prefilled and never left blank.

**LyfeLabz remembers preferences.** Release time, Google Classroom topic, and class row order reflect the teacher's remembered preferences. LyfeLabz never asks a teacher for a value it has already learned.

**LyfeLabz does not assume today's schedule.** A remembered preference is not a bell schedule. Release time is a per-day teacher decision every time.

**Common-case defaults, one-gesture overrides.** Every prefilled value is editable in place. The dialog never forces a teacher to accept a value it can safely default, and never hides an override behind a second gesture.

**Points default to the total possible quiz score.** Where the resource has a quiz, the points field is prefilled with the correct value. Where the resource has no quiz, the field is absent.

**Exceptions live inside the dialog.** A one-off release time, a skipped block, or a different topic are per-row edits. They are not a second workflow.

**Confirmation is a single action.** Scheduling for the entire dialog is one confirmation. Validation errors surface in place.

**Assigned state is visible on the card.** A scheduled lesson shows "✓ Assigned" on its card. The teacher can see the state without opening anything.

**Revisit through the same dialog.** Clicking "✓ Assigned" reopens the Assign Experience with the current state populated. There is no separate Manage or View surface.

**Unassign is a deselection.** Removing an assignment is a per-row deselection inside the dialog, not a dedicated workflow.

**Return, do not redirect.** After confirming, the teacher returns to exactly where she was in curriculum. The workflow does not relocate her.

**Curriculum is a control panel.** The Assign Experience is the primary control. Curriculum is not a dashboard.

---

## 10. Future Growth

The Assign Experience described above is the target shape of the workflow. Some of it will be built by the Assignment Foundation phase (Phase 5) of the Teacher Platform Domain Roadmap. Some of it will grow gradually as adjacent domains certify.

The one-dialog day, the per-class rows, the today-first defaults, the remembered preferences, the ✓ Assigned card state, and the return-in-place confirmation are all Phase 5 territory. They are the shape the Assignment Foundation surface must ultimately satisfy. When Phase 5 begins, this document is one of the inputs that specification must reconcile against.

Google Classroom publication of assignments is anticipated by the Teacher Experience Philosophy (§3.5) and by PDR-015. The Assign Experience already reserves the Google Classroom topic per class row. When Google Classroom publication is scheduled, it will plug into the existing dialog rather than introduce a second one. The teacher continues to prepare the day in one workflow. Publication becomes a consequence of confirming the dialog, not a new step.

Backend scheduling of releases (the mechanism that turns a chosen release time into an actual delivery moment) is a Cloud Function responsibility inside Phase 5. The Assign Experience remains unchanged by whatever scheduling mechanism the Cloud Function Charter records. From the teacher's perspective, release time is a value she typed into a row. What LyfeLabz does with that value at 7:45 is not part of the workflow she performs at 7:12.

Additional publishing targets (for example, a future Canvas integration or a district-owned announcement channel) will follow the same pattern. Each additional target that the platform commits to supporting appears as a per-row control, or as an implicit consequence of confirming the dialog, without changing the overall shape of the workflow. Adding a target must not turn one dialog into two.

The set of assignable resource types will grow. Extensions, investigations, simulations, engineering challenges, and future resource types share the same dialog, the same per-row configuration, and the same confirmation shape. Points defaults may vary per resource type (an engineering challenge may not have a quiz), and any per-type variation lives inside the same dialog as an absent or differently defaulted field. The workflow is one workflow regardless of resource type.

The class workspace surfaces described in Chapters 5 and 6 of the Teacher Journey (the Snapshot and the spreadsheet-style view) are downstream consumers of assignments produced by this workflow. They read the records the Assign Experience produces. They never provide an alternate way to create those records. The Assign Experience remains the single canonical origin.

Multi-grade teachers are already accommodated by per-row configuration. A teacher who teaches Grade 6 in some blocks and Grade 7 in others opens the dialog and sees one row per class, in her preferred order. No multi-grade-specific workflow is required.

Cross-year assignment templates, bulk assignment operations across many lessons, and shared-across-teachers assignment libraries are named by the Assignments domain description in the roadmap as deferred to future sprints. Any such capability, if it eventually ships, must reconcile with the Assign Experience. It must not introduce a parallel workflow for the same teacher decision.

Everything named as future growth here is honestly future. If a proposed feature cannot locate itself inside the moments described above, that is a signal to reconsider the feature, not to add a new workflow.

### Design Rules

- The one-dialog day is the target shape of the Assignment Foundation surface.
- New publishing targets extend the dialog. They never fork the workflow.
- Backend scheduling is a Cloud Function concern. The teacher-facing workflow does not change with the mechanism.
- New assignable resource types share the same dialog, with per-type variation living inside it.
- The Assign Experience is the single canonical origin of assignment records. Class workspace surfaces read, never re-create.
- Future capabilities that cannot fit inside this workflow are candidates for reconsideration, not for a second workflow.

---

*End of Assign Experience. This document defines what assigning a LyfeLabz resource should feel like. It does not define implementation. Every principle here defers to the certified architecture, and every future assignment-related sprint must reconcile its surface with the workflow described above.*
