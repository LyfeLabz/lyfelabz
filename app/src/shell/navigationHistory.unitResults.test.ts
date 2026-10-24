import { hashForState, parseShellHash, parseShellHistoryState } from "./navigationHistory";

describe("Unit Results history state", () => {
  test("round-trips through the hash and the strict parser", () => {
    const state = { kind: "shell-unit-results", surface: "units", unitId: "AbCdEfGhIjKlMnOpQrSt", grade: "7" } as const;
    expect(hashForState(state)).toBe("#units/results/7/AbCdEfGhIjKlMnOpQrSt");
    expect(parseShellHash(hashForState(state))).toEqual(state);
    expect(parseShellHistoryState(state)).toEqual(state);
  });

  test.each([
    [{ kind: "shell-unit-results", surface: "units", unitId: "../x", grade: "7" }],
    [{ kind: "shell-unit-results", surface: "units", unitId: "AbCd", grade: "9" }],
    [{ kind: "shell-unit-results", surface: "curriculum", unitId: "AbCd", grade: "7" }],
  ])("fails closed for %p", (value) => {
    expect(parseShellHistoryState(value)).toBeNull();
  });

  test("a lesson Results origin is kept when valid and dropped (never guessed) when malformed", () => {
    expect(
      parseShellHistoryState({
        kind: "shell-lesson-summary",
        surface: "curriculum",
        lessonSlug: "photosynthesis",
        from: { unitId: "AbCd", grade: "7", view: "results" },
      }),
    ).toEqual({
      kind: "shell-lesson-summary",
      surface: "curriculum",
      lessonSlug: "photosynthesis",
      from: { unitId: "AbCd", grade: "7", view: "results" },
    });
    expect(
      parseShellHistoryState({
        kind: "shell-lesson-summary",
        surface: "curriculum",
        lessonSlug: "photosynthesis",
        from: { unitId: "AbCd", grade: "7", view: "elsewhere" },
      }),
    ).toEqual({ kind: "shell-lesson-summary", surface: "curriculum", lessonSlug: "photosynthesis" });
    expect(parseShellHash("#units/results/7/")).toBeNull();
  });
});
