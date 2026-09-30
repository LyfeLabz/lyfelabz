# Persistent Differentiation - G19 Production Certification Runbook

Planning and certification artifact for the **G19 production gate** defined in
`DIFFERENTIATION_F5_2_IMPLEMENTATION_SPECIFICATION.md` §14. This document is
preparation scaffolding only. It does **not** authorize or perform any
production or staging action. It defines what must be proven, what evidence is
sufficient, which steps are read-only, and which steps are mutations that
require explicit, separate human authorization from Chris before they may run.

> **Notice (F5.3 Slice 9, 2026-09-28).** This runbook predates F5.3 Slice 9
> (revision-bound assessment display, revision-scoped coverage, and the 9D
> client). Its publication, coverage-index, deploy-set, and routing steps must
> be reconciled with `DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md`
> §21 and the staging runbook §3d before any production activation. No
> production action is authorized by this notice.
>
> **Production state (2026-09-30).** Slice 9, Earth's Layers canonical r2,
> fragment hardening, and Policy E are live in production. The Slice 9 +
> Policy E catch-up is recorded in `SECURITY_BACKLOG_LAUNCH_URL_ANALYTICS.md`
> ("Production catch-up"). Current state:
> - Hosting `1fdb7d3ff3ead2aa` (commit `6930452`).
> - The five F5.3/9C-1 Functions (`assessmentSessionsBegin`,
>   `assignmentsListForStudent`, `lmsDeepLinkResolve`,
>   `assessmentSessionsAutosave`, `assessmentAttemptsFinalize`) run `6930452`
>   source. The `lmsGradePassbacks*` Functions still run `60b5f6a` source
>   (separately tracked drift). The rest are as §21.
> - The Firestore ruleset of 2026-09-18 is unchanged. It lacks only the
>   explicit `assessmentPresentations` deny-all, which the terminal
>   default-deny already covers.
> - Earth's Layers has r1 and r2 (current r2), with the existing assignment
>   frozen r1.
> - P1-P4 (the infrastructure catch-up above) are complete.
> - Phases A and B (coverage publication) are complete and certified. Earth's
>   Layers `reading-adapted` has revision-bound scoped coverage for both
>   revisions, published with `publish-variant.ts --target=production` (full
>   record: addendum §21.12, "Production coverage publication"):
>   - `presentationVariants/earths-layers__reading-adapted__r1`: active,
>     r1 → `pr90f…` + `assessmentPresentations/ap1fed…` (Phase A);
>   - `presentationVariants/earths-layers__reading-adapted__r2`: active,
>     r2 → `pr6b7c…` + `assessmentPresentations/ap515838…` (Phase B);
>   - the shared coverage evaluator resolves each revision from its scoped
>     record (active, source scoped).
> - The legacy unscoped `earths-layers__reading-adapted` record (`prff01…`,
>   no revision) is unchanged and retained as historical evidence. Scoped
>   records take precedence.
> - Phases A and B wrote exactly those four documents. Assignments,
>   attempts, Current pointers, sessions, passbacks, Hosting, Functions,
>   Rules, the flag, and accommodations were unchanged.
> - The P9 TTL policy on `launchGrants.expiresAt` is ACTIVE (added
>   2026-09-27; re-read 2026-09-30). This supersedes the §21 observation.
> - Phase C (flag activation) is complete and certified (2026-09-30; full
>   record: addendum §21.12, "Production activation (Phase C)"):
>   - Chris created `platformConfig/differentiatedDelivery` with the boolean
>     `enabled: true` in the Firebase Console. That was the only Phase C
>     production mutation. Differentiated delivery is enabled.
>   - At certification there were 0 accommodations (0 active, 0 history
>     entries) and 0 launch grants.
>   - The designated beta student opened the existing Earth's Layers
>     assignment and received canonical delivery (frozen-r1 rendition, no
>     `launchRef`, no `/variants/` route, four choices on all 10 items, no
>     new session or grant). This certifies "flag enabled + no active
>     accommodation → canonical delivery with no differentiated launch
>     grant".
> - The teacher Student Services UI gate is OPEN: `G19_GATE_OPEN = true`
>   since `ece3861` ("Open Student Services pilot gate", 2026-09-26), and the
>   production bundle carries it. Formal G19 remains deferred by owner
>   decision. The §3 invariants 1-2, the §16 item 10 dark-state check, and
>   the §20 checklist items 4, 20, 24 and 26 describe the G19 dark-state
>   procedure and no longer describe current production.
> - Operational note: with the gate open and the flag enabled, a teacher
>   activating Reading Accessibility through Student Services makes
>   differentiated delivery operational for that student wherever certified
>   coverage exists (today Earth's Layers r1 and r2). This is intended
>   behavior. Setting `enabled` to `false` remains the F5.2 §8.6
>   operational disable.
> - Phases D/E are complete and certified (2026-09-30; full record: addendum
>   §21.12, "Production Phases D/E"). **Earth's Layers r1 differentiated
>   delivery is production-certified.** The designated beta student went
>   canonical → active accommodation → differentiated delivery → inactive
>   accommodation → canonical on the existing frozen-r1 assignment:
>   - Scope limitation: the owning production account is
>     `platformAdministrator`, and the accommodation callables require the
>     canonical role `teacher`, so the production Student Services UI save
>     could not be exercised and is **not** certified (staging certified it).
>     Production used an operator-equivalent activation and deactivation
>     (one transaction each, run outside the repository) with truthful
>     `platformAdministrator` audit provenance and change-ticket
>     correlation IDs.
>   - Phase D: the record became active/adapted at `configRevision` 1, with
>     history `r1` and one audit event. No grant was minted by activation.
>   - Phase E: one My Science load minted exactly one differentiated grant
>     (`reading-adapted`, `pr90f…` + `ap1fed…`, config 1, 6 h expiry). The
>     launch reached the exact retained `pr90f…` artifact with `assignment`
>     and `launchRef` in the fragment and no query string. The r1 AP
>     displayed 3 choices on all 10 items. No answer, session, attempt or
>     passback.
>   - Deactivation: the record became inactive at `configRevision` 2, with
>     history `r2` and a second audit event. The Phase E grant was left to
>     expire (15:42:00Z) and be TTL-deleted.
>   - Canonical restoration: a fresh My Science load minted no grant and
>     routed to the canonical frozen-r1 rendition with no `launchRef`.
>   - Assignments (22), attempts (144), Current pointers (4), sessions (25),
>     passbacks (99), coverage, AP records, the flag, Hosting, Functions,
>     Rules and the TTL policy were unchanged throughout.
>   - r2 coverage is published and staging-certified, but no production r2
>     assignment exists, so the r2 differentiated path is not
>     production-exercised.
>
> §21 below remains the historical 2026-09-26 observation. A later formal
> G19 run must still reconcile this runbook's deploy-set and routing steps
> with Slice 9.

Authoritative contract: `DIFFERENTIATION_F5_2_IMPLEMENTATION_SPECIFICATION.md`
(hereafter F5.2). This runbook never overrides F5.2; where they appear to
differ, F5.2 wins and the divergence is a defect in this runbook.

Companion evidence: `DIFFERENTIATION_STAGING_CERTIFICATION_RUNBOOK.md` (the
Slices 1-6 staging integration certification, "staging runbook" below).

**Revision.** Reconciled on 2026-09-26 against commit `639b619` ("Persist Show
Your Thinking responses in V2") after the differentiation pause. The original
preparation (`99f194c`) predated the Current Assignment architecture, Google
Classroom grade passback, Show Your Thinking V2, the curated application
Hosting artifact, and the Node 22 Functions runtime. This revision:

- makes path (a) the only G19 certification path and suspends path (b) (§10);
- requires fresh staging regression evidence at the certified commit (§7);
- rebaselines the expected production surfaces to the current architecture
  (§5, §8);
- records the Firestore TTL policy on `launchGrants.expiresAt` as a required
  read-only check (P9). An ACTIVE policy is a prerequisite to later production
  activation, not a G19 PASS condition (§8, §12, §19);
- replaces the impossible "empty tracked tree" rule with an exact-tree rule
  (§5);
- adds the current local gates (§6);
- carries Phase K normal routing forward from `1ddc813` under an
  unchanged-code condition (§7.4);
- records the pre-`.create()` grant read as an equivalent implementation of
  the F5.2 "creation transaction" wording (§13);
- records the read-only dark production baseline observed at `639b619`
  (§21). This is an observation checkpoint, not G19 evidence; staging
  re-certification and G19 are deferred by owner decision.

Owner decisions recorded in this revision (Chris, 2026-09-26):

1. Phase K normal routing is carried forward from `1ddc813` subject to the
   §7.4 condition. No staging-only fixture-hosting mechanism will be built.
2. Firestore TTL deletion is not a G19 PASS requirement. An ACTIVE TTL policy
   is a production-activation prerequisite.
3. Six-hour launch-grant authorization expiry remains a required F5.2
   security invariant.
4. The pre-`.create()` grant read is accepted as equivalent to F5.2's
   "creation transaction". The wording difference is a non-blocking
   discrepancy, not a code defect.

---

## 1. Purpose and Scope

**Purpose.** Provide the ordered, safety-gated plan to satisfy F5.2 gate **G19**
in production: prove that differentiated-delivery infrastructure (Slices 2-6)
is deployed as certified and is fail-closed and dark in the live
`lyfelabz-prod` project. Exposing the Slice 7 teacher activation surface is a
later, separate human decision.

**In scope.**
- Repository baseline verification.
- Local automated test gates.
- Fresh staging regression evidence at the certified commit (separately
  authorized).
- Read-only production structural checks.
- Mapping Slices 2-6 contracts to evidence.
- Evidence capture that avoids student PII.
- Explicit STOP, PASS, and FAIL criteria.

**Out of scope (do not perform here or as a side effect of this runbook).**
- Flipping `G19_GATE_OPEN`.
- Enabling differentiated delivery for anyone.
- Publishing any presentation variant to production.
- Deploying anything, including the Slice 7 UI.
- Any production write, including launches, sessions, attempts, assignments,
  recipients, Current pointers, accommodations, grants, and platform config.
- Any Google Classroom action.
- Committing or pushing.
- Privacy-hardening, Hosting architecture, GitHub Pages, DNS, or
  marketing-Hosting work.
- OAuth secret rotation.
- Repository visibility changes.

Slice 8 (teacher preview) is optional and non-blocking (F5.2 §9, §15 row 8) and
is not part of G19.

**Nature of this gate.** G19 is a certification/verification gate, not new
implementation and not activation. All Slice 2-6 code exists and was
staging-certified at `1ddc813`. G19 asks a different question than G14
(staging): does the certified infrastructure exist in production exactly as
certified, remain dark, and fail closed, without misrepresenting delivery and
without touching real student data.

**What G19 can and cannot prove in production today.** At this revision
(2026-09-26), the checked-in retention manifest
`app/lessons/variants/manifest.json` was `[]` and no production presentation
revision existed; that is superseded by Phases A and B (see the
production-state notice above). None may be published by G19. G19 therefore
proves the production posture of the delivery infrastructure (deployed as
certified, deny-all, flag disabled, no coverage, every resolution canonical).
It does not produce a production `"differentiated"` attempt. The
differentiated delivery contracts themselves are proven by local suites plus
fresh staging evidence (§7, §9).

---

## 2. Exact G19 Entry Conditions

All must hold before production certification work begins:

1. **Certified commit identified.** A single commit SHA is named as the
   certified commit. At this revision it is `639b619`. If `origin/main` or the
   production deployment has moved past it, the delta must first be
   reconciled against differentiation. Use the same method as the 2026-09-26
   reconciliation: diff every differentiation file and delivery-path callable
   since the certified commit, and classify each change as no impact,
   compatible, runbook update, or blocker. Then name the new SHA.
2. **G1-G18 hold locally** at the certified commit (§6):
   - Rules deny-all on the three new families (G1).
   - Authorization/CAS/history suites (G2/G3).
   - Canonical non-regression (G4).
   - Determinism/immutability/retention (G5/G6/G7).
   - Fallback classification (G8).
   - Freeze/autosave/reassessment (G9/G10).
   - Classroom/reporting unchanged by presentation (G11/G12).
   - Publication ordering (G15).
   - Launch binding (G16).
   - Client fallback and path privacy (G17).
   - Outcome integrity (G18).
3. **G14 staging proof.**
   - The historical G14 PASS at `1ddc813` is recorded (staging runbook §3a/§3b).
   - A **fresh staging regression certification at the certified commit** must
     also PASS (§7). The historical PASS alone is no longer sufficient, because
     the delivery-path authorization chain, Hosting layout, and Functions
     runtime changed after it (§7.1).
   - The only element carried forward from `1ddc813` is Phase K normal
     routing, under the §7.4 unchanged-code condition.
4. **Certified build is what production runs.** §8 establishes read-only that
   production Functions, Rules, and Hosting correspond to the certified commit.
   This runbook never deploys to make that true. A mismatch is a STOP (§16).
5. **Dark-state invariants intact** (§3).
Not an entry condition: the launch-grant TTL policy. Its state is recorded
during production checks (§8 P9) whether or not the policy exists. Its absence
does not prevent a G19 PASS, but an ACTIVE policy is a prerequisite to later
production activation (§19). Creating the policy is a Firestore configuration
change that needs its own authorization and is never performed by this
runbook.

G19 exposure of Slice 7 is itself "a gated release action, not a code-deploy
side effect" (F5.2 §14). Passing G19 verification does **not** perform that
exposure (§19).

---

## 3. Dark-State and No-Side-Effect Invariants (must remain true throughout)

These must be true before, during, and after G19 verification, and must be
re-checked if anything looks off:

1. **`G19_GATE_OPEN` remains `false`** in `app/src/index.ts`. This runbook
   never changes it. The teacher Student Services activation callables
   (`listStudents` / `getAccommodation` / `setAccommodation`) stay wired to
   `null` while it is false. That wiring is the `app/src/index.ts` Slice 7
   block, flowing through `app/src/router/surfaces/index.ts`,
   `app/src/shell/shell.ts`, and `app/src/shell/surfaces/workspace.ts`.
2. **Differentiated delivery stays disabled in production for the entire G19
   run.** `platformConfig/differentiatedDelivery` is disabled when:
   - the document is missing;
   - the read fails;
   - `enabled` is anything other than the literal `true`.

   See F5.2 §8.6 and the fail-closed flag reader
   `platform/functions/src/shared/config/differentiated-delivery-flag.ts`.
   G19 never writes this document.
3. **No production writes of any kind.** G19 creates, mutates, or deletes no
   `studentAccommodations`, `presentationVariants`, `launchGrants`,
   `platformConfig`, `assignments`, `assignmentsCurrent`, recipients,
   `assessmentSessions`, `attempts`, `lmsGradePassbacks`, users, enrollments,
   or Hosting content.
4. **Current Assignment invariants are respected.** Assignment records are
   historical; Current is operational; attempts and best performance are
   cumulative; the Classroom grade destination is Current. G19 never publishes
   an assignment, never moves a Current pointer, and never launches an
   assignment in production.
5. **Historical attempts are never mutated or backfilled** (F5.2 §3.4, §8.6).
   Pre-feature attempts carry no `deliveryOutcome` and are never rewritten.
6. **No Google Classroom side effects.** G19 performs no coursework
   publication, roster sync, grade passback, grade preview/apply/retry, or
   coursework inspection. Because path (a) creates no attempt, the finalize
   grade-passback hook (`assessmentAttemptsFinalize` ->
   `synchronizeGradePassback`) is never reached.
7. **No real student is a verification target.** Real accommodation,
   enrollment, session, or attempt data is never opened or used as evidence.

If any of these cannot be confirmed, STOP (§16).

---

## 4. Production Project Identity and Target Verification

| Role | Firebase project | Project number | Source of truth |
|---|---|---|---|
| Production | `lyfelabz-prod` | 182791689935 | `.firebaserc` `default`; prod web config in `assets/lyfelabz-firebase-config.js` (non-staging hosts) |
| Staging | `lyfelabz-staging` | 293337283840 | `.firebaserc` alias `staging` |

Production application origin: `https://app.lyfelabz.com` (the marketing site's
`/app` redirects there; `firebase.marketing.json`). Staging Hosting origin:
`https://lyfelabz-staging.web.app`.

**Safety rule.** An alias name is never a trust boundary. The `.firebaserc`
`default` alias is `lyfelabz-prod`, so any command without an explicit
`--project` resolves to production. Every production command in this runbook
passes `--project lyfelabz-prod` (or `--project=lyfelabz-prod` for `gcloud`).
Every staging command passes the literal `lyfelabz-staging`. Every local
emulator command passes a `demo-` project id. Anything that does not
positively resolve to the intended literal id fails closed.

**Repository tooling constraints the operator must know.**
- `platform/functions/src/scripts/staging-cert-driver.ts` is **hard-locked to
  `lyfelabz-staging`**. It requires an explicit `--project=lyfelabz-staging`,
  refuses any other project id (including `lyfelabz-prod`), and refuses a
  conflicting ambient project. It cannot be pointed at production and must not
  be modified to remove that lock.
- `platform/functions/src/scripts/staging-cert-seed.ts` is locked to staging
  in the same way.
- `platform/functions/src/scripts/astra004-hosting-prepare.ts` is pinned to
  the historical staging baseline `cb73aff` and the pre-curated Hosting
  layout. It must not be repurposed for this runbook.
- `platform/functions/src/scripts/publish-variant.ts` has a `--target=production`
  mode, guarded by `--i-know=production`, credentials, and a liveness origin.
  **G19 never invokes it.** Production variant publication is out of scope
  (§1, §10).
- There is no repository-provided production delivery driver. None may be
  created for G19.

---

## 5. Required Repository Baseline Checks (READ-ONLY)

Run all of these and record the output before any verification is trusted.

1. **Branch, HEAD, origin.**
   ```
   git branch --show-current
   git rev-parse HEAD
   git rev-parse origin/main
   git --no-pager log -1 --pretty=format:'%h %s'
   ```
   HEAD must equal the certified commit (§2.1).
2. **Exact-tree rule (replaces the former "empty tracked tree" rule).**
   ```
   git status --short
   ```
   - The only permitted tracked modification is `docs/.DS_Store`. It is a
     known, permanently dirty, unrelated file and must be left untouched.
   - Any other tracked modification means the §6 gates would not test the
     certified commit.
   - So does any untracked file under a gate's scope (`app/`, `lesson-sources/`,
     `platform/`, `scripts/`, `assets/`, or repository-root lesson/page HTML).
     Such files are collected by jest or read by the lesson/curriculum
     verifiers.

   If the primary checkout does not satisfy the rule, **never** clean, reset,
   stash, restore, or edit it. Either:
   - (i) STOP and let Chris resolve the unrelated work; or
   - (ii) run the §6 gates in a disposable detached worktree at the certified
     commit, which leaves the primary checkout untouched:
     ```
     git worktree add --detach <scratch-path> <certified-sha>
     ```
     Install dependencies there with `npm ci` for `app/`, `platform/functions/`,
     and `platform/firebase/`. Remove the worktree with
     `git worktree remove <scratch-path>` after recording results.

   Record which option was used.
3. **Dark-state grep.**
   ```
   grep -n 'G19_GATE_OPEN' app/src/index.ts
   ```
   Confirm `const G19_GATE_OPEN = false;` and the three `null`-gated getters
   (`listStudents`, `getAccommodation`, `setAccommodation`).
4. **Environment separation (ASTRA-004).**
   - `assets/lyfelabz-firebase-config.js` must be host-aware: staging hosts
     (`lyfelabz-staging.web.app`, `lyfelabz-staging.firebaseapp.com`) get the
     staging config, and every other host gets the byte-identical prod config.
   - `localhost` uses the emulator via `getFirebaseClientConfig()` before the
     global is read.
   - The lesson runtime shim (`assets/lyfelabz-assessment-runtime.js`) must
     contain **no** hard-coded production Firebase fallback and must fail
     closed when no usable config is installed.
5. **Empty retention manifest.**
   - `app/lessons/variants/manifest.json` must be `[]`.
   - No `lesson_*__pr<64hex>.html` files may exist under `app/lessons/variants/`.
   - The staging certification fixtures must live only under
     `platform/functions/src/scripts/__fixtures__/staging-cert-variants/`,
     which Hosting excludes.

   A non-empty manifest means a production presentation is pending or has been
   published. That is outside G19 and is a STOP.
6. **Expected production surface baseline (derived from the certified commit,
   used by §8).** Record, from the certified commit:
   - **Functions:** the full export set of `platform/functions/src/index.ts`
     and the runtime in `firebase.json` (`nodejs22` at `639b619`). The
     delivery-half callables (`assignmentsListForStudent`,
     `lmsDeepLinkResolve`, `assessmentSessionsBegin`,
     `assessmentAttemptsFinalize`) and `accommodationsGet` /
     `accommodationsListStudents` / `accommodationsSet` must all be in that
     set. The accommodation callables are deployed but unreachable from the
     UI while the gate is closed. The set also contains every post-pause
     callable (Current Assignment, recipient reconciliation, grade passback,
     coursework inspection, teacher suspension, class color/order, and so
     on). Those are **expected**, not "extra".
   - **Rules:** `platform/firebase/firestore.rules`, including the explicit
     `allow read, write: if false;` blocks for `platformConfig`,
     `studentAccommodations` (and `history`), `presentationVariants`, and
     `launchGrants`. It also includes the post-pause blocks
     (`assignmentsCurrent`, `lmsGradePassbacks`, `platformAdminBootstrap`).
   - **Hosting:** the curated artifact model.
     - `firebase.json` `hosting.public` is `dist/app-hosting`, built by
       `scripts/app-hosting/build.cjs` from
       `scripts/app-hosting/public-files.json` plus the retained variants in
       the manifest (none today).
     - There is no `/app/**` catch-all rewrite. Only the listed SPA routes
       (`/app/signin`, `/app/onboarding`, `/app/pending`, `/app/teacher`,
       `/app/student`, `/app/a/**`) rewrite to `/app/index.html`.
     - The app bundle is served at `/app/dist/bundle.js`.

---

## 6. Required Local Automated Test Gates (READ-ONLY, before any other step)

These prove the G1-G18 behavioral contracts against the certified commit. They
are local and deterministic, and must all be green, on a tree satisfying §5.2,
before any staging or production step.

| Gate | Command (from repo root unless noted) | Proves |
|---|---|---|
| App verify | `npm --prefix app run verify` | curriculum + lessons + **variant retention verifier** (`variants:verify`, expected "0 retained revision(s) verified") + typecheck + lint + the full app jest suite: Slice 5 routing/fallback/ref-discard (`launchRouting.test.ts`), ASTRA-004 firebase-environment contract, begin-request boundary, Slice 7 dark wiring |
| Hosting artifact | `node --test scripts/app-hosting/build.test.cjs` | curated artifact allowlist, private manifest exclusion, retained-variant identity/hash validation. The Hosting-emulator case is skipped by default; record it as skipped. |
| Functions tests | `npm --prefix platform/functions test` | Op B CAS/history (B), resolution + grant minting (C/N), delivery outcome (O), publication ordering (P), client privacy (Q), no-ref + operational disable (R), launch-grant binding, fail-closed flag reader, and the Current-aware authorization chain around them (supersession refusal in begin and deep link, recipient self-heal, Current-aware student list) |
| Functions static | `npm --prefix platform/functions run typecheck`, `npm --prefix platform/functions run lint`, `npm --prefix platform/functions run build` | the deployable Functions compile and lint cleanly (`build` writes only the gitignored `lib/`) |
| Rules | from `platform/firebase`: `npx firebase emulators:exec --project demo-lyfelabz-rules --only firestore "npx jest"` | deny-all on `studentAccommodations`, `presentationVariants`, `launchGrants`, `platformConfig` (G1) and every other Rules contract |

The rules suites initialize their own `lyfelabz-rules-test` project. The
explicit `demo-` project on `emulators:exec` keeps the emulator context off the
ambient `lyfelabz-prod` alias. The stock `npm run test:rules` script omits
`--project`, so do not use it for certification.

Record suite/test totals as compact counts on PASS. On any failure, capture the
full failing output (names, diffs, stack, exit code) and treat it as a G19 FAIL
input (§18). Do not weaken or skip a test to make a gate pass.

A read-only reconciliation pass on 2026-09-26 observed all of these gates green.
It ran on a checkout with unrelated uncommitted lesson work, so it is **not**
G19 evidence. G19 must record its own counts.

---

## 7. Fresh Staging Regression Certification (NEW PREREQUISITE, STAGING MUTATION)

### 7.1 Why the historical staging PASS is no longer sufficient alone

The staging G14 PASS (staging runbook §3a/§3b) was certified at `1ddc813`.
Since then, changes landed that sit on the delivery path or its deployment
surface. The delivery modules themselves are unchanged:
`resolve-launch-presentation.ts`, `resolve-begin-delivery.ts`,
`begin-delivery-deps.ts`, `launch-grant.ts`, the flag reader,
`publish-variant.ts`, `launchRouting.ts`, and the runtime `launchRef`
transport.

| Change | Effect on differentiation | Local evidence |
|---|---|---|
| `assessmentSessionsBegin`: refusal of occurrences superseded by a valid Current (`assignment-window-closed`), and recipient self-heal (`ensureAssignmentRecipient`) for proven active enrollees | Runs before the delivery freeze; a superseded occurrence is refused before any grant is read | begin suites |
| `lmsDeepLinkResolve`: superseded occurrence -> `informational` | Op C is not run; no grant is minted | deep-link suites |
| `assignmentsListForStudent`: Current-aware collapse | Grants are minted only for operational (Current or legacy-scope) items; superseded occurrences are never items | list suites |
| `assessmentAttemptsFinalize`: Show Your Thinking `writtenResponse`, and the post-commit Classroom grade-passback hook | Delivery fields are still copied verbatim; passback never reads delivery fields | finalize suites |
| Curated Hosting artifact; `/app/**` catch-all removed | A missing variant path now returns 404, so the client load probe (`res.ok`) fails closed to canonical. Under the old catch-all, a missing variant path returned the SPA shell with HTTP 200. The private manifest URL now returns 404 instead of the SPA fallback. | `build.test.cjs`, `variants:verify` |
| Functions runtime `nodejs20` -> `nodejs22` | Whole delivery half runs on a new runtime | none (runtime-level) |

Local suites cover the logic. Only a live environment covers the runtime,
deployed Rules, deployed Hosting layout, and callable wiring. G19 path (a) may
rely only on staging evidence produced at the certified commit. The one
exception is Phase K normal routing, which is carried forward from `1ddc813`
under the §7.4 condition.

### 7.2 Authorization and target

This whole section is a **STAGING MUTATION**. It deploys the certified commit
to `lyfelabz-staging` and exercises synthetic users. It requires Chris's
explicit authorization, given separately from any G19 authorization. Every
command targets the literal `lyfelabz-staging`. Production is never touched.
The current staging deployment state (deployed commit, index pointer, flag
value, retained artifacts) is **not recorded in the repository** and must be
established read-only before anything is deployed.

### 7.3 Required fresh evidence at the certified commit

1. **Deploy parity.** Staging Functions, Firestore Rules/indexes, and Hosting
   run the certified commit, with the Functions runtime `nodejs22`. Each deploy
   is scoped with `--only` and `--project lyfelabz-staging`.
   `assessmentAttemptsFinalize` now binds the `GOOGLE_CLASSROOM_CLIENT_SECRET`
   secret. The staging runbook records it as present (version 1, ENABLED).
   Confirm that before deploying Functions, and never read the secret's value.
2. **Backend phases A-M, re-run at the certified commit.** Use the
   staging-locked driver (`staging-cert-driver.ts`; its usage line lists the
   commands). Use the existing synthetic seed (`staging-cert-seed.ts`), which
   is staging-locked and synthetic-only. The phases, per the staging runbook
   "Delivery-half certification":
   - A: identity and deny-all.
   - B: Op B CAS, history, and no-op.
   - C: flag fail-closed.
   - D: canonical control.
   - E: disabled -> `canonicalFallback`.
   - F: differentiated resolution, the 6h grant, and freeze.
   - G: `BEGIN_REQUIRES_LAUNCH`.
   - H: uniform `LAUNCH_REF_INVALID`.
   - I: A->B immutability.
   - J: reassessment.
   - L: operational disable/re-enable truthfulness.
   - M: legacy attempt not backfilled.

   These phases read the index and grants, not hosted bytes, so they are
   unaffected by §7.4.
3. **Current Assignment coexistence in staging.**
   - The seeded `staging-cert-assignment` is written by the seed harness, not
     published through `assignmentsPublish`, so it has no Current pointer.
     Confirm that this legacy scope launches exactly as before.
   - Do not hand-create an `assignmentsCurrent` pointer to force a managed
     scope. Current-managed behavior (supersession refused before any grant is
     read; grants only for the Current item) is evidenced by the local suites
     in §6 and by the begin ordering in §13.
4. **No Classroom side effects in staging.**
   - Before running attempts, confirm the synthetic assignment is not
     Classroom-linked and has no `classroomGrading` configuration.
   - After the run, confirm that no `lmsGradePassbacks` documents exist for the
     synthetic attempts. The finalize hook is a no-op for ungraded assignments.
5. **Hosting behavior under the curated artifact (headless, read-only GETs
   against the staging origin).**
   - `/app/lessons/variants/manifest.json` returns **404**. This replaces the
     historical "SPA index fallback" expectation.
   - An unknown grammar-valid variant path under `/app/lessons/variants/`
     returns **404**.
   - `/app/dist/bundle.js` carries the Slice 5 markers: the path-grammar
     literal `app\/lessons\/variants\/lesson_` and the anomaly text
     `lesson presentation unavailable; opening the standard lesson`.
6. **Phase K controlled failure, at the certified commit.** For a
   differentiated browser actor, blocking or missing the variant artifact must
   produce all of the following:
   - visual canonical fallback;
   - `assignment=` retained with no `launchRef=`;
   - zero sessions and zero attempts created;
   - a subsequent ref-less begin returning `BEGIN_REQUIRES_LAUNCH`.

   Under the curated artifact the fixture revisions are absent from a fresh
   staging deploy (§7.4), so this path is exercised naturally.
7. **TTL policy in staging (read-only).** Record the output of
   `gcloud firestore fields ttls list --project=lyfelabz-staging`. This is
   informational only; production is recorded in §8 P9. Grant *expiry* (the
   security invariant) is proven separately by the application-level
   refusal: local T-N6 suites (`resolve-begin-delivery.test.ts`,
   `assessment-sessions-begin.test.ts`) and the phase F 6h grant.
8. **Evidence and residue.**
   - Capture structural evidence only (§15).
   - Synthetic residue stays on staging for review, as in the original
     certification.
   - Staging may be left with the flag enabled for the synthetic fixture only
     if Chris authorizes it; record the final flag state.

### 7.4 Phase K normal routing - owner decision: CARRY FORWARD

The normal differentiated-routing case of Phase K is **carried forward** from
the staging certification at `1ddc813` (staging runbook §3a: the browser loaded
the exact server-selected revB artifact with no accommodation semantics in the
URL). It is not re-observed at the certified commit. No staging-only
fixture-hosting mechanism will be built to reproduce it. `astra004-hosting-prepare.ts`
must not be repurposed for it, and fixtures must never be added to the
production retention manifest.

**Why it cannot be re-observed.** The staging fixture revisions A/B were removed
from the retention manifest and relocated outside Hosting (`48b7454`; fixture
README under `platform/functions/src/scripts/__fixtures__/staging-cert-variants/`).
A staging Hosting deploy of the certified commit builds the curated artifact
from the empty manifest, so it does not serve the fixture artifacts. The
staging index may still point at revB; its current value is unrecorded.

**Basis for the carry-forward.** Between `1ddc813` and `639b619` the client
routing path is unchanged:
- `app/src/assignments/studentList/launchRouting.ts`;
- `app/src/runtime/launchParams.ts`;
- `app/src/assignments/deepLink/`;
- the `createBrowserLaunchExecuteDeps` probe and executor in `app/src/index.ts`;
- the `launchRef` and presentation handling in `app/src/runtime/entry.ts`,
  `app/src/runtime/orchestrator.ts`,
  `app/src/assignments/studentList/wire.ts`, and
  `app/src/assignments/studentList/types.ts`.

The post-pause Hosting change affects only the missing-artifact path, where it
made behavior stricter (404 instead of an HTTP 200 SPA shell).

**Unchanged-code condition.** If the certified commit is not `639b619`, the
operator must confirm before relying on the carry-forward that the
routing-relevant content of those paths is unchanged:
```
git --no-pager diff --stat 1ddc813..<certified-sha> -- \
  app/src/assignments/studentList/launchRouting.ts \
  app/src/runtime/launchParams.ts \
  app/src/assignments/deepLink/
git --no-pager diff 1ddc813..<certified-sha> -- \
  app/src/index.ts app/src/runtime/entry.ts app/src/runtime/orchestrator.ts \
  app/src/assignments/studentList/wire.ts app/src/assignments/studentList/types.ts
```
- The first command must show no changes.
- In the second, no changed line may touch the probe or executor
  (`createBrowserLaunchExecuteDeps`, `executeLaunch`, `probe`,
  `onVariantLoadFailure`), `launchRef` transport, `presentation` handling, or
  launch-plan construction.

Any such change voids the carry-forward and is a STOP (§16).

**What fresh staging must still prove.** The carry-forward covers only normal
routing. The fresh staging certification must still complete:
- all backend phases (§7.3.2);
- Current Assignment coexistence (§7.3.3);
- the no-Classroom-side-effect checks (§7.3.4);
- the curated-Hosting 404 and bundle-marker checks (§7.3.5);
- the controlled-failure routing check (§7.3.6).

### 7.5 Staging PASS required

The fresh staging regression certification PASSes only when:
- every item in §7.3 is confirmed;
- the §7.4 unchanged-code condition is confirmed for the certified commit;
- no production resource was touched.

Record it as a staging certification note at the certified commit (structural
facts only). G19 production work may not start without it.

---

## 8. Production Read-Only Structural Checks (path (a))

Every check here is **read-only**. None deploys, writes, launches, or calls a
teacher or student callable. Console checks are view-only: do not click
publish, edit, add, or delete. If any check cannot be performed read-only, skip
it and treat G19 as not passable until it can be.

| # | Check | Read-only method | Expected | On mismatch |
|---|---|---|---|---|
| P1 | Deployed Functions match the certified commit | `firebase functions:list --project lyfelabz-prod` | Set equals the §5.6 export set; runtime `nodejs22` where shown; delivery-half and accommodation callables present | STOP (deployment delta) |
| P2 | Deployed Firestore Rules match the certified commit | Firebase console, Firestore Rules tab for `lyfelabz-prod` (view only), compared against `platform/firebase/firestore.rules` at the certified commit | Byte-equivalent; the four deny-all blocks present | STOP |
| P3 | Deny-all is live for unauthenticated clients | Unauthenticated `curl` GET of `https://firestore.googleapis.com/v1/projects/lyfelabz-prod/databases/(default)/documents/<collection>` for `studentAccommodations`, `presentationVariants`, `launchGrants`, `platformConfig` | `403 PERMISSION_DENIED` for each; record status code only | STOP (fail-open) |
| P4 | Hosting serves the curated artifact | `curl -sSI https://app.lyfelabz.com/app/lessons/variants/manifest.json`, and the same for one grammar-valid nonexistent path such as `/app/lessons/variants/lesson_g19-probe__pr` followed by 64 `0` characters and `.html` | `404` for both (no SPA 200 fallback, no manifest bytes) | STOP |
| P5 | Deployed bundle carries Slice 5 routing | `curl -sS https://app.lyfelabz.com/app/dist/bundle.js` piped to `grep -c` for `app\/lessons\/variants\/lesson_` and for `lesson presentation unavailable; opening the standard lesson` | Both present | STOP |
| P6 | Operational flag is disabled | Firebase console, open only `platformConfig/differentiatedDelivery` | Document missing, or `enabled` not the literal `true` | STOP (dark-state drift) |
| P7 | No production presentation coverage | Firebase console root collection list (view only; do not open documents) | No `presentationVariants` collection listed (zero documents) | STOP |
| P8 | No production activation or grants | Firebase console root collection list (view only; **never open these documents**, they are keyed by student `uid`) | Neither `studentAccommodations` nor `launchGrants` listed (zero documents) | STOP and escalate; do not inspect contents |
| P9 | Launch-grant TTL policy | `gcloud firestore fields ttls list --project=lyfelabz-prod` | Record the result: present with state `ACTIVE`, present in another state, or absent. Expected for activation: a TTL policy on collection group `launchGrants`, field `expiresAt`, state `ACTIVE` | **Record only; not a G19 FAIL.** Report it as an outstanding production-activation prerequisite (§19). Creating the policy is a separately authorized Firestore configuration change. |

Notes:
- P1-P2 confirm production runs what §6/§7 certified. Rebaseline them against
  the certified commit, never against the pre-pause callable or Rules set.
- Given P6-P8, every production launch today resolves `expectedCanonical`
  (no accommodation -> no grant, no presentation). This is the dark posture G19
  certifies.
- A non-empty `studentAccommodations` in P8 would mean Op B was invoked while
  the UI was dark. Resolution would still be fail-closed while the flag is
  disabled (truthful `canonicalFallback`), but it is an unexplained production
  state and a STOP.
- **P9 distinguishes security expiry from storage cleanup.**
  - *Security expiry* is a required F5.2 invariant enforced by application
    logic, and it is not weakened. Grants become unusable at `expiresAt`
    (`issuedAt + 6h`): begin refuses with retriable `LAUNCH_REF_EXPIRED`,
    checked against the stored `expiresAt` (F5.2 §8.2 step 2, §7.2, T-N6).
    This is proven by §6 and §7 evidence.
  - *Physical deletion* of expired grant documents by a Firestore TTL policy
    is the F5.2 §3.6/§7.2/§11 "TTL-deleted, never long-term state" property.
    F5.2 §16 classifies the policy as "Operational capability/cost, not
    contract; expiry never depends on deletion latency", with the check
    assigned to "CODE + HUMAN OPERATIONAL CHECK (Slice 4)". The repository
    records no resolution of that check.
  - No F5.2 §14 gate names the policy. P9 therefore records its state for
    G19 and makes an ACTIVE policy a production-activation prerequisite
    (§19).
  - While P8 holds (no active accommodations), production mints no grants, so
    nothing can accumulate before activation.

---

## 9. Slices 2-6 Contract-to-Evidence Matrix (path (a))

No row requires a production mutation.

### Slice 2 - Immutable build pipeline + presentation identity
- **Prove:**
  - deterministic content-addressed build;
  - full-digest `presentationRevisionId`;
  - opaque `app/lessons/variants/lesson_<slug>__pr<64hex>.html` paths carrying
    no `variantKey`, accommodation token, or student id (F5.2 §5, T-Q2);
  - append-only manifest retention (§6.2/§6.3).
- **Evidence:**
  - `variants:verify` and `app run verify` green;
  - `build.test.cjs` green;
  - the certified manifest (`[]`).

  This is a repository property (F5.2 §6), fully proven without production.
- **Rollback/failure:** verifier failure blocks release. Remediation is
  restoring files from git history, never editing the manifest (F5.2 §6.7).

### Slice 3 - Publication state machine + index + retention
- **Prove:**
  - the §6.8 ordered machine: build -> derive/verify digest -> add artifact ->
    append manifest -> verifier -> commit -> deploy -> liveness -> index last;
  - the index only ever points at an artifact confirmed retrievable (T-P1/P2/P3,
    T-E5-E8).
- **Evidence:**
  - local suite P green;
  - historical staging publication proof (revA then revB through
    LOCAL_VERIFIED -> HOSTING_DEPLOYED -> HOSTED_BYTES_VERIFIED ->
    INDEX_UPDATED, A retained byte-identical after B; staging runbook §3);
  - production P7 (no index documents).
- **Under the curated artifact:** a published revision is deployable only
  because its manifest entry precedes the deploy. This matches the §6.8
  ordering and is enforced by `scripts/app-hosting/build.cjs`.
- **Production:** at this revision no production artifact existed, so there
  was no production liveness check to perform. Production publication is out
  of G19 scope (Phases A and B later ran it separately; see the notice above).

### Slice 4 - Server resolution (Op C) + launch grants
- **Prove:**
  - Op C runs only after full existing authorization, only for `actor.uid`,
    and only on launch targets;
  - it mints a `differentiated` grant (uid/assignment/lesson-bound, 6h TTL)
    only when an active index exists and delivery is enabled;
  - it mints only a `canonicalFallback` grant when disabled, uncovered, or
    retired;
  - it mints no grant for canonical-expected students;
  - forbidden-key coverage (F5.2 §4, §3.6, §8.6);
  - under Current Assignment, Op C runs only for operational items and never
    for a superseded occurrence (`informational` deep-link arrival).
- **Evidence:**
  - local suites C/N/M/R, the flag-reader suite, and the list/deep-link
    suites;
  - fresh staging phases C/F/L (§7.3.2);
  - production P6-P8 (disabled, no coverage, no activation).
- **Rollback/failure:** an internal resolver failure yields a canonical
  response with no grant, plus telemetry. A later no-ref begin then applies
  §8.2, never a silent canonical (F5.2 §4 Op C internal-failure row).

### Slice 5 - Client routing + canonical fallback
- **Prove:**
  - the client routes to the exact server-selected `presentation.path` after
    the trust-boundary path grammar check;
  - on load-probe failure it falls back visually to canonical, discards
    `launchRef` (the canonical URL carries no ref), and emits the anomaly;
  - the client never derives a variant and is never authoritative for
    fallback legitimacy (F5.2 §7.3; `app/src/assignments/studentList/launchRouting.ts`,
    probe in `app/src/index.ts` `createBrowserLaunchExecuteDeps`).
- **Evidence:**
  - `launchRouting.test.ts` green;
  - fresh staging §7.3.5-§7.3.6 (Hosting 404s, bundle markers, controlled
    failure);
  - normal routing carried forward from `1ddc813` under the §7.4
    unchanged-code condition;
  - production P4-P5.
- **Rollback/failure:** rolling back Slice 5 while coverage is published
  requires the §8.6 operational disable first (G20). Production has no
  coverage today.

### Slice 6 - Begin binding + deliveryOutcome freeze
- **Prove:**
  - begin validates the grant after the unchanged-in-kind authorization chain
    (§13);
  - it freezes `variantKey` / `presentationRevisionId` /
    `deliveryOutcome:"differentiated"` from the grant;
  - A->B invariant: a grant bound to revision A still freezes A after the
    index moves to B;
  - forbidden, expired, cross-user, and cross-assignment grants are refused
    uniformly;
  - a covered+enabled active accommodation with no valid ref returns
    `BEGIN_REQUIRES_LAUNCH`, with no session and no attempt (P1);
  - a disabled flag yields a truthful `canonicalFallback` (F5.2 §8);
  - finalize copies delivery state verbatim alongside `writtenResponse`
    without re-resolving.
- **Evidence:**
  - local suites N/O/R/G/H/I/K and the finalize suites;
  - fresh staging phases F/G/H/I/J/L/M.
- **Production:** no begin, session, or attempt is created by G19.

---

## 10. Path (b) - SUSPENDED

The earlier runbook offered path (b): one controlled, human-authorized
production delivery proof using a synthetic-in-prod actor, "then remove the
synthetic residue". **Path (b) is suspended and is not a G19 option.** Under
the current architecture it cannot be executed without violating invariants
this runbook must preserve:

1. **No production presentation exists.** A production `"differentiated"`
   attempt would first require publishing a variant to production. That means
   a production Hosting deploy of a manifest-listed revision plus a production
   index write, which is outside G19.
2. **Residue cannot be removed without breaking immutability.** Attempts are
   immutable and cumulative. Assignment records are historical. "Removing
   synthetic residue" would require deleting immutable history.
3. **Current Assignment side effects.** Publishing a synthetic assignment
   advances the Current pointer for its class + lesson. Any synthetic launch
   participates in cumulative attempts and best performance.
4. **Google Classroom side effects.** A synthetic attempt in a
   Classroom-linked or graded class triggers the finalize grade-passback hook.
   Coursework publication would create real Classroom artifacts.
5. **Recipient self-heal writes.** `assessmentSessionsBegin` idempotently
   creates missing recipient documents for proven active enrollees.
6. **No actor mechanism.** No repository-provided, production-locked,
   synthetic actor-provisioning and cleanup mechanism exists. The staging
   driver must not be modified to serve that role.

Reinstating any production delivery proof requires a separately authorized
redesign that resolves all six points. This runbook does not attempt that
redesign. G19 is certified by path (a) only.

---

## 11. Differentiated-Delivery Operational Flag Safety

- `platformConfig/differentiatedDelivery` is **server-owned** platform
  configuration (F5.2 §8.6, §11). No student, teacher surface, or ordinary
  client can set, assert, override, or bypass it. A `launchRef` cannot
  override a disabled state.
- **Fail-closed is the guarantee to preserve.** The flag is disabled when:
  - the document is missing;
  - the read fails;
  - the value is anything other than the literal `enabled === true`.

  Do not add a default-enabled path.
- **G19 never enables, writes, or clears the production flag.** Production P6
  only reads it.
- Setting or clearing the flag never mutates accommodation records or
  historical attempts (§8.6 ownership clause). Staging flag changes during
  §7 are staging-only and separately authorized.

---

## 12. Launch-Grant Verification

These F5.2 §3.6 / §7.2 properties are proven by local suites and fresh staging
evidence (§7). Production confirms that no grants exist (P8) and records the
state of the TTL deletion policy (P9).

- **Server-issued, opaque id:** 32 lowercase hex chars from a CSPRNG, never
  derived from content or predictable inputs.
- **uid binding:** `studentId` must equal `actor.uid`. Another user's grant is
  refused with a shape byte-identical to the unknown-grant refusal (no
  existence disclosure).
- **Assignment binding:** `assignmentId` must match the request.
  Cross-assignment reuse is impossible, with the same uniform refusal shape. A
  grant for an occurrence later superseded by a valid Current can never bind a
  session: begin refuses the superseded occurrence (`assignment-window-closed`)
  before the grant is read.
- **Lesson cross-check:** a `lessonSlug` mismatch refuses identically.
- **Expiry (required security invariant, unchanged):**
  - `expiresAt = issuedAt + 6h` (`LAUNCH_GRANT_TTL_MS`), both server-computed.
  - At or after `expiresAt`, begin refuses with retriable `LAUNCH_REF_EXPIRED`,
    checked against the stored `expiresAt` (a grant whose expiry equals now is
    expired).
  - A missing or malformed `expiresAt` refuses as `LAUNCH_REF_INVALID`.
  - This refusal never depends on the document having been deleted.
  - Evidence: T-N6 in `resolve-begin-delivery.test.ts` and
    `assessment-sessions-begin.test.ts`; staging phase F (6h grant).
- **Storage cleanup (operational, not a G19 condition):** physical deletion of
  expired grant documents is performed by a Firestore TTL policy on
  `launchGrants.expiresAt`. Its state is recorded at P9 and must be ACTIVE
  before production activation (§19).
- **No canonical launch grant:** canonical-expected launches mint no grant;
  absence of `launchRef` represents them.
- **Invalid/stale ref fallback:**
  - forged or unknown -> `LAUNCH_REF_INVALID` plus security telemetry, and no
    session;
  - a ref discarded after a client artifact-load failure, with coverage still
    active -> `BEGIN_REQUIRES_LAUNCH`, never a silent `canonicalFallback`.

Evidence to capture: refusal **codes** and the boolean facts above. Never
capture or print a real grant id, tokens, or an actor's raw identity.

---

## 13. Assessment Begin / deliveryOutcome Freeze Verification

- **Begin ordering (as implemented at the certified commit).** In
  `assessmentSessionsBegin` the order is:
  1. Authorization.
  2. Assignment begin window.
  3. Superseded-occurrence refusal.
  4. Active enrollment.
  5. Recipient check or idempotent self-heal.
  6. Session idempotency (an existing Live session is returned as-is, and a
     supplied `launchRef` is ignored).
  7. The delivery freeze (`resolveBeginDelivery`), which reads the grant, the
     accommodation, and the index with ordinary reads.
  8. Session creation with `.create()` (a must-not-exist precondition).

  Every refusal in step 7 throws before the create, so no session and no
  attempt are produced.
- **"Creation transaction" wording: equivalent implementation (owner-accepted,
  non-blocking).** F5.2 §8.2 says begin reads the grant (step 2) and, for
  no-ref begins, the accommodation (step 3) "in the creation transaction". The
  implementation performs these as ordinary reads immediately before the
  session `.create()` precondition, not inside a Firestore transaction. This
  is accepted as equivalent, not a code defect:
  - **Grants are immutable.** `launchGrants` documents are written only by
    `.create()` at issuance (`launch-presentation-deps.ts`). No code updates
    them, and client access is deny-all. A transactional read would guard
    against a concurrent change that cannot happen. Expiry is evaluated
    against the stored `expiresAt`.
  - **Disjoint writes.** Begin writes only its own session document. It never
    writes the grant, accommodation, index, or flag documents it reads.
    Operations that write those documents (Op B, publication, flag changes)
    never write the session. Any interleaving is therefore equivalent to a
    serial order in which begin precedes the concurrent change, which is the
    same guarantee a transaction would provide.
  - **Single winner.** The `.create()` must-not-exist precondition makes
    exactly one concurrent begin create the session. That is the create-once
    property F5.2 §8.2 step 1 relies on.
  - **No residue on refusal.** Every refusal throws before the create.
  - **A->B invariant.** A grant freeze never consults the index, so it holds
    regardless of read timing.

  One related pre-existing wording gap: F5.2 §8.2 step 1 says a concurrent
  loser "returns that session". The implementation (Sprint 11D, predating
  differentiation) returns `assessmentSessions.conflict` to the loser, and a
  retry returns the live session through the idempotency check. Frozen values
  are deterministic either way.

  Neither item blocks staging re-certification or G19. This ordering was
  staging-certified at `1ddc813` and is unchanged since. Record both in the
  G19 note as known wording discrepancies. Aligning the F5.2 text is a
  separate documentation decision, not a G19 action.
- **Freeze at begin, copy at finalize.** `deliveryOutcome` is frozen on the
  session at begin and copied verbatim to the attempt at finalize. Sessions
  are deleted at finalize, and the attempt is the sole durable carrier (F5.2
  §8.1, §8.4). Show Your Thinking `writtenResponse` is copied beside, not in
  place of, the delivery fields. Autosave cannot write delivery fields.
- **Invariant:**
  - `deliveryOutcome:"differentiated"` requires both presentation fields to be
    present;
  - `"canonical"` and `"canonicalFallback"` require both to be absent;
  - exactly one present is invalid by construction (§3.3).
- **A->B immutability:** a grant that validly bound revision A freezes A even
  after the index moves to B.
- **Distinguishability:** CASE A/B/C are distinguishable from durable attempt
  data alone (§3.4, T-O4).
- **Presentation-agnostic downstream.** Cumulative attempts, best performance,
  Current-aware reporting, and Classroom grade passback never read delivery
  fields. A differing presentation cannot fork or corrupt assessment history.
- **Pre-feature attempts** carry no `deliveryOutcome` and must not be
  backfilled (§3.4).

---

## 14. Failure-Path Verification

Each fail-closed behavior is proven by local suites and fresh staging (§7).
Production confirms the disabled and uncovered posture.

1. **Flag fail-closed:** a missing or non-true flag means disabled. Evidence:
   local, staging C, prod P6.
2. **Covered no-ref begin refuses:** covered + enabled + active accommodation
   + no `launchRef` -> `BEGIN_REQUIRES_LAUNCH`, with no session and no attempt.
   Evidence: T-R1, staging G.
3. **Legitimate fallback still available:** active + uncovered/retired + no
   ref -> `canonicalFallback` with telemetry and no pair. Evidence: T-R2.
4. **Invalid grants:** forged, cross-user, cross-assignment, or malformed ->
   uniform `LAUNCH_REF_INVALID`, with no session. Evidence: T-N3/N4/N5,
   staging H.
5. **Client artifact-load failure:** visual canonical fallback, `launchRef`
   discarded, and a subsequent ref-less begin over active coverage returning
   `BEGIN_REQUIRES_LAUNCH` with zero durable state. Evidence: T-Q1/T-R3,
   staging §7.3.6. Under the curated Hosting artifact, a missing artifact is a
   404 and the probe fails closed.
6. **Operational disable truthfulness:** disable -> covered active students
   record truthful `canonicalFallback`, with the accommodation unchanged;
   re-enable -> normal delivery resumes with no migration. Evidence:
   T-R4/R6, staging L.
7. **Internal begin failure:** a transient failure returns retriable
   `BEGIN_VALIDATION_UNAVAILABLE`, with no session. Evidence: T-N7.
8. **Superseded occurrence:** an old Classroom, direct, or deep link to an
   occurrence superseded by a valid Current is informational at resolution
   (no grant) and refused at begin before any grant is read. Evidence: begin
   and deep-link supersession suites.

---

## 15. Evidence Capture Requirements

- **Prefer structural and aggregate evidence:**
  - suite pass counts;
  - boolean facts;
  - outcome enum values;
  - field presence;
  - refusal codes;
  - HTTP status codes;
  - `grep -c` marker counts;
  - collection present or absent;
  - the TTL policy state.
- **Never capture, print, log, or persist:**
  - raw student emails;
  - raw provider IDs;
  - raw `uid` values tied to real students;
  - document ids in `studentAccommodations` or `launchGrants`;
  - OAuth tokens;
  - service-account or ADC credentials;
  - secret values;
  - a live grant id.
- Redact identifiers in any saved log. Staging synthetic actors are referenced
  by their synthetic labels.
- Public Firebase Web SDK config values are non-secret, but do not reproduce
  them; reference `assets/lyfelabz-firebase-config.js`.
- Store G19 evidence and the §7 staging evidence as certification notes
  (structural facts only). Do not commit them as part of any runbook change.

---

## 16. Explicit STOP Conditions

Stop immediately, do not proceed, and report if any of the following occur:

1. **Wrong project.** Any operation resolves to a project id other than the
   intended literal, or any command lacks an explicit project and would fall
   through to the `lyfelabz-prod` default alias.
2. **Tree not certifiable.** The §5.2 exact-tree rule fails and no disposable
   worktree is used, or HEAD is not the certified commit.
3. **Staging/production boundary ambiguity.** Any doubt about which
   environment a command targets, or any attempt to point a staging-locked
   tool at production.
4. **Deployment delta.** P1, P2, P4, or P5 does not match the certified
   commit. This includes unexpected Rules or a Hosting layout with a catch-all
   or a served manifest.
5. **Fail-open behavior observed.** Any of the following produces a
   `differentiated` claim, a silent canonical or `canonicalFallback` where a
   refusal is required, or a session/attempt that should not exist:
   - a missing or invalid flag;
   - missing config;
   - an invalid, expired, cross-user, or superseded-occurrence grant;
   - an internal failure.

   Any P3 read that is not denied also counts.
6. **Unexpected production state.** P6 shows `enabled: true`, P7 shows
   presentation coverage, or P8 shows accommodations or grants.
7. **Any production write or side effect.** Examples include a real-student
   accommodation, enrollment, recipient, session, attempt, Current pointer, or
   assignment created or changed, or any Google Classroom call.
8. **Missing fresh staging evidence.** §7 has not PASSed at the certified
   commit, or the §7.4 unchanged-code condition fails or is unconfirmed (which
   voids the Phase K normal-routing carry-forward).
9. **Inability to prove rollback/fallback safely.** The §8.6 disable path
   (staging L) or the §6.8 rollback semantics (local suite P) cannot be
   demonstrated.
10. **Dark-state drift.** `G19_GATE_OPEN` is not `false`, or the flag is
    enabled in production.

On any STOP: leave production untouched, record the condition and evidence,
and escalate to Chris. A missing or non-ACTIVE TTL policy (P9) is neither a
STOP nor a G19 FAIL. It is recorded as an outstanding production-activation
prerequisite (§19).

---

## 17. G19 PASS Criteria

G19 passes only when ALL hold:

1. The repository baseline (§5) matches the certified commit under the
   exact-tree rule, and the dark-state and no-side-effect invariants (§3) are
   intact.
2. All local gates (§6) are green and recorded as counts.
3. The fresh staging regression certification (§7) PASSed at the certified
   commit, with the §7.4 unchanged-code condition confirmed.
4. Production read-only checks P1-P8 (§8) all match expectations, and P9 was
   performed with its result recorded (P9's result does not affect PASS).
5. Every Slice 2-6 contract (§9, §12, §13) and fail-closed check (§14) is
   established by the named evidence.
6. No STOP condition (§16) occurred. No real student PII was captured. No
   production write or Classroom side effect occurred. Slice 7 is still dark.
   The flag is not enabled.

Record path (a), the certified SHA, the staging certification reference, and
the evidence set. G19 PASS is a verification result only.

---

## 18. G19 FAIL Criteria

G19 fails if ANY hold:

1. Any local gate (§6) fails, or a test was weakened or skipped to pass
   (beyond the default-skipped Hosting-emulator case in §6).
2. Fresh staging certification (§7) failed or is absent.
3. Any production read-only check P1-P8 mismatches, or P9 was not performed
   and recorded.
4. Any fail-open behavior (§16.5) is observed.
5. A required fail-closed check in §14 cannot be demonstrated.
6. Rollback/fallback safety (§16.9) cannot be proven.
7. Any STOP condition occurred and was not fully resolved with production
   untouched.

On FAIL: capture full failing evidence, leave production and the dark state
unchanged, and return to diagnosis before re-attempting G19.

---

## 19. What Happens AFTER G19 Passes

G19 PASS is a **verification result, not a release authorization.** Passing
G19 does **NOT** by itself authorize, and must not trigger as a side effect:

- flipping `G19_GATE_OPEN` to `true`;
- enabling differentiated delivery in production
  (`platformConfig/differentiatedDelivery` -> `{enabled:true}`);
- publishing any presentation variant to production;
- deploying or exposing the Slice 7 teacher activation surface;
- any other deployment;
- committing;
- pushing.

Each of those is a separate, human-controlled release action performed by
Chris, in the order and with the safety sequencing F5.2 §14/§15 define:

- activation is exposed only after Slices 2-6 are production-verified;
- the §8.6 operational disable remains available as the rollback/emergency
  control (G20 sequence).

**Production-activation prerequisite: launch-grant TTL policy.** Before any
production activation step, a Firestore TTL policy on collection group
`launchGrants`, field `expiresAt`, must be confirmed in state `ACTIVE` in
`lyfelabz-prod`. Activation steps include:
- flipping `G19_GATE_OPEN`;
- enabling differentiated delivery;
- creating any production accommodation;
- publishing any production presentation variant.

The reasons:
- Grants are minted only for active accommodations, so the policy must be in
  place before the first grant can exist.
- This realizes F5.2's "TTL-deleted, never long-term state" property (§3.6,
  §7.2, §11).
- It closes the F5.2 §16 "HUMAN OPERATIONAL CHECK (Slice 4)", which has no
  recorded resolution in the repository.

If P9 already showed ACTIVE, re-confirm it at activation time. Creating or
changing the policy is a separately authorized Firestore configuration change
on `lyfelabz-prod`. The policy provides storage cleanup only. Application-level
expiry (`LAUNCH_REF_EXPIRED` at `expiresAt`) remains the security control and is
required regardless.

Before any variant is published or delivery enabled in production, the
production delivery proof that path (a) does not provide (§1, §10) is itself a
decision for Chris. Slice 8 (teacher preview) remains optional and outside the
G19 critical path.

---

## 20. Concise Operator Checklist

Read-only unless a line is marked **[STAGING MUTATION - AUTH REQUIRED]**. No
line in this checklist mutates production.

1. [ ] Name the certified SHA (`639b619` at this revision). If HEAD or
       production has moved past it, reconcile the delta first (§2.1).
2. [ ] `git branch --show-current` = `main`; HEAD = certified SHA =
       `origin/main`.
3. [ ] Exact-tree rule (§5.2): only `docs/.DS_Store` dirty, or use a disposable
       detached worktree. Never clean the primary checkout.
4. [ ] `grep -n 'G19_GATE_OPEN' app/src/index.ts` = `false`; three getters
       null-gated.
5. [ ] Firebase config host-aware; runtime shim has no hard-coded prod
       fallback.
6. [ ] `app/lessons/variants/manifest.json` = `[]`; no variant HTML under
       `app/lessons/variants/`.
7. [ ] Record the §5.6 baseline (Functions export set + `nodejs22`, Rules,
       curated Hosting).
8. [ ] `npm --prefix app run verify` green (counts; `variants:verify` 0
       retained).
9. [ ] `node --test scripts/app-hosting/build.test.cjs` green (emulator case
       skipped).
10. [ ] `npm --prefix platform/functions test`, `typecheck`, `lint`, `build`
        green.
11. [ ] Rules: `npx firebase emulators:exec --project demo-lyfelabz-rules
        --only firestore "npx jest"` in `platform/firebase` green.
12. [ ] **[STAGING MUTATION - AUTH REQUIRED]** Fresh staging regression
        certification at the certified SHA (§7.2-§7.3).
13. [ ] Confirm the §7.4 Phase K carry-forward condition (routing paths
        unchanged since `1ddc813`; required only if the certified SHA is not
        `639b619`).
14. [ ] Staging certification note: PASS (§7.5).
15. [ ] P1 `firebase functions:list --project lyfelabz-prod` matches the
        baseline.
16. [ ] P2 deployed Rules match (console, view only).
17. [ ] P3 unauthenticated reads of the four families -> 403.
18. [ ] P4 manifest URL and unknown variant path -> 404 on
        `https://app.lyfelabz.com`.
19. [ ] P5 `/app/dist/bundle.js` carries both Slice 5 markers.
20. [ ] P6 `platformConfig/differentiatedDelivery` missing or not `true`.
21. [ ] P7/P8 no `presentationVariants`, `studentAccommodations`, or
        `launchGrants` collections listed (do not open documents).
22. [ ] P9 `gcloud firestore fields ttls list --project=lyfelabz-prod`: record
        the `launchGrants.expiresAt` policy state (record only; not a G19 FAIL;
        ACTIVE is required before activation, §19).
23. [ ] Confirm every §14 fail-closed check against its named evidence.
24. [ ] Confirm no PII captured, no production write, no Classroom side
        effect, Slice 7 dark, flag disabled.
25. [ ] Record PASS/FAIL (§17/§18) with path (a), certified SHA, staging
        reference, and evidence.
26. [ ] STOP. Do not flip the gate, enable delivery, publish a variant,
        deploy, expose Slice 7, commit, or push (§19).

---

## 21. Recorded Dark Production Baseline (2026-09-26, `639b619`)

**Status: observation checkpoint, NOT a G19 PASS.**
- Staging re-certification (§7) and formal G19 are deferred by owner decision
  (2026-09-26). The owner is using the four current testers as a dark
  production pilot in the meantime.
- These observations resemble the §8 checks but do not satisfy §17. There
  was no §6 run on a certifiable tree, no §7 staging PASS, and no §7.4
  confirmation.
- A future G19 run must repeat its checks, not cite this section as PASS
  evidence.

**Method.** Read-only only, every production call with an explicit
`lyfelabz-prod` project:
- public HTTPS GETs against `https://app.lyfelabz.com`;
- `firebase functions:list`;
- `gcloud functions list` (update times);
- a Firebase Rules API ruleset read;
- `firebase firestore:indexes`;
- `gcloud firestore fields ttls list`;
- one Firestore read of `platformConfig/differentiatedDelivery`;
- a root `listCollectionIds` (collection names only, no documents opened).

Nothing was deployed or written.

**Repository.** Branch `main`. HEAD, `origin/main`, and remote
`refs/heads/main` all equal `639b619`; there was no committed-but-unpushed
work.

**Hosting (observed).**
- `/app/dist/bundle.js` was last modified 2026-09-26 19:25 GMT, after the
  `639b619` commit (18:48 GMT).
- These files were byte-identical to HEAD:
  - `app/index.html`;
  - `app/lessons/lesson_conducting-experiments.html` (the HEAD version, not
    the local uncommitted revision);
  - `app/lessons/lesson_earths-layers.html`;
  - `assets/lyfelabz-assessment-runtime.js`;
  - `assets/lyfelabz-firebase-config.js`.
- The bundle carries:
  - the HEAD curriculum description (not the local uncommitted one);
  - Show Your Thinking V2 (`writtenResponse`);
  - both Slice 5 markers (P5);
  - `const G19_GATE_OPEN = false;`, with the three accommodation getters
    returning `null`.
- These paths all returned 404 (P4; no catch-all):
  - `/app/lessons/variants/manifest.json`;
  - a grammar-valid nonexistent variant path;
  - an unknown `/app/*` path.

**Functions (observed).**
- The deployed set exactly equals the `platform/functions/src/index.ts`
  export set: 70 of 70, all `nodejs22` (P1).
- Most functions were last updated 2026-09-24 21:39-21:52Z, which matches
  `a3b9215`. Seven were redeployed later:
  - `lmsCourseworkInspect` (2026-09-25 14:04Z);
  - `lmsGradePassbacksRetry`, `lmsGradePassbacksApply`, and
    `lmsGradePassbacksPreview` (2026-09-25 16:36Z);
  - `assessmentAttemptsFinalize`, `assessmentSessionsAutosave`, and
    `assessmentAttemptGetForTeacher` (2026-09-26 19:24Z).
- Every function whose own handler changed after `a3b9215` was redeployed
  after its last change.
- The remaining shared-module changes since `a3b9215` are additive only:
  new exports in `assignment-recipients.ts`, new methods in the Google
  Classroom adapter/transport/provider and `coursework-family.ts`, and
  type-only additions. Their only callers are among the redeployed
  functions. The functions still on the 2026-09-24 deployment are therefore
  functionally equivalent to HEAD.

**Rules and indexes (observed).**
- The deployed Firestore ruleset (released 2026-09-18) is byte-identical to
  HEAD `platform/firebase/firestore.rules` (P2).
- The deployed Storage ruleset is deny-all like HEAD; only its comments
  differ.
- There are zero composite indexes in production and in the repo. The
  `recipients.studentId` collection-group override is present.

**Differentiation dark state (observed).**
- `G19_GATE_OPEN = false` in the deployed bundle, so the Slice 7 UI is not
  exposed.
- `platformConfig/differentiatedDelivery` does not exist (NOT_FOUND), so
  differentiated delivery is disabled (P6).
- `studentAccommodations`, `presentationVariants`, and `launchGrants` are
  absent from the root collection list (P7, P8).
- Unauthenticated REST reads of those three plus `platformConfig` return 403
  (P3).
- No production reading-adapted variant exists:
  - `app/lessons/variants/manifest.json` is `[]`;
  - no lesson config under `app/scripts/lessonBuilder/lessons/` declares a
    variant.

  Activating an accommodation today would therefore produce only
  `canonicalFallback`. A real pilot first needs a variant built, committed,
  and published (§19).
- "Dark" is enforced at the UI, not the server. `accommodationsGet`,
  `accommodationsListStudents`, and `accommodationsSet` are deployed and
  server-authorized. A direct `accommodationsSet` call is therefore an
  activation action and remains unauthorized (§19).

**TTL policies (observed, P9).**
- There is **no** TTL policy on `launchGrants.expiresAt`. This is the §19
  production-activation prerequisite and is still outstanding.
- There **is** an ACTIVE TTL field override on `lmsOAuthStates.expiresAt`.
  It was configured out-of-band and is **not declared** in
  `platform/firebase/firestore.indexes.json`. A future
  `firestore:indexes` deploy from the repository could offer to remove
  undeclared overrides. Do not deploy indexes until the repository declares
  this override, or the operator has explicitly confirmed it will be
  preserved.

**Operational conclusions.**
- Production is already at the intended dark baseline for `639b619`, so no
  redeployment is currently required.
- Any future production deployment must run from a clean checkout of the
  intended commit (for example the §5.2 disposable worktree), never from a
  working tree with uncommitted changes. The Hosting predeploy builds the
  bundle from working-tree `app/src` and copies working-tree `app/lessons/`.
  On 2026-09-26 the primary checkout carried uncommitted Conducting
  Experiments lesson and curriculum-manifest changes that would otherwise
  have shipped.
- Scope any such deploy with `--only`. Exclude `firestore:indexes` (see
  above) and `storage` (not required).

**Limitation.** Production Hosting and Functions metadata do not record a
commit SHA. The correspondence to `639b619` rests on byte-identical files,
content markers, the exact function set, and deploy timestamps.

---

## Do Not

- Do not deploy to or mutate `lyfelabz-prod`. G19 path (a) is entirely
  read-only in production.
- Do not run path (b) or any production launch, begin, finalize, or
  publication (§10).
- Do not invoke `publish-variant.ts --target=production`.
- Do not modify the staging-locked driver or seed, and do not repurpose
  `astra004-hosting-prepare.ts`.
- Do not rely on a Firebase alias as the safety boundary. Pass the literal
  project id on every command.
- Do not open, read, or use real student accommodation, enrollment, recipient,
  session, or attempt data.
- Do not create or move a Current pointer, or publish an assignment, in any
  environment for this gate.
- Do not trigger any Google Classroom call.
- Do not enable differentiated delivery in production to observe it.
- Do not clean, reset, stash, or restore unrelated working-tree changes to
  satisfy §5.2.
- Do not flip `G19_GATE_OPEN`, expose Slice 7, commit, or push in this or the
  certification session.
- Do not enter the privacy-hardening / Hosting / GitHub Pages / DNS /
  marketing lane.
