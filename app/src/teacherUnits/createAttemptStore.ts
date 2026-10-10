import { validateUnitDescription, validateUnitTitle } from "./fieldRules";
import {
  type CreateAttemptPersistence,
  type CreateAttemptSaveResult,
  type PersistedCreateAttempt,
  type PersistedCreateAttemptStatus,
  type TeacherUnitCreateContext,
  type UnresolvedCreateReason,
} from "./saveCoordination";
import { TEACHER_UNIT_IDEMPOTENCY_KEY_PATTERN, isTeacherUnitGrade } from "./types";

// U2.2 - durable store for teacher-unit create attempts
// (docs/platform/TEACHER_UNITS.md §9.4 "Durable create recovery").
//
// Attempt-keyed: every create attempt has its OWN localStorage entry,
//   lyfelabz.teacherUnits.createAttempt.v2/<uid>/<schoolId>/<idempotencyKey>
// (uid and schoolId percent-encoded; the key grammar has no "/"). A record
// is written, read back, and removed only under its own idempotency key,
// so one create intent (in this tab or another) can never overwrite or
// remove another intent's durable evidence. No cross-entry
// read-check-write sequence exists, so no atomicity across entries is
// needed or claimed. The only entry a tab writes is one whose key it
// minted itself (or a restored attempt it is reconciling with the same key
// and payload).
//
// Kept OUTSIDE `app/src/shell/**` so shell modules stay free of direct
// browser-storage access (Step 5 invariant).
//
// Guarantees:
// - A save counts only when the entry reads back byte-identical.
// - A removal counts only when a read-back confirms the entry is gone.
// - A record is accepted only when it is the current version and every
//   field passes the SERVER's rules (grade, key grammar, title and
//   description via fieldRules.ts), with a consistent status/reason, and
//   its stored key, teacher, and school equal the entry's own scope.
//   Anything else is reported as unreadable, never replayed, and never
//   deleted without an explicit, acknowledged discard.
// - Nothing is deleted automatically (not on sign-out, expiry, or when
//   malformed).
// - School binding (U2.2). A record's `context.schoolId` is the school its
//   create intent began in. It is validated to equal the entry's own scope,
//   and the coordinator sends exactly it as `expectedSchoolId` on every
//   reconcile, so a restored attempt is never resent under a newly
//   authorized school. The record format is unchanged (version 2): the
//   binding was already stored, so existing records keep it.

export const CREATE_ATTEMPT_STORAGE_PREFIX = "lyfelabz.teacherUnits.createAttempt.v2/";
// The pre-certification single-slot prefix (never activated). Entries under
// it are surfaced as unreadable rather than ignored.
export const LEGACY_CREATE_ATTEMPT_STORAGE_PREFIX = "lyfelabz.teacherUnits.createAttempt.";
export const CREATE_ATTEMPT_RECORD_VERSION = 2;

export type CreateAttemptScope = TeacherUnitCreateContext;

export type CreateAttemptListResult =
  | {
      readonly kind: "ok";
      // Valid attempts for this scope, oldest first.
      readonly records: ReadonlyArray<PersistedCreateAttempt>;
      // Storage keys in this scope whose contents could not be validated.
      readonly unreadable: ReadonlyArray<string>;
    }
  // Storage is missing or threw.
  | { readonly kind: "unavailable" };

// Read-only discovery of the SAME teacher's attempts stored under OTHER
// school scopes in this browser (for example after a school transfer).
// Ownership comes only from the storage key's teacher component, which must
// equal this store's teacher exactly; a record's own contents never widen
// what is listed. Nothing is written, rewritten, or removed.
export type FormerSchoolAttempt = {
  // Opaque identifier for the notice (the entry's storage key).
  readonly id: string;
  readonly status: PersistedCreateAttemptStatus;
  readonly grade: PersistedCreateAttempt["payload"]["grade"];
  readonly title: string;
  readonly createdAtMs: number;
};

export type FormerSchoolListResult =
  | {
      readonly kind: "ok";
      // Valid attempts from other schools (unconfirmed or set aside but
      // still uncertain), oldest first.
      readonly attempts: ReadonlyArray<FormerSchoolAttempt>;
      // Count of entries under other schools of this teacher that could not
      // be validated (their contents are never shown).
      readonly unreadable: number;
    }
  | { readonly kind: "unavailable" };

export type CreateAttemptStore = CreateAttemptPersistence & {
  readonly list: () => CreateAttemptListResult;
  readonly listFormerSchools: () => FormerSchoolListResult;
  // Explicit, acknowledged removal of ONE unreadable entry of this scope.
  // Refuses a valid record or a key outside the scope. Verified.
  readonly discardUnreadable: (storageKey: string) => boolean;
};

const STATUSES: ReadonlySet<string> = new Set(["inFlight", "unresolved", "abandoned"]);
const REASONS: ReadonlySet<string> = new Set([
  "uncertain",
  "unauthorized",
  "notFound",
  "contention",
  "idempotencyKeyConflict",
  "replayExpired",
  "replayRefused",
  "schoolContextChanged",
]);

function getStorage(): Storage | null {
  try {
    const holder =
      typeof globalThis !== "undefined"
        ? (globalThis as { localStorage?: Storage })
        : undefined;
    return holder && holder.localStorage ? holder.localStorage : null;
  } catch {
    return null;
  }
}

// "/" is always percent-encoded inside a component and never appears in an
// idempotency key, so no two (scope, key) pairs can share an entry.
export function createAttemptScopePrefix(scope: CreateAttemptScope): string {
  return `${CREATE_ATTEMPT_STORAGE_PREFIX}${encodeURIComponent(scope.teacherId)}/${encodeURIComponent(scope.schoolId)}/`;
}

export function createAttemptStorageKey(scope: CreateAttemptScope, idempotencyKey: string): string {
  return `${createAttemptScopePrefix(scope)}${idempotencyKey}`;
}

// The legacy single-slot entry for this scope.
export function legacyCreateAttemptStorageKey(scope: CreateAttemptScope): string {
  return `${LEGACY_CREATE_ATTEMPT_STORAGE_PREFIX}${encodeURIComponent(scope.teacherId)}/${encodeURIComponent(scope.schoolId)}`;
}

function isValidScope(scope: CreateAttemptScope): boolean {
  return (
    typeof scope.teacherId === "string" &&
    scope.teacherId.length > 0 &&
    typeof scope.schoolId === "string" &&
    scope.schoolId.length > 0
  );
}

// Strict validation. `expectedKey` is the idempotency key named by the
// entry's storage key; the stored key must equal it.
export function parseCreateAttemptRecord(
  raw: string,
  scope: CreateAttemptScope,
  expectedKey: string,
): PersistedCreateAttempt | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (r.v !== CREATE_ATTEMPT_RECORD_VERSION) return null;
  if (typeof r.key !== "string" || !TEACHER_UNIT_IDEMPOTENCY_KEY_PATTERN.test(r.key)) return null;
  if (r.key !== expectedKey) return null;
  if (typeof r.status !== "string" || !STATUSES.has(r.status)) return null;
  if (r.status === "inFlight") {
    if (r.reason !== null) return null;
  } else if (typeof r.reason !== "string" || !REASONS.has(r.reason)) {
    return null;
  }
  if (typeof r.createdAtMs !== "number" || !Number.isFinite(r.createdAtMs) || r.createdAtMs <= 0) {
    return null;
  }
  const ctx = r.context as Record<string, unknown> | null;
  if (!ctx || typeof ctx !== "object") return null;
  if (ctx.teacherId !== scope.teacherId || ctx.schoolId !== scope.schoolId) return null;
  const p = r.payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  if (!isTeacherUnitGrade(p.grade)) return null;
  if (typeof p.title !== "string" || validateUnitTitle(p.title) !== null) return null;
  if (typeof p.description !== "string" || validateUnitDescription(p.description) !== null) return null;
  return Object.freeze({
    key: r.key,
    payload: Object.freeze({ grade: p.grade, title: p.title, description: p.description }),
    context: Object.freeze({ teacherId: scope.teacherId, schoolId: scope.schoolId }),
    status: r.status as PersistedCreateAttemptStatus,
    reason: r.reason as UnresolvedCreateReason | null,
    createdAtMs: r.createdAtMs,
  });
}

function serialize(record: PersistedCreateAttempt): string {
  return JSON.stringify({
    v: CREATE_ATTEMPT_RECORD_VERSION,
    key: record.key,
    payload: {
      grade: record.payload.grade,
      title: record.payload.title,
      description: record.payload.description,
    },
    context: { teacherId: record.context.teacherId, schoolId: record.context.schoolId },
    status: record.status,
    reason: record.reason,
    createdAtMs: record.createdAtMs,
  });
}

function samePinned(a: PersistedCreateAttempt, b: PersistedCreateAttempt): boolean {
  return (
    a.key === b.key &&
    a.payload.grade === b.payload.grade &&
    a.payload.title === b.payload.title &&
    a.payload.description === b.payload.description &&
    a.context.teacherId === b.context.teacherId &&
    a.context.schoolId === b.context.schoolId
  );
}

export function createTeacherUnitCreateAttemptStore(
  scope: CreateAttemptScope,
  getStore: () => Storage | null = getStorage,
): CreateAttemptStore {
  const scoped = Object.freeze({ teacherId: scope.teacherId, schoolId: scope.schoolId });
  const scopeOk = isValidScope(scoped);
  const prefix = createAttemptScopePrefix(scoped);
  const legacyKey = legacyCreateAttemptStorageKey(scoped);

  const readRaw = (storageKey: string): { ok: true; raw: string | null } | { ok: false } => {
    try {
      const store = getStore();
      if (store === null) return { ok: false };
      return { ok: true, raw: store.getItem(storageKey) };
    } catch {
      return { ok: false };
    }
  };

  const list = (): CreateAttemptListResult => {
    if (!scopeOk) return { kind: "unavailable" };
    try {
      const store = getStore();
      if (store === null) return { kind: "unavailable" };
      // Probe a read even when no entries exist, so blocked reads surface
      // as unavailable before any create is offered.
      store.getItem(prefix);
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k !== null && (k.startsWith(prefix) || k === legacyKey)) keys.push(k);
      }
      const records: PersistedCreateAttempt[] = [];
      const unreadable: string[] = [];
      for (const k of keys.sort()) {
        const raw = store.getItem(k);
        if (raw === null) continue;
        const record =
          k === legacyKey ? null : parseCreateAttemptRecord(raw, scoped, k.slice(prefix.length));
        if (record === null) unreadable.push(k);
        else records.push(record);
      }
      records.sort((a, b) => a.createdAtMs - b.createdAtMs || (a.key < b.key ? -1 : 1));
      return { kind: "ok", records: Object.freeze(records), unreadable: Object.freeze(unreadable) };
    } catch {
      return { kind: "unavailable" };
    }
  };

  const save = (record: PersistedCreateAttempt): CreateAttemptSaveResult => {
    if (!scopeOk) return "unavailable";
    // Never write another account's or school's attempt into this scope.
    if (record.context.teacherId !== scoped.teacherId || record.context.schoolId !== scoped.schoolId) {
      return "unavailable";
    }
    if (!TEACHER_UNIT_IDEMPOTENCY_KEY_PATTERN.test(record.key)) return "unavailable";
    const storageKey = createAttemptStorageKey(scoped, record.key);
    const before = readRaw(storageKey);
    if (!before.ok) return "unavailable";
    if (before.raw !== null) {
      // Only the same attempt (same key, payload, context) may update its
      // own entry; anything else there is never replaced.
      const existing = parseCreateAttemptRecord(before.raw, scoped, record.key);
      if (existing === null || !samePinned(existing, record)) return "occupied";
    }
    const text = serialize(record);
    // The record must itself pass strict validation, or it could never be
    // restored; refuse before writing.
    if (parseCreateAttemptRecord(text, scoped, record.key) === null) return "unavailable";
    try {
      const store = getStore();
      if (store === null) return "unavailable";
      store.setItem(storageKey, text);
    } catch {
      return "unavailable";
    }
    const after = readRaw(storageKey);
    return after.ok && after.raw === text ? "saved" : "unavailable";
  };

  const removeVerified = (storageKey: string): boolean => {
    try {
      const store = getStore();
      if (store === null) return false;
      store.removeItem(storageKey);
    } catch {
      return false;
    }
    const after = readRaw(storageKey);
    return after.ok && after.raw === null;
  };

  // Removes exactly this attempt's entry (and nothing else).
  const clear = (key: string): boolean => {
    if (!scopeOk || !TEACHER_UNIT_IDEMPOTENCY_KEY_PATTERN.test(key)) return false;
    const storageKey = createAttemptStorageKey(scoped, key);
    const before = readRaw(storageKey);
    if (!before.ok) return false;
    if (before.raw === null) return true;
    return removeVerified(storageKey);
  };

  const discardUnreadable = (storageKey: string): boolean => {
    if (!scopeOk) return false;
    if (!(storageKey.startsWith(prefix) || storageKey === legacyKey)) return false;
    const before = readRaw(storageKey);
    if (!before.ok) return false;
    if (before.raw === null) return true;
    if (
      storageKey !== legacyKey &&
      parseCreateAttemptRecord(before.raw, scoped, storageKey.slice(prefix.length)) !== null
    ) {
      return false;
    }
    return removeVerified(storageKey);
  };

  // Entries for this teacher under any school: v2 attempt keys and legacy
  // single-slot keys. The school component is the second path segment and
  // must be non-empty; the current school is excluded (list() owns it).
  const teacherPrefix = `${CREATE_ATTEMPT_STORAGE_PREFIX}${encodeURIComponent(scoped.teacherId)}/`;
  const legacyTeacherPrefix = `${LEGACY_CREATE_ATTEMPT_STORAGE_PREFIX}${encodeURIComponent(scoped.teacherId)}/`;
  const currentSchool = encodeURIComponent(scoped.schoolId);

  const listFormerSchools = (): FormerSchoolListResult => {
    if (!scopeOk) return { kind: "unavailable" };
    try {
      const store = getStore();
      if (store === null) return { kind: "unavailable" };
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k !== null) keys.push(k);
      }
      const attempts: FormerSchoolAttempt[] = [];
      let unreadable = 0;
      for (const k of keys.sort()) {
        let encSchool: string;
        let idemKey: string | null;
        if (k.startsWith(teacherPrefix)) {
          const rest = k.slice(teacherPrefix.length);
          const slash = rest.indexOf("/");
          if (slash <= 0) continue;
          encSchool = rest.slice(0, slash);
          idemKey = rest.slice(slash + 1);
        } else if (k.startsWith(legacyTeacherPrefix) && !k.startsWith(CREATE_ATTEMPT_STORAGE_PREFIX)) {
          encSchool = k.slice(legacyTeacherPrefix.length);
          if (encSchool.length === 0 || encSchool.includes("/")) continue;
          idemKey = null;
        } else {
          continue;
        }
        if (encSchool === currentSchool) continue;
        const raw = store.getItem(k);
        if (raw === null) continue;
        let schoolId: string;
        try {
          schoolId = decodeURIComponent(encSchool);
        } catch {
          unreadable++;
          continue;
        }
        const record =
          idemKey === null || encodeURIComponent(schoolId) !== encSchool
            ? null
            : parseCreateAttemptRecord(raw, { teacherId: scoped.teacherId, schoolId }, idemKey);
        if (record === null) {
          unreadable++;
          continue;
        }
        // "abandoned" (set aside) stays listed: its outcome is still
        // uncertain. Only the explicit acknowledgment that removes the
        // record (beginNewUnit / dismissAbandoned at its school) ends it.
        attempts.push(
          Object.freeze({
            id: k,
            status: record.status,
            grade: record.payload.grade,
            title: record.payload.title,
            createdAtMs: record.createdAtMs,
          }),
        );
      }
      attempts.sort((a, b) => a.createdAtMs - b.createdAtMs || (a.id < b.id ? -1 : 1));
      return { kind: "ok", attempts: Object.freeze(attempts), unreadable };
    } catch {
      return { kind: "unavailable" };
    }
  };

  return Object.freeze({ list, listFormerSchools, save, clear, discardUnreadable });
}
