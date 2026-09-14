// Sprint 30A.1 Class Settings V1 - closed class-color token vocabulary.
//
// Mirrors, but does not import from, the canonical `ClassColorToken`
// defined in platform/functions/src/shared/types/teacher-preferences.ts -
// the same pattern already used for `TeacherDefaultGrade`
// (app/src/teacherPreferences/types.ts). A curated LyfeLabz palette, not
// a free-form hex picker: the closed set here is exactly what the
// `teacherClassColorUpdate` callable accepts, so the client can never
// construct a request the server would reject for an unknown color.

export type ClassColorToken =
  | "blue"
  | "teal"
  | "green"
  | "purple"
  | "orange"
  | "rose"
  | "slate";

export const CLASS_COLOR_TOKENS: readonly ClassColorToken[] = Object.freeze([
  "blue",
  "teal",
  "green",
  "purple",
  "orange",
  "rose",
  "slate",
]);

export const isClassColorToken = (value: unknown): value is ClassColorToken =>
  typeof value === "string" &&
  (CLASS_COLOR_TOKENS as readonly string[]).includes(value);

// Teacher-facing label for each token, used only in the Class Settings
// color picker's accessible names (e.g. "Color: Teal").
export const CLASS_COLOR_LABELS: Readonly<Record<ClassColorToken, string>> =
  Object.freeze({
    blue: "Blue",
    teal: "Teal",
    green: "Green",
    purple: "Purple",
    orange: "Orange",
    rose: "Rose",
    slate: "Slate",
  });
