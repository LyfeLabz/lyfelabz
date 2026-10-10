import manifest from "./unit-placeable-resources.json";

// U1B - authoritative server-side placement allowlist for teacher units.
//
// Functions cannot import the client curriculum bundle, so the server
// holds a generated copy of exactly one RA-1 field: the canonical ids whose
// `unitPlaceable` is true in `getFlatResources()`
// (app/src/curriculum/resourceProjection.ts). It is not a second registry:
// it carries no resource data, and RA-1 stays the single derivation of
// placement eligibility.
//
// Drift prevention: the required gate scripts/unit-placement/check-parity.cjs
// compares this file to the real RA-1 projection, order included, and
// fails closed on any difference. It runs as this package's `prebuild`
// (every build and every Functions deploy predeploy), in the Hosting pair
// build (every Hosting deploy), and in Platform CI. It proves source-tree
// parity only, not deployed-artifact parity. Functions must be redeployed
// for a regenerated list to take effect. See docs/platform/TEACHER_UNITS.md
// section 9.3.

type UnitPlaceableManifest = {
  readonly description: string;
  readonly resourceIds: readonly string[];
};

function loadPlaceableIds(source: UnitPlaceableManifest): ReadonlySet<string> {
  const ids = source.resourceIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("unit-placeable-resources.json must list at least one resource id.");
  }
  const set = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0 || set.has(id)) {
      throw new Error(`unit-placeable-resources.json has an invalid or duplicate id: ${String(id)}.`);
    }
    set.add(id);
  }
  return set;
}

const UNIT_PLACEABLE_RESOURCE_IDS: ReadonlySet<string> = loadPlaceableIds(manifest);

// Canonical ids, in RA-1 registry order. Test and documentation use only.
export const UNIT_PLACEABLE_RESOURCE_ID_LIST: readonly string[] = Object.freeze([
  ...UNIT_PLACEABLE_RESOURCE_IDS,
]);

export function isUnitPlaceableResourceId(value: unknown): value is string {
  return typeof value === "string" && UNIT_PLACEABLE_RESOURCE_IDS.has(value);
}
