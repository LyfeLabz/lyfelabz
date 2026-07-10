# Present Mode Architecture

Status: Architecture only. Implementation is deferred.
Companion documents: TEACHER_EXPERIENCE_PHILOSOPHY.md (§3.8, §4.5), PHASE_2_ARCHITECTURE_PLANNING_REPORT.md (§4, §6), LYFELABZ_PLATFORM_DECISIONS.md (PDR-007, PDR-011, PDR-012, PDR-017, PDR-018), LYFELABZ_PLATFORM_ARCHITECTURE.md.

This document defines the Present Mode surface at the architecture level. It is implementation-neutral. No runtime code ships as part of Sprint 6C; Present Mode remains a disabled navigation item in the Teacher Workspace.

---

## 1. Purpose

Present Mode is the teacher-controlled presentation surface used during live classroom instruction. Its purpose is narrow and load-bearing:

- Give a teacher a single, uncluttered way to present LyfeLabz curriculum resources in front of a class.
- Preserve the canonical LyfeLabz curriculum and lesson experience without duplicating it.
- Guarantee that private teacher and student information cannot be projected onto a classroom screen, even accidentally.

Present Mode is the operating expression of PDR-018 for classroom projection. It is not a second Teacher Workspace with sensitive panels hidden by CSS; it is a structurally separate surface.

---

## 2. Relationship Between Teacher Workspace and Canonical LyfeLabz

The Teacher Workspace (`/app/**`) is the authenticated teacher shell. It owns the persistent left-side navigation, the workspace outlet, identity, and the immutable Session Object.

The canonical LyfeLabz surface is the static instructional repository served from the repository root by Firebase Hosting. It owns:

- the curriculum index page (`index.html`),
- every lesson, investigation, simulation, extension, game, engineering challenge, disease, and system page,
- the grade and topic filter box,
- the canonical student-facing navigation between resources.

These two surfaces share one Firebase Hosting origin. They do not share a build system, a stylesheet, or a JavaScript runtime. The canonical surface has no client-side router and imports no Firebase SDK. This separation is the structural foundation on which Present Mode is built.

Present Mode is the act of a teacher entering the canonical surface from an authenticated Teacher Workspace context, using the canonical curriculum experience unmodified, and returning to the Teacher Workspace when finished. It is not a route inside `/app/**` and it is not a parallel curriculum implementation.

---

## 3. Navigation Into Present Mode

Entry into Present Mode is an explicit teacher action inside the Teacher Workspace. The intended contract is:

- The `Present Mode` navigation item on the left-side panel is enabled.
- Selecting the item performs a full-page navigation (or opens a new tab) to the canonical LyfeLabz curriculum surface at `/`.
- Before navigating, the Teacher Workspace records a small opaque return-context marker so that a subsequent exit returns to the correct workspace path.

The return-context marker contains only a workspace path (for example `curriculum` or `class/{opaqueClassRef}`). It contains no student names, no scores, no class data, no accommodations, and no teacher notes. It is stored on the client only; it is never written to Firestore and never sent to a callable.

Present Mode never renders inside the Teacher Workspace router. Rendering the canonical curriculum inside the Teacher Workspace surface tree would violate PDR-018 (no parallel implementation) and the surface-boundary rule (§4.5 of the philosophy).

The choice between same-tab and new-tab navigation is a Present Mode implementation-sprint decision. Same tab is simpler; new tab preserves teacher-side state against accidental navigation. Either mechanism is compatible with this architecture.

---

## 4. Navigation Back to the Teacher Workspace

Exit from Present Mode is a teacher-controlled action rendered on top of the canonical surface. The intended contract is:

- When a return-context marker is present, a small exit affordance is visible on the canonical surface.
- The exit affordance is a single element whose only capability is navigation. It has no access to session data, no Firebase SDK import, and no privileged callable surface.
- Selecting the affordance navigates back to the recorded Teacher Workspace path.
- If the marker is absent (for example, a public browser opened the canonical surface directly), no exit affordance is shown, and the canonical surface behaves exactly as it does for a public visitor.

Whether the exit affordance is rendered by an inline overlay on the canonical `index.html`, a small standalone script, or a lightweight adjacent page is a Present Mode implementation-sprint decision. The affordance must remain small, isolated, and free of session-scoped data.

The teacher may also exit Present Mode by closing the tab, using browser navigation, or entering a different URL. None of these paths leak teacher-scoped data because the canonical surface has none loaded.

---

## 5. Security Expectations

Present Mode is a restricted presentation surface. Its security posture is enforced at the surface boundary, not by conditional rendering.

- The Teacher Workspace bundle is not shipped to the canonical surface. This is the primary and load-bearing guarantee.
- The canonical surface does not import the Firebase Authentication, Firestore, or Functions SDK. No authenticated Session Object is reachable from Present Mode.
- Firebase Authentication persistence is per-origin. The Present Mode implementation sprint must confirm that no future script added to the canonical origin reads the authenticated Auth state. If a future feature ever requires that, it is a PDR-012 auth-surface expansion and requires a written decision record.
- The exit affordance and any return-marker script must be limited in capability to navigation only.
- No new custom claim, no new lifecycle field, and no new Session Object field is introduced by Present Mode.

Present Mode does not weaken the default-deny Firestore Rules. Rules remain authoritative for every read and write. Present Mode simply does not perform any read or write.

---

## 6. Privacy Expectations

Present Mode is designed to be safe to project onto a classroom screen at all times. Its privacy posture is:

- No student personally identifiable information is loaded.
- No score, mastery, accommodation, or classroom metadata is loaded.
- No teacher private preference or teacher note is loaded.
- No assignment-management or activation control is rendered.

These guarantees are structural, not conditional. Because the canonical surface has no access to the authenticated Session, no code path inside Present Mode can retrieve teacher-scoped or student-scoped records.

The privacy contract in Present Mode is stronger than the classroom-mode privacy contract on the canonical surface today. It is the safest surface LyfeLabz owns for projection.

---

## 7. Data That Must Never Be Available in Present Mode

Present Mode must never load or display:

- student names,
- student email addresses or opaque student identifiers,
- assignment records,
- submission records,
- scores or mastery signals,
- accommodation or modification records,
- class rosters or class metadata,
- teacher notes,
- teacher private preferences,
- teacher identity beyond what the canonical surface already renders publicly (none today),
- any audit event vocabulary or admin surface.

This list is not exhaustive. The intent is that any teacher-scoped or student-scoped record defined in the Firestore Data Model is out of scope for Present Mode. Present Mode's data contract is: the canonical curriculum only.

---

## 8. Grade and Topic Filtering Behavior

Present Mode uses the canonical curriculum filter box (`.filter-pill`, `.fp-grade`, `.fp-topic`) exactly as it exists today. No parallel filter is introduced.

- All grades are reachable regardless of what a teacher teaches.
- All topics are reachable regardless of the resources activated for the teacher's classes.
- Every lesson, investigation, simulation, extension, game, engineering challenge, and other resource type is browsable and presentable.

This is deliberate. Present Mode is a browsing and presentation surface, not a curation surface. Activation and hiding (PDR-010) affect what students can access; they do not affect what a teacher can present.

---

## 9. Grade Persistence Strategy

The canonical curriculum surface today does not persist grade or topic selection. A teacher's most-recent selection is retained only within a single tab session by the existing filter box behavior.

For the Present Mode implementation sprint, grade persistence has two viable levels:

- **No persistence.** The teacher chooses grade each time they enter Present Mode. Simplest; matches current canonical behavior.
- **Per-device persistence.** A small `localStorage` value on the canonical origin remembers the most recent grade. Cheap, private, does not require a Firestore write. Sufficient for teachers who use one device.

Cross-device persistence of a teacher's preferred grade is a teacher-preferences record concern, not a Present Mode concern. It is documented in §7 of the Phase 2 Architecture Planning Report and requires the Teachers domain sprint specification.

Present Mode must not read grade preference from a teacher-scoped Firestore record at runtime, because doing so would require loading the Session or a service credential into the canonical surface, which is prohibited by §5 and §6.

If per-device persistence is chosen, its `localStorage` key must be namespaced so it cannot collide with future instructional-side keys.

---

## 10. Future Teacher Preference Considerations

Teacher preferences that touch Present Mode may include:

- default grade or grade set (single or multi-grade teachers),
- default topic filter,
- preferred exit behavior (same tab, new tab),
- preferred entry surface if Present Mode ever grows a landing dashboard.

None of these ship inside Present Mode. Each becomes a field on a future teacher-preferences record defined by the Teachers domain sprint specification. Until that record exists, Present Mode either has no persisted preference (option A in §9) or a per-device fallback (option B in §9).

Any teacher preference that must survive device change requires the teacher-preferences architecture pass. No preference is persisted on `users/{uid}`.

---

## 11. URL and Navigation Strategy

Present Mode uses public canonical URLs.

- The entry URL is the canonical curriculum root: `/`.
- Individual lesson URLs are canonical file paths: for example `/lesson_earths-layers.html`.
- The Teacher Workspace never registers a client-side route that matches a canonical URL. The Hosting rewrite `{"source": "/app/**", "destination": "/app/index.html"}` already scopes the client router to `/app/**`.
- Return navigation targets `/app/<recorded-path>`.

The recorded path is opaque to the canonical surface. It is treated as a string to hand back to the Teacher Workspace, not as data to interpret.

Whether the return-context marker lives in `sessionStorage`, a URL fragment (`/app/#return=…`), or another lightweight mechanism is a Present Mode implementation-sprint decision. Either mechanism preserves the immutable Session Object contract and introduces no new Firestore record, callable, or claim.

Persistent restoration across tabs (for example, restoring the exact class workspace tab a teacher had open before entering Present Mode) is not proposed. Teacher workspace context is treated as tab-local.

---

## 12. Why Present Mode Launches the Canonical LyfeLabz Experience

Present Mode launches the canonical LyfeLabz experience rather than duplicating the curriculum for four reasons.

**PDR-007 canonical experience.** The instructional experience lives once, at the repository root. Duplication would fragment the canonical experience and require every instructional improvement to ship twice.

**PDR-018 no parallel implementation.** A parallel Present Mode curriculum inside `/app/**` would be a competing implementation of the canonical surface. Sprint teams would rediscover the same rendering, filter, and lesson bugs in two places.

**Structural privacy guarantee.** A Present Mode surface built inside `/app/**` shares a JavaScript runtime with the Teacher Workspace. The runtime can read the authenticated Session Object. A separate origin path for Present Mode preserves the guarantee that teacher-scoped data cannot be projected, even by accident. This is the structural expression of §3.8 and §4.5 of the philosophy.

**Preservation-mode alignment.** The canonical instructional surface is preserved by the repository hardening rules in `CLAUDE.md`. Present Mode inherits those guarantees at no cost by reusing the canonical surface directly.

The trade-off is that Present Mode cannot layer teacher-scoped controls directly on top of a lesson while inside Present Mode. That is the correct trade-off: teacher-scoped controls belong to the Teacher Workspace, not to a classroom projection surface.

---

## 13. Future Implementation Considerations

The following decisions are recorded for the Present Mode implementation sprint. None are resolved by this document.

- **Return-context marker mechanism.** `sessionStorage` versus URL fragment. See §11.
- **Entry tab behavior.** Same tab versus new tab. See §3.
- **Exit affordance mechanism.** Inline overlay versus standalone script versus adjacent page. See §4.
- **Return-marker namespace.** The exact key or fragment name, chosen so it cannot collide with future instructional-side keys.
- **Grade persistence choice.** No persistence versus per-device `localStorage`. See §9.
- **Content Security Policy.** Whether the exit affordance requires a CSP adjustment on the canonical origin.
- **Cache correctness.** Whether the exit affordance script must be revved or versioned to survive Hosting cache behavior.
- **Analytics.** Whether a small non-identifying entry and exit signal is desired. If so, it is a separate architecture pass and must not read authenticated Session data.
- **Interaction with future Google Classroom integration.** Present Mode is separate from any assignment-publishing workflow. If Google Classroom integration later requires a projection surface, it composes with Present Mode rather than replacing it.

Each of these is scoped to the Present Mode implementation sprint. None expand the certified architecture, add a Firestore record, add a callable, add a claim, add a lifecycle field, or add an audit vocabulary term. If any implementation decision later requires one of those changes, it is a formal architecture amendment and requires its own decision record.

---

*End of Present Mode architecture. This document defines the surface at the architecture level. Implementation is deferred to a dedicated Present Mode sprint that must reference this document and the Teacher Experience Philosophy.*
