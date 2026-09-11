# Persistent Differentiation - G19 Production Certification Runbook

Planning and certification artifact for the **G19 production gate** defined in
`DIFFERENTIATION_F5_2_IMPLEMENTATION_SPECIFICATION.md` §14. This document is
preparation scaffolding only. It does **not** authorize or perform any
production action. It defines what must be proven, what evidence is sufficient,
which steps are read-only, and which steps are production mutations that require
explicit, separate human authorization from Chris before they may run.

Authoritative contract: `DIFFERENTIATION_F5_2_IMPLEMENTATION_SPECIFICATION.md`
(hereafter F5.2). This runbook never overrides F5.2; where they appear to
differ, F5.2 wins and the divergence is a defect in this runbook.

Companion evidence: `DIFFERENTIATION_STAGING_CERTIFICATION_RUNBOOK.md` (the
completed Slices 1-6 staging integration certification, "staging runbook"
below).

---

## 1. Purpose and Scope

**Purpose.** Provide the ordered, safety-gated plan to satisfy F5.2 gate **G19**
in production: prove that differentiated delivery infrastructure (Slices 2-6) is
correct and fail-closed in the live `lyfelabz-prod` project so that, as a later
and separate human decision, the Slice 7 teacher activation surface may be
exposed.

**In scope.** Repository baseline verification; local automated test gates;
read-only production structural checks; the production verification matrix for
Slices 2-6; launch-grant, delivery-outcome, and failure-path verification
planning; evidence-capture rules that avoid student PII; explicit STOP, PASS,
and FAIL criteria.

**Out of scope (do not perform here or as a side effect of this runbook).**
Flipping `G19_GATE_OPEN`; enabling differentiated delivery for the general
population; deploying the Slice 7 UI; committing; pushing; any privacy-hardening,
Firebase Hosting architecture, GitHub Pages, DNS, or marketing-Hosting work
(that is the separate Codex track); OAuth secret rotation; repository visibility
changes. Slice 8 (teacher preview) is optional and non-blocking (F5.2 §9, §15
row 8) and is not part of G19.

**Nature of this gate.** G19 is a certification/verification gate, not new
implementation. All Slice 2-6 code exists and is staging-certified. G19 asks a
different question than G14 (staging): does the same infrastructure behave
correctly and fail-closed in production, without misrepresenting delivery and
without touching real student plan data.

---

## 2. Exact G19 Entry Conditions

From F5.2 §14 G19 and §10.2, all must hold before production certification work
begins:

1. **G1-G18 hold.** Every prior gate green. In repository terms: Rules deny-all
   on the three new families (G1), authorization/CAS/history suites (G2/G3),
   canonical non-regression (G4), determinism/immutability/retention
   (G5/G6/G7), fallback classification (G8), freeze/autosave/reassessment
   (G9/G10), Classroom/reporting unchanged (G11/G12), publication ordering
   (G15), launch binding (G16), client fallback + path privacy (G17), outcome
   integrity (G18). See §6 for the local commands that evidence these.
2. **G14 staging proof complete.** One variant published end-to-end through the
   §6.8 machine and delivered to a staging student with a recorded
   `"differentiated"` attempt. Status: DONE (staging runbook §3b: "Slices 1-6
   staging integration certification: PASS").
3. **Slices 2-6 code live-ready in production.** The certified build is the code
   that will be, or already is, deployed to `lyfelabz-prod`. §5 confirms the
   deployed-surface expectation before any verification is trusted.
4. **Dark-state invariants intact** (see §3).

G19 exposure of Slice 7 is itself "a gated release action, not a code-deploy
side effect" (F5.2 §14). Passing G19 verification does **not** perform that
exposure (see §16).

---

## 3. Dark-State Invariants (must remain true throughout)

These must be true before, during, and after G19 verification, and must be
re-checked if anything looks off:

1. **`G19_GATE_OPEN` remains `false`** in `app/src/index.ts`. This runbook never
   changes it. The teacher Student Services activation callables
   (`listStudents` / `getAccommodation` / `setAccommodation`) stay wired to
   `null` while it is false (`app/src/index.ts`, Slice 7 block). Verified dark
   at the current baseline (§5).
2. **Differentiated-delivery operational enablement stays safely disabled**
   unless a narrowly defined certification action in §8 explicitly and
   temporarily requires otherwise, under separate human authorization.
   `platformConfig/differentiatedDelivery` at NORMAL means: missing document =
   disabled; read failure = disabled; any value other than literal
   `enabled === true` = disabled (F5.2 §8.6; fail-closed flag reader
   `platform/functions/src/shared/config/differentiated-delivery-flag.ts`).
3. **No accommodation record is created, mutated, or read for a real student**
   as a byproduct of verification. Op B activation of a real student is a Slice 7
   / post-G19 concern, not a G19 step.
4. **Historical attempts are never mutated or backfilled** (F5.2 §3.4, §8.6).

If any of these cannot be confirmed, STOP (§13).

---

## 4. Production Project Identity and Target Verification

| Role | Firebase project | Project number | Source of truth |
|---|---|---|---|
| Production | `lyfelabz-prod` | 182791689935 | `.firebaserc` `default`; prod web config in `assets/lyfelabz-firebase-config.js` (non-staging branch) |
| Staging | `lyfelabz-staging` | 293337283840 | `.firebaserc` alias `staging` |

**Safety rule (identical posture to the staging runbook, inverted target).** An
alias name is never a trust boundary. Every production operation must positively
resolve to the literal project id `lyfelabz-prod` before it runs, and must fail
closed otherwise.

**Repository constraint the operator must know.** The existing headless
certification driver
(`platform/functions/src/scripts/staging-cert-driver.ts`) is **hard-locked to
`lyfelabz-staging`**: it requires an explicit `--project=lyfelabz-staging`,
refuses any other project id (including `lyfelabz-prod`), and refuses a
conflicting ambient project. **It cannot be pointed at production, and must not
be modified to remove that lock.** Consequently there is no repository-provided
headless prod delivery driver today. §7 states, per slice, what this means:
some Slice 2-6 properties are proven entirely by local/repository evidence and
carry forward from staging; the genuinely prod-only delivery behaviors require a
consciously chosen, human-authorized mechanism (see §7 and §13), not a
repurposed staging driver.

---

## 5. Required Repository Baseline Checks (READ-ONLY)

Run all of these and record the output before any verification is trusted. All
are read-only.

1. **Branch and HEAD.**
   ```
   git branch --show-current
   git rev-parse HEAD
   git --no-pager log -1 --pretty=format:'%h %s'
   ```
   Record the SHA and subject. Confirm HEAD matches the intended certified
   commit and the locally known `origin/main`.
2. **Clean tracked tree.**
   ```
   git status --short
   ```
   Must be empty of tracked modifications. Untracked/generated artifacts
   (for example `app/dist/`) may be listed but must not be modified merely
   because they exist. A dirty tracked tree is a STOP condition (§13).
3. **Dark-state grep.**
   ```
   grep -n 'G19_GATE_OPEN' app/src/index.ts
   ```
   Confirm `const G19_GATE_OPEN = false;` and the three `null`-gated getters.
4. **Environment separation.** Confirm `assets/lyfelabz-firebase-config.js` is
   host-aware: staging hosts receive staging config, every other host receives
   the byte-identical prod config; `localhost` uses the emulator via
   `getFirebaseClientConfig()` before the global is read. Confirm the lesson
   runtime shim (`assets/lyfelabz-assessment-runtime.js`) contains **no**
   hard-coded production Firebase fallback (ASTRA-004 constraint) and fails
   closed when no usable config is installed.
5. **Expected deployed surfaces.** Independently establish (read-only) that the
   `lyfelabz-prod` deployment corresponds to this HEAD's certified build:
   the app bundle carries the Slice 5 routing markers (absolute
   `/app/lessons/variants/...` probe + canonical fallback), and Cloud Functions
   include the delivery-half callables (`assignmentsListForStudent`,
   `lmsDeepLinkResolve`, `assessmentSessionsBegin`, finalize). An unexpected
   deployment delta versus HEAD is a STOP condition (§13).

---

## 6. Required Local Automated Test Gates (READ-ONLY, before any production action)

These prove G1-G18 behavioral contracts against the code that will be certified.
They are local, deterministic, and must be green before any production step.

| Gate | Command (from repo root) | Proves |
|---|---|---|
| App full suite | `npm --prefix app test` | Slice 5 routing/fallback/ref-discard (`launchRouting.test.ts`), ASTRA-004 firebase-environment contract, shell/settings Slice 7 dark wiring |
| App verify (build integrity) | `npm --prefix app run verify` | curriculum + lessons + **variant retention verifier** (`variants:verify`), typecheck, lint, tests together |
| Functions delivery-half suites | `npm --prefix platform/functions test` (or the scoped presentation/accommodations/launch-grant/begin/flag suites) | Op B CAS/history (B), resolution + grant minting (C/N), delivery outcome (O), publication ordering (P), client-privacy (Q), no-ref + operational disable (R), launch-grant binding, fail-closed flag reader |
| Rules suites | the `platform/firebase` rules test suites | deny-all on `studentAccommodations`, `presentationVariants`, `launchGrants` (G1) |

Record suite/test totals as compact counts on PASS. On any failure, capture the
full failing output (names, diffs, stack, exit code) and treat it as a G19 FAIL
input (§15). Do not weaken or skip a test to make a gate pass.

---

## 7. Production Verification Matrix - Slices 2 through 6

For each slice: the behavior to prove, sufficient observable evidence, whether a
production mutation is required (and thus separate human authorization),
rollback/failure expectation, whether student PII is involved, and PII
avoidance. **Every row marked "PRODUCTION MUTATION" requires explicit human
authorization before it runs; nothing in this runbook is that authorization.**

### Slice 2 - Immutable build pipeline + presentation identity

- **Prove:** deterministic content-addressed build; full-digest
  `presentationRevisionId`; opaque `app/lessons/variants/lesson_<slug>__pr<64hex>.html`
  paths carrying no `variantKey`, accommodation token, or student id (F5.2 §5,
  T-Q2); manifest append-only retention (§6.2/§6.3).
- **Sufficient evidence:** local `variants:verify` green + `app run verify`
  green + the committed `app/lessons/variants/manifest.json`. This is a
  **repository property, not a hosting behavior** (F5.2 §6 opening line), so it
  is fully proven without production.
- **Production mutation required:** NONE.
- **Rollback/failure expectation:** verifier failure blocks release; remediation
  is restoring files from git history, never editing the manifest (F5.2 §6.7).
- **PII:** none.

### Slice 3 - Publication state machine + index + retention

- **Prove:** the §6.8 ordered machine (build -> derive/verify digest -> add
  artifact -> append manifest -> verifier -> commit -> deploy -> **liveness** ->
  **index last**); the index may only ever point at an artifact already confirmed
  retrievable; the index write exists only inside the publish tool (T-P1/P2/P3,
  T-E5-E8).
- **Sufficient evidence:** local suite P green (ordering + failure semantics) +
  staging G14 end-to-end proof carried forward (staging runbook §3: revisions A
  then B each through LOCAL_VERIFIED -> HOSTING_DEPLOYED -> HOSTED_BYTES_VERIFIED
  -> INDEX_UPDATED, A retained byte-identical after B). For production, a
  **read-only** liveness check of any already-published prod artifact path
  (HTTP 200 + sha256 equals the manifest `sha256`) evidences retention without
  mutation.
- **Production mutation required:** ONLY if a variant must actually be published
  to prod for the delivery proof (Slice 4-6 below). Publishing to prod runs the
  §6.8 machine with `--project=lyfelabz-prod` and a prod `--hosting-origin`;
  this is a **PRODUCTION MUTATION (Hosting deploy + Firestore index write)** and
  requires explicit human authorization and a prod-safe invocation. The staging
  publish invocation in the staging runbook is the shape; the target and origin
  change to prod. Note: the repository publish CLI's staging target is the wired
  path; a prod target invocation must be confirmed to exist and be fail-closed to
  `lyfelabz-prod` before use, or the publication is performed under direct human
  operation.
- **Rollback/failure expectation:** any failure before the index write leaves
  the index unchanged and additions inert; rollback repoints to a retained,
  re-liveness-confirmed revision and never deletes an artifact (F5.2 §6.8 table).
- **PII:** none (lesson content only).

### Slice 4 - Server resolution (Op C) + launch grants

- **Prove:** Op C runs only after full existing authorization, only for
  `actor.uid`; mints a `differentiated` grant (uid/assignment/lesson-bound,
  6h TTL) only when an active index exists and delivery is enabled; mints only a
  `canonicalFallback` grant when disabled/uncovered/retired; forbidden-key
  coverage; `differentiatedDeliveryEnabled` honored server-side (F5.2 §4, §3.6,
  §8.6).
- **Sufficient evidence:** local suites C/N + grant-mint assertions + flag reader
  suite green; staging Phase C/F/L carried forward. Production-only confirmation
  that the flag is read fail-closed and that grants are non-forgeable requires a
  live resolve, which is **delivery verification** (see the prod-delivery note
  below).
- **Production mutation required:** a live prod resolve for a covered student
  writes a transient `launchGrants/{grantId}` doc. This is a **PRODUCTION WRITE**
  (transient, TTL-deleted) and is only reached via a real or synthetic student
  launch; it requires authorization and a chosen actor mechanism (prod-delivery
  note).
- **Rollback/failure expectation:** internal resolver failure yields a canonical
  response with no grant and telemetry; a later no-ref begin then applies §8.2
  (never a silent canonical) (F5.2 §4 Op C internal-failure row).
- **PII:** a real student's `uid` and enrollment are read. Avoid printing raw
  `uid`, email, or provider id; capture only structural facts (grant present
  y/n, `outcomeAtIssuance`, TTL set y/n) - see §12.

### Slice 5 - Client routing + canonical fallback

- **Prove:** client routes to the exact server-selected `presentation.path`
  after the trust-boundary path grammar check; on load-probe failure it falls
  back **visually** to canonical, **discards** `launchRef` (canonical URL carries
  no ref), and emits the anomaly; the client never derives a variant, never
  selects a second differentiated target, and is never authoritative for fallback
  legitimacy (F5.2 §7.3; `app/src/assignments/studentList/launchRouting.ts`).
- **Sufficient evidence:** local `launchRouting.test.ts` green + staging Phase K
  browser certification carried forward (staging runbook §3a: normal
  differentiated routing PASS; controlled artifact-failure PASS with `launchRef`
  discarded and no durable state created). Production browser confirmation, if
  performed, mirrors the staging §3a script against a prod synthetic actor.
- **Production mutation required:** browser observation itself performs a real
  prod launch (reads/writes as Slices 4/6). No client-only mutation beyond that.
- **Rollback/failure expectation:** rolling back Slice 5 while coverage is
  published requires the §8.6 operational disable first (G20 sequence), so covered
  students record truthful `canonicalFallback` rather than hitting
  `BEGIN_REQUIRES_LAUNCH` once the client can no longer transport `launchRef`.
- **PII:** as Slice 4; the anomaly event must carry no `variantKey`,
  `presentationRevisionId`, `launchRef`, path, or accommodation detail
  (`onVariantLoadFailure` contract).

### Slice 6 - Begin binding + deliveryOutcome freeze

- **Prove:** begin validates the grant inside the create transaction after
  unchanged authorization; freezes `variantKey` / `presentationRevisionId` /
  `deliveryOutcome:"differentiated"` from the grant; the A->B invariant (a grant
  bound to A freezes A even after the index moves to B); forbidden/expired/cross-
  user/cross-assignment grants refuse uniformly; a covered+enabled active
  accommodation with no valid ref returns `BEGIN_REQUIRES_LAUNCH` with **no
  session and no attempt** (P1); `differentiatedDeliveryEnabled=false` yields
  truthful `canonicalFallback` (F5.2 §8).
- **Sufficient evidence:** local suites N/O/R + G/H/I/K green; staging Phases
  F/G/H/I/J/L/M carried forward (staging runbook §"Delivery-half certification").
  A production `"differentiated"` attempt (§16 defines it is proof of
  infrastructure, not authorization to expose Slice 7) is the strongest single
  prod evidence if a controlled prod delivery is authorized.
- **Production mutation required:** a live prod begin creates a
  `assessmentSessions` doc and, on finalize, an `attempts` doc for the actor.
  This is a **PRODUCTION WRITE** and is only reached via an authorized real or
  synthetic student launch.
- **Rollback/failure expectation:** transient internal failure returns retriable
  `BEGIN_VALIDATION_UNAVAILABLE` with no session and no silent freeze (F5.2 §8.3);
  frozen historical attempts are never rewritten (§8.2 A->B invariant).
- **PII:** as Slice 4/5; classroom session/attempt docs are keyed to a real
  student. Prefer a controlled synthetic-in-prod actor over any real student, and
  capture only structural facts (see §12).

### Prod-delivery note (applies to Slices 4-6 live proof)

Slice 2-3 are provable with zero production mutation. Slices 4-6 delivery
behaviors that are not already established by local suites + staging carry-
forward can only be exercised by an actual production launch. Because the
staging driver refuses prod (§4), the owner must consciously choose ONE of:

- **(a) Rely on local suites + staging G14 carry-forward** as sufficient for
  G1-G18 and treat production G19 as read-only structural confirmation (§5) plus
  the dark-state and fail-closed checks - performing **no** prod delivery
  mutation. This is the lowest-risk path and keeps §3 invariants absolute.
- **(b) Perform a single controlled, human-authorized production delivery proof**
  using a **synthetic-in-prod** actor (never a real student), mirroring the
  staging §3a script, then remove the synthetic residue. This requires an
  authorized prod actor-provisioning + cleanup mechanism that this runbook does
  **not** provide and that must not be a modified staging driver.

Path (a) is recommended unless a specific stakeholder requires a live prod
`"differentiated"` attempt. Either way, no real student PII is used and Slice 7
stays dark.

---

## 8. Differentiated-Delivery Operational Flag Safety

- The flag `platformConfig/differentiatedDelivery` is **server-owned** platform
  configuration (F5.2 §8.6, §11). No student, teacher surface, or ordinary client
  can set, assert, override, or bypass it; a `launchRef` cannot override a
  disabled state.
- **Fail-closed is the guarantee to preserve.** Missing document = disabled; read
  failure = disabled; any value other than literal `enabled === true` = disabled.
  Do not add a default-enabled path.
- **Do not globally enable differentiated delivery merely to observe it.** G19
  does not require, and must not perform, a general-population enable.
- The **only** enablement contemplated for certification is, under path (b) in §7
  and separate authorization, a narrowly scoped, reversible enable used solely to
  drive one controlled synthetic-in-prod delivery, followed by returning the flag
  to its disabled/NORMAL state. Under path (a) the flag is never enabled in prod
  during G19.
- Setting or clearing the flag never mutates accommodation records or historical
  attempts (§8.6 ownership clause).

---

## 9. Launch-Grant Verification

Verify the F5.2 §3.6 / §7.2 security properties. Local suites (launch-grant
types, resolution, begin) already prove these; production confirmation, if any
prod delivery is authorized, checks the same properties on live grants using
**structural** evidence only:

- **Server-issued, opaque id:** 32 lowercase hex chars, CSPRNG, never derived
  from content or predictable inputs.
- **uid binding:** `studentId` must equal `actor.uid`; another user's grant is
  refused with a shape byte-identical to unknown-grant refusal (no existence
  disclosure).
- **Assignment binding:** `assignmentId` must match the request; cross-assignment
  reuse impossible; same uniform refusal shape.
- **Lesson cross-check:** `lessonSlug` mismatch refuses identically.
- **TTL:** `expiresAt = issuedAt + 6h`; expired grants refuse with retriable
  `LAUNCH_REF_EXPIRED`; TTL-deleted, never long-term state.
- **No canonical launch grant:** canonical-expected launches mint no grant;
  absence of `launchRef` represents them.
- **Invalid/stale ref fallback:** forged/unknown -> `LAUNCH_REF_INVALID` +
  security telemetry, no session; a discarded ref after client artifact-load
  failure, with coverage still active, yields `BEGIN_REQUIRES_LAUNCH` (not a
  silent canonicalFallback) - the client is never authoritative for fallback
  legitimacy.

Evidence to capture: refusal **codes** and the boolean facts above. Never capture
or print a real grant id tied to a real student, tokens, or the actor's raw
identity.

---

## 10. Assessment Begin / deliveryOutcome Freeze Verification

- **Freeze at begin, copy at finalize.** `deliveryOutcome` is frozen on the
  session at begin and copied verbatim to the attempt at finalize; sessions delete
  at finalize; the attempt is the sole durable carrier (F5.2 §8.1, §8.4).
- **Invariant:** `deliveryOutcome:"differentiated"` iff both presentation fields
  present; `"canonical"` and `"canonicalFallback"` iff both absent; exactly one
  present is invalid by construction (§3.3).
- **A->B immutability:** a grant that validly bound revision A freezes A even
  after the index moves to B; the no-ref coverage check never selects a revision
  (§8.2 A->B invariant).
- **Distinguishability:** CASE A/B/C are distinguishable from durable attempt data
  alone, without the now-current accommodation record (§3.4, T-O4).
- **Pre-feature attempts** carry no `deliveryOutcome` and must not be backfilled
  or read as evidence that no accommodation should have existed (§3.4).

Local suites N/O already prove these; a prod confirmation (path (b) only) reads
the created attempt's outcome enum and field-presence, nothing more.

---

## 11. Failure-Path Verification (production equivalents of the staging fail-closed checks)

Confirm each fail-closed behavior. Local suites prove them deterministically; the
production equivalents (path (b) only) reproduce the staging §3a controlled
checks:

1. **Flag fail-closed:** missing/again-non-true `differentiatedDelivery` = disabled
   (staging Phase C equivalent).
2. **Covered no-ref begin refuses:** covered + enabled + active accommodation +
   no `launchRef` -> `BEGIN_REQUIRES_LAUNCH`, no session, no attempt (T-R1, staging
   Phase G).
3. **Legitimate fallback still available:** active + uncovered/retired + no ref ->
   `canonicalFallback` with telemetry, no pair (T-R2).
4. **Invalid grants:** forged / cross-user / cross-assignment / malformed ->
   uniform `LAUNCH_REF_INVALID`, no session (T-N3/N4/N5, staging Phase H).
5. **Client artifact-load failure:** differentiated artifact blocked -> visual
   canonical fallback, `launchRef` discarded, `assignment=` retained but no
   `launchRef=`, and a subsequent ref-less begin over active coverage returns
   `BEGIN_REQUIRES_LAUNCH` with zero durable state (staging §3a controlled-failure,
   T-Q1/T-R3).
6. **Operational disable truthfulness:** disable -> covered active students record
   truthful `canonicalFallback` (never `differentiated`), accommodation unchanged;
   re-enable -> normal differentiated resumes with no accommodation migration
   (T-R4/R6, staging Phase L).
7. **Internal begin failure:** injected transient failure -> retriable
   `BEGIN_VALIDATION_UNAVAILABLE`, no session, canonical never silently frozen
   (T-N7).

---

## 12. Evidence Capture Requirements

- **Prefer structural/aggregate evidence.** Suite pass counts; boolean facts
  (grant present y/n, outcome enum value, field-presence, refusal code, HTTP
  status, sha256 match y/n); session/attempt **counts** by outcome.
- **Never capture, print, log, or persist:** raw student emails, raw provider
  IDs, raw `uid` values tied to real students, OAuth tokens, service-account or
  ADC credentials, secret values, or a live grant id bound to a real student.
- Redact identifiers in any saved log. Where a specific actor must be referenced,
  use a synthetic-in-prod label, never a real student's identity.
- Public Firebase Web SDK config values are non-secret (documented in
  `assets/lyfelabz-firebase-config.js`) but there is no reason to reproduce them
  in evidence; reference the file instead.
- Store G19 evidence as a certification note (structural facts only); do not
  commit it as part of this runbook change.

---

## 13. Explicit STOP Conditions

Stop immediately, do not proceed, and report if any of the following occur:

1. **Wrong Firebase project.** Any operation resolves to a project id other than
   the intended one; a prod step that does not positively resolve to
   `lyfelabz-prod`, or a staging step that does not resolve to `lyfelabz-staging`.
2. **Dirty or unexpected tracked worktree.** `git status --short` shows tracked
   modifications not authorized for this pass.
3. **Staging/production boundary ambiguity.** Any doubt about which environment a
   command targets, or any attempt to point the staging-locked driver at prod.
4. **Unexpected deployment delta.** Deployed prod surfaces do not match the
   certified HEAD (app bundle missing Slice 5 markers, missing/extra callables,
   unexpected Rules).
5. **Fail-open behavior observed.** Any case where a missing/invalid flag,
   missing config, invalid/expired/cross-user grant, or internal failure produces
   a `differentiated` claim, a silent canonical/canonicalFallback where the
   contract requires a refusal, or a session/attempt that should not exist.
6. **Unexpected student provisioning or enrollment mutation.** Any real-student
   accommodation, enrollment, session, or attempt created or changed as a
   verification byproduct.
7. **Inability to prove rollback/fallback safely.** The §8.6 disable path or the
   §6.8 rollback (repoint to a re-liveness-confirmed retained revision) cannot be
   demonstrated without risk.
8. **Dark-state drift.** `G19_GATE_OPEN` is not `false`, or the flag is enabled
   for the general population.

On any STOP: leave production untouched, record the condition and evidence, and
escalate to Chris.

---

## 14. G19 PASS Criteria

G19 passes only when ALL hold:

1. Repository baseline (§5) clean and matching the certified HEAD; dark-state
   invariants (§3) intact.
2. All local automated gates (§6) green, recorded as counts.
3. Read-only production structural checks (§5.5) confirm deployed Slice 2-6
   surfaces match HEAD, Rules deny-all on the three families, and the operational
   flag reads fail-closed.
4. Slice 2 and Slice 3 retention/publication properties proven (local verifier +
   staging carry-forward; prod artifact liveness read-only where applicable).
5. Slices 4-6 delivery and failure-path contracts (§7, §9, §10, §11) established
   by EITHER path (a) (local suites + staging G14 carry-forward + read-only prod
   confirmation) OR path (b) (one authorized controlled synthetic-in-prod delivery
   proof with residue removed), with every fail-closed check in §11 confirmed.
6. No STOP condition (§13) encountered; no real student PII captured; Slice 7
   still dark; flag not generally enabled.

Record the chosen path (a or b) and the evidence set. G19 PASS is a verification
result only.

---

## 15. G19 FAIL Criteria

G19 fails if ANY hold:

1. Any local gate (§6) fails, or a test was weakened/skipped to pass.
2. Any read-only prod check (§5.5) shows a deployment delta from certified HEAD.
3. Any fail-open behavior (§13.5) is observed.
4. A required fail-closed check in §11 cannot be demonstrated.
5. Rollback/fallback safety (§13.7) cannot be proven.
6. Any STOP condition occurred and was not fully resolved with production
   untouched.

On FAIL: capture full failing evidence, leave production and the dark state
unchanged, and return to implementation/diagnosis before re-attempting G19.

---

## 16. What Happens AFTER G19 Passes

G19 PASS is a **verification result, not a release authorization.** Passing G19
does **NOT** by itself authorize, and must not trigger as a side effect:

- flipping `G19_GATE_OPEN` to `true`;
- enabling differentiated delivery for the general population
  (`platformConfig/differentiatedDelivery` -> `{enabled:true}` broadly);
- deploying or exposing the Slice 7 teacher activation surface;
- committing;
- pushing.

Each of those is a separate, human-controlled release action performed by Chris,
in the order and with the safety sequencing F5.2 §14/§15 define (activation
exposed only after Slices 2-6 are production-verified, and the §8.6 operational
disable available as the rollback/emergency control). Slice 8 (teacher preview)
remains optional and out of the G19 critical path.

---

## 17. Concise Operator Checklist

Read-only unless a line is marked **[PROD MUTATION - AUTH REQUIRED]**.

1. [ ] `git branch --show-current` = `main`; record HEAD SHA + subject; matches
       certified commit and `origin/main`.
2. [ ] `git status --short` empty of tracked changes (untracked build artifacts
       ok, do not modify).
3. [ ] `grep -n 'G19_GATE_OPEN' app/src/index.ts` = `false`; three getters
       null-gated.
4. [ ] `assets/lyfelabz-firebase-config.js` host-aware; runtime shim has no
       hard-coded prod fallback and fails closed.
5. [ ] `npm --prefix app test` green (record counts).
6. [ ] `npm --prefix app run verify` green (incl. `variants:verify`).
7. [ ] `npm --prefix platform/functions test` green (record counts).
8. [ ] Rules deny-all suites green for the three families.
9. [ ] Read-only prod: deployed bundle carries Slice 5 markers; delivery-half
       callables present; Rules deny-all live; flag reads fail-closed.
10. [ ] Slice 2/3 retention: local verifier green; (read-only) any published prod
        artifact returns HTTP 200 with sha256 = manifest.
11. [ ] Choose delivery path: **(a)** carry-forward + read-only, or **(b)**
        controlled synthetic-in-prod proof **[PROD MUTATION - AUTH REQUIRED]**.
12. [ ] If (b): confirm synthetic-in-prod actor mechanism (not a modified staging
        driver); run the staging §3a script equivalent; capture structural
        evidence only; remove synthetic residue.
13. [ ] Confirm every §11 fail-closed check.
14. [ ] Confirm no real student PII captured; no STOP condition; Slice 7 dark;
        flag not generally enabled.
15. [ ] Record PASS/FAIL (§14/§15) with the evidence set and chosen path.
16. [ ] STOP - do not flip the gate, enable delivery, deploy Slice 7, commit, or
        push. Those are separate human release actions (§16).

---

## Do Not

- Do not deploy to or mutate `lyfelabz-prod` without explicit, per-action human
  authorization.
- Do not modify the staging-cert driver's `lyfelabz-staging` project lock.
- Do not rely on a Firebase alias as the safety boundary; verify the resolved
  project id.
- Do not use real student accommodation, enrollment, session, or attempt data
  as a verification target.
- Do not globally enable differentiated delivery to observe it.
- Do not flip `G19_GATE_OPEN`, expose Slice 7, commit, or push in this or the
  certification session.
- Do not enter the Codex privacy-hardening / Hosting / GitHub Pages / DNS /
  marketing lane.
