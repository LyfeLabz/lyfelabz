import { classTitleIncludesBlock, sharedStudentContextLabel, type SharedStudent } from "./types";
import { isSupportOnlyTeacher } from "../shell/supportWorkspace";

const student = (classTitle: string, classBlock: string | null): SharedStudent => ({
  grantId: "g",
  classId: "c",
  classTitle,
  studentId: "s",
  studentDisplayName: "Jordan Smith",
  ownerDisplayName: "Mr. Brown",
  classBlock,
});

describe("sharedStudentContextLabel", () => {
  test("teacher, class, and block", () => {
    expect(sharedStudentContextLabel(student("Science 7", "B"))).toBe("Mr. Brown · Science 7 · B Block");
  });

  test("no block when the record has none", () => {
    expect(sharedStudentContextLabel(student("Science 7", null))).toBe("Mr. Brown · Science 7");
    expect(sharedStudentContextLabel(student("Science 7", "  "))).toBe("Mr. Brown · Science 7");
  });

  test.each(["Science 7B", "Science 7 B", "Science B Block", "Block B Science", "(B) Science", "Science - block b"])(
    "suppresses a block already in the class name: %s",
    (title) => {
      expect(sharedStudentContextLabel(student(title, "B"))).toBe(`Mr. Brown · ${title}`);
    },
  );

  test("a stored block that already says Block is not doubled", () => {
    expect(sharedStudentContextLabel(student("Science 7", "Block B"))).toBe("Mr. Brown · Science 7 · B Block");
  });

  test("a block letter inside another word is not a match", () => {
    expect(classTitleIncludesBlock("Biology", "B")).toBe(false);
    expect(classTitleIncludesBlock("Science A", "B")).toBe(false);
  });
});

describe("isSupportOnlyTeacher", () => {
  test("only zero owned classes with at least one shared student", () => {
    expect(isSupportOnlyTeacher(0, 1)).toBe(true);
    expect(isSupportOnlyTeacher(0, 0)).toBe(false);
    expect(isSupportOnlyTeacher(1, 3)).toBe(false);
  });
});
