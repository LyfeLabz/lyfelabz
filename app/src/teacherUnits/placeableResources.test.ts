import * as fs from "fs";
import * as path from "path";

import { getFlatResources } from "../curriculum/resourceProjection";
import {
  filterPlaceableResources,
  getPlaceableResourceById,
  getPlaceableResources,
  resolveUnitResources,
  resourceEligibility,
} from "./placeableResources";

const SERVER_LIST = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../platform/functions/src/teacherUnits/unit-placeable-resources.json",
    ),
    "utf8",
  ),
) as { resourceIds: string[] };

describe("placeable resources adapter", () => {
  test("matches the certified 62-resource placeable set in canonical order", () => {
    const ids = getPlaceableResources().map((r) => r.id);
    expect(ids).toEqual(SERVER_LIST.resourceIds);
    expect(ids).toHaveLength(62);
    const byType: Record<string, number> = {};
    for (const r of getPlaceableResources()) byType[r.type] = (byType[r.type] ?? 0) + 1;
    expect(byType).toEqual({
      lesson: 49,
      investigation: 4,
      extension: 5,
      simulation: 3,
      challenge: 1,
    });
  });

  test("returns the RA-1 objects themselves, not copies", () => {
    const flat = new Set(getFlatResources());
    for (const r of getPlaceableResources()) expect(flat.has(r)).toBe(true);
  });

  test("excludes every non-placeable resource", () => {
    const excluded = getFlatResources().filter((r) => !r.unitPlaceable);
    expect(excluded.length).toBeGreaterThan(0);
    for (const r of excluded) expect(getPlaceableResourceById(r.id)).toBeNull();
    expect(getPlaceableResourceById("ragebaiting")).toBeNull();
    expect(getPlaceableResourceById("lab-report-assistant")).toBeNull();
    const types = new Set(getPlaceableResources().map((r) => r.type));
    for (const t of ["activity", "game", "map", "disease", "tool"]) expect(types.has(t as never)).toBe(false);
  });

  test("Gravity Wells is placeable but organize-only", () => {
    const gw = getPlaceableResourceById("simulation-gravity-wells");
    expect(gw).not.toBeNull();
    expect(gw?.capabilities.authenticatedAssignment).toBe(false);
    expect(resourceEligibility(gw!)).toBe("organizeOnly");
  });

  test("eligibility follows authenticatedAssignment exactly", () => {
    for (const r of getPlaceableResources()) {
      expect(resourceEligibility(r)).toBe(
        r.capabilities.authenticatedAssignment ? "assignable" : "organizeOnly",
      );
    }
    expect(resourceEligibility(getPlaceableResourceById("earths-layers")!)).toBe("assignable");
  });

  test("defaults to the unit grade", () => {
    const g7 = filterPlaceableResources({ unitGrade: "7" });
    expect(g7.length).toBeGreaterThan(0);
    expect(g7.every((r) => r.grade === "7")).toBe(true);
    expect(filterPlaceableResources({ unitGrade: "8" })).toEqual([]);
  });

  test("explicit cross-grade discovery returns every grade with grades unchanged", () => {
    const all = filterPlaceableResources({ unitGrade: "6", scope: "allGrades" });
    expect(all).toEqual(getPlaceableResources());
    expect(all.some((r) => r.grade === "7")).toBe(true);
    expect(filterPlaceableResources({ unitGrade: "8", scope: "allGrades" })).toHaveLength(62);
  });

  test("type, topic and search filters compose in canonical order", () => {
    const sims = filterPlaceableResources({ unitGrade: "6", scope: "allGrades", type: "simulation" });
    expect(sims).toHaveLength(3);
    const all = getPlaceableResources();
    expect(sims).toEqual(all.filter((r) => r.type === "simulation"));
    const topic = all[0]!.topic!;
    const byTopic = filterPlaceableResources({ unitGrade: "6", scope: "allGrades", topic });
    expect(byTopic.every((r) => r.topic === topic)).toBe(true);
    const hit = filterPlaceableResources({ unitGrade: "6", scope: "allGrades", search: "  GRAVITY " });
    expect(hit.map((r) => r.id)).toContain("simulation-gravity-wells");
  });

  test("resolveUnitResources keeps order and flags unavailable ids", () => {
    const res = resolveUnitResources(["earths-layers", "ragebaiting", "nope"]);
    expect(res.map((r) => [r.id, r.status])).toEqual([
      ["earths-layers", "available"],
      ["ragebaiting", "unavailable"],
      ["nope", "unavailable"],
    ]);
  });
});
