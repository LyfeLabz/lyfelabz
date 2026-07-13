# LyfeLabz LMS Experience

Status: Canonical product specification for the teacher-facing LMS integration workflow.
Companion documents: LMS_INTEGRATION_ARCHITECTURE.md, LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md, TEACHER_JOURNEY.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, ASSIGN_EXPERIENCE.md, CLASS_SNAPSHOT_EXPERIENCE.md, PRESENT_MODE_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md.

## Sprint 10A F-3 Reconciliation Notice

The engineer-facing implementation rules that follow from the Google Classroom integration philosophy in this document are canonical in `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` under PDR-027. The teacher-facing surfaces, error messages, and product principles in this document remain authoritative. Implementation questions about the deep-link URL, the publication callable, the resolution callable, multiple-class fan-out, and Classroom-side co-teacher handling route to the new contract.

Where this document and the implementation contract conflict on product behavior or on teacher-facing surface shape, this document controls and the implementation contract is reconciled.

---

## Sprint 9D Reconciliation Notice

The Google Classroom integration philosophy in this document is subordinate to `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` and PDR-024 in the following respects:

- **Activation and publication are separate.** Activation controls access to lessons inside LyfeLabz. Publication sends assignments into Google Classroom. Activation without publication is a supported state. Publication without activation is refused.
- **Google Classroom remains the assignment hub for LMS-linked classes.** LyfeLabz's `My Assignments` surface is a status view, not a competing assignment hub.
- **Deep links land the student in the correct authorized attempt context silently.** The student never selects a class or an assignment after arriving from Google Classroom.
- **Integrate Rather Than Duplicate.** Wherever Google Classroom already answers a question, LyfeLabz defers.

Where this document and the specification conflict, the specification controls.


This document is a product specification. It is not an architecture specification, a sprint plan, or an implementation guide. It defines what LMS integration should feel like from the teacher's perspective. Every principle here defers to the certified architecture and to `LMS_INTEGRATION_ARCHITECTURE.md`.

The LMS Experience exists inside the LyfeLabz Teacher Workspace. It never renders on Present Mode. It never renders on the public instructional experience. It never renders on a student surface. It is a teacher-only, opt-in workflow.

---

## 1. Purpose

LMS integration exists for one reason: a teacher who already uses Google Classroom should be able to bring the classes she already has into LyfeLabz without recreating them by hand.

Everything the LMS Experience does flows from that reason.

- The teacher's classes already exist somewhere. LyfeLabz should not ask her to type them in again.
- The teacher's rosters already exist somewhere. LyfeLabz should not ask her to invite thirty students by join code when the LMS already knows who is in the class.
- The teacher's assignment communication already happens somewhere. LyfeLabz should be able to place a link there, not compete for the teacher's attention with a second channel.
- The teacher's gradebook already exists somewhere. LyfeLabz should collect learning evidence, not attempt to compute a report card.

LyfeLabz complements the LMS. It never replaces it.

---

## 2. Why LMS Integration Exists

LyfeLabz is a teaching platform. It is not a learning management system.

A teacher does not want to run two platforms in parallel. She wants LyfeLabz to slot into the workflow she already has. The LMS Experience is the shape of that slotting-in.

The Google Classroom teacher already lives inside a specific rhythm: check the class stream between blocks, post the day's agenda, attach today's lesson, and walk to the whiteboard. LyfeLabz's job in that rhythm is to be one of the tools she attaches, not to become the stream, the agenda, or the gradebook.

The teacher who does not use Google Classroom, or whose district does not adopt any LMS at all, is a first-class teacher on LyfeLabz. The join-code enrollment path certified in Phase 4 remains the default. LMS integration is opt-in. A teacher who does not opt in does not see the surface.

---

## 3. Teacher Onboarding

The LMS Experience appears inside Settings, under a section named Integrations. It does not appear on the Curriculum surface, the Classes surface, Present Mode, or Snapshot. A teacher who has never opened Settings has never encountered LMS integration.

Onboarding is deliberate. The teacher visits Settings, opens Integrations, sees the list of supported LMS providers (in Version 1: Google Classroom only), and selects "Connect Google Classroom."

She sees a plain-language explanation of what LyfeLabz will and will not do:

- LyfeLabz will read the list of classes she teaches in Google Classroom.
- LyfeLabz will read the rosters of the classes she chooses to import.
- LyfeLabz will publish LyfeLabz assignments to Google Classroom when she asks it to.
- LyfeLabz will never post, comment, message, email, or grade on her behalf.
- LyfeLabz will never read the streams, announcements, comments, or non-LyfeLabz assignments from Google Classroom.
- She can disconnect at any moment.

She confirms. Google's own OAuth screen appears. She grants the scopes. She returns to Settings and sees a connection card that shows the connection is active. She has not yet imported a single class. That is a separate, later action.

Onboarding ends when the teacher chooses to close Integrations and continue teaching. Nothing has changed in her Classes list. Nothing has changed on Curriculum. Nothing has changed for her students. She has only opened a door.

---

## 4. Importing Classes

The teacher opens Integrations and selects "Import a class from Google Classroom."

She sees the list of classes she teaches in Google Classroom, in the order Google Classroom returned them. Each row shows:

- the LMS class name,
- the LMS section (where present),
- the LMS class's own indicator of active or archived status,
- the LyfeLabz grade she intends to assign the class to (defaulting to the grade she teaches most, if that preference is known),
- an Import control.

She imports the classes she wants imported. She does not import the ones she does not want imported. The list does not grow silently; classes she declined to import in one session are not smuggled in during the next session.

Each import creates a LyfeLabz class record under the certified Classroom domain. The LyfeLabz class receives its own stable class identifier per PDR-005. It receives a link, in the mirror, to its Google Classroom counterpart. The teacher is the owner. The class appears in her Classes list on the left-side navigation the moment the import completes.

The class opens on Snapshot, as every class does. Snapshot renders the class the same way it renders a non-LMS class. LMS-scoped affordances (Refresh from Google Classroom, LMS class name badge) appear only in class settings and in the Assignment Dialog, not on Snapshot. Snapshot is a preparation surface. LMS state is not preparation.

The imported class begins with its mirrored roster from Google Classroom. A student who exists in Google Classroom but has not yet signed into LyfeLabz appears in the roster as a placeholder. On her first LyfeLabz sign-in that matches the Google identity, the placeholder resolves into an active enrollment. She does not need a join code. The teacher does not need to communicate one.

---

## 5. Refreshing Classes

An LMS-linked class carries a Refresh affordance. The teacher can refresh whenever she wants. LyfeLabz does not refresh silently, at least in Version 1 of the integration.

Refresh reads the current LMS roster and reconciles it against the current LyfeLabz enrollments. It presents a small, human-readable proposal:

- students newly added by the LMS since the last refresh,
- students removed by the LMS since the last refresh,
- students whose display name in the LMS has changed since the last refresh.

The teacher confirms the proposal. Confirmation writes the changes into the LyfeLabz enrollment records under the certified vocabulary (`active`, `transferred`, `withdrawn`). A removed student becomes `withdrawn`. A newly added student becomes `active`. No enrollment record is ever deleted. Historical submissions from a withdrawn student remain readable to the teacher, in the same way they remain readable when a teacher manually withdraws a student under Phase 4.

Refresh is an idempotent action. Running refresh a second time in a row produces no proposal because there is nothing to reconcile.

Automatic refresh is a future capability. Until it ships, the teacher's Refresh gesture is the sole source of roster updates from the LMS.

---

## 6. Handling Archived Classes

A class archived in Google Classroom continues to exist in LyfeLabz. It appears in the teacher's Classes list under the certified archival treatment (visible to the teacher, excluded from active views, retained per PDR-011's retention rules).

Refresh is disabled on an LMS-archived class. The teacher can still open the class, review submissions, and, if she chooses, unlink the class and continue to use it as an ordinary LyfeLabz class going forward.

If the teacher archives the class in LyfeLabz herself (independent of the LMS's state), the LMS state is not affected. LyfeLabz never archives, deletes, or modifies an LMS class. That authority belongs to the LMS.

---

## 7. Handling Transferred Classes

A class transferred between teachers inside Google Classroom is a change in LMS ownership. LyfeLabz does not automatically transfer ownership of the mirrored class in response. This is deliberate: PDR-005 makes LyfeLabz class ownership immutable except through an audited administrative path.

If a teacher who imported a class is no longer the teacher of record in the LMS, the connection to the LMS class becomes stale on next refresh. The teacher sees a clear message: "You are no longer listed as the teacher of this class in Google Classroom." She can unlink the LyfeLabz class from the LMS mirror. She can request an ownership transfer of the LyfeLabz class through the LyfeLabz support path, which is the same audited path used for any other class ownership transfer.

LyfeLabz never silently reassigns a class from one teacher to another. Ownership is a teacher trust boundary. It changes with an audit trail or it does not change.

---

## 8. Handling Deleted Classes

A class deleted in Google Classroom is a signal, not an authority. LyfeLabz preserves the mirrored class's data.

The mirrored link is marked broken. The class continues to appear in the teacher's Classes list with a clear indicator: "This class no longer exists in Google Classroom." Refresh is disabled. Enrollments are frozen at their last-known-good state. Submissions remain readable.

The teacher can choose to unlink the class (returning it to a standalone LyfeLabz class), archive the LyfeLabz class herself (moving it to the archived treatment described in PDR-005 and PDR-011), or leave the class in its broken-link state. LyfeLabz does not force a resolution. Deleting instructional history because an upstream deletion happened would violate PDR-005 and PDR-011.

---

## 9. Handling Duplicate Imports

A class already linked to a Google Classroom class cannot be linked to the same Google Classroom class twice.

If the teacher visits Import and sees a class she has already imported, that row is shown in a distinct state: "Already imported. Open in LyfeLabz." Selecting the row navigates to her existing LyfeLabz class. No second class is created.

If a class exists in LyfeLabz but was created outside the integration (a join-code class or an in-app teacher-created class), the Import surface does not silently link it to an LMS class. Linking a preexisting LyfeLabz class to an LMS class is a distinct, explicit action available in class settings. It carries a clear warning: "This class currently uses join codes. Linking it to Google Classroom will disable join codes for this class. Existing enrollments are preserved." The teacher confirms. The class transitions to an LMS-fed enrollment source.

Unlinking is available and reversible in principle. The mirror history is retained for audit; the class returns to the join-code path.

---

## 10. Multiple Schools

Some teachers work at more than one school. LyfeLabz supports this through Google Classroom by treating each connected Google account as its own connection.

A teacher signs into LyfeLabz with the identity that owns her `users/{uid}` record. She can connect Google Classroom for the account she signed in with. That connection surfaces the classes she teaches in that Google Classroom account.

If she also teaches at a second school under a second Google Workspace account, that second account is architecturally a second connection under a different LyfeLabz identity. LyfeLabz does not merge two LyfeLabz identities into one because two Google Workspace accounts belong to the same person. Merging identities is a PDR-004 concern; it is not resolved by an LMS integration.

This is a designed limitation. It preserves the closed role model, keeps the ownership model unambiguous, and matches how most teachers already keep their two schools separate.

---

## 11. Multiple Google Accounts

A teacher who tries to connect Google Classroom while signed into a Google account that is not her LyfeLabz identity sees a plain-language message: "Sign in to Google with your LyfeLabz email to connect Google Classroom."

This prevents an accidental connection to the wrong roster and prevents a class of support incidents where a teacher connects her personal Google account instead of her school account.

Reconnecting the same provider with the same identity replaces the token set. Existing links are preserved. Existing mirrored classes remain the same LyfeLabz classes; the teacher does not lose her Snapshot, her assignments, or her submission history because she reconnected.

---

## 12. Conflict Resolution

The LMS is authoritative for classroom identity, teacher ownership, and roster. LyfeLabz is authoritative for LyfeLabz assignments, the Practice Mode and Classroom Mode contract, and every learning interaction.

Every conflict resolves through this rule.

- If the LMS says a student is enrolled and LyfeLabz's mirror does not, the mirror is updated on refresh.
- If the LMS says a student was removed and LyfeLabz has submissions from that student, the submissions are preserved. The enrollment is marked `withdrawn`.
- If the LMS says the class has a new name, the LyfeLabz class carries the LMS name as its display name. The teacher can override the display name for LyfeLabz purposes without breaking the link.
- If the LMS returns an unexpected shape, the mirror is not updated and the teacher sees a plain-language message describing the outcome.
- If the LyfeLabz teacher who owns a class is no longer the LMS teacher of record, LyfeLabz does not reassign ownership. See §7.

The teacher is never asked to arbitrate a machine-machine conflict without a plain-language description of what happened.

---

## 13. Teacher Expectations

The teacher should be able to trust that:

- Importing a class from Google Classroom never sends a message, notification, announcement, or comment to students or parents.
- Refreshing a class never affects Google Classroom.
- Disconnecting Google Classroom never destroys LyfeLabz data.
- LyfeLabz never grades on her behalf.
- LyfeLabz never publishes to Google Classroom without an explicit gesture in the Assignment Dialog.
- LyfeLabz never reads content from Google Classroom that it does not need to reconcile the mirror.
- The Teacher Workspace continues to work if Google Classroom is unreachable, slow, or unavailable.
- Present Mode continues to work regardless of LMS state.

These are the trust promises the LMS Experience makes. Every design decision defers to them.

---

## 14. Error Recovery

Errors are boring by design.

- **Sign-in prompted again.** If Google's OAuth surface prompts the teacher to sign in a second time during connection, the LyfeLabz Integrations surface shows a message: "Google asked for your password again. This is expected." The teacher completes sign-in and returns.
- **Token expired.** The connection card shows: "Google Classroom needs to be reconnected." One control reconnects.
- **Refresh failed.** The class shows: "Couldn't reach Google Classroom just now. Try again in a moment." The class continues to render its last-known-good roster.
- **Import failed.** The Import surface shows: "Couldn't import this class right now." The failed row is not silently added to the classes list. The teacher can retry.
- **Publish failed.** The Assignment Dialog's Google Classroom outcome shows: "The LyfeLabz assignment was scheduled. Publishing to Google Classroom didn't succeed." The LyfeLabz assignment is authoritative. The teacher can retry publication from the class's assignment detail view.
- **Link broken.** The class banner shows: "This class no longer exists in Google Classroom." The teacher chooses the next step.
- **Ownership no longer valid.** The class banner shows: "You are no longer listed as the teacher of this class in Google Classroom." The teacher chooses the next step.

Every message is plain language. No stack trace. No jargon. No "please contact your administrator" without a description of what happened.

---

## 15. Future Publishing Workflow

Publishing a LyfeLabz assignment to Google Classroom happens inside the Assignment Dialog, not as a separate workflow.

The dialog already shapes every class row. For an LMS-linked class row, two additional affordances appear:

- an optional Google Classroom topic selector, populated from the LMS class's topics,
- an "Also publish to Google Classroom" toggle, off by default until the teacher opts in for that class.

Publishing produces a Google Classroom assignment that links back to the LyfeLabz surface where the student performs the work. LyfeLabz does not duplicate its instructional experience inside Google Classroom. LyfeLabz does not post the answer key. LyfeLabz does not post analytics.

Publishing is confirmed inside the Assign Experience's ordinary confirmation surface (see `ASSIGN_EXPERIENCE.md`). It is a single gesture inside the one dialog. It is not a second workflow.

Editing a published Google Classroom assignment (title, description, topic, availability) is not authored inside the Assignment Dialog after publication. If the teacher wants to edit the Google Classroom side of the assignment, she edits it in Google Classroom, which is the appropriate surface for that action. LyfeLabz does not become a second editing surface for LMS-authored records.

Unpublishing (removing the Google Classroom post while keeping the LyfeLabz assignment) is available on the class's assignment detail view. It is a single gesture. It does not touch the LyfeLabz assignment.

---

## 16. Future Assignment Workflow

Beyond publication, the assignment workflow is unchanged.

- The Assign Experience remains one workflow.
- One dialog, one control per class row, one confirmation.
- The default assignment date is Today.
- Points default to the total possible quiz score for the lesson.
- Session-scoped remembered preferences are respected.

LMS integration does not restructure the Assign Experience. It extends it with a small, optional column of affordances on LMS-linked class rows.

If a future sprint proposes a second Assign workflow because "the LMS integration is different," the proposal is measured against `ASSIGN_EXPERIENCE.md` and rejected.

---

## 17. Future Synchronization Philosophy

Automatic synchronization is a future capability, described here so that no future sprint invents it silently.

- Automatic synchronization is opt-in per class. A teacher who has not opted in never sees an automatic refresh.
- Automatic synchronization is rate-limited and coalesced. LyfeLabz does not poll Google Classroom on every page load. It refreshes on a cadence chosen to balance freshness against unnecessary LMS calls.
- Every automatic refresh produces the same reversible, human-readable proposal a manual refresh produces. The teacher can review the proposal and undo it.
- If the LMS's roster and the LyfeLabz mirror diverge in a way that would require destroying LyfeLabz data (for example, a student withdrawn by the LMS whose LyfeLabz submissions would otherwise be lost), the automatic path always errs on the side of preservation. It never destroys learning history.
- Automatic synchronization can be turned off on a class or on a teacher at any time. The setting is immediately effective.

Automatic synchronization ships only after manual synchronization has been used at scale and its edge cases are known. Shipping it earlier would betray the teacher trust the manual path was designed to earn.

---

## 18. The Rule LyfeLabz Never Breaks

Across every moment in this document, one rule is invariant:

**LyfeLabz extends the LMS. It never replaces it.**

The LMS Experience is measured against this rule. A proposed feature that would move LyfeLabz toward being a Google Classroom replacement, an announcements surface, a parent-communication surface, or a gradebook is declined and referred back to the appropriate district system.

The LMS Experience is a small, careful workflow that lets a teacher who already lives inside Google Classroom bring the classes she teaches into LyfeLabz without paperwork. That is all it is. That is all it should ever be.

---

*End of LMS Experience. This document defines what LMS integration should feel like for a teacher. Its architecture lives in `LMS_INTEGRATION_ARCHITECTURE.md`. Its amendments to the certified platform architecture live in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`.*
