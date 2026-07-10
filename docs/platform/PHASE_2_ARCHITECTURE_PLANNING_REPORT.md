# Phase 2 Architecture Planning Report

Status: Planning
Companion documents: TEACHER_EXPERIENCE_PHILOSOPHY.md, LYFELABZ_PLATFORM_DECISIONS.md (PDR-018), TEACHER_PLATFORM_DOMAIN_ROADMAP.md, LYFELABZ_PLATFORM_ARCHITECTURE.md

This report inspects the current repository against the teacher-experience philosophy and records the architecture questions that Phase 2 must answer before Sprint 6C implementation begins. It is planning material, not an implementation specification.

---

## 1. How the original LyfeLabz index and lesson experience are currently delivered

The instructional experience is a flat static site at the repository root:

- `index.html` at repo root - the canonical curriculum page. Contains the grade/topic filter box (`.filter-pill`, `.fp-grade`, `.fp-topic` in the inline `<style>` block).
- `lesson_*.html`, `investigation_*.html`, `simulation_*.html`, `extension_*.html`, `game_*.html`, `challenge_*.html`, `disease_*.html`, `system_*.html` at repo root - one HTML file per resource.
- Assets and shared stylesheets live at the repo root and in a small set of subdirectories (`mission-control/`, `wonderbox/`, `blog/`).

There is no client-side router. Navigation between the curriculum page and a lesson is a full-page load. The public URL of a lesson is its filename, per PDR-007 and PDR-009 (governed by the safe-rename checklist in CLAUDE.md).

Firebase Hosting serves this surface from `platform/firebase/firebase.json` with `"public": "../.."`, meaning Hosting serves the repository root. The `ignore` array excludes `platform/**`, `docs/**`, and `blog/**` from the deploy set.

## 2. How the authenticated Teacher Workspace is currently delivered

The Teacher Workspace is a single-page TypeScript application under `app/`:

- Entry point: `app/index.html` + `app/src/index.ts`.
- Session bootstrap: `app/src/session/bootstrap.ts` produces the immutable Session Object per Sprint 3.
- Router: `app/src/router/router.ts` dispatches to one of the surfaces enumerated in `app/src/router/routes.ts` based on the Session `kind`.
- Teacher Shell: `app/src/shell/shell.ts` renders header, top-nav (`navigation.ts`), a single workspace outlet (`surfaces/workspace.ts`), and footer.
- Active workspace surfaces today: `home` and `classes`. `students`, `assignments`, and `settings` render coming-soon placeholders.

The shell reads only session-derived fields plus data returned by injected fetchers (`listClasses`). It opens no Firestore listeners directly.

## 3. Do these surfaces use separate entry points, routers, or hosting paths

Yes.

- Original LyfeLabz curriculum: served from the repository root by Firebase Hosting. No router. Direct file paths.
- Authenticated Teacher Workspace: served from `/app/**`, with the Hosting rewrite `{"source": "/app/**", "destination": "/app/index.html"}`. Client-side router runs inside `/app/index.html`.

The two surfaces share one Firebase Hosting origin. They do not share a build system, a stylesheet, or a JavaScript runtime. They cross into each other only through anchor links (see `app/src/shell/surfaces/home.ts`, which renders `<a href="/">Return to public lessons</a>`).

This separation is structurally clean. It is also the primary reason Present Mode can be implemented without introducing a duplicate curriculum: the canonical curriculum surface already lives at a URL every authenticated tab can navigate to.

## 4. The safest architecture for entering and exiting Present Mode

Present Mode is a genuinely restricted presentation surface (§3.8 of `TEACHER_EXPERIENCE_PHILOSOPHY.md`; PDR-018b, PDR-018c). The safest architecture is:

**Entry.**

- Present Mode is a navigation action inside the Teacher Workspace that transitions the tab (or a new tab) to the canonical curriculum surface at `/`.
- Before transition, the Teacher Workspace records a small opaque return-context marker in `sessionStorage`. The marker contains only the workspace path the teacher was on (for example `curriculum`, or `class/{opaqueClassRef}`). It contains no student names, no scores, no class data, no accommodations, no teacher notes.
- The canonical curriculum surface, when loaded, has no access to the authenticated Session Object because it is a separate document under a different top-level path with no shared script bundle.
- Firebase Authentication persistence is per-origin, not per-path. This means an authenticated Firebase user session may still be reachable from the canonical surface if it later ships client-side Firebase SDK calls. Today the canonical surface does not import the Firebase SDK, so no session data is loaded. Present Mode must preserve that property: the canonical surface must remain free of any script that reads the authenticated Session.

**Exit.**

- A small teacher-controlled exit affordance is rendered on top of the canonical curriculum surface when a return-context marker is present.
- Selecting exit navigates back to `/app/<recorded-path>`.
- The affordance is a single element (a floating button or a top strip) whose only capability is navigation. It has no access to session data.

**Non-negotiables.**

- Present Mode never loads teacher-only data. This is enforced by not shipping the Teacher Workspace bundle to the canonical surface, not by conditional rendering. See PDR-018c.
- Present Mode is not a route inside `/app/**`. Rendering the canonical curriculum inside the Teacher Workspace router would violate PDR-018b (no parallel implementation) and PDR-018c (surface boundary must be structural, not cosmetic).

**Open questions for the Phase 2 Present Mode architecture sprint.**

- Whether the exit affordance is added as an inline overlay on the canonical `index.html`, or as a small standalone script served alongside it, or as a lightweight adjacent page. Each option has trade-offs for CSP, cache correctness, and the preservation-mode rule that discourages editing canonical instructional pages.
- Whether the return marker should be namespaced in `sessionStorage` under a key that cannot collide with future instructional-side keys.
- Whether Present Mode should open in the same tab or a new tab. Same tab is simpler; new tab is safer against accidental teacher-side state loss.

These are architecture decisions for the Present Mode sprint. They are not resolved here.

## 5. How to avoid duplicating curriculum files or creating a competing router

- The canonical curriculum surface (`index.html` and the resource HTML files at the repository root) remains authoritative. Per PDR-007 and PDR-018b, no duplicate copy is created inside `/app/**`.
- The Teacher Workspace curriculum landing page (Sprint 6D) references the canonical surface rather than embedding lesson content. Referencing may be as simple as anchor links, or as sophisticated as an overlay that renders teacher controls on top of the canonical surface. The Phase 2 Curriculum Landing sprint decides.
- The Teacher Workspace never registers a client-side route that matches a canonical curriculum URL. The `/app/**` rewrite already prevents this at the Hosting layer, and the router in `app/src/router/routes.ts` never adds routes outside `/app/**`.
- If a future sprint proposes to fetch canonical HTML fragments into the Teacher Workspace, that proposal is a PDR-017 divergence and requires a written decision record. The default answer is no.

## 6. How teacher workspace context could later be restored after exiting Present Mode

Two mechanisms are viable.

- **`sessionStorage` return marker.** Simplest. Survives full-page navigation within the same tab. Cleared on tab close. Cannot leak across origins. Contains only a workspace path.
- **URL-fragment return marker.** The exit affordance navigates to `/app/#return=<opaque-path>`. Slightly more visible; robust against `sessionStorage` being cleared by extensions.

Either mechanism is compatible with the immutable Session Object contract. Neither introduces a new claim, lifecycle field, or Firestore collection. The choice is deferred to the Present Mode sprint.

Persistent restoration across tabs (for example, restoring the exact class workspace tab a teacher had open before entering Present Mode) is not proposed. Teacher workspace context is treated as tab-local.

## 7. Where a persistent grade/topic preference should eventually live

The canonical curriculum surface today reads grade/topic filter state from user interaction only. It does not persist a preference.

Persistent preference options:

- **Local (per-device):** `localStorage` on the canonical origin. Cheap, private, does not require a Firestore write. Sufficient for teachers who use one device.
- **Server (per-teacher):** a `teachers/{uid}/preferences` document or a field on a future teacher-preferences record. Portable across devices. Requires rules, a callable, and audit vocabulary. Aligns with the Teachers domain in the roadmap.

Recommendation for the philosophy-level answer: persistent grade/topic preference lives on the teacher-preferences record introduced by the Teachers domain sprint specification. Until that record exists, a local-only fallback is acceptable for the Curriculum Landing sprint, on the understanding that it is a per-device convenience and not a durable preference.

Do not persist preferences on `users/{uid}` itself. Per the certified data model, `users/{uid}` is owned end-to-end by the Identity domain and its shape is not extended by teacher preferences.

## 8. Which decisions require a future teacher-preferences architecture specification

The following require a formal teacher-preferences architecture pass before implementation:

- Persistent grade selection (single or multi-grade).
- Persistent topic filter defaults.
- Persistent left-side navigation state (for example, which classes are pinned).
- Any private note or reminder attached to a teacher.
- Any teacher-configured display preference that must survive device change.

Each of these belongs on a teacher-owned record whose ownership, security rules, callable set, and audit vocabulary are defined by the Teachers domain sprint specification. None of them ship inside Sprint 6C or 6D.

Accommodations and student-support configuration (§3.7 of the philosophy) require their own architecture specification, separate from teacher preferences, because they carry FERPA/COPPA implications under PDR-011 and PDR-012.

## 9. Which decisions require Google Classroom API research and a separate integration architecture phase

The following require a dedicated Google Classroom integration architecture pass:

- Publishing an assignment from LyfeLabz into Google Classroom.
- Selecting a Google Classroom topic during LyfeLabz assignment authoring.
- Reading course and roster information from Google Classroom to reduce duplicate teacher effort.
- Any OAuth scope beyond the current sign-in scope.

Each of these touches PDR-011 (third-party data disclosure), PDR-012 (auth surface expansion), and PDR-015 (documented demand). No integration ships in the current sprint sequence. When demand is documented, an integration architecture phase inspects the Google Classroom API surface, defines the OAuth scope escalation path, defines the LyfeLabz-side data boundary, and produces a sprint specification. Until that phase begins, teacher-facing copy in Sprint 6C and 6D does not promise Google Classroom features.

PowerSchool integration is a separate, later, and lower-priority integration pass. LyfeLabz does not compute a grade of record; there is no near-term motivation to write into PowerSchool.

## 10. The recommended next implementation sprint

**Recommended Sprint 6C scope: Teacher Workspace navigation restructuring.**

See §11 for the full recommendation.

The Classroom Detail Workspace previously proposed as Sprint 6C should be re-scoped as a later Phase 4 sprint. It is not the correct next step because:

- The left-side navigation is a prerequisite for a clean class workspace entry point.
- A class detail surface built into the current top-nav shell would be reworked as soon as the left-side navigation lands.
- The teacher-experience philosophy names the left-side navigation as a load-bearing UX pattern (§3.3). Building around it first respects PDR-017 (one canonical way).

---

## 11. Sprint 6C Recommendation (Narrow Scope)

**Sprint 6C - Teacher Workspace Navigation Restructuring.**

**Objective.** Replace the Sprint 6A/6B top-nav with the persistent left-side navigation defined in §3.3 of `TEACHER_EXPERIENCE_PHILOSOPHY.md`.

**In scope.**

- Left-side navigation panel with items: LYFELABZ, Curriculum, Classes, Present Mode, Settings.
- LYFELABZ returns to Curriculum.
- Curriculum renders the Sprint 6B Home surface renamed to Curriculum until Sprint 6D delivers the curriculum landing bridge. Renaming is a copy-only change; the surface behavior is identical.
- Classes renders the Sprint 6B Classes surface unchanged.
- Present Mode and Settings render coming-soon surfaces under the exact contract used for unavailable navigation items in Sprint 6B (`shell-nav-disabled`, `Coming soon` label, disabled button, no dispatch).
- Existing shell tests are updated to reflect the new navigation shape. New tests cover the left-panel structure and the coming-soon contract for Present Mode and Settings.

**Out of scope.**

- Any Firestore read change.
- Any new callable.
- Any new claim, lifecycle field, or Session Object field.
- Any curriculum content inside the shell (Sprint 6D).
- Present Mode runtime (deferred).
- Settings runtime (deferred).
- Class detail workspace (deferred to Phase 4 or later).

**Architectural risks.**

- Renaming Home to Curriculum could imply that the surface already displays curriculum content. Mitigation: the surface's own headline text names it as a transitional surface until Sprint 6D.
- The left-side panel could grow inline surfaces that duplicate future workspace outlets. Mitigation: strict adherence to the single-outlet contract from Sprint 6A.

**Exit criteria.**

- Existing router, session, and shell tests remain green.
- New navigation tests cover the five items and the coming-soon contract for Present Mode and Settings.
- No runtime source file outside `app/src/shell/**` is modified.
- No Firestore rule, callable, or claim is modified.
- Preservation mode remains intact: no file at the repository root is modified.

---

*End of report. This planning document scopes the next Phase 2 sprint. It does not authorize implementation.*
