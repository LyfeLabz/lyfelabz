import type { ClassSummary } from "./types";

// Sprint 30A.1 - pure class-order arithmetic, deliberately split out of
// classOrder.ts. classOrder.ts also exports Firebase-backed factories
// (`createFirestoreReadTeacherClassOrder`, `createFirebaseUpdateTeacherClassOrder`)
// that import `firebase/firestore` / `firebase/functions` at module scope;
// any VALUE import from that file (not just `import type`) pulls those in
// transitively. The Classes workspace (classes.ts) carries a "no firebase/*
// import" invariant so it stays reachable from plain-node Jest suites that
// do not polyfill `fetch`, so its reorder logic imports this file instead
// of classOrder.ts. classOrder.ts re-exports everything here unchanged, so
// existing imports of the pure functions from "./classOrder" keep working.

// Numeric-aware comparison so block/period tokens sort sensibly whether
// they are letters ("A" < "B"), numbers ("2" < "10", never "10" < "2"),
// or mixed ("Period 2" < "Period 10"). Never assumes letter blocks.
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function blockOf(cls: ClassSummary): string | undefined {
  return cls.status === "needsSetup" ? undefined : cls.block;
}

// Deterministic fallback order for a teacher with no saved preference (or
// for classes the saved preference has never named): classes that carry
// the teacher's own block/period metadata sort by that value first (the
// most semantically meaningful existing signal - a teacher who set up
// "Block A", "Block B", "Period 2", etc. already expressed an order),
// then by title as a stable tiebreak. Classes with no block metadata
// (including every `needsSetup` class) sort after those with one, by
// title. This never hardcodes a letter/number scheme and works for
// period numbers, block letters, multiple subjects, or no block at all.
export function computeFallbackClassOrder(
  classes: ReadonlyArray<ClassSummary>,
): readonly string[] {
  const withBlock: ClassSummary[] = [];
  const withoutBlock: ClassSummary[] = [];
  for (const c of classes) {
    if (blockOf(c)) withBlock.push(c);
    else withoutBlock.push(c);
  }
  withBlock.sort((a, b) => {
    const cmp = naturalCompare(blockOf(a) ?? "", blockOf(b) ?? "");
    return cmp !== 0 ? cmp : naturalCompare(a.title, b.title);
  });
  withoutBlock.sort((a, b) => naturalCompare(a.title, b.title));
  return Object.freeze([...withBlock, ...withoutBlock].map((c) => c.id));
}

// Merges the teacher's saved order with the current live class set:
//   1. Every id in `persistedOrder` that still corresponds to a class in
//      `classes` is placed first, in the teacher's saved order. A
//      duplicate or now-deleted/archived-and-filtered id in the saved
//      array is silently ignored (defense against corrupt state) rather
//      than crashing or dropping the whole preference.
//   2. Every remaining class (never ordered, or added after the teacher
//      last saved an order) is appended afterward, in the deterministic
//      fallback order - never spliced into the middle of the saved
//      order, so a newly imported class predictably lands at the end
//      rather than disturbing what the teacher already arranged.
// A teacher with no saved order at all (`persistedOrder === null`) gets
// purely the fallback order.
export function applyCanonicalClassOrder(
  classes: ReadonlyArray<ClassSummary>,
  persistedOrder: ReadonlyArray<string> | null,
): ReadonlyArray<ClassSummary> {
  const byId = new Map(classes.map((c) => [c.id, c] as const));
  const placed = new Set<string>();
  const ordered: ClassSummary[] = [];
  if (persistedOrder) {
    for (const id of persistedOrder) {
      if (placed.has(id)) continue;
      const cls = byId.get(id);
      if (cls) {
        ordered.push(cls);
        placed.add(id);
      }
    }
  }
  for (const id of computeFallbackClassOrder(classes)) {
    if (placed.has(id)) continue;
    const cls = byId.get(id);
    if (cls) {
      ordered.push(cls);
      placed.add(id);
    }
  }
  return Object.freeze(ordered);
}

// Sprint 30A.1 human-review finalization: reordering now happens ONLY on
// the Classes workspace (never inside Assign, which just displays the
// canonical order it receives). This is the pure array-surgery step both
// the drag-drop and keyboard reorder interactions reduce to: move `id`
// out of its current position and reinsert it immediately before
// `beforeId` (or at the end when `beforeId` is null - dropped past the
// last card, or keyboard-moved past the last position). Ids not present
// in `orderedIds` are a no-op (defense against a stale id from a
// concurrent list refresh). Pure and side-effect-free so it is trivial to
// unit test independent of any DOM or persistence concern; the caller is
// responsible for persisting the result through `UpdateTeacherClassOrder`.
export function moveClassId(
  orderedIds: ReadonlyArray<string>,
  id: string,
  beforeId: string | null,
): readonly string[] {
  const next = orderedIds.filter((v) => v !== id);
  if (!orderedIds.includes(id)) return orderedIds;
  if (beforeId === null) {
    next.push(id);
  } else {
    const idx = next.indexOf(beforeId);
    if (idx === -1) {
      next.push(id);
    } else {
      next.splice(idx, 0, id);
    }
  }
  return Object.freeze(next);
}
