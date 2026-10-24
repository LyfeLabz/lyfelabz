// Same-browser persistence for which My Units cards a teacher has collapsed,
// modeled on `rosterSortStorage.ts` (the existing teacher
// display-preference pattern). Kept OUTSIDE `app/src/shell/**` so the shell
// surfaces stay free of direct browser-storage access.
//
// Units expand by default, so only the teacher's explicit collapses are
// stored: a unit with no saved preference (including a new unit) is open.
// Scope: per teacher uid, per browser. Display state only - no Firestore, no
// change to unit membership, order, or content. An in-memory copy keeps the
// choice for the page session even when storage is blocked or throwing;
// anything unexpected in storage reads as "no preference".

const UNITS_COLLAPSED_STORAGE_PREFIX = "lyfelabz.units.collapsed.";

let session: { readonly uid: string; readonly ids: Set<string> } | null = null;

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

function readStored(uid: string): Set<string> {
  try {
    const raw = getStorage()?.getItem(`${UNITS_COLLAPSED_STORAGE_PREFIX}${uid}`);
    if (raw === null || raw === undefined) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string" && v.length > 0));
  } catch {
    return new Set();
  }
}

function collapsedFor(uid: string): Set<string> {
  if (session === null || session.uid !== uid) session = { uid, ids: readStored(uid) };
  return session.ids;
}

export function isUnitExpanded(uid: string, unitId: string): boolean {
  return !collapsedFor(uid).has(unitId);
}

export function writeUnitExpanded(uid: string, unitId: string, expanded: boolean): void {
  const ids = collapsedFor(uid);
  if (expanded) ids.delete(unitId);
  else ids.add(unitId);
  try {
    getStorage()?.setItem(`${UNITS_COLLAPSED_STORAGE_PREFIX}${uid}`, JSON.stringify([...ids]));
  } catch {
    // Storage full/blocked: the in-memory choice still applies this session.
  }
}

// Test-only: drops the in-memory copy so the next read comes from storage
// (a simulated reload).
export function _resetUnitExpansionSessionForTest(): void {
  session = null;
}

// Test-only full reset: drops the in-memory copy and every stored bucket.
export function clearAllStoredUnitExpansion(): void {
  session = null;
  try {
    const store = getStorage();
    if (store === null) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key !== null && key.startsWith(UNITS_COLLAPSED_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // ignore
  }
}
