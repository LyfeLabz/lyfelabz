import {
  DEFAULT_ROSTER_SORT_ORDER,
  isRosterSortOrder,
  type RosterSortOrder,
  type RosterSortPreference,
} from "./rosterSort";

// Sprint 30 roster polish: same-browser persistence for the teacher's roster
// sort preference, modeled exactly on `curriculumFilters/storage.ts` (the
// existing teacher display-preference pattern). Kept OUTSIDE
// `app/src/shell/**` and `assignments/detail/detail.ts` so those surfaces
// stay free of direct browser-storage access (the Step 5 posture invariant).
//
// Scope: per teacher uid, per browser. No Firestore, no cross-device sync,
// no backend/rules/callable change. An in-memory copy keeps the choice for
// the rest of the page session even when storage is blocked or throwing;
// stored values are validated and anything unexpected reads as the default.

const ROSTER_SORT_STORAGE_PREFIX = "lyfelabz.roster.sort.";

let sessionOrder: { readonly uid: string; readonly order: RosterSortOrder } | null =
  null;

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

export function readRosterSortOrder(uid: string): RosterSortOrder {
  if (sessionOrder !== null && sessionOrder.uid === uid) return sessionOrder.order;
  try {
    const raw = getStorage()?.getItem(`${ROSTER_SORT_STORAGE_PREFIX}${uid}`);
    if (isRosterSortOrder(raw)) return raw;
  } catch {
    // Unreadable storage: fall back to the default.
  }
  return DEFAULT_ROSTER_SORT_ORDER;
}

export function writeRosterSortOrder(uid: string, order: RosterSortOrder): void {
  sessionOrder = { uid, order };
  try {
    getStorage()?.setItem(`${ROSTER_SORT_STORAGE_PREFIX}${uid}`, order);
  } catch {
    // Storage full/blocked: the in-memory choice still applies this session.
  }
}

export function createRosterSortPreference(uid: string): RosterSortPreference {
  return {
    read: () => readRosterSortOrder(uid),
    write: (order) => writeRosterSortOrder(uid, order),
  };
}

// Test-only full reset: drops the in-memory choice and every stored bucket.
export function clearAllStoredRosterSort(): void {
  sessionOrder = null;
  try {
    const store = getStorage();
    if (store === null) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key !== null && key.startsWith(ROSTER_SORT_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // ignore
  }
}
