import { PlatformError } from "../errors/platform-error";
import type { ClassRecord } from "../types/class";
import {
  __classifyForTests,
  assertClassSupports,
  type ClassOperation,
} from "./eligibility";

// Unit coverage for the shared class-lifecycle eligibility helper per
// Phase 2B.1 test inventory §9 test 1. Every (operation, status) cell
// is asserted directly against the rule table, then the throwing
// surface is re-asserted end-to-end for one representative refusal per
// operation. The helper never calls Firestore, so no mocks are needed.

function fixture(status: "active" | "archived" | "needsSetup"): ClassRecord {
  const common = {
    teacherId: "t",
    schoolId: "s",
    title: "Title",
    createdAt: {} as never,
  } as const;
  if (status === "needsSetup") {
    return { ...common, status };
  }
  return {
    ...common,
    status,
    grade: "7",
    block: "A",
    joinCode: "ABCD1234",
  };
}

type Statuses = ReadonlyArray<"active" | "needsSetup" | "archived">;
const ALL_STATUSES: Statuses = ["active", "needsSetup", "archived"] as const;

type OpExpectation = {
  readonly op: ClassOperation;
  readonly ok: ReadonlyArray<"active" | "needsSetup" | "archived">;
  readonly refusalCode: string;
};

const OP_TABLE: ReadonlyArray<OpExpectation> = [
  { op: "activate", ok: ["active", "needsSetup"], refusalCode: "classes.notActivatable" },
  { op: "editMetadata", ok: ["active"], refusalCode: "classes.invalidStatus" },
  { op: "archive", ok: ["active", "needsSetup", "archived"], refusalCode: "unreachable" },
  { op: "assignDraft", ok: ["active"], refusalCode: "assignments.invalidClassStatus" },
  { op: "teacherAddEnrollment", ok: ["active"], refusalCode: "enrollments.invalidClassStatus" },
  { op: "studentJoin", ok: ["active"], refusalCode: "enrollments.joinCodeNotFound" },
  { op: "rosterSync", ok: ["active"], refusalCode: "lms.classNotActive" },
  { op: "lmsLink", ok: ["active", "needsSetup"], refusalCode: "lms.classNotActive" },
];

describe("assertClassSupports rule table", () => {
  for (const row of OP_TABLE) {
    for (const status of ALL_STATUSES) {
      const permitted = row.ok.includes(status);
      const label = `${row.op} ${permitted ? "permits" : "refuses"} ${status}`;
      it(label, () => {
        const verdict = __classifyForTests(row.op, status);
        if (permitted) {
          expect(verdict.ok).toBe(true);
        } else {
          expect(verdict.ok).toBe(false);
          if (!verdict.ok) {
            expect(verdict.code).toBe(row.refusalCode);
          }
        }
      });
    }
  }
});

describe("assertClassSupports throwing surface", () => {
  for (const row of OP_TABLE) {
    if (row.ok.length === 3) continue;
    it(`${row.op} throws PlatformError with the historical code on refusal`, () => {
      const refusalStatus = ALL_STATUSES.find((s) => !row.ok.includes(s));
      if (!refusalStatus) throw new Error("expected a refusal status");
      const record = fixture(refusalStatus);
      let caught: unknown = null;
      try {
        assertClassSupports(row.op, record);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PlatformError);
      expect((caught as PlatformError).code).toBe(row.refusalCode);
    });
  }

  it("archive is idempotent across every status", () => {
    for (const status of ALL_STATUSES) {
      expect(() => assertClassSupports("archive", fixture(status))).not.toThrow();
    }
  });
});
