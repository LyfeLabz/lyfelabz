/**
 * Milestone 2A: the Curriculum resource selection model.
 */
import { getFlatResources } from "../../curriculum/resourceProjection";
import { createCurriculumSelection, curriculumSelectionFor, isSelectableResourceId } from "./curriculumSelection";

const placeable = getFlatResources().filter((r) => r.unitPlaceable);
const notPlaceable = getFlatResources().find((r) => !r.unitPlaceable);

describe("curriculum selection", () => {
  test("holds canonical ids and returns them in registry order, not selection order", () => {
    const s = createCurriculumSelection();
    const [a, b, c] = [placeable[0]!.id, placeable[3]!.id, placeable[7]!.id];
    s.set(c, true);
    s.set(a, true);
    s.set(b, true);
    expect(s.ids()).toEqual([a, b, c]);
    expect(s.size()).toBe(3);
  });

  test("ignores ids a unit would refuse and unknown ids", () => {
    const s = createCurriculumSelection();
    if (notPlaceable !== undefined) {
      expect(isSelectableResourceId(notPlaceable.id)).toBe(false);
      s.set(notPlaceable.id, true);
    }
    s.set("lesson-that-does-not-exist", true);
    expect(s.size()).toBe(0);
  });

  test("notifies only on real changes; clear empties it", () => {
    const s = createCurriculumSelection();
    const seen = jest.fn();
    const off = s.subscribe(seen);
    const id = placeable[0]!.id;
    s.set(id, true);
    s.set(id, true);
    s.set("unknown", false);
    expect(seen).toHaveBeenCalledTimes(1);
    s.clear();
    s.clear();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(s.has(id)).toBe(false);
    off();
    s.set(id, true);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  test("one selection per seam and teacher: a new seam (new bootstrap run) or another teacher starts empty", () => {
    const seamA = {};
    const id = placeable[0]!.id;
    curriculumSelectionFor(seamA, "teacherA").set(id, true);
    expect(curriculumSelectionFor(seamA, "teacherA").has(id)).toBe(true);
    expect(curriculumSelectionFor({}, "teacherA").size()).toBe(0);
    expect(curriculumSelectionFor(seamA, "teacherB").size()).toBe(0);
  });
});
