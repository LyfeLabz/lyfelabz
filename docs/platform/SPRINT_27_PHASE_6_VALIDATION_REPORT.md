# Sprint 27 Phase 6 - Deterministic Validation Sweep

Status: Phase 6 complete. This report consolidates the deterministic and
local code-level evidence that the implemented Sprint 27 architecture
(Phases 2 through 5) satisfies the Sprint 27 definition and architectural
blueprint, and is internally coherent and ready for integrated browser and
emulator certification (Phase 7).

This is a validation phase, not a feature-development phase. No browser or
emulator certification was performed, no live Google certification was
performed, no deployment occurred, and nothing was staged, committed, or
pushed. All Sprint 27 implementation remains uncommitted.

Companion documents:
- `SPRINT_27_DEFINITION.md` (scope of record)
- `SPRINT_27_ARCHITECTURAL_BLUEPRINT.md` (Phase 1 architecture)
- `SPRINT_27_IMPLEMENTATION_PLAN.md` (ordered phases; Phase 6 marked VALIDATED)

Style: no em dashes. Use " - " (spaced hyphen) as the sentence break.

---

## 1. Disposition

**PHASE 6 VALIDATED - READY FOR BROWSER CERTIFICATION.**

Phase 6 discovered no implementation defect. No production code was changed
during Phase 6. Every deterministic validation target was verified against
current code (not prior reports). The one non-executed evidence stream (the
Firestore rules suite) is an environmental constraint, not a Sprint 27
defect: Sprint 27 changed zero rules, and a user-owned emulator held the
rules test port (see §6).

## 2. Production changes during Phase 6

None. Phase 6 changed no production code and no test code. It added this
validation report and marked Phase 6 VALIDATED in the implementation plan.
No defect required correction, so the disposition is VALIDATED (not
CORRECTED AND VALIDATED).

## 3. Full validation results

### 3.1 Functions

- Typecheck (`npm run typecheck`): clean (exit 0).
- Lint (`npm run lint`): clean (exit 0).
- Test (`npm test`): **91 suites, 1699 tests, 0 failures** (exit 0).

### 3.2 App

- Typecheck (`npm run typecheck`): clean (exit 0).
- Lint (`npm run lint`): clean (exit 0).
- Test (`npm test`): **65 suites (64 passed, 1 failed), 1092 tests
  (1091 passed, 1 failed).**
- The single failure is `src/curriculum/curriculumManifest.test.ts`
  ("checked-in manifest matches a freshly parsed canonical index.html"):
  the known curriculum-manifest SHA drift between root `index.html` and
  `app/src/curriculum/curriculum.manifest.json`. This is an explicit
  Sprint 27 non-goal (definition §14, "curriculum-manifest SHA repair")
  and a Sprint 29 item. No Sprint 27 file touches `index.html` or the
  manifest; the drift is pre-existing and unrelated to Sprint 27. It is
  NOT a Sprint 27 regression.

### 3.3 Firestore rules

- Not executed this session. The repository convention runs the rules
  suite via `firebase emulators:exec --only firestore "jest"`, which spins
  up an ephemeral Firestore emulator on port 8080. That port is held by a
  pre-existing user-owned Firebase emulator (importing
  `sprint26-pathb-cert-state`, project `lyfelabz-prod`). Running the rules
  harness would require either killing that emulator (a hard-to-reverse
  action on the user's work) or pointing the rules harness at the live
  emulator, whose `clearFirestore` between tests would wipe the user's
  seeded Sprint 26 certification state. Neither was done.
- This is not a Sprint 27 concern: **Sprint 27 changed zero Firestore
  rules.** `platform/firebase/firestore.rules` is unmodified (last touched
  Sprint 25 Phase 1, commit `9b073ed`, 2026-08-06) and carries no
  uncommitted change. No rules regression is possible from Sprint 27, and
  the committed 18-file rules suite that was green at the certified
  Sprint 26 baseline remains applicable unchanged.
- The rules layer relevant to Sprint 27 was verified statically (§4,
  Target L). Recommended follow-up: run the standalone rules suite once the
  port is free (or as part of Phase 7 emulator certification) and record
  exact counts then.

Evidence artifacts (this session):
- `scratchpad/functions_results.txt`, `scratchpad/app_results.txt`,
  `scratchpad/rules_results.txt`.

## 4. Requirements traceability matrix

Legend: D = deterministic (unit/static) evidence executed and green;
S = static code inspection; B = remaining browser assertion (Phase 7);
L = remaining live-provider assertion (Phase 8).

| Target | Invariant | Implementation | Deterministic evidence | Result | Browser (P7) | Live (P8) |
|---|---|---|---|---|---|---|
| A | Manual class lifecycle not regressed | `launch.ts` behavior-preserving refactor; session/attempt/detail unchanged | Functions 1699 green; App suite green; `buildAssignmentLaunchUrl` `?assignment=` path byte-identical | PASS (D/S) | Full manual chain | none |
| B | Classroom-linked lifecycle wired | `students-complete-lms-onboarding.ts`, `deep-link-*`, recipient candidates/add | `students-complete-lms-onboarding.test.ts` (41), `deep-link-resolve.test.ts`, `deep-link-url.test.ts` | PASS (D) | Full Classroom chain | courseWork.create |
| C | Late-enrollment recovery chain | `assignments-recipient-candidates.ts` + `assignmentsRecipientAdd` + detail affordance | candidates test (23); `late-recipient.test.ts` (12); add-then-resolve domain regression | PASS (D) | add -> resolve authorized in browser | none |
| D | My Results caller-scoped only | `studentResults/wire.ts`, `aggregate.ts` | `wire.test.ts`, `aggregate.test.ts`, surface tests; targets only `assessmentAttemptsList`, empty payload, no `studentId` | PASS (D/S) | My Results renders after attempt | none |
| E | LMS onboarding server-authoritative trust | `students-complete-lms-onboarding.ts` | 41 cases: forbidden-field, no/manual/archived/terminal enrollment, conflicting-school fail-closed, claims repair | PASS (D/S) | onboarding activation in browser | none |
| F | Roster sync resolves pre-activation | `resolveActiveExternalIdentity` (external-identity store), `sync-engine.ts` unchanged | resolves on `externalIdentities.status=="active"` alone; never reads user status or claims; `sync-engine.test.ts` | PASS (D/S) | sync creates enrollment for signed-in student | roster read |
| G | Server-owned Classroom URL | `deep-link-url.ts` sole producer; publish builds server-side; client field removed | `deep-link-url.test.ts`; publish test asserts server-built URL and ignores client URL | PASS (D/S) | none | courseWork.create accepts URL |
| H | Deep-link authorization (URL != auth) | `deep-link-resolve.ts` | `deep-link-resolve.test.ts`: every refusal branch + informational + no-audit-on-refusal | PASS (D) | arrival -> resolve in browser | none |
| I | Session begin defense in depth | `assessment-sessions-begin.ts` independent recipient/enrollment/district enforcement | existing session-begin tests green; enrolled-non-recipient refused independently | PASS (D/S) | enrolled-non-recipient blocked at runtime | none |
| J | Auth round-trip preserves `/app/a/{id}` | `index.ts` pending-id capture; `dispatch` without history preserves URL | `route.test.ts`; `dispatch` replaceState only when history passed | PASS (D/S); OAuth redirect return is B | redirect sign-in returns to deep link | none |
| K | Frozen recipients | resolver/sync/onboarding/candidate all read-only wrt recipients; add append-only `manualAddition`, idempotent, published-only | recipient-add tests; candidates draft/closed gating; resolver never mutates | PASS (D/S) | freeze survives late sign-in in browser | none |
| L | District / school isolation (both layers) | Functions: `requireDistrictContext` + schoolId checks. Rules: recipients `read:false`, attempts district+self/owner, externalIdentities `read/write:false` | Functions suite green; rules unchanged + static inspection | PASS (D/S); rules suite exec deferred (§3.3) | none | none |
| M | Privacy / data minimization | attempt projection excludes itemResults/responses; candidate = studentId+name; resolver payload = ids+routing hints only | projection tests; candidate no-attempt/score/provider assertions | PASS (D/S) | none | none |
| N | Routing / hosting | `/app/a/{id}` client parse; Firebase Hosting `/app/** -> /app/index.html` | `route.test.ts`; `firebase.json` rewrite; no `/app/app/` | PASS (D/S) | route reaches shell in browser | none |
| O | Test / export / build integrity | full suites | Functions 1699/0; App 1091/1 (known drift); typecheck+lint clean; rules unchanged | PASS (D) | none | none |

## 5. Security invariants (verified)

- **Server-authoritative LMS onboarding (Target E).**
  `studentsCompleteLmsOnboarding` accepts only an optional `displayName`;
  every authority field (`schoolId`, `districtId`, `classId`, `studentId`,
  `enrollmentId`, `providerId`, `providerAccountId`, `uid`, `userId`,
  `role`) is refused before any read. `schoolId` derives from the LMS class
  record, `districtId` from the school record. Activation requires an
  `active` enrollment in an `active`, `enrollmentSource === "lms"` class;
  manual/join-code, archived, needsSetup, and terminal enrollments do not
  qualify; multi-school resolution fails closed
  (`students.conflictingLmsEnrollment`). The manual path,
  `studentsCompleteOnboarding`, `enrollmentsJoinByCode`,
  `reconcileMyExternalIdentity`, and `BETA_SCHOOL_ID` are unchanged.
- **URL ownership (Target G).** `buildAssignmentDeepLinkUrl` is the sole
  producer, emitting exactly `https://app.lyfelabz.com/app/a/{assignmentId}`
  and refusing any non-canonical id (structural: the id grammar admits no
  `:`, `/`, `?`, `#`, `.`). The client `lyfelabzAssignmentUrl` field is
  removed from the publish contract, the client no longer computes
  `window.location.origin + lesson.href`, and any residual client value is
  ignored (asserted). The client cannot influence the Classroom
  destination.
- **Resolver authorization (Target H).** `lmsDeepLinkResolve` runs the
  PDR-027 §10.1 order (auth -> student -> active -> assignment -> same-school
  district -> published/closed -> active enrollment -> recipient-aware
  `attemptContext`). URL possession never authorizes. It reads only,
  writes exactly one success audit event (best-effort), never calls Google,
  and never reads an OAuth token. Refusals leak only a stable code; the
  arrival surface never renders the raw code.
- **Session defense in depth (Target I).** `assessmentSessionsBegin`
  independently enforces school/district, published status, active
  enrollment, and canonical recipient membership
  (`assessmentSessions.recipientRequired`). An enrolled-but-not-recipient
  student is refused by the resolver (`informational`) and independently by
  session begin. The resolver is not the sole authorization boundary.
- **Frozen recipients (Target K).** Publication freezes the population;
  roster sync, onboarding, the resolver, and deep-link possession never
  mutate recipients; late enrollment alone never mutates recipients. The
  only extension is the teacher's explicit one-at-a-time
  `assignmentsRecipientAdd` (`source: "manualAddition"`, idempotent,
  append-only, published-only). Draft/closed/archived cannot be extended.
- **District / school isolation (Target L).** Enforced at both the
  Functions layer (`requireDistrictContext` plus explicit `schoolId`
  ownership checks in every Sprint 27 callable) and the Firestore rules
  layer (unchanged: `recipients` `read: if false`, `attempts` district-claim
  + self/owner, `externalIdentities` `read, write: if false`, `enrollments`
  self-or-owning-teacher with no client create).
- **Privacy / data minimization (Target M).** The caller-scoped attempt
  projection excludes `itemResults`, `responses`, answer keys, `teacherId`,
  and district internals by construction. The candidate projection carries
  only `studentId` + resolved display name. The resolver payload carries
  only `assignmentId`, `classId`, `lessonSlug`, `internalTarget`,
  `attemptContext` - no other student, recipient list, enrollment list,
  Google subject/provider id, OAuth metadata, token, score, or answer key.
  No new PII or token enters any URL, audit payload, or log line.

## 6. Integration tests

No new integration tests were added in Phase 6. Existing deterministic
evidence already proves each lifecycle chain at the domain level:

- **Integration A (late enrollment -> candidate -> add -> resolver
  authorized):** `assignments-recipient-add.test.ts` asserts the exact
  `recipients/{studentId}` write shape (`status: "assigned"` +
  district/school ownership), and `deep-link-resolve.test.ts` asserts the
  authorized-recipient resolution over that shape via `isCanonicalRecipient`.
  The "add then next resolve authorizes" transition is proven without a
  browser. The full browser run of this chain is Phase 7.
- **Integration B (provisioned LMS student -> qualifying enrollment ->
  onboarding -> canonical claims):** `students-complete-lms-onboarding.test.ts`
  (41 cases) proves server-side derivation, canonical claims/audit shape,
  side-effect ordering, and every refusal, and `sync-engine.test.ts` proves
  a provisioned bridged student is enrolled without claims.
- **Integration C (completed attempt -> results aggregation):**
  `aggregate.test.ts` proves best-score, tie-break, count, and status over
  the caller-scoped list; the surface tests prove the render.

Adding emulator-backed integration tests purely to increase counts was
avoided per the Phase 6 strategy. The genuine multi-seam chains are proven
by the mapped unit evidence above and are the Phase 7 browser/emulator
targets.

## 7. Security negative-case matrix

| Attack / hostile state | Expected behavior | Deterministic evidence |
|---|---|---|
| Student requests another student's results | Impossible: `assessmentAttemptsList` is caller-scoped, no `studentId` accepted; wire sends empty payload | `assessment-attempts-list.test.ts`; `studentResults/wire.test.ts` |
| Client supplies school/district to LMS onboarding | Refused `students.forbiddenField` before any read | `students-complete-lms-onboarding.test.ts` (per-field) |
| Manual enrollment used as LMS proof | Refused `students.noLmsEnrollment` (join-code class never qualifies) | onboarding test (manual-only) |
| Deep-link id guessed / malformed | `deep-link-shape-invalid` before any read; existence not probeable | `deep-link-resolve.test.ts`, `deep-link-url.test.ts` |
| Student enrolled but not recipient | Resolver `informational`; session begin independently refuses | resolve test; session-begin tests |
| Wrong district / cross-school | Resolver `district-mismatch`; session begin same-school check | resolve test (cross-school) |
| Arbitrary publication URL supplied | Ignored; canonical server-built URL emitted | `assignments-publish.test.ts` |
| External return redirect attempted | No arbitrary `returnUrl`; navigate only ever an internal helper-built path | `arrival.ts` (S), `deepLink/*` tests |
| Roster sync after publication | Creates enrollment only; never mutates frozen recipients | `sync-engine.ts` (S); recipient-add/candidates tests |
| Student attempts self-add | No client recipient write path (rules `create: if false`); add is teacher-only | rules (S); `assignments-recipient-add.test.ts` |
| Teacher acts on another teacher's assignment | `assignments.forbidden` (owner + same-school) | candidates test; recipient-add test |
| Add after assignment closed | Candidates empty (published-only); add refuses non-published | candidates test; recipient-add test |

## 8. Phase 7 browser / emulator handoff

Not executed in Phase 6. The following require Phase 7 certification.

**Path A - Manual class (browser + emulator, no real Google):**
1. Teacher creates manual class -> join code -> student Google sign-in ->
   join-code onboarding -> active enrollment.
2. Teacher publishes assignment -> recipients frozen -> student sees My
   Assignments with a status indicator.
3. Student launches -> assessment runtime -> completes an attempt.
4. My Results reflects the attempt (best score, attempt count, status,
   Improve My Score on a less-than-perfect best; suppressed on perfect).
5. Teacher Assignment Detail shows the attempt.

**Path B - Classroom-linked class (browser + emulator; Google via fixture
transport for provider behavior):**
1. Teacher imports/activates a Classroom class; student first Google
   sign-in creates the identity bridge.
2. Teacher runs roster sync -> active LMS enrollment created while student
   is provisioned.
3. Student LMS onboarding activates -> forced token refresh -> claims
   canonical -> My Assignments.
4. Teacher publishes -> server-built `/app/a/{assignmentId}` coursework URL
   (fixture transport).
5. Student follows the deep link -> `/app/a/{assignmentId}` reaches the app
   shell -> resolver authorizes -> silent arrival into the runtime ->
   completes -> My Results updates -> teacher sees the attempt.

**Late-enrollment recovery (browser):**
1. Teacher publishes; a Classroom student signs in afterward; teacher
   re-syncs -> active enrollment but NOT a recipient.
2. Student follows the deep link -> resolver `informational` "ask your
   teacher" surface; session begin independently refuses.
3. Teacher opens Assignment Detail -> "Students not yet assigned" ->
   explicitly adds the student -> candidate disappears.
4. Student re-follows the deep link -> now `authorized` -> silent arrival ->
   completes.

**Auth round-trip (browser):** the Google/Firebase redirect sign-in from a
signed-out `/app/a/{assignmentId}` arrival returns the browser to that same
URL and the resolver runs after authentication. The client capture,
history-preservation, and re-resolution logic is proven deterministically
(§4 Target J); only the actual OAuth redirect return is a browser
assertion.

## 9. Phase 8 live-provider handoff

One remaining Google-boundary assertion: a single real Google Classroom
`courses.courseWork.create` accepts the server-built
`https://app.lyfelabz.com/app/a/{assignmentId}` link material and returns a
coursework record, under the already-certified Sprint 25/26 OAuth
publication path. The resolver requires no live-provider evidence.
Account-chooser behavior is not a criterion; grants are not manipulated.
Sprint 25 B13 is not reopened.

## 10. Static / security review findings

- No accidental Phase 7/8 code, no broad unrelated refactor, no generalized
  multi-school work, no background job/webhook, no grade-back, no
  notification system, no rollup backend, no student-analytics expansion,
  no answer-key exposure, no automatic recipient propagation, no arbitrary
  Classroom destination.
- No em dashes in any new or modified Sprint 27 source or documentation.
- No credentials, secrets, or tokens introduced; no accidental PII.
- No TODO/FIXME/HACK markers in new production code.
- Nothing staged; nothing committed; nothing pushed.
- The `launch.ts` change is a behavior-preserving extraction of
  `buildLessonBasePath`; the existing `?assignment=` launch URL is
  byte-identical.

## 11. Deferred work (confirmed still deferred)

- **Sprint 28:** the manual `studentsCompleteOnboarding` path shares the
  same non-atomic activation seam (record active -> custom claims -> audit)
  that Phase 3 self-healed for LMS onboarding. It is intentionally NOT
  self-healed here and remains deferred to Sprint 28 pre-release hardening.
- **Sprint 28:** teacher-facing late-recipient UX beyond the narrow
  "Students not yet assigned" affordance; broad Assignment Detail polish.
- **Sprint 29:** curriculum-manifest SHA drift repair; final v1 production
  certification; Google OAuth verification and Data Access disposition.
- **Post-v1:** the client-supplied `schoolId` on the manual path
  (generalized trust-boundary concern; out of Sprint 27 scope; the LMS path
  deliberately does not inherit it).

## 12. Git status at end of Phase 6

- Tracked files changed: yes (Sprint 27 Phases 2-5 implementation, still
  uncommitted).
- Untracked files: the Sprint 27 new modules and docs (including this
  report), still uncommitted.
- Staged files: none.
- Commits: none. Pushes: none. Deployments: none.
- Firebase changes: none (no rules change, no deploy, no emulator state
  mutation by Phase 6). Google changes: none.

Sprint 27 implementation remains uncommitted, exactly as required.

*End of Phase 6 validation report.*
