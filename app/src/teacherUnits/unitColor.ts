// Teacher-selected unit color: client mirror of the server's closed palette
// (platform/functions/src/shared/types/teacher-unit.ts TEACHER_UNIT_COLORS).
// A curated, accessible set, never a free-form color. A unit without a color
// (null) shows the neutral default. Presentation only: color never changes
// membership, ordering, ownership, archive state, or assignments, and it is
// never the only indicator of a unit (the unit title is always shown).

export type TeacherUnitColor =
  | "teal"
  | "blue"
  | "purple"
  | "green"
  | "gold"
  | "coral"
  | "slate";

export const TEACHER_UNIT_COLORS: ReadonlyArray<TeacherUnitColor> = Object.freeze([
  "teal",
  "blue",
  "purple",
  "green",
  "gold",
  "coral",
  "slate",
]);

export const TEACHER_UNIT_COLOR_LABELS: Readonly<Record<TeacherUnitColor, string>> = Object.freeze({
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  green: "Green",
  gold: "Gold",
  coral: "Coral",
  slate: "Slate",
});

export function isTeacherUnitColor(value: unknown): value is TeacherUnitColor {
  return typeof value === "string" && (TEACHER_UNIT_COLORS as ReadonlyArray<string>).includes(value);
}

// The `data-unit-color` value a surface styles from; "none" is neutral.
export function unitColorKey(color: TeacherUnitColor | null): TeacherUnitColor | "none" {
  return color ?? "none";
}
