import { getFlatResourceById, getFlatResources } from "../../curriculum/resourceProjection";

// Milestone 2A: the Curriculum resource selection a teacher builds before
// adding resources to one of their units (TEACHER_UNITS.md "Milestone 2A").
//
// Identity. Entries are RA-1 canonical resource ids (`FlatResource.id`: a
// lesson's slug, or "<type>-<stem>" for other unit-owned resources), the same
// ids a unit's `resourceIds` holds. Only `unitPlaceable` ids are accepted, so
// the selection can never name a resource a unit would refuse.
//
// Lifetime. Memory only, never browser storage. The selection belongs to one
// teacher and one Teacher Units seam. The app builds a new seam for every
// bootstrap run (sign-in, sign-out, account switch, school change), so a new
// run starts with an empty selection; a reload starts empty too. Within one
// run it survives Curriculum tab, grade, and topic changes and leaving and
// returning to Curriculum.
//
// It is DOM-free and holds no unit state: adding to a unit goes through the
// units controller, and the selection is cleared only by the teacher (Clear
// Selection) or after a confirmed addition.

export type CurriculumSelection = {
  readonly has: (id: string) => boolean;
  // Adds or removes one id. Ids that are not unit-placeable are ignored.
  readonly set: (id: string, selected: boolean) => void;
  readonly clear: () => void;
  readonly size: () => number;
  // Every selected id, in canonical registry order (the order a unit
  // receives them in), independent of the order they were chosen.
  readonly ids: () => ReadonlyArray<string>;
  readonly subscribe: (listener: () => void) => () => void;
};

let registryOrder: ReadonlyMap<string, number> | null = null;
function orderOf(id: string): number {
  if (registryOrder === null) {
    registryOrder = new Map(getFlatResources().map((r, i) => [r.id, i]));
  }
  return registryOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
}

// Whether a resource id can be selected (and so placed in a unit).
export function isSelectableResourceId(id: string): boolean {
  return getFlatResourceById(id)?.unitPlaceable === true;
}

export function createCurriculumSelection(): CurriculumSelection {
  const selected = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of Array.from(listeners)) l();
  };
  return Object.freeze({
    has: (id: string) => selected.has(id),
    set: (id: string, on: boolean) => {
      if (on) {
        if (selected.has(id) || !isSelectableResourceId(id)) return;
        selected.add(id);
      } else if (!selected.delete(id)) {
        return;
      }
      notify();
    },
    clear: () => {
      if (selected.size === 0) return;
      selected.clear();
      notify();
    },
    size: () => selected.size,
    ids: () => Object.freeze(Array.from(selected).sort((a, b) => orderOf(a) - orderOf(b))),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}

const bySeam = new WeakMap<object, { readonly uid: string; readonly selection: CurriculumSelection }>();

// The selection for this teacher under this seam, created on first use.
export function curriculumSelectionFor(seam: object, uid: string): CurriculumSelection {
  const held = bySeam.get(seam);
  if (held !== undefined && held.uid === uid) return held.selection;
  const selection = createCurriculumSelection();
  bySeam.set(seam, Object.freeze({ uid, selection }));
  return selection;
}
