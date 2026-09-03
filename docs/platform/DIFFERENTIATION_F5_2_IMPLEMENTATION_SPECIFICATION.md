# LyfeLabz Persistent Student Differentiation

## F5.2 Implementation Specification

**Status:** Final implementation contract. Supersedes F5.1 by applying the P5.1 targeted-certification patches: **P1** (covered no-ref begin must not silently downgrade), **P2** (server-owned operational differentiated-delivery disable for rollback), and **P3** (precise meaning of "delivered"), plus the pre-feature-attempt interpretation correction and reconciled test/rollback language. F5.1 already incorporated the six P5 patches (C1-C6), the silent-fallback reclassification, and clarifications M2-M5, M7, M10 (plus M6/M8/M9 notes); those remain intact. Evidence priority: P5.1 -> P5 -> P4 -> P1 -> this document. No production code, Rules syntax, or lesson content. D1/D2/D3 remain closed; session creation remains the sole durable freeze point - only the *source* of the frozen value changes. Specification readiness only: no runtime tests have run and no implementation exists yet.

---

### 1. Implementation Disposition

**SAFE TO HAND TO CLAUDE CODE.**

P5.1 disposition was CERTIFIED AFTER MINOR CONTRACT PATCHES; those patches (P1/P2/P3) are now applied here. No F1 root decision is reopened; D1/D2/D3 remain closed; no new architecture is introduced. All P5 HIGH findings (B1-B5) and M1 remain resolved. The one remaining HIGH runtime-contract defect (covered no-ref begin, P1) and the HIGH rollback consequence it creates (P2) are closed by this revision. This is specification readiness, not implementation completion: no production code has been written and no runtime test has executed.

### 2. Certified V1 Boundary

**Ships:** a student-scoped accommodation record keyed by canonical `uid`, one service (reading accessibility), compare-and-set writes, append-only history, attribution; an N-variant build pipeline producing immutable content-addressed artifacts at revision-specific **opaque** paths; a manifest-enforced retention contract; a **cross-system publication state machine** repointing the runtime index only after confirmed artifact liveness; server-authoritative resolution on the launch surfaces; **server-issued, TTL-bounded launch grants** binding session freeze to the presentation actually delivered; frozen `variantKey`/`presentationRevisionId` plus **`deliveryOutcome`** on classroom sessions and attempts; **client canonical fallback on variant navigation failure**; a **platform enable/coverage gate** ahead of teacher activation exposure; a **server-owned operational differentiated-delivery disable** (`differentiatedDeliveryEnabled`) for rollback and emergency safety; teacher student-services functional operations.

**Does not ship:** any second accommodation dimension; IEP/504 documents, diagnoses, disability labels, case management, approval chains; cross-school/district authorization (policy preserved, not implemented — P4-2); canonical lesson versioning; reporting changes; grade passback or any Classroom change; differentiated assessment content; lesson instructional text; delivery/compliance dashboards or per-lesson coverage UI; client version-negotiation infrastructure.

---

### 3. Data Contracts

#### 3.1 Accommodation record — `studentAccommodations/{studentId}` (NEW record family)

One document per canonical student `uid`; document ID **is** the `uid`. Absence = no accommodation = canonical experience. Direct client read/write: denied entirely.

| Field | Meaning | Authority | Req | Mutability |
|---|---|---|---|---|
| `studentId` | Canonical `users/{uid}` key; equals doc ID | Server-derived | R | Immutable |
| `schoolId` | School of the last accepted write's enrollment context; audit metadata only, **never** the live authorization source (§4 recomputes) | Server-derived at write | R | Per accepted write |
| `readingAccessibility.status` | `"active"` \| `"inactive"`; `"inactive"` ≡ canonical | Teacher-asserted via callable, server-validated | R | CAS only |
| `readingAccessibility.level` | Machine level token (§3.2); required iff status `"active"` | Teacher-asserted, validated against closed vocabulary | C | CAS only |
| `configRevision` | Positive integer, starts 1, +1 per accepted state-changing write; the CAS token | Server-assigned | R | Monotonic |
| `createdAt` / `createdBy` | First activation time / teacher `uid` | Server | R | Immutable |
| `updatedAt` / `updatedBy` | Last accepted write time / teacher `uid` | Server | R | Per accepted write |

**Excluded fields:** IEP/plan text, diagnoses, disability categories, service minutes, goals, notes, free-text. Platform configuration only.

**History (S1):** append-only subcollection `.../history/{r{configRevision}}` — `revision`, `readingAccessibility` snapshot, `setBy`/`setAt`, `classId`, optional `idempotencyKey`; server-written, immutable, never deleted; committed atomically with the parent. Deactivation is a normal accepted write, never a delete.

#### 3.2 Reading accessibility vocabulary (S2)

Machine level token: `"adapted"` — the only V1 member of the closed `ReadingLevel` enum; describes the presentation, not the student. Canonical state is never a level value. `variantKey = "reading-" + level` → V1: exactly `"reading-adapted"` (deterministic, closed set). New levels extend the enum; new dimensions add typed top-level fields; unknown values are rejected. `variantKey` never appears in student-visible artifact paths (§5.2, M4).

#### 3.3 Session additive fields (S9) — `assessmentSessions/{sessionId}`

| Field | Meaning | Authority | Req | Mutability |
|---|---|---|---|---|
| `variantKey` | Logical presentation identity frozen for this session | Server-derived at begin **from the validated launch grant** (§8); never client-supplied | Iff `deliveryOutcome:"differentiated"` | Frozen at creation; structurally outside the two-field autosave write type (V4) |
| `presentationRevisionId` | Exact immutable build frozen for this session | Same | Same | Same |
| `deliveryOutcome` | `"canonical"` \| `"differentiated"` \| `"canonicalFallback"` (§8.1) | Server-derived at begin | R on every session created at/after Slice 6 | Frozen at creation |

Invariant: `deliveryOutcome:"differentiated"` ⟺ both presentation fields present; `"canonical"` and `"canonicalFallback"` ⟺ both absent. Exactly one presentation field present is invalid by construction. Pre-Slice-6 sessions lack all three fields and are interpreted as canonical.

#### 3.4 Attempt additive fields (S10) — `attempts/{attemptId}`

| Field | Meaning | Authority | Req | Mutability |
|---|---|---|---|---|
| `variantKey` / `presentationRevisionId` | Copied verbatim from session inside the finalize transaction (explicit field-list extension, V5) | Server | Per §3.3 invariant | Immutable |
| `deliveryOutcome` | Copied verbatim from session at finalize | Server | R when present on session | Immutable |

`deliveryOutcome` is delivery-status metadata, not plan/diagnosis data (§11). **`configRevision` is NOT stored on the attempt.** Historical interpretation (F1): `"canonical"` = no support expected, canonical delivered; `"differentiated"` = the platform validated a grant-bound `(variantKey, presentationRevisionId)` and delivered that retained artifact to the client with no reported pre-begin delivery failure (a platform-delivery event, **not** proof the student read or processed it - see §8.1 delivery-meaning note); `"canonicalFallback"` = support expected, canonical delivered for a legitimate reason - all three distinguishable **without** the now-current accommodation record. **Pre-feature attempts** predate this durable outcome contract and carry no `deliveryOutcome`; absence therefore means only "created before the durable-outcome contract existed." It requires no backfill, remains valid forever, and **must not** be read as evidence that no accommodation should have existed for that student. No fourth stored enum is introduced. Aggregate score reporting ignores all three fields (T-L1).

#### 3.5 Variant index — `presentationVariants/{lessonSlug}__{variantKey}` — see §5.3.

#### 3.6 Launch grant — `launchGrants/{grantId}` (NEW record family; C1)

Server-issued, non-forgeable, TTL-bounded evidence of which presentation a specific resolution delivered. Zero direct client access (deny-all).

| Field | Meaning | Authority | Req |
|---|---|---|---|
| `grantId` (doc ID) | ≥128-bit CSPRNG value, 32 lowercase hex chars; server-generated; never derived from content or predictable inputs | Server | R |
| `studentId` | `actor.uid` at issuance; grant is unusable by any other user | Server | R |
| `assignmentId` | Assignment at issuance; grant is assignment-specific, unusable elsewhere | Server | R |
| `lessonSlug` | Canonical lesson; integrity cross-check against the assignment | Server | R |
| `outcomeAtIssuance` | `"differentiated"` \| `"canonicalFallback"` | Server | R |
| `variantKey` / `presentationRevisionId` | The delivered pair | Server | Present iff `outcomeAtIssuance:"differentiated"` |
| `issuedAt` / `expiresAt` | `expiresAt = issuedAt + LAUNCH_GRANT_TTL` (constant, 6 hours — sized to cover one study window) | Server | R |

**Representation:** a server-stored record behind an opaque unguessable ID — chosen over a signed token because it needs no key management or verification crypto, revalidation is one transactional read matching the deny-all record-family precedent, expiry/cleanup is native (Firestore TTL on `expiresAt`), and a stored record cannot be forged offline or outlive deletion. **Replayable within its TTL** (not one-time): begin retries and idempotent concurrent begins require it; replay is harmless because the grant confers no authority (§7.2). **Canonical-expected launches mint no grant** — absence of `launchRef` represents them, with zero cost or delta for the canonical population. Grants are TTL-deleted, never long-term state.

#### 3.7 Audit

Every accepted **state-changing** write emits an audit event (existing append-only `auditEvents` pattern): actor `uid`, `studentId`, `classId`, old→new revision, timestamp. **An equal-value write is a true no-op: no revision increment, no history entry, and no audit event (C6).** Audit access remains server/admin-only.

---

### 4. Server Operation Contracts

**V1 teacher-authorization invariant (P4-5, verified per call):** actor is an authenticated, verified, `active` teacher `T`; request names `studentId S`, `classId C`; server verifies in one consistent read set that `classes/{C}` is active with `teacherId == T.uid` and `schoolId == T.schoolId`, and `enrollments/{C}__{S}` is active. Same-school is the enforced boundary; `classId` is claimed context granting nothing.

#### Op A — Teacher read

Unchanged from F5: composed invariant; reads record only; no writes, no audit; response `{ configRevision, readingAccessibility, updatedBy, updatedAt }` or `{ configRevision: 0 }`; refusals never reveal record existence; history not returned in V1.

#### Op B — Teacher activate / update / deactivate

Unchanged from F5 except C6: request-authoritative `studentId`, `classId`, `expectedRevision`, `newValue`, optional `idempotencyKey`; single transaction (re-verify invariant → CAS §4.2 → parent write → `history/r{N}` → audit enqueue); `.create()` precondition on first activation; deactivation is a normal write. **Exposure of any teacher-facing activation surface for Op B is gated by §10.2** — the callable exists from Slice 1 but ships dark.

#### Op C — Student presentation resolution (internal step; launch surfaces only)

| Aspect | Contract |
|---|---|
| Where | Inside `lmsDeepLinkResolve` and `assignmentsListForStudent` only, strictly after each surface's full existing authorization chain. **`assessmentSessionsBegin` no longer runs Op C** — begin consumes the launch grant instead (§8), which is the C1 correction. |
| Role | The already-authorized student; always for `actor.uid`, never a requested student. |
| Request-authoritative | Nothing new. Forbidden-keys coverage per §4.3. |
| Resolution | Read `studentAccommodations/{actor.uid}`. Absent/`inactive` → **EXPECTED_CANONICAL**: no grant, no `presentation`, stop. If `differentiatedDeliveryEnabled = false` (§8.6) → mint a `canonicalFallback` grant, emit operational-disable telemetry, respond with `launchRef` only (never a `differentiated` grant while disabled). Else derive `variantKey`; read `presentationVariants/{lessonSlug}__{variantKey}`. Absent or `retired` → mint a `canonicalFallback` grant, emit coverage telemetry, respond with `launchRef` only. Malformed index → same, plus defect-severity anomaly. Active index → mint a `differentiated` grant binding the index's current pair; respond with `presentation { variantKey, presentationRevisionId, path }` and `launchRef`. |
| Internal failure | Resolution-step failure here → canonical response, telemetry, **no grant**. Not historically misleading: a subsequent begin with an active record and no grant runs the §8.2 no-ref coverage check - if differentiated coverage is currently available it refuses with retriable `BEGIN_REQUIRES_LAUNCH` (client re-resolves), and only a legitimately uncovered/retired/disabled state records `canonicalFallback`. Begin itself never degrades silently (§8.3). |

#### 4.2 Compare-and-set contract (S4)

Items 1–8 unchanged from F5 (read `configRevision`; supply verbatim as `expectedRevision`; transactional compare; stale → stable conflict code carrying current state; success → increment; first activation via `.create()` with `expectedRevision 0`; history atomic with parent; idempotency-key retry match via `history/r{N+1}.idempotencyKey`). Item 9 per C6: an **equal-value write** (revision matches, `newValue` deep-equals current) returns success with the current value/revision **writing nothing — no revision increment, no history entry, no audit event**; the client may treat it as success because requested and existing state already agree. (M8: a keyless network retry of a landed write surfaces as a stale-conflict carrying current state — safe; accepted.)

#### 4.3 Forbidden request-shape coverage (M10)

`FORBIDDEN_REQUEST_KEYS` extension: `variantKey`, `presentationRevisionId`, `readingLevel`, `accommodation`, `presentation`. Enumerated student-facing boundaries:

| Surface | Selector posture |
|---|---|
| `lmsDeepLinkResolve` | Refuses all forbidden keys; accepts no `launchRef` (response-only there). |
| `assignmentsListForStudent` | Same. |
| `assessmentSessionsBegin` | Refuses all forbidden keys. Accepts exactly one new optional field: `launchRef` (opaque string, §8). `launchRef` cannot name content — content binding is server-written at issuance; the client supplies only the ID. |
| Autosave | Fixed two-field write type (V4); structurally cannot carry any selector or `launchRef`; no new check needed beyond the existing shape validation, asserted by T-G1. |
| Finalize | Accepts no presentation, outcome, or `launchRef` fields; forbidden keys extended to include `deliveryOutcome` and `launchRef` here and on autosave/list/resolver shapes. |
| Practice entry | Launches via resolver/list; no additional request shape exists; covered above. |

No student-facing shape outside this table accepts arbitrary fields; each is covered by an explicit refusal or a fixed write type.

---

### 5. Presentation Build and Identity Contract (S5, S6)

#### 5.1 Identity semantics — normative

- `lessonSlug`: canonical lesson identity; frozen on the assignment as today; never encodes accommodation. **Charset (M3):** any `lessonSlug` participating in variant publication must match `^[a-z0-9-]+$` (no underscore), validated by the publish step and verifier, making the `__` delimiter in index doc IDs and manifest keys unambiguous. A slug outside this charset refuses variant publication (canonical behavior unaffected).
- `variantKey`: logical accommodation-presentation identity (`"reading-adapted"` in V1); stable across regenerations; never encodes a build; **never appears in student-visible paths** (M4).
- `presentationRevisionId`: identity of one exact immutable delivered build of `(lessonSlug, variantKey)`; changes iff delivered bytes change.
- `assessmentRevisionId`: untouched by this feature. The four identifiers never collapse.

#### 5.2 Build artifact contract

| Aspect | Contract |
|---|---|
| Build inputs / pipeline scope | Unchanged from F5: variant authored source + shared transformer config; `config.cjs`/`index.cjs`/`paths.cjs` restructured to a target-set model (P4-3); canonical-only builds of unchanged lessons emit byte-identical `v1`/`v2` outputs (T-D5). |
| Determinism | Byte-deterministic; no timestamps, build IDs, or volatile metadata in artifacts; verified by double-build (T-D1). |
| `presentationRevisionId` derivation (M2) | `"pr" + full 64-hex-char SHA-256(final artifact bytes)`. **Full digest from the beginning (M2)**: identifier length has no product cost (internal ID, opaque path segment), and the full digest permanently eliminates prefix-collision remediation. No historical IDs exist before first publication, so nothing is rewritten; identical bytes still dedupe to the identical ID; a full-digest collision over different bytes is refused at publication as an integrity failure (T-D4). No length-extension scheme exists. |
| Output addressing (M4) | `/app/lessons/variants/lesson_{lessonSlug}__{presentationRevisionId}.html`. The path carries **no `variantKey` or accommodation category**: the revision ID is an opaque content hash, so URL/history/referrer disclose only that some alternate presentation exists — never the accommodation category, student identity, IEP status, diagnosis, or any sensitive detail. `variantKey` travels only in server responses and server-side records. No future path scheme may encode accommodation semantics finer than this; no student identifier ever appears in a path. |
| Immutable publication rule | Once a revision path is manifest-listed, writing different bytes to it is a build error; rewriting identical bytes is a no-op. |
| Regeneration rule | New bytes → new ID → new path; index pointer moves per §6.8; prior file and manifest entry untouched. Note (M6): a shared-shell/wrapper change re-mints every variant's revision — correct for reproducibility, accepted retention-growth cost. |
| Build retention posture (M7) | Build tooling treats every manifest-listed path as an **immutable retained input**: normal build/generation never clears, regenerates, or destructively writes the historical variants directory — it only adds new revision files, even in manual/emergency flows bypassing CI. The verifier remains the final gate, not the only defense (T-P5). |
| Missing-variant behavior | Classified in §8.5 (rows 3–6): resolution-time absence is CANONICAL_FALLBACK_WITH_TELEMETRY; an index-live-but-file-absent state is structurally exceptional under §6.8 and additionally covered by client fallback (§7.3). The word "silent" is retired: fallback for an active accommodation is never signal-free. |

#### 5.3 Variant index (S6) — `presentationVariants/{lessonSlug}__{variantKey}`

Index docs exist only for pairs with a published variant (no lesson catalog is created). Fields as in F5: `lessonSlug`, `variantKey` (immutable), `currentPresentationRevisionId`, `currentPath` (§5.2 formula), `contentSha256` (full hash), `status` `"active"`\|`"retired"`, `updatedAt`/`publishedBy`. Written only by the publish step under §6.8 — **the pointer may only ever reference an immutable artifact already confirmed retrievable (the §6.8 invariant)**. Zero direct client access; absence = fallback per §8.5. Old revisions are historical simply by not being pointed to; attempts self-carry their frozen IDs.

---

### 6. Historical Artifact Retention and Publication Contract (S7)

Retention is a property of the repository plus a deterministic verifier, never of hosting behavior or manual discipline.

1. **Revision-specific committed paths.** Every published build is committed at its §5.2 path; hosting serves the committed tree, so committed files survive every deploy.
2. **Retention ledger.** Append-only `app/lessons/variants/manifest.json`: `{ lessonSlug, variantKey, presentationRevisionId, path, sha256, publishedAt }` per revision; the publish step appends, nothing edits or removes. Manifest + verifier own retention. (M9: `lessonSlug` is derivable from an attempt's `activityId`, so manifest lookup survives any path-formula change.)
3. **Verifier.** Fails if: any manifest path absent from the tree; any manifest file's bytes hash differently; a build writes a manifest-listed path with different bytes; any manifest entry removed/altered; a new ID collides with an existing entry's ID over different bytes; a variant-published `lessonSlug` violates the §5.1 charset.
4. **Enforcement.** Verifier runs in CI on every commit and as a mandatory publish-tooling step (§6.8 step 5); deployment refuses on failure. Build tooling additionally enforces M7 (§5.2) so history cannot be wiped even before the verifier runs.
5. **Prohibitions.** Path reuse forbidden; deleting any manifest-listed build forbidden; rollback never deletes an artifact.
6. **Proof across deploys.** T-E2 as in F5 (publish A, regenerate to B, clean build + verifier: A persists byte-identical while the index points to B).
7. **Failure remediation.** Verifier failure blocks release; remediation is restoring files from git history, never manifest editing.

#### 6.8 Publication state machine (C2) — normative, cross-system

For publishing revision B of `(lessonSlug, variantKey)`, the publish tooling executes exactly this ordered machine; each step is a gate for the next:

1. Build immutable revision B locally (deterministic).
2. Derive `presentationRevisionId` (full digest) and verify it against B's bytes.
3. Add B's revision-specific artifact file at its §5.2 path (add-only; M7).
4. Append B's manifest entry (append-only).
5. Run the retention/build verifier (§6.3); refuse on failure.
6. Commit/preserve the tree per normal project process.
7. Deploy Hosting so B becomes application-retrievable.
8. **Liveness confirmation:** fetch B at its exact immutable hosted path and verify the response bytes hash to B's manifest `sha256`.
9. **Only then** update `presentationVariants/{lessonSlug}__{variantKey}` (`currentPresentationRevisionId`, `currentPath`, `contentSha256`, `status:"active"`). The index update is always last.

**Invariant:** `presentationVariants.currentPath` may only reference an immutable artifact already confirmed retrievable. Enforced by tooling and tests, not prose: the index write lives only inside the publish tool, is mechanically preceded by the step-8 liveness check in the same tool run, and T-E5–T-E8 prove the ordering; no other pathway writes the index.

**Failure semantics:**

| Failure point | Result |
|---|---|
| Any failure before step 7 | Index unchanged; publication aborted; artifact/manifest additions remain inert (add-only, harmless). |
| Hosting deployment fails (7) | Current index unchanged; retry deploy. |
| Deploy succeeds, liveness check fails (8) | Current index unchanged; treat as deployment defect; do not repoint. |
| Liveness passes, Firestore index update fails (9) | Old index remains safe and current (stale, not broken); retry the index update alone. |
| First-ever publication fails before 9 | No index doc exists; resolution sees no current variant → §8.5 row 3. |
| Rollback | Repoint the index to a previously retained revision **after re-confirming its liveness** (step 8 against it). Rollback never deletes an artifact. |

A deployment/verification failure **blocks publication**; it is never converted into a runtime fallback state (§8.5 rows 7, 11).

---

### 7. Student Resolution, Launch Binding, and Client Boundary (S8; C1, C3)

#### 7.1 Response extension (additive, optional)

Authorized resolutions (resolver; list, per item) may include `presentation: { variantKey, presentationRevisionId, path }` — present iff a `differentiated` grant was minted — and `launchRef: <grantId>` — present iff any grant was minted (`differentiated` or `canonicalFallback`). Both entirely absent for canonical-expected students, whose responses stay shape-identical to pre-feature behavior.

#### 7.2 Launch-grant security model (normative)

The grant is **presentation-binding evidence, not authorization**:

- It authorizes nothing by itself; begin performs its full existing authentication and assignment/enrollment authorization unchanged, before grant validation. Possession alone bypasses no check.
- It only proves which server-authorized presentation was delivered for that authorized student/assignment launch.
- It is unusable by another user (`studentId` must equal `actor.uid`) or for another assignment (`assignmentId` must match); mismatches refuse with a shape identical to unknown-grant refusals.
- It cannot name arbitrary content: content fields are server-written at issuance; the client transports only the opaque ID.
- It cannot outlive `expiresAt`; expired grants are refused and TTL-deleted, never sensitive long-term state.
- Replay within TTL for the same `(uid, assignment)` is permitted and harmless (idempotent begin; deterministic re-freeze); cross-assignment/cross-user reuse is impossible.

#### 7.3 Surfaces and client behavior

| Surface | Server | Client |
|---|---|---|
| Deep-link launch (`lmsDeepLinkResolve`) | Full existing authorization → Op C → attach `presentation`/`launchRef` | If `presentation.path` present, navigate to it; else existing static slug table. Retain `launchRef` for begin. |
| Student assignment list (`assignmentsListForStudent`) | One accommodation read per call + one index read per distinct differentiated `lessonSlug`; per-item `presentation`/`launchRef` | Same rule in the shared `launch.ts` builder. |
| Practice launch | Same as its entry surface | Same routing; nothing persisted (§9). |

**Navigation-failure fallback (C3, defense-in-depth; reconciled with P1):** if navigation to / load of `presentation.path` fails, the client may still fall back **visually** to the static-table canonical target for that `lessonSlug` and emits a variant-load-failure anomaly event (differentiated delivery was expected - structurally exceptional under §6.8). The client **discards the `launchRef`** and **must not** later use that grant to claim `differentiated` delivery for an artifact that did not load. Discarding the ref does **not** by itself yield a successful `canonicalFallback` begin: begin runs the §8.2 no-ref coverage check, so while server-side coverage still reports the index active, begin refuses with `BEGIN_REQUIRES_LAUNCH` and the client must return through fresh launch/re-resolution rather than assert canonical fallback itself. Only if fresh resolution determines coverage is legitimately absent/retired (or delivery is operationally disabled, §8.6) does the existing `canonicalFallback` path apply. An index that remains active while the artifact remains unloadable is an **operational delivery defect**, not a client-authorized bypass of required support. The client knows exactly two targets - the server-authorized path and the canonical fallback - and never selects another differentiated target; no second variant-resolution engine exists, and the client is never authoritative for fallback legitimacy. Discarding a ref only ever *downgrades* toward canonical; the client cannot mint or alter one to upgrade.

**Server-authoritative:** whether a presentation applies, which pair, the target path, the grant. **The client merely routes and transports the opaque `launchRef`.** Another student's response confers nothing (§7.2). Authorization-vs-secrecy posture unchanged: artifact-byte secrecy is not claimed; the guarantees are authoritative selection and configuration non-disclosure — strengthened now that paths omit accommodation category (§5.2).

#### 7.4 Stale clients

- **Pre-enablement / pre-activation:** old clients ignore the unknown optional fields and route canonically — plain backward compatibility, EXPECTED_CANONICAL.
- **Post-activation, no current differentiated coverage** (uncovered/retired) **or delivery operationally disabled (§8.6):** an old client's begin carries no ref, so with an active record the session records `"canonicalFallback"` with telemetry (§8.2).
- **Post-activation, current differentiated coverage available and delivery enabled:** an old client cannot transport `launchRef`, so its no-ref begin must **not** silently record `"canonicalFallback"`; begin returns retriable `BEGIN_REQUIRES_LAUNCH` (§8.2), and the student must use the compatible launch flow. This is intentional - a stale client cannot suppress available required support by omitting the ref.
- In all cases the platform never claims differentiated delivery it did not make, and a stale client can never cause a falsely differentiated record (differentiated requires a valid grant). This recording rule plus the §10.2/§15 rollout ordering and the §8.6 operational disable is the smallest sufficient V1 handling; **no client-version-negotiation infrastructure is introduced.**

---

### 8. Session, Attempt, Delivery Outcome, and Reassessment Contract (S9–S11; C1, C5)

#### 8.1 `deliveryOutcome` machine values

| Value | Meaning |
|---|---|
| `"canonical"` | No support expected at freeze; canonical delivered. CASE A. |
| `"differentiated"` | The platform validated a server-issued, uid/assignment/lesson-bound launch grant for the exact `(variantKey, presentationRevisionId)` and authorized/delivered that differentiated presentation to the client for this assessment flow, with no reported delivery failure before begin (see delivery-meaning note below). CASE B. |
| `"canonicalFallback"` | Support was expected but canonical was delivered for a **legitimate** reason: coverage gap (no/retired index), operational differentiated-delivery disable (§8.6), a valid canonical-fallback grant, or a load/nav failure resolved to a legitimately uncovered state. No presentation fields; no sensitive plan data. CASE C. **A covered, enabled, active-accommodation launch that reaches begin with no valid grant is refused (`BEGIN_REQUIRES_LAUNCH`, §8.2), never recorded as `canonicalFallback`.** |

**Delivery meaning (P3, normative).** `deliveryOutcome:"differentiated"` records a platform-delivery event only. It does **not** prove the human student read, viewed, or cognitively processed the material, that every byte rendered visibly, or any compliance fact beyond the validated-grant delivery the contract represents. `"canonicalFallback"` likewise records a platform-delivery outcome, not a judgment about the student's plan.

Frozen on the session at begin; copied verbatim to the attempt at finalize; practice persists nothing (§9).

#### 8.2 Session begin — validation and freeze (replaces F5 "begin performs Op C")

`assessmentSessionsBegin`, after its full existing authorization chain (unchanged):

1. **Idempotency first (unchanged):** an existing live session for `(uid, assignment)` is returned as-is; frozen fields never change; a supplied `launchRef` is ignored; presentation/outcome fields never join the request-match comparison. Concurrent begins: the create-once transaction yields one winner, the loser returns that session; replayable grants leave no consumption race — deterministic frozen values either way.
2. **With `launchRef`:** read `launchGrants/{launchRef}` in the creation transaction.
   - Malformed ID or no such doc → refuse `LAUNCH_REF_INVALID` (stable code), security telemetry, no writes.
   - `studentId ≠ actor.uid`, or `assignmentId` ≠ the request's assignment, or `lessonSlug` mismatch → same refusal, byte-identical shape (no existence disclosure). Not equivalent to an ordinary canonical student: it is a refused operation.
   - `expiresAt` passed → refuse `LAUNCH_REF_EXPIRED` (retriable): the client re-resolves (fresh Op C mints a fresh grant reflecting current delivery), re-routes, and retries. Never silently frozen canonical.
   - Valid, `outcomeAtIssuance:"differentiated"` → freeze the grant's pair + `deliveryOutcome:"differentiated"` — **even if** the accommodation was deactivated after issuance (delivered truth is recorded; deactivation governs later launches) and **even if** the index has since moved to B or retired (a grant that validly bound A is never rewritten to B). The referenced artifact is retained by §6; begin needs no liveness check because delivery already occurred.
   - Valid, `outcomeAtIssuance:"canonicalFallback"` → freeze no pair + `deliveryOutcome:"canonicalFallback"`.
3. **Without `launchRef` (P1 - covered no-ref begin must not silently downgrade):** read `studentAccommodations/{actor.uid}` in the transaction.
   - Absent / `inactive` → freeze `"canonical"`, no pair. (CASE 2 / CASE 3.)
   - `active` → the server performs a **server-side coverage check** for the assignment's frozen `lessonSlug` and the accommodation's derived `variantKey` (read `presentationVariants/{lessonSlug}__{variantKey}`). This check exists **only** to decide whether a ref-less fallback is legitimate. It **must not** select or freeze a presentation revision, replace launch-grant binding, reintroduce Op C at begin, or inspect current coverage to freeze a pair (see the A->B invariant below). Its decision:
     - `differentiatedDeliveryEnabled = false` (§8.6, operational disable) → freeze `"canonicalFallback"`, no pair, emit operational-disable telemetry. This is the sole way a covered active accommodation legitimately reaches canonical delivery with no grant.
     - Index **active** (differentiated coverage currently available) and delivery enabled → **refuse** with the stable retriable code `BEGIN_REQUIRES_LAUNCH`: **create no session and no attempt**; the client must return through fresh server-authoritative launch resolution (§4 Op C) to obtain a valid grant. A withheld, discarded, or stale-client-absent `launchRef` cannot suppress available required support.
     - Index **absent** → legitimate coverage gap → freeze `"canonicalFallback"`, no pair, emit coverage/fallback telemetry.
     - Index **retired** → legitimate coverage withdrawal → freeze `"canonicalFallback"`, no pair, emit coverage/fallback telemetry.
     - Index **malformed** → fail safely: do **not** treat an untrusted client's omission as an ordinary successful fallback; refuse with retriable `BEGIN_VALIDATION_UNAVAILABLE` (§8.3) unless the server can affirmatively establish the fallback is legitimate. No silent `"canonical"`/`"canonicalFallback"` freeze.
     - **Transient failure** while performing the coverage check → retriable `BEGIN_VALIDATION_UNAVAILABLE` (§8.3); no session; no silent canonical/canonicalFallback freeze.

**A->B invariant (P1, do not reintroduce the A->B race).** The no-ref coverage check answers only "is differentiated coverage currently available such that this client must return through launch resolution?" - never "which presentation revision should this session freeze?" Only a validated launch grant (step 2) may freeze `variantKey`, `presentationRevisionId`, and `deliveryOutcome:"differentiated"`. If a student legitimately launched revision A and the index later moves to B, a valid grant for A freezes A; the check never inspects B to replace it. A valid `canonicalFallback` grant issued when no variant existed still freezes `"canonicalFallback"` even after variant B is published. The check applies **only** when there is no `launchRef`.

#### 8.3 Internal failure at begin (fail closed)

Any transient internal failure in the step-2/3 reads (grant, accommodation record, coverage index, storage), or a malformed coverage index the server cannot resolve, → refuse with retriable `BEGIN_VALIDATION_UNAVAILABLE`; **no session is created and neither `"canonical"` nor `"canonicalFallback"` is ever silently frozen** because validation/coverage could not be established. This is distinct from `BEGIN_REQUIRES_LAUNCH` (§8.2), which is a definite "coverage is available, obtain a grant" result rather than an unavailability. Idempotency makes retries safe; a misleading durable record is never the failure mode of an outage. (No UI copy specified.)

#### 8.4 Autosave, finalize, reassessment

**Autosave:** unchanged; the two-field write type structurally cannot touch presentation/outcome fields (T-G1/G2). **Finalize:** the explicit session→attempt field copy extends to `variantKey`, `presentationRevisionId`, and `deliveryOutcome` when present (absent ⇒ absent); the attempt is the only durable carrier (sessions delete at finalize); idempotent retry returns the existing attempt unchanged. **Reassessment:** Improve My Score triggers a fresh launch (fresh Op C, fresh grant) and a new begin freezing the then-delivered state under §8.2; attempts under one assignment share `assignmentId`/`activityId`/assignment-frozen `assessmentRevisionId` while pairs and outcomes may differ. Assessment difficulty and content never vary. Configuration changes affect only later launches; pre-deployment sessions finalized post-deployment yield valid canonical attempts.

#### 8.5 Delivery-state classification (normative; replaces "canonical fallback everywhere")

Categories: **EXPECTED_CANONICAL** (EC), **CANONICAL_FALLBACK_WITH_TELEMETRY** (CFT), **BLOCK_LAUNCH_OR_OPERATION** (BLK).

| # | Condition | Launch/list resolution | Lesson navigation | Session begin |
|---|---|---|---|---|
| 1 | No accommodation record | EC | Canonical target | `"canonical"` |
| 2 | Inactive accommodation | EC | Canonical target | `"canonical"` |
| 3 | Active, no variant/index for lesson | CFT (coverage telemetry; fallback grant) | Canonical target | `"canonicalFallback"` (fallback grant, or no-ref uncovered check §8.2) |
| 4 | Active, retired variant | CFT (withdrawal telemetry; fallback grant) | Canonical target | `"canonicalFallback"` (fallback grant, or no-ref retired check §8.2) |
| 5 | Malformed variant index | CFT + defect-severity anomaly; fallback grant | Canonical target | With fallback grant: `"canonicalFallback"`. No-ref: BLK - fail-safe retriable `BEGIN_VALIDATION_UNAVAILABLE` (§8.2/§8.3), never a silent fallback |
| 6 | Active index, artifact navigation/load fails | (Structurally exceptional under §6.8) | Client canonical fallback + anomaly; `launchRef` discarded, grant not used to claim differentiated (§7.3) | BLK - no-ref + active index → `BEGIN_REQUIRES_LAUNCH` (§8.2); re-resolution required. Index-active-but-unloadable is an operational delivery defect, not a silent fallback |
| 7 | Artifact hash/retention verification failure pre-deploy | BLK — publication blocked (§6.8); never a runtime state | n/a | n/a |
| 8 | Internal resolver/storage failure | CFT at resolve/list; no grant minted | Canonical target | BLK — retriable refusal (§8.3), never silent canonical |
| 9 | Invalid/expired launch reference | n/a | n/a | BLK — forged/cross-user/cross-assignment: refused + security telemetry; expired: retriable refusal via re-launch. Never treated as an ordinary canonical student. |
| 10 | Stale pre-feature client | Pre-activation: EC. Post-activation: coverage-dependent (see begin) | Canonical routing | `"canonical"` if record absent/inactive; if active: covered+enabled → BLK `BEGIN_REQUIRES_LAUNCH` (§8.2); uncovered/retired/disabled → `"canonicalFallback"` |
| 11 | Incomplete presentation deployment | BLK — unreachable under §6.8 (index never precedes liveness); residue manifests as row 6 | Row 6 | Row 6 |
| 12 | Active accommodation, canonical-fallback delivery | Resultant `"canonicalFallback"` state of rows 3-4 (uncovered/retired), 10 (stale, uncovered), 14 (disabled); distinct from the BLK refusals in rows 5-6, 8, 13 | Canonical delivered | `"canonicalFallback"` — always distinguishable from `"canonical"` |
| 13 | Active, covered, enabled, **no valid launchRef** at begin | n/a (this is a begin-time state) | Canonical routing if the client got here by withholding/discarding a ref | BLK - `BEGIN_REQUIRES_LAUNCH` (§8.2); no session, no attempt; client must re-resolve for a valid grant. The central P1 case: available required support cannot be suppressed by omitting the ref |
| 14 | `differentiatedDeliveryEnabled = false` (operational disable, §8.6), active accommodation | CFT (operational-disable telemetry; fallback grant) | Canonical target | `"canonicalFallback"`, no pair, never `"differentiated"`; accommodation record unchanged. The sole path by which a covered active accommodation legitimately reaches canonical at begin |

#### 8.6 Operational differentiated-delivery disable (P2) — normative

A single **server-owned** operational control, `differentiatedDeliveryEnabled` (boolean; NORMAL = `true`). It is a runtime platform-delivery safety switch, **not** a new accommodation state, not a new architecture root, and not an IEP/plan concept. Its storage mechanism is left to repository convention at implementation (§16); the contract is its semantics.

**NORMAL (`true`):** ordinary F5.2/P1 behavior (§4 Op C, §8.2).

**OPERATIONALLY DISABLED (`false`):**
- Active accommodation configuration remains **stored and unchanged**; no accommodation is deactivated or rewritten; teacher plan state is untouched.
- Historical attempts remain untouched.
- Differentiated launch selection is **not claimed**: Op C mints only `canonicalFallback` grants (§4); no `differentiated` grant is issued.
- Active students may legitimately receive canonical content because the platform has intentionally disabled differentiated delivery.
- New classroom sessions freeze `deliveryOutcome:"canonicalFallback"`, **no presentation pair**, and **never** `"differentiated"` (§8.2 step 3, §8.5 row 14); operational/fallback telemetry is emitted.

**Ownership and separation.** The flag is server-owned: the client may not set, assert, override, or bypass it, and a `launchRef` cannot override a disabled state. It must **not** be conflated with `readingAccessibility.status:"inactive"`, missing artifact coverage, a retired variant, teacher deactivation, or any change to an educational plan. It exists so that P1's covered-no-ref refusal (`BEGIN_REQUIRES_LAUNCH`) cannot strand active students when the launch-grant / client-delivery infrastructure is intentionally rolled back while differentiated coverage remains published: disabling delivery first converts those launches into truthful `canonicalFallback` rather than refusals (see §14 rollback requirement, §15 slice rollback).

---

### 9. Practice and Teacher Preview Contract (S12, S13)

**Practice.** Practice never reaches session-begin; its sole server-authoritative resolution point is the resolver/list call it launches from (§7). Nothing is persisted — no session, attempt, or delivery-outcome record (`deliveryOutcome` is a classroom-history construct, genuinely not required for stateless practice). Each launch re-resolves current configuration and build; an active student on an uncovered lesson is §8.5 row 3 (canonical delivery + coverage telemetry, the only practice-side signal). Grants minted at a practice-used surface are never consumed and expire by TTL. Practice acquires no lifecycle, history, or freeze semantics.

**Teacher preview** — unchanged from F5: optional Slice 8, deferrable past V1 GA; teacher-only; explicit `(lessonSlug, variantKey)` selection from the vocabulary, never a student; verified-active-teacher authorization; returns the current `presentation` target; writes no student state; never exposes which students have any configuration. Preview mints no launch grant (grants bind student/assignment launches only).

---

### 10. Teacher Student-Services Functional Contract (S14; C4)

#### 10.1 Three distinguished layers

| Layer | What it is | Where it lives |
|---|---|---|
| A. Accommodation configuration state | Teacher-asserted record state (`active`/`inactive`) | `studentAccommodations` (§3.1) |
| B. Artifact coverage/availability | Whether an active index doc exists for `(lessonSlug, "reading-adapted")` — determined solely by the §6.8-published index; per-lesson, operationally observable via coverage telemetry | `presentationVariants` + telemetry |
| C. Actual delivery outcome | What a specific launch/attempt actually delivered | Grants (transient) and `deliveryOutcome` (durable, §8.1) |

No surface, response, or document may represent A as implying C: "configuration is active" is never rendered, logged, or reported as "the adapted presentation was delivered." Durable delivery claims derive only from `deliveryOutcome`. V1 adds no delivery-reporting UI, compliance dashboard, or IEP workflow.

#### 10.2 Enable gate (platform-level, before any activation exposure)

Teacher activation capability (the Slice 7 surface exposing Op B) may be exposed in production only when **differentiated delivery is platform-enabled**: Slices 2–6 live and gates G1–G18 held, including the staging end-to-end publish/deliver proof (G14) and the publication-ordering and launch-binding suites. Until then Op B ships dark (§4). Activation is **student-wide** (per student, not per lesson) even though coverage varies per lesson: an active student on an uncovered lesson receives canonical delivery with coverage telemetry and, on classroom attempts, `"canonicalFallback"` (§8.5 row 3). Resolver telemetry on every active-accommodation canonical fallback is the V1 coverage signal; reporting UI is out of scope.

**Relationship to the operational disable (§8.6).** G19 (§14) governs the *initial* exposure of teacher activation, and its principle is unchanged: activation must not be exposed until differentiated-delivery infrastructure is proven ready. The `differentiatedDeliveryEnabled` disable is a distinct, primarily *rollback/emergency* control for use after active accommodation records may already exist. While delivery is operationally disabled the product must not present differentiated delivery as functioning normally: no `"differentiated"` outcome is produced, active students degrade to truthful `"canonicalFallback"` (§8.6), and new teacher activation exposure is suspended/hidden as appropriate (§14 rollback requirement). This patch specifies neither teacher UI design nor UI copy.

#### 10.3 Functional requirements (surface behavior)

Unchanged from F5: locate via owned-class roster context → Op A with `(studentId, classId)`; see current configuration, `configRevision`, attribution ("no record" indistinguishable in tone from `inactive`); act via Op B with the last-read `expectedRevision`; on stale-conflict, re-present the refusal payload's current state, never blind-retry; framing conveys administration of the student's required support (copy out of scope); display only §3.1 fields — no disability/plan/diagnostic information exists to display. The inert "Student Services" placeholder remains the mount point.

---

### 11. Security and Privacy Invariants (S15)

- `studentAccommodations/**`, `presentationVariants/**`, and **`launchGrants/**`**: zero direct client read/write for any role; server-mediated exclusively (deny-all precedent).
- Teacher operations require the full composed invariant per call; same-school is the enforced boundary; no cross-school/district path implemented.
- Op C runs only after each surface's complete existing authorization, only for `actor.uid`, only server-side; forbidden-keys coverage per §4.3, with `launchRef` the sole new accepted student field — opaque, content-inert.
- Launch grants follow §7.2: evidence, not authorization; uid- and assignment-bound; TTL-bounded and TTL-deleted; unguessable; possession bypasses nothing; refusal shapes uniform, disclosing neither grant existence nor any configuration.
- `differentiatedDeliveryEnabled` (§8.6) is **server-owned platform configuration**: no student or ordinary client can set, assert, override, or bypass it, no accommodation-request shape carries it, and a `launchRef` cannot override a disabled state. It is distinct from `readingAccessibility.status:"inactive"` and never mutates accommodation records or historical attempts. Any authority to change it is a server-admin/operational mechanism, never a teacher/student surface.
- Refusal shapes and list responses never disclose whether an accommodation record exists; relationship refusals are indistinguishable from no-record outcomes.
- History subcollection is server/admin-only in V1; audit events retain the no-client-access contract; equal-value writes emit no audit (§3.7) — audit and history can never diverge.
- Artifact paths contain `lessonSlug` and an opaque content-hash revision ID — **never** a student identifier, `variantKey`, accommodation category, IEP status, or diagnosis (§5.2/M4). Exposure otherwise has parity with canonical `/app/lessons/` files; the enforced properties are authoritative selection and non-disclosure, not artifact secrecy.
- `deliveryOutcome` is minimal delivery-status metadata (three closed values) encoding no plan, diagnosis, level, or configuration history. No new sensitive educational-plan data is stored anywhere in this design.
- Existing invariants preserved verbatim: sessions client-`get`-only by owner, attempts immutable and client-write-denied, recipients append-only, Classroom link opaque.

---

### 12. Migration and Backward-Compatibility Matrix (S16, S17)

| Record / artifact family | Classification | Notes |
|---|---|---|
| `users`, `schools`, `classes`, `enrollments`, `assignments`, assignment recipients | NO MIGRATION | Unchanged; assignments never gain variant fields (D2) |
| `assessmentSessions` | ADDITIVE OPTIONAL FIELDS | §3.3 incl. `deliveryOutcome`; existing sessions valid as-is |
| `attempts` | ADDITIVE OPTIONAL FIELDS | §3.4; **no backfill onto pre-feature attempts** |
| `auditEvents` | ADDITIVE (new event types) | Existing events untouched |
| `studentAccommodations` (+history), `presentationVariants`, **`launchGrants`** | NEW RECORD FAMILIES | `launchGrants` is TTL-transient |
| Lesson canonical HTML | NO MIGRATION | Byte-identical canonical outputs |
| Lesson build configuration | BUILD/DEPLOY MIGRATION | Target-set restructuring; canonical outputs regression-locked; publish tooling implements §6.8 |
| Slug-to-artifact client mapping | NO MIGRATION (additive routing + fallback rule) | Static table remains the canonical/fallback target (§7.3) |
| Google Classroom publication state | NO MIGRATION | Links and publication records unchanged |
| Firestore Rules | ADDITIVE (deploy) | New deny-all blocks (incl. `launchGrants`); no existing block altered |
| `differentiatedDeliveryEnabled` (§8.6) | ADDITIVE (server-owned config) | New operational flag; NORMAL=`true`; storage per repo convention (§16); no data migration; not client-writable |
| ONE-TIME DATA MIGRATION | **None required anywhere** | |

**Backward compatibility:**

| Case | Required behavior |
|---|---|
| No accommodation record | Canonical everywhere; zero observable delta (one extra server-side read); `deliveryOutcome:"canonical"` on new attempts |
| Record exists, service `inactive` | Identical to no-record for resolution; record/history retained |
| Active accommodation, no current artifact | §8.5 rows 3–4: canonical delivery + telemetry; attempts record `"canonicalFallback"` |
| Active accommodation, covered, enabled, no valid grant at begin | §8.5 row 13: BLK `BEGIN_REQUIRES_LAUNCH`; no silent fallback (P1) |
| Index present but path/file unusable | §8.5 row 6: client visual canonical fallback + anomaly; no-ref begin refuses `BEGIN_REQUIRES_LAUNCH` while coverage active (operational delivery defect), not a silent `"canonicalFallback"` |
| Operational delivery disable active (§8.6) | Active accommodations degrade to truthful `"canonicalFallback"`; records unchanged; never `"differentiated"` |
| Stale client (pre-feature build) | §7.4: canonical routing; EC pre-activation. Post-activation: uncovered/retired/disabled → honestly recorded `"canonicalFallback"`; covered+enabled → BLK `BEGIN_REQUIRES_LAUNCH` (must use compatible launch flow). Never a falsely differentiated record |
| Historical assignment created pre-feature | Fully compatible; resolves normally |
| Session created pre-Slice-6, finalized post-Slice-6 | Fields absent on session ⇒ absent on attempt ⇒ valid canonical-interpreted attempt |
| Historical attempt without new fields | Predates the durable-outcome contract; valid forever; never backfilled. Absence means only "created before this contract," **not** evidence that no accommodation should have existed (§3.4) |

Canonical delivery remains the universal *degradation direction* for launch and navigation; it is **not** the failure direction at the durable freeze point (§8.3) or in publication (§6.8), where safety means refusal/blocking.

---

### 13. Automated Test Contract (S18)

Behavioral assertions; framework syntax out of scope. (N) = negative. F5 suites A (authorization), B (CAS/history), C (resolution), D (artifact identity), E (retention), G (autosave), H (finalize), I (reassessment), J (practice), K (fallback/backcompat), L (reporting), M (Classroom) carry over with these reconciliations: T-A9 adds `launchGrants/**` deny-all; T-B6 asserts the C6 no-op emits **no revision increment, history entry, or audit event**; T-C1 asserts `presentation` + `launchRef` and grant minting; T-K1/K2 assert fallback-grant minting and telemetry; T-F1–F4 are superseded by suites N/O; T-D3 asserts the full-digest derivation and opaque path formula; T-J3 asserts practice coverage telemetry.

**N. Launch binding (new; C1)**
- T-N1: Student opens revision A; B becomes current; begin freezes A via the valid grant.
- T-N2: Student opens A; accommodation deactivated before begin; begin still records differentiated A (grant valid).
- T-N3 (N): Forged/unknown `launchRef` → refused, security telemetry, no session.
- T-N4 (N): Another student's grant → refused; refusal shape byte-identical to T-N3.
- T-N5 (N): Grant for another assignment → refused, same shape.
- T-N6: Expired grant → retriable refusal; re-launch mints a fresh grant; subsequent begin freezes the freshly delivered state.
- T-N7 (N): Injected internal failure during begin validation → retriable refusal, no session, canonical never silently frozen.
- T-N8: Concurrent begins → one session; deterministic frozen values; grant replay harmless.
- T-N9 (N): Begin without `launchRef` runs the §8.2 no-ref coverage check, not a silent freeze - covered+enabled active accommodation → `BEGIN_REQUIRES_LAUNCH` (suite R); uncovered/retired/disabled → `"canonicalFallback"`; never a forced upgrade to `"differentiated"`.
- T-N10 (N): Mixed old/new client rollout — an old client (no `launchRef` transport) can never produce `"differentiated"`; against covered+enabled coverage it receives `BEGIN_REQUIRES_LAUNCH`, not a silent fallback.

**O. Delivery outcome (new; C5)**
- T-O1: Active accommodation + unavailable variant → begin records `"canonicalFallback"`, never `"canonical"`.
- T-O2: No accommodation → `"canonical"`.
- T-O3: Differentiated delivery → `"differentiated"` plus both fields; (N) the §3.3 outcome/fields invariant is unviolable.
- T-O4: Finalize copies `deliveryOutcome` verbatim; CASE A/B/C distinguishable from attempt data alone, without the current accommodation record.

**P. Publication ordering (new; C2)**
- T-P1 (N): Hosting deploy fails before index update → index still points at the prior retained revision.
- T-P2 (N): Deploy succeeds, index update fails → old index remains safe/current; index-update retry succeeds alone.
- T-P3 (N): Publish tooling cannot set the pointer to an artifact that failed or skipped step-8 liveness; the index never references an unverified artifact.
- T-P4: Rollback repoints to a retained, re-liveness-confirmed revision; no artifact deleted.
- T-P5 (N): Build/generation cannot delete or destructively regenerate manifest-listed historical files, independent of the verifier (M7).

**Q. Client fallback and path privacy (new; C3, M4)**
- T-Q1: Variant navigation/load failure → client lands **visually** on the canonical target, emits the anomaly, and discards `launchRef` without using the grant to claim differentiated; if coverage is still active the subsequent begin refuses `BEGIN_REQUIRES_LAUNCH` (suite R, T-R3), and only a legitimately uncovered/disabled re-resolution records `"canonicalFallback"`.
- T-Q2 (N): Published artifact paths contain only `lessonSlug` + opaque revision ID — no `variantKey`, accommodation category token, or student identifier.

**R. No-ref coverage and operational disable (new; P5.1 patches P1/P2 - all BLOCKING before implementation)**
- T-R1 (P1-A, BLOCKING): accommodation active + differentiated coverage/index active for the assignment lesson + delivery enabled + begin called with no `launchRef` → retriable `BEGIN_REQUIRES_LAUNCH`; **no session created, no attempt created, no `"canonicalFallback"`, no differentiated pair frozen**.
- T-R2 (P1-B, BLOCKING): accommodation active + coverage absent or retired + no `launchRef` → session may be created with `deliveryOutcome:"canonicalFallback"`, no presentation pair, fallback/coverage telemetry emitted (proves legitimate fallback remains available).
- T-R3 (P1-C, BLOCKING): differentiated grant issued + client cannot load the artifact + client does not use the grant to claim differentiated + server coverage still active → begin does **not** silently create `"canonicalFallback"`; fresh launch/re-resolution required or operation remains retriable; no misleading differentiated session/attempt created; client assertion alone cannot establish legitimate fallback.
- T-R4 (P2-A, BLOCKING): accommodation active + differentiated coverage exists + `differentiatedDeliveryEnabled = false` + no `launchRef` → session may freeze `deliveryOutcome:"canonicalFallback"`, no presentation pair, never `"differentiated"`, operational/fallback telemetry emitted, accommodation record remains active and unchanged.
- T-R5 (P2-B, BLOCKING, N): the operational disable is server-owned - a student cannot set/override it, teacher accommodation-request shapes cannot assert it (absent an explicit server-admin mechanism authorized for that role), ordinary clients cannot override it, a `launchRef` cannot override the disabled state, and setting it never mutates a historical attempt.
- T-R6 (P2-C, BLOCKING): accommodation remains active through an operational disable; differentiated infrastructure restored and verified; disable removed; coverage active → fresh launch resumes normal differentiated grant issuance, no accommodation migration/rewrite required, and a subsequent valid begin may record `"differentiated"`.

**L (reconfirmed):** T-L1 — canonical score/report aggregates are identical before/after presentation and `deliveryOutcome` metadata exist on some attempts.

---

### 14. Production Release Gates (S19)

- G1 Rules: deny-all proven on all three new families incl. `launchGrants` (T-A9); no existing block weakened.
- G2 Callable authorization: suite A green. G3 CAS/history: suite B green (incl. revised T-B6).
- G4 Canonical regression: T-D5, T-C2, T-K3, T-L1 green — no-accommodation experience unchanged end-to-end.
- G5 Determinism: T-D1. G6 Immutable revision: T-D2/T-D4 (full-digest). G7 Retention across deploys: T-E2 + verifier wired into CI and publish tooling (T-E4).
- G8 Fallback classification: T-K1/T-K2/T-J3 + suite O green. G9 Freeze + autosave refusal: suites N, G green. G10 Reassessment: suite I green.
- G11 Classroom unchanged: suite M. G12 Reporting unchanged: suite L. G13 Legacy-submissions operational check: unchanged from F5 (non-blocking; documented as carrying no presentation stamping).
- G14 Staging proof: one variant published end-to-end via the full §6.8 machine (build → verify → deploy → liveness → index) and delivered to a staging student with a recorded `"differentiated"` attempt.
- **G15 Publication ordering:** suite P green; the index-write path exists only inside the publish tooling.
- **G16 Launch binding:** suite N green.
- **G17 Client fallback + path privacy:** suite Q green.
- **G18 Outcome integrity:** suite O green; CASE A/B/C distinguishable from durable data alone.
- **G19 Enable gate (C4):** the Slice 7 activation surface may be exposed only after G1–G18 hold with Slices 2–6 verified live in production; exposure is itself a gated release action, not a code-deploy side effect. G19 is unchanged by this patch; the §8.6 operational disable is a separate rollback/emergency control, not a substitute for G19.
- **G20 No-ref coverage + operational disable (P5.1 P1/P2):** suite R green - covered+enabled active accommodations with no valid grant refuse `BEGIN_REQUIRES_LAUNCH` (no silent downgrade), legitimately uncovered/retired/disabled states record truthful `"canonicalFallback"`, and `differentiatedDeliveryEnabled` is proven server-owned and non-mutating. **Rollback requirement:** before rolling back any component required for differentiated launch resolution, grant minting, grant transport, session binding, or durable delivery-outcome recording **while active accommodation records exist**, operations must (1) set `differentiatedDeliveryEnabled = false`, (2) verify active students degrade to truthful `"canonicalFallback"`, (3) suspend/hide new teacher activation exposure as appropriate, and only then (4) roll back the affected component. Rollback returns active accommodated students to an explicit `"canonicalFallback"` operational state, **not** to ordinary `"canonical"`. On restoration: verify required components healthy, restore enablement, and existing active records resume ordinary server-authoritative resolution with **no accommodation migration or rewrite**.

No deployment is performed by this specification.

---

### 15. Implementation Slices (S20)

| # | Slice | Responsibility | Tests | Depends on | Rollback safety (per-slice; M5) |
|---|---|---|---|---|---|
| 1 | Accommodation record + teacher ops (dark) | §3.1/§3.2/§3.7; Op A/B; §4.2 CAS; audit; deny-all Rules. **No exposed teacher surface.** | A, B | — | Inert data + callables remain; production behavior canonical-only. |
| 2 | Build pipeline + identity | §5.1 charset validation; §5.2 target-set restructuring, determinism, full-digest IDs, opaque paths, M7 rule; manifest + verifier | D, T-E1/E3, T-P5, T-Q2 | — | Canonical outputs locked (T-D5); no runtime effect. |
| 3 | Publication state machine + index + retention gating | §6.8 publish tooling (liveness gate, index-last rule); `presentationVariants` family; CI/deploy wiring | T-E2/E4, suite P | 2 | No runtime reads yet; index inert. |
| 4 | Server resolution + launch grants | Op C on resolver/list; grant minting (§3.6); `differentiatedDeliveryEnabled` server-owned flag honored by Op C (§8.6, mints only fallback grants when disabled); `presentation`/`launchRef` responses; §4.3 forbidden keys; telemetry | C, J (server), M, grant-mint assertions, R (disable-at-resolver) | 1, 3 | **P2 rollback rule:** if any activation exists and coverage is published, first set `differentiatedDeliveryEnabled = false` and verify active students degrade to truthful `"canonicalFallback"` (§8.6/§8.2), then remove `presentation`/`launchRef`. Without the disable, a covered no-ref begin would correctly return `BEGIN_REQUIRES_LAUNCH` and could strand students (G20). |
| 5 | Client routing + fallback | §7.3: route `presentation.path` else static table; nav-failure visual canonical fallback + anomaly + ref discard (grant not used to claim differentiated); `launchRef` transport to begin | T-K1–K3, T-Q1, E2E C1/C2 | 4 | **P2 rollback rule:** if activation exists and coverage is published, disable delivery first (§8.6) so covered active students record truthful `"canonicalFallback"` rather than hitting `BEGIN_REQUIRES_LAUNCH` once the client can no longer transport `launchRef`; then roll back the client. Unconsumed grants expire; no second resolution engine ever exists. |
| 6 | Begin binding + delivery outcome | §8: grant validation, §8.1 freeze incl. `deliveryOutcome`, no-ref coverage check + `BEGIN_REQUIRES_LAUNCH` (§8.2, P1), `differentiatedDeliveryEnabled` honored at begin (§8.6), fail-closed §8.3; finalize copy extension | N, O, **R**, G, H, I, K4/K5, L | 1, 3, 4 (production rollout after 5) | **P2 rollback rule:** if any activation has occurred, set `differentiatedDeliveryEnabled = false` and suspend new activation exposure (G19/G20) before rolling back 6; active students then record truthful `"canonicalFallback"` rather than `BEGIN_REQUIRES_LAUNCH`. Frozen historical attempts unaffected; no accommodation migration on restore. |
| 7 | Enable gate + teacher activation surface | §10.2/§10.3: expose Op B UI behind G19 | E2E of §10; G19 checklist | 1, 4, 5, 6 live + G1–G18 | Removes the surface, stopping new configuration changes; existing active records keep delivering differentiated while 4–6 remain live — **not** canonical-only, and safely so. To roll back delivery infrastructure itself (4–6), use the §8.6 operational disable per the G20 rollback sequence first. |
| 8 | Teacher preview (optional) | §9 preview | Preview auth negatives; no-student-state-write | 2, 3 | None; never blocks GA. |

Order 1→8 (1–2 parallelizable); each slice independently committable. Safety ordering: activation cannot appear to work before delivery infrastructure is live (7 gated on 4–6 + G19); the grant mechanism precedes session history's dependence on it (4 before 6); the publication machine is proven before any index pointer can go live (3 before 4); client fallback and server resolution stay rollout-compatible (5 before 6 in production — and since `"differentiated"` requires a valid grant, no slice or client mix can corrupt historical attempt interpretation). **Rollback safety (P2/G20):** because P1 makes a covered no-ref begin refuse (`BEGIN_REQUIRES_LAUNCH`) rather than silently downgrade, any rollback of Slices 4–6 while active accommodations exist and coverage is published must be preceded by setting `differentiatedDeliveryEnabled = false` and suspending new activation exposure, so active students degrade to truthful `"canonicalFallback"` instead of being stranded; restoration re-enables delivery with no accommodation migration.

---

### 16. Remaining Implementation-Level Questions

QUESTION: Is `LYFELABZ_LEGACY_SUBMISSIONS_WRITES_ENABLED` set in any deployed environment?
WHY IT REMAINS: Operational environment state, invisible to the repository. WHO RESOLVES: HUMAN OPERATIONAL CHECK (G13). BLOCKS SLICE 1: NO

QUESTION: Do current generated lesson artifacts embed volatile bytes (timestamps, nonces, environment strings) violating §5.2 determinism?
WHY IT REMAINS: P4 verified the hash utility, not output-byte volatility. WHO RESOLVES: CODE (Slice 2, before wiring identity). BLOCKS SLICE 1: NO

QUESTION: What is the actual enforcement posture of `/app/lessons/*` static files under current `firebase.json` hosting behavior?
WHY IT REMAINS: Affects only the documentation accuracy of §7's exposure-parity statement. WHO RESOLVES: CODE (Slice 5; record the finding). BLOCKS SLICE 1: NO

QUESTION: Is the Firestore TTL-deletion policy available and acceptable in the project for `launchGrants.expiresAt`, and is the per-list-refresh grant write volume for accommodated students acceptable at current class sizes?
WHY IT REMAINS: Operational capability/cost, not contract; expiry never depends on deletion latency (`expiresAt` is checked at begin); volume is bounded by accommodated students × differentiated list items. WHO RESOLVES: CODE + HUMAN OPERATIONAL CHECK (Slice 4). BLOCKS SLICE 1: NO

QUESTION: What is the concrete storage and server-admin mechanism for the `differentiatedDeliveryEnabled` operational flag (§8.6), consistent with existing repository configuration conventions?
WHY IT REMAINS: The contract specifies the flag's semantics and ownership (server-owned, not client-writable), not its storage; the mechanism should follow current repo convention rather than be over-designed here. WHO RESOLVES: CODE (Slice 4, before honoring it at resolver/begin). BLOCKS SLICE 1: NO

### 17. Architecture Blockers

NONE.
