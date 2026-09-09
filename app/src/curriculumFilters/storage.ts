// Sprint 29G.5P: durable, same-browser persistence backend for the teacher
// Curriculum grade/topic filter. This module is deliberately OUTSIDE
// `app/src/shell/**` so the shell surfaces stay free of direct browser-storage
// access (the Step 5 data/callable posture invariant): the Curriculum surface
// calls these seams instead of touching `localStorage` itself.
//
// It persists ONLY the two filter strings, keyed per uid, in localStorage.
// No Firestore, no cross-device sync, and no relationship to the separate
// class-creation `defaultGrade` preference. Every access is guarded so
// unavailable, blocked, throwing, or corrupt storage degrades to "no durable
// value" without throwing. Values are returned RAW; the caller validates them
// against the current filter enumerations before use.

const CURRICULUM_FILTERS_STORAGE_PREFIX = "lyfelabz.curriculum.filters.";

export type RawStoredCurriculumFilters = {
  readonly grade: string;
  readonly topic: string;
};

function storageKeyFor(uid: string): string {
  return `${CURRICULUM_FILTERS_STORAGE_PREFIX}${uid}`;
}

function getStorage(): Storage | null {
  try {
    const holder =
      typeof globalThis !== "undefined"
        ? (globalThis as { localStorage?: Storage })
        : undefined;
    return holder && holder.localStorage ? holder.localStorage : null;
  } catch {
    // Accessing the property itself can throw when site data is blocked.
    return null;
  }
}

export function readStoredCurriculumFilters(
  uid: string,
): RawStoredCurriculumFilters | null {
  try {
    const store = getStorage();
    if (store === null) return null;
    const raw = store.getItem(storageKeyFor(uid));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const grade = typeof record.grade === "string" ? record.grade : "";
    const topic = typeof record.topic === "string" ? record.topic : "";
    return { grade, topic };
  } catch {
    return null;
  }
}

export function writeStoredCurriculumFilters(
  uid: string,
  grade: string,
  topic: string,
): void {
  try {
    const store = getStorage();
    if (store === null) return;
    store.setItem(storageKeyFor(uid), JSON.stringify({ grade, topic }));
  } catch {
    // Storage full/blocked/unavailable: the in-memory selection still applies
    // for this page load; a write failure must never break the UI.
  }
}

// Remove every persisted Curriculum filter bucket. Used only by the test-only
// full-reset helper; production sign-out never calls it, so real persistence
// across sign-in is preserved.
export function clearAllStoredCurriculumFilters(): void {
  try {
    const store = getStorage();
    if (store === null) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key !== null && key.startsWith(CURRICULUM_FILTERS_STORAGE_PREFIX)) {
        keys.push(key);
      }
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // ignore
  }
}
