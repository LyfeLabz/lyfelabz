import {
  assertActivateWriteConsistent,
  isValidPresentationRevisionId,
  isValidVariantKey,
  presentationVariantIndexDocId,
  variantKeyForReadingLevel,
} from "./presentation-variant";

// F5.2 §3.5/§5.3 index contract (Slice 3). Pure identity/consistency checks.

const REV = `pr${"a".repeat(64)}`;
const SHA = "a".repeat(64);

describe("presentationVariantIndexDocId", () => {
  test("composes {lessonSlug}__{variantKey}", () => {
    expect(presentationVariantIndexDocId("earths-layers", "reading-adapted")).toBe(
      "earths-layers__reading-adapted",
    );
  });

  test("rejects a lessonSlug with an underscore (would make __ ambiguous, M3)", () => {
    expect(() => presentationVariantIndexDocId("earths_layers", "reading-adapted")).toThrow();
  });

  test("rejects a variantKey with an underscore", () => {
    expect(() => presentationVariantIndexDocId("earths-layers", "reading__adapted")).toThrow();
  });

  test("rejects path-traversal-ish slugs", () => {
    expect(() => presentationVariantIndexDocId("../etc", "reading-adapted")).toThrow();
  });
});

describe("variantKeyForReadingLevel", () => {
  test("derives reading-adapted from the adapted level (§3.2)", () => {
    expect(variantKeyForReadingLevel("adapted")).toBe("reading-adapted");
    expect(isValidVariantKey(variantKeyForReadingLevel("adapted"))).toBe(true);
  });
});

describe("isValidPresentationRevisionId", () => {
  test("accepts pr + 64 hex; rejects short/upper/non-hex", () => {
    expect(isValidPresentationRevisionId(REV)).toBe(true);
    expect(isValidPresentationRevisionId(`pr${"a".repeat(63)}`)).toBe(false);
    expect(isValidPresentationRevisionId(`pr${"A".repeat(64)}`)).toBe(false);
    expect(isValidPresentationRevisionId(SHA)).toBe(false);
  });
});

describe("assertActivateWriteConsistent", () => {
  const good = {
    lessonSlug: "earths-layers",
    variantKey: "reading-adapted",
    currentPresentationRevisionId: REV,
    currentPath: `app/lessons/variants/lesson_earths-layers__${REV}.html`,
    contentSha256: SHA,
  };

  test("accepts an internally consistent activate write", () => {
    expect(() => assertActivateWriteConsistent(good)).not.toThrow();
  });

  test("rejects a revision id that does not match the sha256", () => {
    expect(() =>
      assertActivateWriteConsistent({ ...good, currentPresentationRevisionId: `pr${"b".repeat(64)}` }),
    ).toThrow(/self-consistency/);
  });

  test("rejects a path that does not match the identity formula (M4)", () => {
    expect(() =>
      assertActivateWriteConsistent({ ...good, currentPath: "app/lessons/variants/reading-adapted.html" }),
    ).toThrow(/identity formula/);
  });

  test("rejects a path that leaks the variantKey", () => {
    expect(() =>
      assertActivateWriteConsistent({
        ...good,
        currentPath: `app/lessons/variants/lesson_earths-layers__reading-adapted__${REV}.html`,
      }),
    ).toThrow();
  });
});
