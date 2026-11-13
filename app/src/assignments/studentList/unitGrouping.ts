// Teacher Units P2A: pure grouping of already-built My Science work items
// into the server-projected Teacher Units. No DOM, no Firebase, no I/O.
//
// The server (`teacher-unit-projection.ts`, P1) is authoritative for unit
// eligibility, unit order, card order, and membership. This module only
// joins that projection onto the cards the surface already decided to show,
// by assignment id. It never reads lesson titles or slugs, never derives
// membership, never decides visibility, and never clones or mutates a work
// item: every grouped entry is the caller's original object.
//
// Card identity: a My Science card may represent several assignment ids (a
// Current tile plus its `relatedAssignmentIds`, or one history-only group).
// The caller supplies `assignmentIdsOf` so this module never assumes one id
// per card; P1 lists every id of a placed history group and the Current id
// of an operational card, so any one represented id locates the card.
//
// Rules:
//   - units keep server order; each projection entry is a distinct group,
//     even when two entries share a unitId (one per class scope; P2A never
//     merges them);
//   - cards inside a unit follow the unit's assignmentIds order;
//   - a card is placed at most once: the first unit (and first id) that
//     references it wins; duplicate and unknown ids are ignored;
//   - superseded ids are never used for placement (P1 never places them;
//     their attempts belong to the Current card);
//   - units that place no card are omitted;
//   - every unplaced card goes to "Other assigned work" in the caller's
//     existing order;
//   - when no unit places any card (or the projection is missing or
//     malformed) the result is the flat-list fallback.

export const OTHER_ASSIGNED_WORK_LABEL = "Other assigned work";

// Structural view of a parsed projection entry (see types.ts
// `StudentAssignmentUnit`). Typed loosely so malformed runtime input is
// tolerated rather than trusted.
export type UnitProjectionEntry = {
  readonly unitId: string;
  readonly title: string;
  readonly color: string | null;
  readonly assignmentIds: ReadonlyArray<string>;
};

export type UnitGroupingInput<T> = {
  // The cards the surface already authorized and built, in the existing
  // My Science order.
  readonly items: ReadonlyArray<T>;
  // Every assignment id the card represents.
  readonly assignmentIdsOf: (item: T) => ReadonlyArray<string>;
  readonly units: ReadonlyArray<UnitProjectionEntry> | null | undefined;
  readonly supersededAssignmentIds?: ReadonlyArray<string> | null;
};

export type UnitGroup<T> = {
  // Position of the source entry in the server projection; distinguishes
  // two entries that share a unitId across class scopes.
  readonly projectionIndex: number;
  readonly unitId: string;
  readonly title: string;
  readonly color: string | null;
  readonly items: ReadonlyArray<T>;
};

export type UnitGroupingResult<T> =
  | { readonly kind: "flat"; readonly items: ReadonlyArray<T> }
  | {
      readonly kind: "grouped";
      readonly units: ReadonlyArray<UnitGroup<T>>;
      readonly other: {
        readonly label: typeof OTHER_ASSIGNED_WORK_LABEL;
        readonly items: ReadonlyArray<T>;
      };
    };

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

function isUsableEntry(entry: unknown): entry is UnitProjectionEntry {
  if (entry === null || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return (
    isNonEmptyString(e.unitId) &&
    isNonEmptyString(e.title) &&
    Array.isArray(e.assignmentIds)
  );
}

function flat<T>(items: ReadonlyArray<T>): UnitGroupingResult<T> {
  return Object.freeze({ kind: "flat" as const, items: Object.freeze([...items]) });
}

export function groupWorkItemsByUnit<T>(
  input: UnitGroupingInput<T>,
): UnitGroupingResult<T> {
  const { items, assignmentIdsOf, units } = input;
  if (!Array.isArray(units) || units.length === 0 || items.length === 0) {
    return flat(items);
  }
  const superseded = new Set(
    Array.isArray(input.supersededAssignmentIds)
      ? input.supersededAssignmentIds.filter(isNonEmptyString)
      : [],
  );

  // Assignment id -> index of the first card that represents it.
  const cardIndexById = new Map<string, number>();
  items.forEach((item, index) => {
    const ids = assignmentIdsOf(item);
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (!isNonEmptyString(id) || superseded.has(id)) continue;
      if (!cardIndexById.has(id)) cardIndexById.set(id, index);
    }
  });

  const placed = new Set<number>();
  const groups: UnitGroup<T>[] = [];
  units.forEach((entry, projectionIndex) => {
    if (!isUsableEntry(entry)) return;
    const members: T[] = [];
    for (const id of entry.assignmentIds) {
      if (!isNonEmptyString(id) || superseded.has(id)) continue;
      const index = cardIndexById.get(id);
      if (index === undefined || placed.has(index)) continue;
      placed.add(index);
      members.push(items[index] as T);
    }
    if (members.length === 0) return;
    groups.push(
      Object.freeze({
        projectionIndex,
        unitId: entry.unitId,
        title: entry.title,
        color: isNonEmptyString(entry.color) ? entry.color : null,
        items: Object.freeze(members),
      }),
    );
  });

  if (groups.length === 0) return flat(items);
  const other = items.filter((_, index) => !placed.has(index));
  return Object.freeze({
    kind: "grouped" as const,
    units: Object.freeze(groups),
    other: Object.freeze({
      label: OTHER_ASSIGNED_WORK_LABEL,
      items: Object.freeze(other),
    }),
  });
}
