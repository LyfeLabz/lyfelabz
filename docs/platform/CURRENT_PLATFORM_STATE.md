# LyfeLabz Current Platform State

**Status:** Canonical current-state reference.
**Purpose:** Orient a fresh session to the currently certified LyfeLabz platform without reconstructing it from sprint history.

---

## 1. Purpose and Usage

This document defines the **currently certified state** of the LyfeLabz platform and the invariants that must be preserved. Begin here.

- It is **not** a changelog and **not** sprint history. It records what is true now, not how it got here.
- Historical sprint reports (`SPRINT_*`) are **evidence**, not the onboarding path. Read them only for the reasons in Section 14.
- For a task, read: (1) this document, (2) the current sprint definition if one is active, (3) only the subsystem canonical docs the routing table (Section 13) points you to, then (4) the relevant source.
- This document is **replaced in place** as the architecture evolves. Do not append history to it. If it starts to grow past ~800 lines or accumulates dated narrative, that is drift; trim it back to current state.
- Where this document and a subsystem canonical contract conflict on detail, the **subsystem contract controls** and this document must be reconciled. This file summarizes and routes; it does not override contracts.

Load-bearing claims below are grounded in the canonical specs named in Section 13 and verified against the repository working tree.

---

## 2. Platform Overview

LyfeLabz is a standards-driven middle-school science learning platform (Massachusetts 2016 STE Framework). It has two layers:

- **Instructional layer.** Self-contained, public, mobile-first HTML lessons served statically. No runtime dependency on auth, Firestore, or Cloud Functions. Anonymous visitors can always read them.
- **Platform layer.** An authenticated coordination fabric around the lessons: identities, classes, rosters, assignments, assessment attempts, and teacher visibility. It is deliberately **not** an LMS (no gradebook, planner, calendar, messaging, or analytics-surveillance surface).

Major surfaces in the current build:

- **Public curriculum:** 50 v1 lessons served from the repo root (`/lesson_<slug>.html`), plus supporting types (investigations, simulations, extensions, engineering challenges, games).
- **Authenticated v2 lessons:** 49 lessons under `/app/lessons/`, consuming platform identity and the certified assessment runtime.
- **Teacher Workspace:** class creation/import, roster views, Curriculum/Assign, assignment publication, per-assignment monitoring.
- **Student Workspace:** exactly `My Assignments` and `My Results`.
- **Firebase backend:** Google Sign-In (Firebase Auth), Firestore (system of record), Cloud Functions (server authority).
- **Google Classroom integration:** connect, import classes, roster sync, one-way assignment publication, deep-link student launch.
- **Assessment system:** server-authoritative sessions → attempts → scoring against confidential answer keys.

Hosting: **Firebase Hosting is the sole production origin, `https://lyfelabz.com/`.** Public curriculum from the repo root; the authenticated platform under `/app/**` (path-based routing). GitHub Pages is retained only as a migration safety net and is being retired.

---

## 3. Environment and Repository Structure

Routing map (where to look, not an exhaustive inventory):

| Path | Contains |
| --- | --- |
| `/` (repo root) | 50 public v1 `lesson_<slug>.html` artifacts, other public instructional pages, `index.html`, `sitemap.xml`, `CNAME`. **Generated** lesson artifacts — do not hand-edit (see Section 10). |
| `lesson-sources/` | Canonical instructional source for the deterministic lesson build. Excluded from Hosting; never served. The only place instructional edits propagate from. |
| `app/` | Authenticated platform client (TypeScript, esbuild). |
| `app/src/` | Client surfaces: `shell/` (workspace surfaces: `classes`, `curriculum`), `assignments/detail/`, `router/surfaces/`, `assignments/studentList/launchOverrides.ts`, `runtime/` (assessment runtime entry). |
| `app/lessons/` | 49 generated **v2** authenticated lesson artifacts. Generated — do not hand-edit. |
| `app/scripts/lessonBuilder/lessons/*.cjs` | 50 per-lesson build configs (declarative). |
| `platform/functions/` | Cloud Functions (TypeScript, ts-jest). `src/` domains: `students/`, `lms/`, `assessments/`, `shared/identity/`, `shared/firestore/`. Sole home of server authority. |
| `platform/firebase/` | Firestore Security Rules + rules tests (`tests/**/*.rules.test.ts`, run under the Firestore emulator). |
| `docs/platform/` | This file + canonical contracts/specs + sprint history/evidence. |
| `assets/` | Shared runtime JS (e.g. the active assessment runtime bundle). |
| `mission-control/`, `blog/`, `ball*/`, `wonderbox/` | Peripheral/experimental; not part of the certified platform. Ignore unless a task names them. |

Test/build entry points:

- App: `npm --prefix app run verify` (curriculum:verify → lessons:verify → typecheck → lint → test). Tests are Jest.
- Functions: `npm --prefix platform/functions test` (Jest). Current baseline: **91 suites / 1708 tests pass**.
- Rules: `npm --prefix platform/firebase run test:rules` (spins the Firestore emulator, then Jest).

---

## 4. Authentication and Teacher Access

**Authentication is not authorization.** Google Workspace authenticates; the platform authorizes.

- **Sign-in:** Google Sign-In via Firebase Authentication. Anonymous exploration is allowed and produces no identity record and no attempt.
- **Authorization** is expressed by custom claims `role`, `schoolId`, `districtId`, written **only** when the user's `status` is `active`. The server-authoritative record is `users/{uid}`.
- **Account lifecycle** (`status` on `users/{uid}`): `provisioned` → `pendingVerification` (teachers only) → `active`. `awaitingFirstSignIn` is a **roster-level** placeholder state, not a user state. Suspension/archival are reserved states.
- **Two identity families:** teacher and student. Neither silently becomes the other.
- **Teacher verification** is the gate to any teacher capability. Preferred path: a one-time, institution-bound **verification code** (single-use, expiring, district+school-bound). Fallback: **Request Teacher Access** (Platform Administrator approve/deny). Personal Google accounts are refused for teacher onboarding (`auth.activationRejected`, no state change). Unverified teachers cannot create classes, import, mint join codes, view rosters, or read student data.
- **Pilot allowlist guardrail (Sprint 29C, pilot-release control).** A narrow, server-side, belt-and-suspenders gate at the approval boundary: `teachersApproveVerification` refuses activation unless the target's server-trusted email (read from `users/{uid}`, never the request payload) is a member of the `platformConfig/teacherPilotAllowlist` document. Admin approval remains the primary mechanism; both are required. The allowlist document is denied to every client role at the Rules layer, so pilot emails never reach a client. The check precedes every write, so a non-allowlisted approval fails atomically (`teachers.pilotNotAllowlisted`, no status/claims mutation). Membership is a Firestore data edit needing no redeploy. See `TEACHER_PILOT_ALLOWLIST.md`.
- **Canonical session bootstrap** (one per surface, no ad-hoc re-derivation): Firebase Auth → custom claims (after forced token refresh) → one self-read of `users/{uid}` → authorization posture → school context → one immutable **Canonical Session Object**. On claims/record disagreement, **the Firestore record wins**.
- **Onboarding claims self-heal:** the onboarding callables (`students-complete-onboarding`, `students-complete-lms-onboarding`) idempotently re-assert `role`/`schoolId`/`districtId` from the authoritative record if missing or stale, failing closed (no partial writes).
- **Return-to-location:** authentication becomes required only when a capability needs identity; after sign-in the user returns to where they were.

Planned, **not** current: parent accounts, school/district administrator dashboards, additional identity providers. Do not treat these as implemented.

---

## 5. Google Classroom Integration

Current certified integration. Google Classroom is the only supported external provider (`lmsProviders` = `googleClassroom`); the provider abstraction is preserved for future adapters.

- **Connection model:** `lmsConnections`, one document per `(teacher, provider)`. Records granted OAuth scopes, a token **reference** (not the token), and connection status. Tokens (access + refresh) are **server-only**, never in client-readable Firestore, a callable response, or a URL.
- **Incremental OAuth (scope widening):** the initial connection requests the **minimum read-only scope** to list the teacher's classes and read a class roster. Additional scope (e.g. to publish) is requested only when the teacher starts the workflow that needs it. Read-only connection state and publication scope are distinct.
- **Revocation / reconnect:** an authorization error marks the connection `revoked`, marks affected class links `stale`, and prompts the teacher to reconnect. Reconnecting an already-connected provider **replaces the token set** and preserves existing links (a distinct `reconnect` intent, not a fresh credential).
- **Class discovery + import:** the teacher imports a Classroom course; import creates an **LMS-linked** class (`lmsClassLinks`) and pulls the current roster. One active link per LyfeLabz class.
- **Roster authority = Google Classroom** for linked classes; the LyfeLabz roster is a mirror. **Roster sync** is teacher-initiated refresh at v1 (client roster sync landed Sprint 24B); continuous/automatic sync is a reversible opt-in future capability.
- **Identity matching / external identity bridging:** primary key is the **Google Classroom User ID**; email is a secondary validator only. A roster import creates `awaitingFirstSignIn` placeholders; the student's **first Google sign-in** provisions the LyfeLabz student identity and transitions the placeholder to Active (atomic, idempotent). Ambiguous matches are held for administrative resolution, never resolved by the student.
- **Ownership drift / broken link:** publication and refresh detect when the caller is no longer the Classroom teacher-of-record (`ownership-drift` → link `stale`) or the upstream course is deleted (broken link). LyfeLabz never silently reassigns class ownership.
- **Publication capability** (one-way): see Section 7.

LyfeLabz **never** posts to the Classroom stream, comments, messages, grades/grade-backs, or reads other people's Classroom content. Every Classroom API call originates server-side under the owning teacher's OAuth grant; clients never call Classroom directly.

---

## 6. Class and Roster Model

- A **class** has exactly one teacher owner, one school, one school year, one **roster authority**, and one **enrollment source**. Classes are **archived, never deleted**.
- **Two creation paths:**
  - **Import from Google Classroom** → LMS-linked; roster authority = Classroom; students join by signing in (no join code).
  - **Create Class Manually** → LyfeLabz-owned; roster authority = LyfeLabz; a join code is minted at creation.
- **Setup / activation:** a newly created/imported class may require setup (grade/block metadata) before it is fully usable; teacher default class metadata is governed by `ADR_TEACHER_DEFAULT_CLASS_METADATA.md`. Roster/activation state is shown visually and never by color alone.
- **Join codes** (manual classes only): server-minted, unique, rotatable, revocable, disabled on archive. Redemption requires an authenticated Google session and is atomic + idempotent. **Redemption against a linked class is refused server-side.** No hybrid roster authority exists.
- **Enrollment** state vocabulary: `active`, `transferred`, `withdrawn`, `archived`. Enrollments are never deleted; history is preserved.
- **Transfers** within a district preserve the permanent LyfeLabz Student ID; cross-district moves create a new identity in the new district (no automatic cross-district linking).

Invariants: one roster authority per class; imports and join-code redemptions are idempotent; no duplicate enrollments for a `(student, class)` pair.

---

## 7. Assignment and Publication Model

- **`assignments/{assignmentId}`** is the single load-bearing identity for authorization, activation, and every attempt-bearing operation. One assignment per class per activity. It owns activation, window, `mode` (`practice` | `classroom`), and `activityId`/`lessonSlug`. `status` ∈ `draft` | `published` | `closed` | `archived`.
- **Fan-out:** assigning one activity to multiple classes produces one assignment **per class**; it never shares an assignment across classes.
- **Activation vs publication are separate.** Activation controls access inside LyfeLabz; publication sends the assignment into Google Classroom.
- **Publication (`lmsAssignmentPublish`)** is a one-way, server-mediated write producing one Classroom coursework record per `(assignment, class)`, carrying a **single deep-link material** (Section 8) and the LyfeLabz title. It requires a `linked` class link and an active connection with the widened scope. Optional Classroom **topic** is supported. It writes `lmsAssignmentPublications/{publicationId}` and the optional `assignments/{id}.lmsPublicationRef`. Absence of `lmsPublicationRef` must never block an assessment operation.
- **Retry / idempotency:** publication deduplicates on a client-supplied idempotency marker + a deterministic `publicationId`; retries are safe; 5xx/rate-limit retried within budget then `provider-unavailable`; 4xx not retried (`provider-refused`).
- Refused for cross-district, cross-teacher (`caller.uid !== assignment.teacherId`), unlinked/stale/broken links, or revoked connections. **Never** pushes a score, completion, or grade into Classroom (grade-back is permanently out of scope).

---

## 8. Student Launch and Access Control (security-sensitive)

- **Deep-link URL shape (only):** `https://lyfelabz.com/app/a/{assignmentId}`. `https` only, canonical host only, no query/fragment. The URL **must not** carry a student/teacher/school/district id, token, OAuth code, score, session id, Classroom coursework id, answer-key material, or lesson slug. `assignmentId` is not a secret but **confers no authorization on its own**.
- **Resolver `lmsDeepLinkResolve`** (student callable, **read-only** — never creates/mutates a session or attempt) enforces, in order: authenticated → `role === student` → `status === active` → assignment exists → `districtId` claim matches assignment → **active enrollment in the assignment's class** → assignment `status` is `published` or `closed` (refuse `draft`/`archived`). It returns `internalTarget` and `attemptContext` (`authorized` | `informational`).
- **Signed-out arrival:** the `/app/**` bootstrap establishes identity first, **preserves the arriving URL through the sign-in round trip**, then dispatches. Silent arrival = no class/assignment picker, but identity is still established.
- **Recipient enforcement / closed assignments:** a non-enrolled caller is refused (`enrollment-inactive`); a closed window without grace and an archived assignment are informational/refused, not attemptable. `Referer` is never trusted as authorization.
- **No unauthorized attempt creation:** the resolver never touches `assessmentSessions/*` or `attempts/*`; only the assessment callables do (Section 9).
- **External identity bridging:** a Classroom-arriving student is authorized against **LyfeLabz state alone**; the Classroom account maps to the LyfeLabz identity via first-sign-in activation + identity matching (Section 5). The resolver is Classroom-agnostic.

---

## 9. Assessment System

- **Attempt is authoritative.** There is no separate "submission" entity. A distinct **Session** holds transient, resumable, autosaving working state (24h expiry → archived → recoverable within a bounded window).
- **Callables:** `assessmentSessionsBegin` (sole session creator), `assessmentAttemptsFinalize` (sole writer of `attempts/*`; runs the scorer), `assessmentSessionsSweepExpired`, `assessmentSessionsRecover`.
- **Collections:** `assessmentSessions`, `attempts`, `attemptRollups`, `assignmentRollups`, `assessmentRevisions`, `assessmentAnswerKeys`.
- **Server-authoritative scoring** against `assessmentAnswerKeys/{revisionId}`. Answer keys are the confidentiality boundary: Security Rules refuse **all** client reads/writes for **every** role including `platformAdministrator`; only the scorer reads them at request time. No answer key ever appears in a client artifact, callable response, URL, or audit event. No client-authoritative score field ever enters an attempt.
- **Immutability:** attempts are immutable and ownership-stamped (student, class-at-submission, `lessonSlug`, `assessmentRevisionId`). Revisions are immutable; correcting one deploys a new `revisionOrdinal` with a paired new answer key (both deployed together); prior revisions remain readable so historical attempts stay interpretable.
- **Behavior:** unlimited formative attempts by default; **submit = completion**; `Improve My Score` is offered on a less-than-perfect best score; 10/10 does not. There is **no practice/classroom mode toggle** at the pipeline level — behavior derives from auth/authz; `assignment.mode` governs routing (classroom → assessment pipeline; practice → lesson surface without the pipeline).
- **Surfaces:** students see `My Assignments` and `My Results`; teachers see aggregate + per-assignment monitoring. Answer keys and other students' PII never enter any teacher analytics view.
- **v2 results UX (implemented):** in the authenticated v2 lessons, after submission the results transition **scrolls/focuses to the top of the results content so the score/results header is fully visible** (`scroll-margin-top` offset + focus with `preventScroll` + `role="status"`/`aria-live`). This is present across all 49 v2 authenticated lesson artifacts. It is a **v2 (authenticated) behavior**; the public v1 artifacts retain their legacy results flow.

---

## 10. Curriculum and Lesson Architecture

- **One canonical source, two generated outputs.** Instructional edits go into `lesson-sources/`; the deterministic build produces a **v1 public artifact** (`/lesson_<slug>.html`, preserves the public URL and legacy classroom behavior) and a **v2 authenticated artifact** (`app/lessons/lesson_<slug>.html`, no legacy classroom architecture, consumes platform identity + the certified assessment runtime). Both generated files begin with a `GENERATED FILE` notice. **Direct edits to generated artifacts are prohibited** and caught by `lessons:verify` in CI.
- **Build/verify:** `npm --prefix app run lessons:build` / `lessons:verify` (verify rebuilds in memory and fails on drift; part of `app` verify). An instructional-equivalence contract compares normalized v1 vs v2 output. Per-lesson config lives at `app/scripts/lessonBuilder/lessons/<slug>.cjs` (50 configured).
- **Launcher / v2 routing:** `app/src/assignments/studentList/launchOverrides.ts` maps slugs to the v2 path. **All 49 assignable slugs are now routed to `/app/lessons/`** (expanded through Sprint 28 Phase 5A). Any non-listed slug launches to the byte-identical v1 URL.
- **Counts:** 50 public v1 lessons at root; 49 v2 authenticated artifacts.
- **Formal curriculum scope:** **Games are excluded from the formal LyfeLabz curriculum.** Lesson closing order is Quiz → More Learning → Connections. *More Learning* holds investigations/simulations/extensions/games; *Connections* holds only related lesson cards. (Extension/simulation curriculum-membership decisions beyond this are not finalized here — do not invent them.)
- **Present Mode** is a structurally separate instructional surface with **no Firebase SDK on the canonical instructional origin**; no LMS token/OAuth/bundle reaches it.
- Lesson content standards, voice, and structure are governed by `CLAUDE.md` (the repository instruction file); this document does not restate them.

---

## 11. Security Invariants (must be preserved)

1. **Authentication ≠ authorization.** Claims (`role`, `schoolId`, `districtId`) are written only when `status === active`; on claims/record disagreement the **Firestore record wins**.
2. **District is a hard security boundary.** Cross-district reads/writes are refused at both the Security-Rules and callable layers; cross-user records and audit events carry `districtId`.
3. **Classroom isolation.** A class's data is invisible to any user not owning or enrolled in it; cross-class queries are structurally impossible for non-admins (enforced by data model + rules, not UI filtering).
4. **Immutable ownership.** Ownership is stamped at creation and changed only through an audited admin path; ownership-violating writes are refused server-side.
5. **No unauthorized student launch.** `lmsDeepLinkResolve` requires student + active + district-match + **active enrollment** + published/closed; `assignmentId` alone grants nothing; `Referer` is not authorization.
6. **No unauthorized attempts.** Only `assessmentSessionsBegin` creates sessions; only `assessmentAttemptsFinalize` writes `attempts/*`. Anonymous exploration creates no attempt.
7. **Answer-key confidentiality.** `assessmentAnswerKeys/*` is readable only by the scorer; refused for all client roles including `platformAdministrator`; never in a URL, response, or audit event.
8. **Server-authoritative scoring and timestamps.** No client-authoritative score or academically-weighted timestamp is trusted.
9. **OAuth tokens are server-only.** Never in client-readable Firestore, a callable response, or a URL; revocation → `revoked` + `stale` links + reconnect prompt.
10. **Publication is one-way and server-mediated.** Cross-district and cross-teacher publication refused; no score/completion/PII is pushed into Classroom.
11. **Join-code redemption is server-only**, authenticated, atomic, idempotent, and refused against linked classes.
12. **`auditEvents` is append-only.** No rule or callable permits update/delete for any role, including `platformAdministrator`; privileged actions are audited.
13. **Student PII protection.** Email is only a secondary match validator; PII is never placed in deep-link URLs; identity is not compiled across sources.
14. **Identity operations are server-authoritative, atomic, idempotent.** No duplicate identities, enrollments, activations, or verifications.

---

## 12. Current Platform Status

- **Teacher Platform v1 UX is FROZEN as of Sprint 28.5 (2026-08-20).**
- Recent certified workstreams (by commit): Sprint 25 (LMS assignment publication), Sprint 26 (LMS UX hardening), Sprint 27 (student classroom lifecycle + deep links), Sprint 28 (teacher UX + v2 curriculum hardening, including the Phase 5A v2 migration and v2 results hardening), Sprint 28.5 (student + teacher workspace polish + cross-platform certification).
- **Next:** Sprint 29 (not yet defined in this document).
- **Production certification:** the platform is certified through the Sprint 28.5 cross-platform certification. LMS publication has been exercised against **real** Google Classroom coursework (there is no runtime test-double seam, so browser certification of the LMS path hits real Google — plan LMS cert work accordingly).
- **Test baselines:** Functions 91 suites / 1708 tests pass; App and Rules suites certified per their sprint reports.

Confirm the active sprint against the newest `docs/platform/SPRINT_*` document and the git log before relying on this section; it is the part most likely to age.

---

## 13. Canonical Document Routing Table

Read this document first, then route to the single strongest canonical source for the task:

| If working on… | Read (canonical) |
| --- | --- |
| Identity, onboarding, verification, roster authority, sessions bootstrap | `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` |
| Teacher pilot allowlist guardrail (pilot-release control) | `TEACHER_PILOT_ALLOWLIST.md` |
| Firestore Security Rules, rule invariants | `LYFELABZ_FIREBASE_SECURITY_MODEL.md` (+ `platform/firebase/` rules & tests) |
| Firestore collections, document shapes, identifiers | `LYFELABZ_FIRESTORE_DATA_MODEL.md` |
| Composite indexes, query strategy | `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` |
| Google Classroom OAuth, connection, discovery, import, roster sync | `LMS_INTEGRATION_ARCHITECTURE.md` (+ `_AMENDMENT`, `_OPERATIONS`) |
| Student deep links, assignment publication, resolver, publication callables | `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`; `PDR_030_LMS_ASSIGNMENT_PUBLICATION.md` |
| Assessment sessions/attempts, ownership, answer-key custody, callables | `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`; `ASSESSMENT_PIPELINE_SPECIFICATION.md` |
| Assessment item/answer-key/response shapes, scoring | `ASSESSMENT_SCORING_CONTRACT.md` |
| District security boundary, cross-district enforcement | `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` |
| Cloud Function authority boundaries | `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` |
| Assign workflow / Assignment Dialog | `ASSIGN_EXPERIENCE.md` |
| Roster/display-name handling | `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` |
| Class default metadata / setup | `ADR_TEACHER_DEFAULT_CLASS_METADATA.md` |
| Teacher UX principles / journey | `TEACHER_EXPERIENCE_PHILOSOPHY.md`; `TEACHER_JOURNEY.md` |
| Domain entities / relationships | `LYFELABZ_PLATFORM_DOMAIN_MODEL.md` |
| Ratified platform decisions (PDR index) | `LYFELABZ_PLATFORM_DECISIONS.md` |
| Account lifecycle states | `PLATFORM_STATE_MACHINE.md` |
| Hosting, environments, release/rollback, session policy | `PLATFORM_OPERATIONS_SPECIFICATION.md` |
| Lesson build system, markers, equivalence | `CLAUDE.md`; `app/scripts/lessonBuilder/lessons/<slug>.cjs` |
| Lesson content standards, voice, quiz/vocab rules | `CLAUDE.md` |

`LYFELABZ_PLATFORM_ARCHITECTURE.md` is the conceptual master but is explicitly pre-implementation and carries reconciliation notices; treat its subsystem sections as superseded by the specs above.

---

## 14. Historical Documentation Policy

`SPRINT_*` completion/certification/findings reports and `SPRINT_HISTORY.md` are evidence, not current state. `SPRINT_HISTORY.md` is not maintained to the latest sprint (it trails). Read historical sprint docs **only** to:

- determine **why** a decision was made (rationale),
- gather **certification evidence** for a claim,
- resolve a **genuine conflict** between current canonical docs,
- investigate a **regression** (what changed, when, and how it was tested),
- verify **previously tested behavior** before altering it.

Do **not** read them to reconstruct current architecture — Sections 2–13 and the routing table exist so you don't have to.

---

## 15. Claude Code Working Conventions

Efficiency conventions (validated in optimization Pass 1). **Efficiency never overrides correctness or security review** — expand context whenever architecture or security evidence requires it.

- `git status --short`; `git --no-pager diff --stat` before a targeted `git --no-pager diff -- <path>`; `git --no-pager log --oneline -n 20`.
- Search (`rg`) for a symbol before opening a large file; read targeted line ranges rather than whole 2k–4k-line files; don't re-read an unchanged file without reason.
- Summarize successful test runs (counts + suites); retain **complete** failure output (names, diffs, stack, exit code).
- On security-sensitive work (auth, rules, OAuth, deep links, publication, scoring), read the full relevant contract and rules — do not economize on the evidence a certification depends on.
