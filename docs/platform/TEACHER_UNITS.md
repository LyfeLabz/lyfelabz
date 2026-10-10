# Teacher Units (U1A Foundation)

**Status:** U1A implemented in the repository (Functions code, Firestore Rules, tests), including the Sol 6.1 certification remediation (transactional authorization snapshots, in-transaction school and district checks, create retry receipts, school-scoped listing). **Not deployed.** No teacher UI calls these operations, so teacher units are not available to teachers. Nothing here is live until the Functions callables and the Firestore Rules blocks are deployed, and no product surface uses them until U2.

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

A unit stamped with a school that is no longer the teacher's current canonical school is not readable or mutable by that teacher (callables return `teacherUnits.notFound` or never read it; Rules deny). It is retained, not deleted or migrated. There is no recovery path in U1A (see section 10).

## 3. Storage

### `teacherUnits/{unitId}`

`unitId` is a server-generated Firestore auto-id (20 characters, `[A-Za-z0-9]`), globally unique and stable for the life of the unit. Callables reject any other id shape.

| Field | Type | Rule |
| --- | --- | --- |
| `teacherId` | string | Caller uid at creation. Immutable. |
| `schoolId` | string | Caller's canonical school at creation. Immutable. |
| `grade` | `"6"` \| `"7"` \| `"8"` | Same closed set as `classesActivate` and the teacher default-grade preference. Immutable. A Grade 8 unit is valid; which resources it may hold is a U1B question. |
| `title` | string | Trimmed, 1-120 code points, no control characters. |
| `description` | string | Trimmed, 0-1000 code points; line breaks and tabs allowed, other control characters rejected. Defaults to `""`. |
| `status` | `"active"` \| `"archived"` | |
| `archivedAt` | Timestamp \| null | `null` while active; server time of the archive transition while archived. |
| `createdAt` | Timestamp | Server timestamp. Immutable. |
| `updatedAt` | Timestamp | Server timestamp of the last accepted mutation. |
| `resourceIds` | string[] | `[]` at creation. No U1A operation changes it (U1B). |
| `sortOrder` | number | U1A placeholder `0` for every unit. No U1A operation changes it (U1B). |
| `revision` | integer | See section 6. |

No `districtId` is stored (the approved record does not include one); the district is resolved from the school on every call, and audit events carry it.

Reader order is `sortOrder` ascending, then `createdAt`, then `unitId`. With the U1A placeholder this is creation order.

### `teacherUnitCreateReceipts/{receiptId}` (server-only)

One receipt per accepted create (section 5). Fields: `teacherId`, `schoolId`, `unitId`, `requestHash` (SHA-256 hex of the normalized grade, title, and description), `createdAt` (server timestamp), `expiresAt` (approximately seven days after creation, computed from the transaction attempt's clock, not the server commit timestamp that sets `createdAt`). `receiptId` is the SHA-256 hex of (operation, teacherId, schoolId, idempotencyKey). The raw key and the title and description text are not stored.

### Indexes

No composite index is required. Both the list callable and a direct client list use two equality filters (`teacherId`, `schoolId`) with no ordering clause, which Firestore serves from the automatic single-field indexes. No TTL policy is configured (section 5.3).

## 4. Operations (Cloud Functions callables)

All require an authenticated, `active`, canonical `teacher` whose school resolves to the district on their signed claim (`role-forbidden`, `account-inactive`, `claim-*`, `school-district-mismatch`, `district-*` refusals otherwise). Every request uses a closed key allowlist (`teacherUnits.invalidRequest` names any extra field). Missing, another teacher's, and another school's units all return the same `teacherUnits.notFound`.

| Callable | Request | Effect |
| --- | --- | --- |
| `teacherUnitsCreate` | `grade`, `title`, `description?`, `idempotencyKey` | Creates an active unit at revision 1, or replays the unit this key already created (section 5). Returns `{ unit, replayed }`. |
| `teacherUnitsList` | `includeArchived?` (default false), `grade?` | Caller's own units in their current school, canonical order. Returns `{ units }`. Refuses (`teacherUnits.listLimitExceeded`) above 1000 records rather than truncating. |
| `teacherUnitsGet` | `unitId` | One own unit, active or archived. Returns `{ unit }`. |
| `teacherUnitsUpdate` | `unitId`, `expectedRevision`, `title?`, `description?` (at least one) | Rename and/or edit description. Archived units are read-only (`teacherUnits.invalidStatus`). |
| `teacherUnitsArchive` | `unitId`, `expectedRevision` | `active` -> `archived`, sets `archivedAt`. |
| `teacherUnitsRestore` | `unitId`, `expectedRevision` | `archived` -> `active`, sets `archivedAt` to `null`. |

Each unit is returned as `{ unitId, grade, title, description, status, archivedAtMillis, createdAtMillis, updatedAtMillis, resourceIds, sortOrder, revision }`. Mutations return `{ unit, noop }`.

There is no delete operation, no resource-membership operation, and no ordering operation.

**Error mapping.** The canonical code is always in `HttpsError.details.code`. Coarse HTTPS codes: `teacherUnits.invalidRequest`, `.invalidIdempotencyKey`, `.invalidUnitId`, `.invalidExpectedRevision`, `.invalidGrade`, `.invalidTitle`, `.invalidDescription` -> `invalid-argument`; `.notFound` -> `not-found`; `.writeConflict` -> `already-exists`; `.invalidStatus`, `.idempotencyKeyConflict`, `.listLimitExceeded` -> `failed-precondition`. The U1A validation codes are listed as exact codes in `shared/errors/https-callable.ts` (not suffixes), so `classes.invalidTitle`, `classes.invalidGrade`, and `accommodations.invalidExpectedRevision` keep their existing `failed-precondition` mapping.

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

The receipt is scoped to the authoritative teacher **and** school. Another teacher using the same key, or the same teacher after a school transfer, gets a different receipt and a new unit; neither can reach the original unit through the key. A replay is authorized exactly like a first request (the authorization snapshot precedes the receipt read), so a suspended or transferred teacher cannot replay.

### 5.3 Receipt lifecycle and retention

- Exactly one receipt per created unit; refused and replayed requests write none. Receipts are therefore bounded by the number of units created.
- Receipts are never updated or deleted by any callable. Rules deny all client access.
- Each receipt carries `expiresAt`, calculated approximately seven days after creation (`TEACHER_UNIT_CREATE_RECEIPT_RETENTION_MS`) using the transaction attempt's clock rather than the server commit timestamp, so a Firestore TTL policy can remove it without a data migration.
- **No TTL policy is configured in U1A.** Adding one is a `firestore.indexes.json` field-override change (the index deploy surface, guarded by `platform/firebase/tests/firestore-indexes.rules.test.ts`) and needs separate authorization. Until then receipts persist, one per unit.
- A receipt is honored for as long as it exists, regardless of `expiresAt`. Once a TTL policy deletes it, the same key would create a new unit. The retry window that matters (a lost response, a reload) is seconds to minutes, far inside 7 days.

## 6. Revision and concurrency contract

- A new unit has `revision: 1`.
- Every accepted state-changing mutation increments `revision` by exactly 1, in the same Firestore transaction that compares it.
- Each mutation runs in one transaction: authorization snapshot (section 4.1) -> read the unit -> verify ownership -> compute the change -> compare `expectedRevision` -> write the change, `revision + 1`, server `updatedAt`, and the audit event.
- **No-op rule.** Full authorization and ownership are verified first. Then, if the request's result already holds (same title/description, archive of an archived unit, restore of an active unit), nothing is written, the revision and `archivedAt` are unchanged, no audit event is written, the current revision is returned with `noop: true`, and `expectedRevision` is not compared. Nothing can be overwritten by a write that does not happen. This makes a retried archive or restore safe after a lost response.
- **Conflict.** Otherwise a mismatched `expectedRevision` is refused with `teacherUnits.writeConflict` (HTTPS `already-exists`) and `details.currentRevision`. Nothing is written. Transaction contention that exhausts Firestore's retries is also reported as `teacherUnits.writeConflict` (without `currentRevision`).
- Two writers holding the same revision can never both commit: the loser's transaction is retried by Firestore, observes the new revision, and is refused.
- Client timestamps are never used for conflict detection.
- Every refusal is raised inside the transaction before any write is staged, or before the transaction starts; a refused request leaves the record, its revision, and the audit trail unchanged.

## 7. Security boundaries

Firestore Rules (`platform/firebase/firestore.rules`):

- `teacherUnits/{unitId}` `get` / `list`: only when `resource.data.teacherId == request.auth.uid`, the caller's canonical `users/{uid}` is an active `teacher` (`callerIsActiveTeacher()`), and `resource.data.schoolId` equals the caller's canonical `schoolId`. A client list must therefore filter `teacherId == uid` **and** `schoolId == <own school>`; a list filtered only by `teacherId`, only by `schoolId`, or not at all is refused. Rules do not read the school document (consistent with other teacher read rules); district validation is enforced by the callables.
- `teacherUnits/{unitId}` `create`, `update`, `delete`: denied for every client. The callables are the sole writers (Admin SDK).
- `teacherUnitCreateReceipts/{receiptId}`: all client reads and writes denied.

Audit: `teacherUnits.created`, `teacherUnits.updated`, `teacherUnits.archived`, `teacherUnits.restored`, written in the same transaction as the change (target type `teacherUnit`), attributed to the in-transaction verified school and district. Payloads carry only `grade`, the revision(s), and for updates the changed field names. They never carry the title or description text. A replayed create and a no-op mutation emit none.

## 8. Archival semantics

Archive and restore are reversible status transitions of the same document. They preserve the unit id, owner, school, grade, title, description, `resourceIds`, `sortOrder`, and `createdAt`. Neither deletes the document or touches any assignment. Restore sets `archivedAt` back to `null`; the archive history is in the audit events. An archived unit cannot be edited until it is restored.

## 9. U1A capabilities and exclusions

U1A delivers only the data model, Rules, and the six callables above, covering create, list, get, rename, edit description (both through `teacherUnitsUpdate`), archive, and restore.

Explicitly not in U1A:

- **U1B:** adding, removing, or reordering resources in a unit; server-side placeability validation (the `unitPlaceable` projection in `FLAT_RESOURCE_PROJECTION.md`); unit ordering; any cross-unit membership rule.
- **U2:** any teacher UI.
- **U3:** assignment integration, including the conceptual publication snapshot `unitContext: { grade, unitId, unitTitle } | null`, which is not persisted anywhere and not added to the publisher.
- **U4:** student grouping by unit.
- **U5:** unit materials.

U1A does not change the assignment publisher, the assignment lifecycle, assessment revision contracts, completion definitions, resource evidence, Student My Science, or non-lesson assignability.

## 10. Known limitations

- Units created at a teacher's previous school are retained but unreachable by that teacher after a transfer; U1A has no recovery or transfer operation.
- Receipts persist until a TTL policy is authorized and deployed (section 5.3).
- `teacherUnitsList` returns everything in one response up to 1000 units per teacher per school (archived units count toward the ceiling); there is no pagination.
- Post-commit revocation (section 4.1) can leave a committed write whose response was refused; for creates, the key replays it once the caller is authorized again.

## 11. Tests

- `platform/functions/src/teacherUnits/teacher-units.test.ts` (hermetic; runs in `npm test` and CI). Its in-memory transaction stages audit events with the other writes and commits all or nothing.
- `platform/functions/src/teacherUnits/teacher-units.emulator.test.ts` (real Firestore emulator; `npm run test:emulator`; not run by CI). Certifies transactional atomicity, the authorization snapshot (suspension, role change, school transfer, school deletion, district reassignment and removal, each committed between pre-check and transaction), post-commit response refusal, create replay, concurrent same-key creates, changed-payload and unauthorized replay, school-scoped listing, overflow boundaries, and stale-revision no-ops.
- `platform/firebase/tests/teacher-units.rules.test.ts` (`npm run test:rules`; run by CI).

## 12. Deployment surfaces (when authorized)

- Functions: the six `teacherUnits*` callables.
- Firestore Rules: the `teacherUnits/{unitId}` and `teacherUnitCreateReceipts/{receiptId}` blocks. Until deployed, the terminal default-deny refuses every direct client read; the callables work regardless.
- Optional, separately authorized: a TTL field override on `teacherUnitCreateReceipts.expiresAt` in `firestore.indexes.json`.
- No composite index, Storage, Hosting, or Auth change.
