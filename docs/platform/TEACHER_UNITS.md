# Teacher Units (U1A Foundation, U1B Membership and Ordering)

**Status:** U1A implemented in the repository (Functions code, Firestore Rules, tests), including the Sol 6.1 certification remediation (transactional authorization snapshots, in-transaction school and district checks, create retry receipts, school-scoped listing). U1B (resource membership and unit ordering, section 9) implemented in the repository on top of U1A. **Not deployed.** No teacher UI calls these operations, so teacher units are not available to teachers. Nothing here is live until the Functions callables and the Firestore Rules blocks are deployed, and no product surface uses them until U2.

**Canonical for:** the `TeacherUnit` domain type, the `teacherUnits/{unitId}` and `teacherUnitCreateReceipts/{receiptId}` collections, the `teacherUnits*` callables, and their security, consistency, and concurrency contract.

---

## 1. TeacherUnit vs CurriculumUnit

| | `TeacherUnit` (this document) | `CurriculumUnit` |
| --- | --- | --- |
| Meaning | A teacher's own named instructional unit for one grade | One curriculum lesson card in the client manifest |
| Defined in | `platform/functions/src/shared/types/teacher-unit.ts` | `app/src/curriculum/curriculumManifest.ts` |
| Stored | Firestore `teacherUnits/{unitId}` | Bundled client data, never stored |
| Owner | One teacher, in one school | LyfeLabz curriculum |

The two types share no code and must not be merged or aliased.

## 2. Ownership

A unit is owned by exactly one teacher, in that teacher's school, for one grade (**teacher-grade ownership**). `teacherId` and `schoolId` come only from the caller's verified canonical identity (`requireDistrictContext`: the `users/{uid}` record wins over claims, and the school's `districtId` must match the signed claim). A request that names `teacherId`, `schoolId`, or any other server-owned field is rejected.

A unit stamped with a school that is no longer the teacher's current canonical school is not readable or mutable by that teacher (callables return `teacherUnits.notFound` or never read it; Rules deny). It is retained, not deleted or migrated. There is no recovery path in U1A (see section 11).

## 3. Storage

### `teacherUnits/{unitId}`

`unitId` is a server-generated Firestore auto-id (20 characters, `[A-Za-z0-9]`), globally unique and stable for the life of the unit. Callables reject any other id shape.

| Field | Type | Rule |
| --- | --- | --- |
| `teacherId` | string | Caller uid at creation. Immutable. |
| `schoolId` | string | Caller's canonical school at creation. Immutable. |
| `grade` | `"6"` \| `"7"` \| `"8"` | Same closed set as `classesActivate` and the teacher default-grade preference. Immutable. A Grade 8 unit is valid. Membership is not grade-restricted (section 9.1). |
| `title` | string | Trimmed, 1-120 code points, no control characters. |
| `description` | string | Trimmed, 0-1000 code points; line breaks and tabs allowed, other control characters rejected. Defaults to `""`. |
| `status` | `"active"` \| `"archived"` | |
| `archivedAt` | Timestamp \| null | `null` while active; server time of the archive transition while archived. |
| `createdAt` | Timestamp | Server timestamp. Immutable. |
| `updatedAt` | Timestamp | Server timestamp of the last accepted mutation. |
| `resourceIds` | string[] | Ordered canonical resource ids, each RA-1 `unitPlaceable`, no duplicates, at most 100. `[]` at creation. Written only by `teacherUnitsSetResources` (section 9.1). |
| `sortOrder` | number | `0` at creation. Written only by `teacherUnitsReorder`, which assigns positions `1..n` (section 9.2). |
| `revision` | integer | See section 6. |

No `districtId` is stored (the approved record does not include one); the district is resolved from the school on every call, and audit events carry it.

Reader order is `sortOrder` ascending, then `createdAt`, then `unitId`. Before any reorder this is creation order.

### `teacherUnitCreateReceipts/{receiptId}` (server-only)

One receipt per accepted create (section 5). Fields: `teacherId`, `schoolId`, `unitId`, `requestHash` (SHA-256 hex of the normalized grade, title, and description), `createdAt` (server timestamp), `expiresAt` (approximately seven days after creation, computed from the transaction attempt's clock, not the server commit timestamp that sets `createdAt`). `receiptId` is the SHA-256 hex of (operation, teacherId, schoolId, idempotencyKey). The raw key and the title and description text are not stored.

### Indexes

No composite index is required. The list callable, the reorder callable, and a direct client list use two equality filters (`teacherId`, `schoolId`) with no ordering clause, which Firestore serves from the automatic single-field indexes. No TTL policy is configured (section 5.3).

## 4. Operations (Cloud Functions callables)

All require an authenticated, `active`, canonical `teacher` whose school resolves to the district on their signed claim (`role-forbidden`, `account-inactive`, `claim-*`, `school-district-mismatch`, `district-*` refusals otherwise). Every request uses a closed key allowlist (`teacherUnits.invalidRequest` names any extra field). Missing, another teacher's, and another school's units all return the same `teacherUnits.notFound`.

| Callable | Request | Effect |
| --- | --- | --- |
| `teacherUnitsCreate` | `grade`, `title`, `description?`, `idempotencyKey`, `expectedSchoolId?` (U2.2, section 5.4) | Creates an active unit at revision 1, or replays the unit this key already created (section 5). Returns `{ unit, replayed }`. |
| `teacherUnitsList` | `includeArchived?` (default false), `grade?` | Caller's own units in their current school, canonical order. Returns `{ units }`. Refuses (`teacherUnits.listLimitExceeded`) above 1000 records rather than truncating. |
| `teacherUnitsGet` | `unitId` | One own unit, active or archived. Returns `{ unit }`. |
| `teacherUnitsUpdate` | `unitId`, `expectedRevision`, `title?`, `description?` (at least one) | Rename and/or edit description. Archived units are read-only (`teacherUnits.invalidStatus`). |
| `teacherUnitsArchive` | `unitId`, `expectedRevision` | `active` -> `archived`, sets `archivedAt`. |
| `teacherUnitsRestore` | `unitId`, `expectedRevision` | `archived` -> `active`, sets `archivedAt` to `null`. |
| `teacherUnitsSetResources` (U1B) | `unitId`, `expectedRevision`, `resourceIds` | Replaces the unit's ordered resource list (add, remove, and reorder in one request). Archived units are read-only. Returns `{ unit, noop }`. Section 9.1. |
| `teacherUnitsReorder` (U1B) | `grade`, `units: [{ unitId, expectedRevision }]` | Orders the caller's active units of one grade. Returns `{ units, noop }` (the grade's active units in canonical order). Section 9.2. |

Each unit is returned as `{ unitId, grade, title, description, status, archivedAtMillis, createdAtMillis, updatedAtMillis, resourceIds, sortOrder, revision }`. Single-unit mutations return `{ unit, noop }`.

There is no delete operation. U1A operations still reject `resourceIds` and `sortOrder` as request fields.

**Error mapping.** The canonical code is always in `HttpsError.details.code`. Coarse HTTPS codes: `teacherUnits.invalidRequest`, `.invalidIdempotencyKey`, `.invalidUnitId`, `.invalidExpectedRevision`, `.invalidGrade`, `.invalidTitle`, `.invalidDescription`, (U2.2) `.invalidExpectedSchoolId`, and (U1B) `.invalidResourceIds`, `.duplicateResource`, `.resourceNotPlaceable`, `.invalidUnitOrder` -> `invalid-argument`; `.notFound` -> `not-found`; `.writeConflict` -> `already-exists`; `.invalidStatus`, `.idempotencyKeyConflict`, `.listLimitExceeded`, (U2.2) `.schoolContextChanged` -> `failed-precondition`. The U1A and U1B validation codes are listed as exact codes in `shared/errors/https-callable.ts` (not suffixes), so `classes.invalidTitle`, `classes.invalidGrade`, and `accommodations.invalidExpectedRevision` keep their existing `failed-precondition` mapping.

### 4.1 Authorization snapshot

`assertActiveTeacher` (`requireDistrictContext` plus the teacher role) runs first, outside any transaction, and fixes the actor (`uid`, `schoolId`, claim-verified `districtId`). Every operation then repeats the canonical checks **inside the Firestore transaction that reads or writes unit data**, against the same snapshot (`reassertTeacherContextInTransaction`):

- `users/{uid}` exists, `status == "active"`, `role == "teacher"`, and `schoolId` is still the actor's school (`account-inactive`, `role-forbidden`, `claim-state-mismatch`);
- `schools/{schoolId}` exists (`school-district-mismatch`), has a non-empty `districtId` (`district-unassigned`), equal to the actor's verified district (`district-mismatch`).

These are the same refusal codes `requireDistrictContext` uses for the same conditions. Schools have no status field, so existence plus district membership is the complete school authorization, as elsewhere in the platform. Ownership is then checked against the verified context, and writes and audit events use it.

- **Get** and every **post-mutation / post-create response** use `readOwnedTeacherUnit`: one read-only transaction that re-verifies authorization and reads the unit.
- **List** re-verifies authorization and runs its query in one transaction.
- **Mutations** re-verify authorization, read the unit, decide, and write in one transaction. A no-op response is built from that same snapshot.

**Consistency boundary.** Authorization and the data returned come from one transaction snapshot, and the user and school documents are in its read set. A suspension, role change, school transfer, school deletion, or district change committed **before** that snapshot is always honored. A change committed **after** the transaction completes cannot recall data already returned. After a committed write, the response is produced by a second authorized snapshot: if authorization was revoked between the commit and that read, the write stands and the response is refused (the caller sees the refusal code, not the unit). For a create, retrying the same `idempotencyKey` once authorized again replays the unit.

## 5. Create retry contract

### 5.1 Behavior

`idempotencyKey` is required: a URL-safe token of 8-64 characters (`[A-Za-z0-9_-]`, the `labReportsSave.saveId` / RA-3A `operationId` grammar; a UUID fits). The client generates one key per intended unit and reuses it only to retry that same request.

In one transaction, after the authorization snapshot (section 4.1), the handler reads the receipt `teacherUnitCreateReceipts/{sha256(teacherId, schoolId, key)}`:

- **Absent:** create the unit (server auto-id), the receipt, and the `teacherUnits.created` audit event atomically. `replayed: false`.
- **Present, same normalized request:** a replay. Nothing is written and no audit event is emitted. The response is the original unit (same `unitId`) in its **current** state (it may have been renamed or archived since), with `replayed: true`.
- **Present, different normalized request:** `teacherUnits.idempotencyKeyConflict`; nothing is written.

The request hash covers the normalized values (trimmed title and description, description defaulted to `""`), so `" Earth "` and `"Earth"` are the same request. Deduplication is by key only, never by title: two different keys with the same title create two units.

### 5.2 Concurrency and scope

Two simultaneous requests with the same scope and key map to the same receipt document. Exactly one transaction commits; the other is retried by Firestore (or loses the `create()` precondition and is re-run once), observes the receipt, and replays. If contention exhausts the retries, the request fails with `teacherUnits.writeConflict` and is safe to retry with the same key.

The receipt is scoped to the authoritative teacher **and** school. Another teacher using the same key, or the same teacher after a school transfer, gets a different receipt and a new unit; neither can reach the original unit through the key. A replay is authorized exactly like a first request (the authorization snapshot precedes the receipt read), so a suspended or transferred teacher cannot replay. Without `expectedSchoolId`, a transferred teacher's same-key request is authorized in the new school and creates a new unit there; a client that sends `expectedSchoolId` is refused instead (section 5.4).

### 5.3 Receipt lifecycle and retention

- Exactly one receipt per created unit; refused and replayed requests write none. Receipts are therefore bounded by the number of units created.
- Receipts are never updated or deleted by any callable. Rules deny all client access.
- Each receipt carries `expiresAt`, calculated approximately seven days after creation (`TEACHER_UNIT_CREATE_RECEIPT_RETENTION_MS`) using the transaction attempt's clock rather than the server commit timestamp, so a Firestore TTL policy can remove it without a data migration.
- **No TTL policy is configured in U1A.** Adding one is a `firestore.indexes.json` field-override change (the index deploy surface, guarded by `platform/firebase/tests/firestore-indexes.rules.test.ts`) and needs separate authorization. Until then receipts persist, one per unit.
- A receipt is honored for as long as it exists, regardless of `expiresAt`. Once a TTL policy deletes it, the same key would create a new unit. The retry window that matters (a lost response, a reload) is seconds to minutes, far inside 7 days.

### 5.4 School binding: `expectedSchoolId` (U2.2, additive)

Receipts are scoped to the verified school (section 5.2). So if a create commits in school A, its response is lost, and the teacher's canonical membership and claims then move to school B, a same-key retry is authorized in B, finds no receipt there, and creates a second unit in B. That is an authorized cross-school duplicate, not an authorization bypass. The optional `expectedSchoolId` closes it for callers that send it.

- **Field.** Optional. Absent means the U1A / U2.1 request, unchanged. When present it must be a canonical school id (`SCHOOL_ID_PATTERN` in `platform/functions/src/shared/types/school.ts`, the grammar `schoolsCreate` enforces), or the request is refused with `teacherUnits.invalidExpectedSchoolId` during validation, before any transaction (no write).
- **Comparison.** Inside the create transaction, immediately after the authorization snapshot (section 4.1) and **before the receipt is read or any write is staged**, `expectedSchoolId` must equal the verified school. Otherwise the request is refused with `teacherUnits.schoolContextChanged` (`failed-precondition`): no unit, no receipt, no audit event. This applies identically to a first create and to a same-key replay.
- **Never authority.** The field is only compared. The school written to the unit, the receipt id and record, and the audit event is always the server-verified one. `schoolId` itself remains a rejected server-owned request field, and every authorization refusal (section 4.1, including a transfer committed between the pre-check and the transaction, which is `claim-state-mismatch`) still applies first.
- **Idempotency unchanged.** The field is not part of the request hash: an accepted value always equals the receipt's own school, so a legacy request and a school-bound request with the same key and payload replay each other. Concurrent same-key requests still admit exactly one unit.
- **After a refusal.** The original unit (if the first dispatch committed) stays in school A. If the teacher's school becomes A again, the same bound key replays it. A teacher who still needs the unit in B creates it there with a new key, as an explicit new intent.
- **Proof.** `teacher-units.emulator.test.ts`, "school binding: expectedSchoolId (U2.2 P1-B)", runs the real handler against the Firestore emulator: create and replay in A; lost response plus transfer to B refused with no unit, receipt, or audit in B; transfer committed between pre-check and transaction; transfer back to A replays; mismatched initial create writes nothing; legacy behavior (including the legacy cross-school scope) unchanged; malformed values rejected with no write; authorization and membership refusals intact; concurrent bound requests admit one unit. With the comparison removed, the transfer, mismatch, and authorization cases fail.

## 6. Revision and concurrency contract

- A new unit has `revision: 1`.
- Every accepted state-changing mutation increments `revision` by exactly 1, in the same Firestore transaction that compares it.
- Each mutation runs in one transaction: authorization snapshot (section 4.1) -> read the unit -> verify ownership -> compute the change -> compare `expectedRevision` -> write the change, `revision + 1`, server `updatedAt`, and the audit event.
- **No-op rule.** Full authorization and ownership are verified first. Then, if the request's result already holds (same title/description, archive of an archived unit, restore of an active unit, the stored resource list, every unit already at its requested position), nothing is written, the revision and `archivedAt` are unchanged, no audit event is written, the current revision is returned with `noop: true`, and `expectedRevision` is not compared. Nothing can be overwritten by a write that does not happen. This makes a retried archive or restore safe after a lost response.
- **Conflict.** Otherwise a mismatched `expectedRevision` is refused with `teacherUnits.writeConflict` (HTTPS `already-exists`) and `details.currentRevision`. Nothing is written. Transaction contention that exhausts Firestore's retries is also reported as `teacherUnits.writeConflict` (without `currentRevision`).
- Concurrency outcomes (U1A and U1B alike). Every operation is one Firestore transaction; the outcome of concurrent requests is whatever Firestore's transaction serialization produces, and this contract does not promise that a given pair always succeeds or always fails. What is guaranteed:
  - **Conflicting state-changing writes** to the same unit from the same revision cannot both commit. The loser's transaction is retried by Firestore, observes the new revision, and is refused with `teacherUnits.writeConflict` (or `teacherUnits.invalidStatus` when the winner archived the unit). Nothing is overwritten.
  - **Identical requests** (same rename, same archive or restore, same resource list, same unit order) may produce one state-changing write and one authorized no-op: the second, retried against the new state, finds its result already holds (`noop: true`, no write, no audit event). This is the U1A no-op rule applied under concurrency.
  - **Operations on different state** (two different units, two grades, two teachers' organizations, a create in another grade) do not contend and succeed in a valid serialized order.
  - **Create, restore, and reorder in the same grade** follow serialization: if the create or restore commits before the reorder's snapshot, the reorder no longer names the complete organization and is refused with `teacherUnits.writeConflict` (nothing written); if it commits after, both succeed and the created unit sits at position 0 (a restored unit at its preserved position). Either outcome is valid.
- Client timestamps are never used for conflict detection.
- Every refusal is raised inside the transaction before any write is staged, or before the transaction starts; a refused request leaves the record, its revision, and the audit trail unchanged.

## 7. Security boundaries

Firestore Rules (`platform/firebase/firestore.rules`):

- `teacherUnits/{unitId}` `get` / `list`: only when `resource.data.teacherId == request.auth.uid`, the caller's canonical `users/{uid}` is an active `teacher` (`callerIsActiveTeacher()`), and `resource.data.schoolId` equals the caller's canonical `schoolId`. A client list must therefore filter `teacherId == uid` **and** `schoolId == <own school>`; a list filtered only by `teacherId`, only by `schoolId`, or not at all is refused. Rules do not read the school document (consistent with other teacher read rules); district validation is enforced by the callables.
- `teacherUnits/{unitId}` `create`, `update`, `delete`: denied for every client. The callables are the sole writers (Admin SDK).
- `teacherUnitCreateReceipts/{receiptId}`: all client reads and writes denied.

Audit: `teacherUnits.created`, `teacherUnits.updated`, `teacherUnits.archived`, `teacherUnits.restored`, and (U1B) `teacherUnits.resourcesUpdated` (payload adds `previousResourceCount`, `resourceCount`) and `teacherUnits.reordered` (one per moved unit; payload adds `previousSortOrder`, `sortOrder`), written in the same transaction as the change (target type `teacherUnit`), attributed to the in-transaction verified school and district. Payloads carry only `grade`, the revision(s), and for updates the changed field names. They never carry the title or description text. A replayed create and a no-op mutation emit none.

## 8. Archival semantics

Archive and restore are reversible status transitions of the same document. They preserve the unit id, owner, school, grade, title, description, `resourceIds`, `sortOrder`, and `createdAt`. Neither deletes the document or touches any assignment. Restore sets `archivedAt` back to `null`; the archive history is in the audit events. An archived unit cannot be edited (title, description, or resources) until it is restored, and a reorder never writes it.

## 9. Resource membership and ordering (U1B)

### 9.1 Membership: `teacherUnitsSetResources`

The request carries the complete ordered `resourceIds` the unit should hold; adding, removing, and reordering resources are all this one operation, one revision, and one audit event. It runs through the U1A compare-and-set core (`mutateOwnedTeacherUnit`), so authorization snapshot, ownership, no-op, revision, and audit behavior are exactly section 4.1 and section 6.

Validation runs before any read or write, and any failure refuses the whole request with nothing written:

- `resourceIds` must be an array of strings, at most `TEACHER_UNIT_RESOURCES_MAX` (100) (`teacherUnits.invalidResourceIds`);
- no id may repeat within the unit (`teacherUnits.duplicateResource`, `details.resourceId`);
- every id must be RA-1 `unitPlaceable` (`teacherUnits.resourceNotPlaceable`, `details.resourceIds` lists every failing id). Unknown ids, gated resources (for example the gated lesson `ragebaiting`), and reusable tools (`lab-report-assistant`) all fail.

Approved semantics:

- Placement requires `unitPlaceable` only. It does **not** require `authenticatedAssignment`: Gravity Wells (`simulation-gravity-wells`) is placeable and stays unassignable. Placing a resource does not make it assignable.
- A resource may appear in any number of units (the teacher's own units in any grade, and co-teachers' units). There is no cross-unit uniqueness check or index.
- Membership is not restricted by the resource's grade; the approved rule is placeability alone.
- An archived unit refuses with `teacherUnits.invalidStatus`. Archive and restore preserve `resourceIds` exactly.
- A list identical to the stored one (same ids, same order) is a no-op. Validation precedes the no-op check, so a list naming an id that is no longer placeable is refused even if it matches the stored list; the teacher removes the id by sending the list without it.
- Stored ids are not rewritten when the curriculum changes. A resource that later stops being placeable remains in existing units until a teacher saves the unit without it.

### 9.2 Ordering: `teacherUnitsReorder`

A teacher-grade organization is every **active** unit the caller owns, in their current canonical school, for one grade: exactly what `teacherUnitsList({ grade })` returns. Co-teachers and other grades are separate organizations.

The request names that complete set in the desired order, each unit with the `expectedRevision` the caller last observed (at most `TEACHER_UNITS_REORDER_MAX`, 200). Unit `i` (0-based) receives `sortOrder = i + 1`. In one transaction:

1. re-verify the caller's canonical authorization (section 4.1);
2. read the caller's units with the same `teacherId` + `schoolId` query as list (no new index) and keep the active units of the grade;
3. any requested id that is not one of them is refused with the uniform `teacherUnits.notFound` (missing, another teacher's, another school's, another grade's, or archived); a request that omits one of them is refused with `teacherUnits.writeConflict` (the caller's view is stale, for example a unit was created or restored since);
4. if every unit already holds its requested position, nothing is written (`noop: true`, revisions not compared);
5. otherwise every requested `expectedRevision` must match (`teacherUnits.writeConflict`, `details: { unitId, currentRevision }` for the first mismatch);
6. each unit whose position changes gets its new `sortOrder`, `revision + 1`, a server `updatedAt`, and one `teacherUnits.reordered` audit event, all in the same commit. Units whose position does not change are not written.

Malformed requests (empty list, repeated unit, entry not `{ unitId, expectedRevision }`) are refused before any read (`teacherUnits.invalidUnitOrder`, `.invalidUnitId`, `.invalidExpectedRevision`, or `.invalidRequest`).

Concurrency (section 6): two **different** reorders of one organization from the same revisions cannot both commit. Each reads every unit in the organization, so the loser's read set moved; Firestore retries it, and the retry is refused on revision. Two **identical** reorders may produce one write and one authorized no-op. A reorder compares the revision of every unit it names but writes only the units whose position changes, so a concurrent edit to a unit the reorder **moves** conflicts with it at that unit's revision (they cannot both commit from the same revision), while an edit to an **unmoved** unit may succeed alongside the reorder: if the reorder serializes first, both commit; if the edit serializes first, the reorder's comparison fails and it is refused with nothing written. A concurrent create or restore in the grade follows section 6 (serialization-dependent). A reorder that commits rewrites each moved unit's revision, so a client holding an older revision for one of those units must reload before its next edit.

Ordering decisions (current behavior, recorded for review; not changed without approval):

- **New units start at position 0.** Create is unchanged from U1A, so a unit created after the last reorder sorts ahead of the ordered units (positions 1..n), in creation order, until the next reorder, which must include it.
- **Restored units retain their previous position.** Archived units are outside the organization and are never written by a reorder; a unit keeps its `sortOrder` through archive and restore and is placed by that preserved value until the next reorder includes it.
- **Ties are deterministic:** equal `sortOrder` values are ordered by `createdAt`, then `unitId` (for example two new units at 0, or a restored unit whose preserved position equals another unit's).
- **A complete reorder supports at most 200 active units** (`TEACHER_UNITS_REORDER_MAX`) per teacher-grade organization.

Post-commit response: the same contract as U1A mutations. The response is produced by an authorized read (`listOwnedTeacherUnits`) after the commit; a revocation between the commit and that read refuses the response while the reorder stands.

### 9.3 Authoritative placement validation and drift prevention

Functions cannot import the client curriculum bundle, so the server validates against a generated copy of one RA-1 field: `platform/functions/src/teacherUnits/unit-placeable-resources.json` holds the canonical ids for which `getFlatResources()` (`app/src/curriculum/resourceProjection.ts`) reports `unitPlaceable: true`, in canonical registry order (62 ids today). `unit-placeable-resources.ts` loads it into a frozen set and refuses to load an empty list or a duplicate id. It carries no resource data and is not a registry; RA-1 remains the single derivation of placement eligibility (`FLAT_RESOURCE_PROJECTION.md`).

**Required parity gate.** `scripts/unit-placement/check-parity.cjs` is the release invariant. It (1) runs `build-curriculum-manifest.cjs --check`, because RA-1 reads the generated manifest; (2) bundles and evaluates the real RA-1 accessor with the app's esbuild (it does not re-derive placement); (3) requires the server file to have exactly `description` and `resourceIds` and to equal the canonical ids, order included. An empty canonical list (zero placeable resources, which the server loader would refuse), noncanonical, non-placeable, stale, missing, duplicated, or reordered ids, a missing or malformed file, or missing app dependencies all fail closed (exit 1) and print the exact replacement list. It is invoked by every supported path:

| Path | How the gate runs |
| --- | --- |
| Any Functions build: `npm --prefix platform/functions run build`, CI, and the Functions `predeploy` of every `firebase deploy --only functions[...]` (including single-function deploys) | `prebuild` script in `platform/functions/package.json` |
| Any Hosting deploy: both targets, a single target, production (`firebase.json`) or staging (`firebase.staging.json`) | `build-pair.cjs` (the only Hosting `predeploy`) runs it before building, and records `unitPlacement: { count, fingerprint }` in `dist/hosting-release/pair-build.json` |
| `scripts/hosting-release/prepare.cjs` | through the pair build, plus the gate's test suite in its Hosting tests, plus app verify (`unitPlaceableManifest.test.ts`) |
| Platform CI (`.github/workflows/platform-ci.yml`) | explicit "Unit placement parity" step (gate and its tests) and the `prebuild`; the workflow also triggers on the RA-1 inputs (`app/src/curriculum/**`, the curriculum build scripts, `app/package*.json`, root `index.html`) and on `scripts/unit-placement/**`, as well as on `platform/**` (which includes the server file) |

Consequence: Functions release checkouts now need app dependencies installed (`npm --prefix app ci`), as Hosting release checkouts already do; without them the Functions build refuses. `scripts/unit-placement/check-parity.test.cjs` proves the gate refuses each drift class and that each entry point above invokes it.

**What the gate does not prove.** It checks the source tree being built. It does not prove which placement list a deployed Functions or Hosting artifact carries, and Hosting and Functions remain separately deployable. Today the effect of a deployed mismatch is bounded: the server list is the only enforcement, no teacher UI calls these callables yet, and a mismatch can only make the server refuse (`resourceNotPlaceable`) an id a future client offers, or accept one it does not offer; it cannot admit a resource outside the server's own deployed list. Deployed-version coordination is deferred as a mandatory U2 activation safeguard (section 11).

The app test `app/src/curriculum/unitPlaceableManifest.test.ts` remains as a fast developer check in `npm --prefix app run verify`.

## 9.4 U2.2 My Units client (gated, not active)

**Status:** implemented in the repository behind `TEACHER_UNITS_GATE_OPEN = false` (`app/src/index.ts`). Not active and not deployed. Opening the gate requires the U1A/U1B Functions and Rules to be deployed first, and separate authorization.

- **Surface.** Curriculum shows a Browse | My Units switch (`shell/surfaces/curriculum.ts`, panel in `shell/surfaces/teacherUnitsPanel.ts`) only when the entry point supplies the `teacherUnits` seam. With the gate closed the seam is `null`: no switch, no `teacherUnits*` call, no create-recovery storage access, and the Curriculum DOM is unchanged. My Units is not a top-level navigation item. Its history entry is `shell-curriculum-units` (`#curriculum/units`).
- **Scope.** Grade 6/7/8 listing, show-archived toggle, create, rename, edit description, archive, restore, and (U2.3, section 9.5) resource membership. No ordering (U2.4) UI. The controller is created lazily on first open, defaulting to the active Curriculum grade filter; "All" falls back to Grade 6 because the teacher-level saved default grade was removed in Sprint 28.6F.
- **Authority.** `teacherUnits/unitsController.ts` displays only server responses and sends the last server revision it holds. On `writeConflict` it fetches the unit with `teacherUnitsGet`, keeps the teacher's unsaved edits in the open editor, shows the current version, and waits for a deliberate save again. It never replays a stale revision.
- **Lifetime guard.** Every asynchronous continuation checks that the controller is still mounted and that the current Firebase uid still equals the mounted teacher, so a late response cannot update another account's UI.

### Durable create recovery

- **Store (attempt-keyed).** `teacherUnits/createAttemptStore.ts`: same-browser `localStorage`, one entry per create attempt, `lyfelabz.teacherUnits.createAttempt.v2/<uid>/<schoolId>/<idempotencyKey>` (uid and school percent-encoded; the key grammar has no `/`). An attempt is written, read back, and removed only under its own key, so one intent (in this tab or another) cannot overwrite or remove another's evidence. There is no cross-entry read-check-write sequence, so no atomicity across entries is relied on or claimed; Web Locks or IndexedDB transactions are not needed. Every write is read back byte-identical before it counts; every removal is verified. An entry holding anything other than the same attempt (same key, payload, context) is never replaced.
- **Strict validation.** A record is accepted only when it is version 2 and its grade, key grammar, title, and description pass the server's own rules (`teacherUnits/fieldRules.ts` mirrors `readTitle` / `readDescription`), its status and reason are consistent, and its stored key, teacher, and school equal the entry's scope. Anything else (including the pre-certification single-slot entry) is listed as unreadable: never replayed, never deleted automatically, and discarded only explicitly after an authoritative check.
- **Coordinator hooks.** The U2.1 `createUnitCreateCoordinator` gained optional `persistence`, `restore`, and `now` hooks. Without them it is the unchanged U2.1 state machine. With them, the attempt (key, exact payload, teacher/school context, status, `createdAtMs`) is saved and verified before first dispatch; if that fails, nothing is sent. Later transitions are saved best-effort: a failed save leaves the earlier in-flight record, which restores as unresolved, and the key stays in memory.
- **Resend refusals.** A pre-commit validation refusal of a same-key RESEND (reconcile) proves only that the resend did not commit. It never settles the attempt as rejected or removes its record: the attempt becomes unresolved `replayRefused`, reconcile is disabled, and it follows the check-then-set-aside path. Only a refusal of the first dispatch is a confirmed rejection.
- **Restore and discovery.** On mount the controller lists every attempt in its scope and gives each restored attempt its own coordinator. Before a new create it rescans, so an attempt saved by another tab blocks the form until resolved (a UX guard only; attempts that race past it each keep their own record). An in-flight record restores as unresolved ("uncertain", possibly committed). Reconciliation resends the same key and payload only when the live context equals the pinned one. A new key needs explicit new-unit intent.
- **Replay window.** Six days from `createdAtMs` (inside the approximately seven-day receipt retention, §5.3, with a day of margin; future-dated records are untrusted). Outside it the attempt becomes `replayExpired`: reconcile is disabled, the teacher must run an authoritative list check (all grades, archived included) before setting it aside, and an abandoned attempt keeps its "may already have been created" warning until explicitly dismissed. Nothing is deleted automatically.
- **Sign-out.** Records are not deleted on sign-out. They are only ever replayed under the same uid and school; another school's records of the same uid are only read for the informational former-school notices below.

### School binding (P1-B, resolved in the repository)

The cross-school duplicate described in section 5.4 is closed by the additive server field plus this client behavior (`teacherUnits/saveCoordination.ts`):

- **Capture.** The attempt's teacher/school context is pinned when the create intent begins (the coordinator reads the live session at `submit`, and the controller only returns it when it equals the mounted session). The durable record already stores it as `context.schoolId` (record version 2, unchanged), validated to equal the entry's scope.
- **Send.** Every dispatch, the first send and every reconcile (including a restored attempt after reload), carries `expectedSchoolId` equal to that pinned school. It is never re-read from the session and never replaced by a newly authorized school. A live context that differs from the pinned one still blocks reconciliation (`contextMismatch`) before anything is sent.
- **`schoolContextChanged`.** Classified as unresolved reason `schoolContextChanged` on a first dispatch or a resend: never a confirmed rejection, never deleted. The original key, payload, school, and durable record are preserved; reconciliation is disabled (`blocked: "schoolContextChanged"`), so nothing is resent automatically or against another school. Setting it aside requires the authoritative check, like `replayRefused`. The teacher sees: "We couldn't confirm whether this unit was created. Your school changed after you asked for it, so LyfeLabz won't create it at your new school. If it was created, it belongs to your previous school. Reload the page to continue at your current school, and create the unit there only if you still need it."
- **Old server.** A Functions deployment without the field rejects it as an unsupported field (`teacherUnits.invalidRequest`) during validation, before any transaction. On a first dispatch that is a confirmed pre-commit rejection (nothing written; the teacher cannot create until Functions are updated). On a resend it is `replayRefused`: unresolved, record kept, reconciliation disabled. The client never falls back to a request without the binding.
- **Compatibility.** `wire.ts` sends `expectedSchoolId` only when the caller supplies it, so existing U2.1 callers of `create` that omit it send the unchanged U2.1 payload. The U2.2 coordinator always supplies it.

### Former-school notices (cross-school recovery visibility)

A teacher can start a create at school A, lose the response, and later be authorized only for school B. The school-A record stays in this browser under its own scope, and the school-B controller cannot reconcile it (section 5.4). Without discovery the teacher would never learn it exists. The correction is client-only (`createAttemptStore.listFormerSchools`, `unitsController` `formerSchool` state, `teacherUnitsPanel` "Unit request from a previous school" region):

- **Discovery.** On mount and on every rescan (before a new create, and on Check my units), the store enumerates existing `localStorage` keys under `lyfelabz.teacherUnits.createAttempt.v2/<uid>/` (and the legacy single-slot prefix) for the mounted teacher's uid, excluding the mounted school. Ownership comes only from the key's exact, percent-encoded uid segment, which must equal the Firebase uid the controller was mounted for; a record's own contents never widen what is listed, and a prefix-sharing uid never matches. Each entry is then strictly validated against the scope its key names (school segment must decode and re-encode canonically). No Firestore read, no callable, no school id from the browser is used for any authorization.
- **Read-only.** Discovery never writes, rewrites, re-scopes, or removes any entry; records stay byte-for-byte unchanged, including malformed ones. Storage failure reports `unavailable` (no notice, and the existing same-school storage guard still blocks create) and deletes nothing.
- **Informational only.** The region shows, for each valid attempt whose outcome is still uncertain (`inFlight`, `unresolved`, or set aside as `abandoned`), its title, grade, and start date, plus a count of unreadable former-school entries. It does not show the saved description or any school id. It has no controls: no Check again, reconcile, open, edit, restore, copy-into-a-new-create, or discard. It does not block the form: the teacher may deliberately create a new unit at the current school, which mints a new key and leaves the old record intact. Copy states that the outcome cannot be confirmed from the current school, that it will not be created again here, and to contact a school administrator if confirmation is needed; it never claims the unit was or was not created. Set-aside attempts are included and labelled "set aside": setting aside is not an acknowledgment of the outcome (the record, key, and uncertain reason stay stored, and the same-school UI keeps warning that the unit may exist). An attempt stops being listed only when its record is removed by the existing state machine: confirmation through reconciliation, or the explicit acknowledgment (Create another unit / dismiss) while authorized at its original school.
- **Lifecycle.** Notices are recomputed per controller, and a controller is bound to one uid and school, so a teacher or school change (a new controller) shows only that teacher's notices for that school. They persist across reloads until the attempt is resolved through normal recovery while authorized at its original school, after which they disappear on the next mount or rescan. The panel's polite status region (shared with other actions) is updated whenever the notice count changes: an increase is announced with the current count; a decrease replaces only the panel's own earlier notice message (with the new count, or "No unit requests from a previous school are listed now." at zero) and never overwrites an unrelated message; an unchanged rescan writes nothing; storage-unavailable clears the panel's own message without claiming zero. A teacher or school change mounts a new panel with an empty status; the region is labelled by its own heading and hidden (`hidden`) when empty.
- **Limits.** Discoverable only in the same browser, for the same authenticated teacher. Browser and device local only: an attempt made in another browser, profile, or device is not visible, and clearing site data removes the evidence. There is no cross-school replay or authorization capability, by design.

**Remaining activation prerequisites.** Unchanged by this correction: deploy and certify the Functions (with `expectedSchoolId`) and Rules first, then Hosting; independent certification of U2.2 including this correction; explicit authorization to set `TEACHER_UNITS_GATE_OPEN = true`.

**Rollout order (mandatory): Functions before Hosting.** Deploy the `teacherUnitsCreate` Function that accepts `expectedSchoolId` first, then any Hosting bundle that sends it. A Hosting client that sends the field to an older Function cannot create units (every create is rejected as `invalidRequest`, safely, with no write). Functions can be deployed alone: the field is optional, so the current client is unaffected. Rolling back Functions while a field-sending client is live has the same safe-but-blocked effect. The gate (`TEACHER_UNITS_GATE_OPEN = false`) stays closed until both are deployed and certified.

## 9.5 U2.3 Resource membership UI (gated, not active)

**Status:** implemented in the repository behind the same closed gate (`TEACHER_UNITS_GATE_OPEN = false`). Not active and not deployed. No server, Rules, index, or Functions change: it is a client of `teacherUnitsSetResources` (section 9.1) through the existing U2.1 `setResources` wire adapter.

- **Catalog.** The picker lists `getPlaceableResources()` (`teacherUnits/placeableResources.ts`, the U2.1 adapter over RA-1 `getFlatResources()`), filtered to the unit's own grade (`filterPlaceableResources({ unitGrade })`) with an optional title search. Eligibility is RA-1 `unitPlaceable` only; nothing is inferred from type, public page, assessment, or `authenticatedAssignment`. Placeable resources that are not assignable (for example Gravity Wells) are offered and labelled "Can be organized here, not assigned". Grade 8 units show an empty state (RA-1 has no Grade 8 resources); grade eligibility is not broadened. The cross-grade discovery scope the adapter supports (`allGrades`) is not exposed. Labels are the Curriculum Browse labels (`FORMAL_RESOURCE_LABEL`, "Lesson").
- **Identity.** Requests carry canonical RA-1 ids only. The client refuses ids that are not placeable before sending; the server remains the enforcement boundary.
- **Add.** `unitsController.addResources(unitId, ids)` appends the ids not already in the held server list, in canonical registry order, and sends the complete list with the held `expectedRevision`. All-present is a no-op without a call; more than `TEACHER_UNIT_RESOURCES_MAX` (100) is refused before sending. The same resource may be in any number of units.
- **Remove.** `unitsController.removeResource(unitId, id)` sends the held list without that id. It affects only that unit; it never deletes a resource or touches assignments. An id the held unit no longer has is a no-op without a call. A stored id that is no longer placeable is shown ("no longer available") and can be removed.
- **Order.** The list renders `unit.resourceIds` as returned (server order). No reordering UI (U2.4).
- **Archived units.** Membership is shown read-only with "Restore this unit to add or remove resources." The controller refuses archived units before sending; a unit archived elsewhere is refused by the server (`invalidStatus`) and shown as archived. Archive and restore semantics are unchanged.
- **Authority and concurrency.** Nothing is shown as added or removed until the server responds; the list always renders the last server unit. Requests go through the U2.2 `mutate` path: one mutation per unit at a time (`createMutationGate`; extra clicks are `busy` and the controls are disabled while pending), `writeConflict` re-reads the unit with `teacherUnitsGet`, adopts it, and waits for a deliberate retry (the picker keeps the selection, minus anything now in the unit). A network failure or malformed response is reported as **uncertain**: the unit is re-read once and shown, nothing is resent, and the teacher is told the outcome could not be confirmed. A later attempt carries the re-read revision, so it cannot overwrite another session's change. A placement refusal (`resourceNotPlaceable`, `duplicateResource`) re-reads the unit and shows the refusal. Authorization refusals are shown and not retried. A teacher or school change while a request is pending makes the response stale (ignored), and later requests are not sent (existing lifetime guard).
- **No durable attempt evidence.** Membership is not stored in browser storage. Unlike create, a membership write is revision-guarded and idempotent in effect (a resend of the same list is a server no-op, a stale one is refused), so a lost response is resolved by reading the unit, not by a replay record. The U2.2 create-attempt mechanism is unchanged and not extended.
- **Accessibility.** Add resources is a button with `aria-expanded`; the picker is a labelled form (heading, search field, fieldset with legend, native checkboxes) that opens with focus in the search field and closes on Cancel or Escape with focus returned to Add resources. Each Remove button names the resource and unit. Pending, success, and no-op outcomes use the panel's polite status region; a pending message is cleared (only if still the panel's own) when a request settles without confirmation. Failures use the card's alert notice. After removal, focus moves to the next Remove button or to Add resources.
- **Activation prerequisite (unchanged).** Section 11 "Deployed-version coordination" applies to this surface: before the gate opens, a mechanism must prove the deployed Functions placement list matches the client's offered choices. U2.3 does not implement it.
- **Out of scope.** Assignment publication, Classroom, `unitContext`, completion, scoring, passback, Current assignment selection, student grouping, study materials, and ordering.

## 10. Capabilities and exclusions

U1A delivers only the data model, Rules, and the six callables above, covering create, list, get, rename, edit description (both through `teacherUnitsUpdate`), archive, and restore.

U1B adds `teacherUnitsSetResources` and `teacherUnitsReorder` (section 9).

Explicitly not in U1A or U1B:

- **U2:** any teacher UI (U2.2 My Units is now implemented behind a closed gate, section 9.4).
- **U3:** assignment integration, including the conceptual publication snapshot `unitContext: { grade, unitId, unitTitle } | null`, which is not persisted anywhere and not added to the publisher.
- **U4:** student grouping by unit.
- **U5:** unit materials.

U1A and U1B do not change the assignment publisher, `unitContext`, the assignment lifecycle, assessment revision contracts, completion definitions, resource evidence, Student My Science, or non-lesson assignability.

## 11. Known limitations

- Units created at a teacher's previous school are retained but unreachable by that teacher after a transfer; U1A has no recovery or transfer operation.
- Receipts persist until a TTL policy is authorized and deployed (section 5.3).
- `teacherUnitsList` returns everything in one response up to 1000 units per teacher per school (archived units count toward the ceiling); there is no pagination.
- Post-commit revocation (section 4.1) can leave a committed write whose response was refused; for creates, the key replays it once the caller is authorized again.
- A grade organization larger than 200 active units cannot be reordered in one request.
- The server placement list is a deploy-time copy (section 9.3): after a registry change, membership validation follows the new list only once Functions are redeployed.
- **Deployed-version coordination: deferred, mandatory U2 activation safeguard.** The parity gate proves source-tree parity only; it does not prove which placement list deployed Functions or a deployed (or cached) Hosting client carries, and Hosting and Functions remain independently deployable. Nothing is implemented in U1B. Before U2 activates any client surface that offers placement choices, a coordination mechanism must be designed, approved, and certified that accounts for:
  - a shared clean source commit for the Functions and Hosting releases;
  - the eligibility fingerprint (SHA-256 of the ordered RA-1 placeable ids, printed by the gate and recorded in `pair-build.json` as `unitPlacement.fingerprint`);
  - the actual deployed Functions fingerprint (observable from the running server, not assumed from source);
  - the deployed Hosting artifact fingerprint;
  - partial rollout and rollback (one surface deployed or rolled back without the other);
  - cached clients still running an older bundle;
  - fail-closed activation: on any mismatch the client must not offer placement choices it cannot prove the server accepts.
  No deployment policy is changed by U1B.

## 11.1 CI enforcement status

Three different things, not to be conflated:

- **CI runs automatically.** `.github/workflows/platform-ci.yml` (workflow "Platform CI") runs on pull requests and pushes to `main` that touch its path filters, which now include the U1B parity inputs (section 9.3).
- **CI passes.** A run's jobs succeed. The check runs are named `Functions (lint, typecheck, test, build)` (which includes the "Unit placement parity" step and the `prebuild` gate) and `Firestore Rules tests` (verified against the check runs recorded on commit `6c404d8`).
- **GitHub requires CI before integration.** Not configured. As verified for U1B, `main` has no branch protection (`GET /branches/main/protection` returns 404 "Branch not protected") and no repository rulesets. A failing or missing run therefore does not mechanically block a merge or a direct push to `main`. The parity gate is still mechanically enforced at build and deploy time (Functions `prebuild`, Hosting pair build), independent of GitHub settings.

Recommended smallest future change (not applied; repository settings are owner-controlled): a repository ruleset (or classic branch protection) on `main` requiring the status check `Functions (lint, typecheck, test, build)` (and optionally `Firestore Rules tests`) from GitHub Actions, with changes integrated through pull requests. Caveat: Platform CI uses path filters, so a pull request that touches none of them never produces the check, and a required check that never reports blocks the merge. Before requiring it, either remove the workflow's path filters or accept that every pull request must trigger it. Until such a rule is configured and verified, do not describe CI as required by GitHub.

## 12. Tests

- `platform/functions/src/teacherUnits/teacher-units.test.ts` (hermetic; runs in `npm test` and CI). Its in-memory transaction stages audit events with the other writes and commits all or nothing.
- `platform/functions/src/teacherUnits/teacher-units.emulator.test.ts` (real Firestore emulator; `npm run test:emulator`; not run by CI). Certifies transactional atomicity, the authorization snapshot (suspension, role change, school transfer, school deletion, district reassignment and removal, each committed between pre-check and transaction), post-commit response refusal, create replay, concurrent same-key creates, changed-payload and unauthorized replay, school-scoped listing, overflow boundaries, stale-revision no-ops, and (U2.2) the `expectedSchoolId` school binding (section 5.4).
- U2.3 client: `app/src/teacherUnits/unitsController.resources.test.ts` (controller membership, guards, conflict, lost response, authorization, context change) and `app/src/shell/surfaces/teacherUnits.resources.test.ts` (panel list, picker, remove, focus, announcements, archived, Grade 8).
- U2.2 client: `app/src/teacherUnits/createAttempt.schoolBinding.test.ts` (binding on every dispatch, restored attempts, `schoolContextChanged` uncertainty, old-server `invalidRequest`), plus the panel case in `app/src/shell/surfaces/curriculum.teacher-units.test.ts`.
- `platform/firebase/tests/teacher-units.rules.test.ts` (`npm run test:rules`; run by CI), including U1B direct-write denials for `resourceIds` and `sortOrder`.
- U1B: the hermetic and emulator suites above cover add/remove/reorder, atomic rejection of non-placeable, unknown, duplicate, and malformed ids, Gravity Wells placement, cross-unit and co-teacher reuse, archived-unit refusal, archive/restore preservation, stale no-ops, stale-revision and incomplete-organization conflicts, simultaneous conflicting membership edits and reorders, reorder versus membership and archive races, every authorization-snapshot revocation, and post-commit response refusal. `scripts/unit-placement/check-parity.test.cjs` (run by Platform CI and Hosting `prepare`) proves the required parity gate and its wiring, including an empty canonical list and a real `npm run prebuild` run; `app/src/curriculum/unitPlaceableManifest.test.ts` is the app-side developer check (section 9.3).

## 13. Deployment surfaces (when authorized)

- Functions: the eight `teacherUnits*` callables (six U1A, plus `teacherUnitsSetResources` and `teacherUnitsReorder`). U2.2 changes `teacherUnitsCreate` additively (`expectedSchoolId`, section 5.4); it must be deployed before any Hosting bundle that sends the field (section 9.4, rollout order).
- Firestore Rules: the `teacherUnits/{unitId}` and `teacherUnitCreateReceipts/{receiptId}` blocks. Until deployed, the terminal default-deny refuses every direct client read; the callables work regardless.
- Optional, separately authorized: a TTL field override on `teacherUnitCreateReceipts.expiresAt` in `firestore.indexes.json`.
- U1B changes no Firestore Rules or indexes (the Rules file gains tests only).
- No composite index, Storage, Hosting, or Auth change.
