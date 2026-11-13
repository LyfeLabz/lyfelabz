// Teacher Units P2A: pure grouping engine tests.

import {
  OTHER_ASSIGNED_WORK_LABEL,
  groupWorkItemsByUnit,
  type UnitGroupingResult,
  type UnitProjectionEntry,
} from "./unitGrouping";

// A card shaped like the internal My Science work item, carrying its
// represented ids plus fields that must survive untouched.
type Card = {
  readonly assignmentId: string;
  readonly ids: ReadonlyArray<string>;
  readonly lessonSlug: string | null;
  readonly title: string;
  readonly launchPlan: { readonly url: string } | null;
};

const card = (id: string, extra: ReadonlyArray<string> = [], over: Partial<Card> = {}): Card => ({
  assignmentId: id,
  ids: [id, ...extra],
  lessonSlug: `slug-${id}`,
  title: `Title ${id}`,
  launchPlan: { url: `/lessons/${id}` },
  ...over,
});

const unit = (
  unitId: string,
  assignmentIds: ReadonlyArray<string>,
  over: Partial<UnitProjectionEntry> = {},
): UnitProjectionEntry => ({ unitId, title: `Unit ${unitId}`, color: "teal", assignmentIds, ...over });

const run = (
  items: ReadonlyArray<Card>,
  units: unknown,
  superseded?: ReadonlyArray<string>,
): UnitGroupingResult<Card> =>
  groupWorkItemsByUnit<Card>({
    items,
    assignmentIdsOf: (c) => c.ids,
    units: units as ReadonlyArray<UnitProjectionEntry>,
    supersededAssignmentIds: superseded,
  });

const grouped = (r: UnitGroupingResult<Card>) => {
  if (r.kind !== "grouped") throw new Error(`expected grouped, got ${r.kind}`);
  return r;
};
const idsIn = (items: ReadonlyArray<Card>) => items.map((c) => c.assignmentId);

describe("groupWorkItemsByUnit", () => {
  const a = card("a");
  const b = card("b");
  const c = card("c");
  const d = card("d");

  test("no units: flat fallback in existing order", () => {
    for (const units of [undefined, null, []]) {
      const r = run([a, b], units);
      expect(r.kind).toBe("flat");
      expect(r.kind === "flat" && r.items).toEqual([a, b]);
    }
  });

  test("malformed projection: flat fallback, never throws", () => {
    for (const units of ["x", 7, { unitId: "u" }, [null, "x", { unitId: "u" }, { unitId: "u", title: "T", assignmentIds: "a" }]]) {
      const r = run([a, b], units);
      expect(r.kind).toBe("flat");
    }
  });

  test("one populated unit with remaining work under Other assigned work", () => {
    const r = grouped(run([a, b, c], [unit("u1", ["b"])]));
    expect(r.units).toHaveLength(1);
    expect(r.units[0]).toMatchObject({ unitId: "u1", title: "Unit u1", color: "teal", projectionIndex: 0 });
    expect(idsIn(r.units[0].items)).toEqual(["b"]);
    expect(r.other.label).toBe(OTHER_ASSIGNED_WORK_LABEL);
    expect(r.other.label).toBe("Other assigned work");
    expect(idsIn(r.other.items)).toEqual(["a", "c"]);
  });

  test("multiple units keep server unit order and teacher assignment order", () => {
    const r = grouped(run([a, b, c, d], [unit("u2", ["d", "a"]), unit("u1", ["c", "b"])]));
    expect(r.units.map((u) => u.unitId)).toEqual(["u2", "u1"]);
    expect(idsIn(r.units[0].items)).toEqual(["d", "a"]);
    expect(idsIn(r.units[1].items)).toEqual(["c", "b"]);
    expect(r.other.items).toEqual([]);
  });

  test("ungrouped work keeps the existing flat order", () => {
    const r = grouped(run([d, c, b, a], [unit("u1", ["c"])]));
    expect(idsIn(r.other.items)).toEqual(["d", "b", "a"]);
  });

  test("empty unit and unit with only unknown ids are omitted", () => {
    const r = grouped(run([a, b], [unit("empty", []), unit("ghost", ["zzz"]), unit("u1", ["a", "nope"])]));
    expect(r.units.map((u) => u.unitId)).toEqual(["u1"]);
    expect(r.units[0].projectionIndex).toBe(2);
    expect(idsIn(r.units[0].items)).toEqual(["a"]);
  });

  test("all assignments ungrouped (no matches): flat fallback signal", () => {
    const r = run([a, b], [unit("u1", ["x", "y"]), unit("u2", [])]);
    expect(r.kind).toBe("flat");
    expect(r.kind === "flat" && r.items).toEqual([a, b]);
  });

  test("duplicate ids within a unit place the card once at its first position", () => {
    const r = grouped(run([a, b], [unit("u1", ["b", "a", "b", "a"])]));
    expect(idsIn(r.units[0].items)).toEqual(["b", "a"]);
  });

  test("duplicate ids across units: first eligible unit wins", () => {
    const r = grouped(run([a, b], [unit("u1", ["a"]), unit("u2", ["a", "b"])]));
    expect(idsIn(r.units[0].items)).toEqual(["a"]);
    expect(idsIn(r.units[1].items)).toEqual(["b"]);
  });

  test("a later unit whose ids were all claimed earlier is omitted", () => {
    const r = grouped(run([a], [unit("u1", ["a"]), unit("u2", ["a"])]));
    expect(r.units.map((u) => u.unitId)).toEqual(["u1"]);
  });

  test("superseded ids are never used for placement", () => {
    // `cur` represents itself plus superseded `old`; a unit listing only the
    // superseded id must not place the card.
    const cur = card("cur", ["old"]);
    const r = run([cur, a], [unit("u1", ["old"])], ["old"]);
    expect(r.kind).toBe("flat");
    const r2 = grouped(run([cur, a], [unit("u1", ["old", "cur"])], ["old"]));
    expect(r2.units[0].items).toEqual([cur]);
  });

  test("history-only group card is located by any of its ids and placed once", () => {
    const hist = card("h1", ["h2", "h3"], { title: "Assignment no longer listed", lessonSlug: null, launchPlan: null });
    const r = grouped(run([a, hist], [unit("u1", ["h2", "h1", "h3", "a"])]));
    expect(r.units[0].items).toEqual([hist, a]);
    expect(r.other.items).toEqual([]);
  });

  test("items representing multiple assignment ids (Current + related) are placed by the Current id", () => {
    const cur = card("cur", ["rel-1", "rel-2"]);
    const r = grouped(run([cur, b], [unit("u1", ["cur"])]));
    expect(r.units[0].items).toEqual([cur]);
  });

  test("orphan assignment cards (no unit reference) go to Other assigned work", () => {
    const orphan = card("gone", [], { title: "Assignment no longer listed", lessonSlug: null, launchPlan: null });
    const r = grouped(run([a, orphan], [unit("u1", ["a"])]));
    expect(r.other.items).toEqual([orphan]);
  });

  test("same unitId in two class scopes stays as two distinct groups", () => {
    const r = grouped(run([a, b], [unit("shared", ["a"]), unit("shared", ["b"])]));
    expect(r.units).toHaveLength(2);
    expect(r.units.map((u) => [u.unitId, u.projectionIndex])).toEqual([["shared", 0], ["shared", 1]]);
    expect(idsIn(r.units[0].items)).toEqual(["a"]);
    expect(idsIn(r.units[1].items)).toEqual(["b"]);
  });

  test("membership uses ids only, never titles or slugs", () => {
    const r = run([a], [unit("u1", ["slug-a", "Title a"], { title: "Title a" })]);
    expect(r.kind).toBe("flat");
  });

  test("invalid color falls back to null; no extra metadata is exposed", () => {
    const raw = { ...unit("u1", ["a"]), color: 5, description: "private" };
    const r = grouped(run([a], [raw]));
    expect(r.units[0].color).toBeNull();
    expect(Object.keys(r.units[0]).sort()).toEqual(["color", "items", "projectionIndex", "title", "unitId"]);
  });

  test("invalid ids inside a unit are ignored", () => {
    const r = grouped(run([a], [unit("u1", ["", null, 3, "a"] as unknown as string[])]));
    expect(r.units[0].items).toEqual([a]);
  });

  test("preserves original object identity and does not mutate inputs", () => {
    const items = Object.freeze([a, b, c]);
    const units = Object.freeze([Object.freeze(unit("u1", Object.freeze(["c", "a"])))]);
    const superseded = Object.freeze(["x"]);
    const snapshot = JSON.stringify({ items, units, superseded });
    const r = grouped(
      groupWorkItemsByUnit<Card>({ items, assignmentIdsOf: (x) => x.ids, units, supersededAssignmentIds: superseded }),
    );
    expect(r.units[0].items[0]).toBe(c);
    expect(r.units[0].items[1]).toBe(a);
    expect(r.other.items[0]).toBe(b);
    expect(r.units[0].items[0].launchPlan).toBe(c.launchPlan);
    expect(JSON.stringify({ items, units, superseded })).toBe(snapshot);
  });

  test("flat fallback returns the original objects in order", () => {
    const r = run([b, a], []);
    expect(r.kind === "flat" && r.items[0]).toBe(b);
    expect(r.kind === "flat" && r.items[1]).toBe(a);
  });

  test("no items: flat fallback", () => {
    expect(run([], [unit("u1", ["a"])]).kind).toBe("flat");
  });
});
