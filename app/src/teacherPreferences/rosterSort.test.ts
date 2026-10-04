/**
 * @jest-environment jsdom
 *
 * Sprint 30 roster polish: the teacher's roster sort preference. Shared name
 * keys, both orders, the compact Sort control, and the per-teacher,
 * same-browser persistence seam.
 */
import {
  compareRosterNames,
  createRosterSortControl,
  DEFAULT_ROSTER_SORT_ORDER,
  formatRosterName,
  rosterNameSortKey,
  sortRosterStudents,
} from "./rosterSort";
import {
  clearAllStoredRosterSort,
  createRosterSortPreference,
  readRosterSortOrder,
  writeRosterSortOrder,
} from "./rosterSortStorage";

const s = (studentId: string, studentDisplayName: string) => ({ studentId, studentDisplayName });
const names = (rows: ReadonlyArray<{ studentDisplayName: string }>) =>
  rows.map((r) => r.studentDisplayName);

beforeEach(() => {
  clearAllStoredRosterSort();
  localStorage.clear();
});

describe("rosterNameSortKey", () => {
  test("splits on the final word; hyphenated surnames stay whole; whitespace is ignored", () => {
    expect(rosterNameSortKey("Cher")).toEqual({ unnamed: false, last: "Cher", first: "" });
    expect(rosterNameSortKey("  Mary Kate   Smith-Jones ")).toEqual({
      unnamed: false,
      last: "Smith-Jones",
      first: "Mary Kate",
    });
  });

  test("blank and the server's unavailable fallback are unnamed", () => {
    expect(rosterNameSortKey("Name unavailable").unnamed).toBe(true);
    expect(rosterNameSortKey("   ").unnamed).toBe(true);
  });
});

describe("Last name (A-Z)", () => {
  const order = "lastName" as const;

  test("is the default", () => {
    expect(DEFAULT_ROSTER_SORT_ORDER).toBe("lastName");
  });

  test("last name first, then first name; names are not rewritten", () => {
    const sorted = sortRosterStudents(
      [s("1", "Zoe Adams"), s("2", "Adrianna Blumberg"), s("3", "Aaron Carter"), s("4", "Ben Adams")],
      order,
    );
    expect(names(sorted)).toEqual(["Ben Adams", "Zoe Adams", "Adrianna Blumberg", "Aaron Carter"]);
  });

  test("single-word, hyphenated, and unavailable names are safe and deterministic", () => {
    expect(
      names(
        sortRosterStudents(
          [s("u", "Name unavailable"), s("d", "Dana Smith-Jones"), s("c", "Cher"), s("a", "Al Smith")],
          order,
        ),
      ),
    ).toEqual(["Cher", "Al Smith", "Dana Smith-Jones", "Name unavailable"]);
  });

  test("duplicate full names fall back to studentId; case-insensitive and input-order independent", () => {
    const rows = [s("s-2", "Sam Lee"), s("s-1", "Sam Lee"), s("x", "amy LEE")];
    const forward = sortRosterStudents(rows, order).map((r) => r.studentId);
    const reverse = sortRosterStudents([...rows].reverse(), order).map((r) => r.studentId);
    expect(forward).toEqual(["x", "s-1", "s-2"]);
    expect(reverse).toEqual(forward);
  });
});

describe("First name (A-Z)", () => {
  const order = "firstName" as const;

  test("first name first, then last name", () => {
    const sorted = sortRosterStudents(
      [s("1", "Zoe Adams"), s("2", "Adrianna Blumberg"), s("3", "Ben Adams"), s("4", "Adrianna Abbott")],
      order,
    );
    expect(names(sorted)).toEqual(["Adrianna Abbott", "Adrianna Blumberg", "Ben Adams", "Zoe Adams"]);
  });

  test("single-word names sort by that word; unavailable sorts last", () => {
    expect(
      names(sortRosterStudents([s("u", "Name unavailable"), s("b", "Bea Zed"), s("c", "Cher"), s("a", "Al Smith")], order)),
    ).toEqual(["Al Smith", "Bea Zed", "Cher", "Name unavailable"]);
  });

  test("duplicate full names fall back to studentId", () => {
    expect(sortRosterStudents([s("s-2", "Sam Lee"), s("s-1", "Sam Lee")], order).map((r) => r.studentId)).toEqual([
      "s-1",
      "s-2",
    ]);
  });

  test("the comparator never reorders equal keys nondeterministically", () => {
    const cmp = compareRosterNames(order);
    expect(cmp(s("a", "Sam Lee"), s("a", "Sam Lee"))).toBe(0);
  });
});

describe("formatRosterName (roster-row presentation only)", () => {
  test("Last name mode shows Last, First; First name mode shows the name as resolved", () => {
    expect(formatRosterName("Christopher Brown", "lastName")).toBe("Brown, Christopher");
    expect(formatRosterName("Adrianna Blumberg", "lastName")).toBe("Blumberg, Adrianna");
    expect(formatRosterName("Christopher Brown", "firstName")).toBe("Christopher Brown");
  });

  test("hyphenated surname stays whole; multi-word first portion is kept together; whitespace collapsed", () => {
    expect(formatRosterName("Dana Smith-Jones", "lastName")).toBe("Smith-Jones, Dana");
    expect(formatRosterName("  Mary Kate   Smith ", "lastName")).toBe("Smith, Mary Kate");
  });

  test("one-word names and Name unavailable are unchanged in both modes; never a malformed comma", () => {
    for (const order of ["lastName", "firstName"] as const) {
      expect(formatRosterName("Cher", order)).toBe("Cher");
      expect(formatRosterName("Name unavailable", order)).toBe("Name unavailable");
    }
    for (const name of ["Cher", " Cher ", "Name unavailable", "A B", "Christopher Brown"]) {
      expect(formatRosterName(name, "lastName")).not.toMatch(/^,|,\s*$|,\s*,/);
    }
  });
});

describe("createRosterSortControl", () => {
  test("labeled native select showing the current choice; change reports the new order", () => {
    const changes: string[] = [];
    const control = createRosterSortControl(document, "roster", "firstName", (o) => changes.push(o));
    document.body.appendChild(control);
    const select = control.querySelector("select")!;
    const label = control.querySelector("label")!;
    expect(label.textContent).toBe("Sort");
    expect(label.htmlFor).toBe(select.id);
    expect(select.getAttribute("aria-label")).toBe("Sort students by");
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ["lastName", "Last name (A-Z)"],
      ["firstName", "First name (A-Z)"],
    ]);
    expect(select.value).toBe("firstName");
    select.value = "lastName";
    select.dispatchEvent(new Event("change"));
    expect(changes).toEqual(["lastName"]);
  });
});

describe("rosterSortStorage (per teacher, same browser)", () => {
  test("no saved preference reads Last name", () => {
    expect(readRosterSortOrder("t1")).toBe("lastName");
  });

  test("a saved choice survives a reload (fresh module state) and is per teacher", () => {
    writeRosterSortOrder("t1", "firstName");
    expect(localStorage.getItem("lyfelabz.roster.sort.t1")).toBe("firstName");
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require("./rosterSortStorage") as {
        readRosterSortOrder: typeof readRosterSortOrder;
      };
      expect(fresh.readRosterSortOrder("t1")).toBe("firstName");
      expect(fresh.readRosterSortOrder("t2")).toBe("lastName");
    });
  });

  test("a corrupt stored value reads as the default", () => {
    localStorage.setItem("lyfelabz.roster.sort.t1", "score");
    expect(readRosterSortOrder("t1")).toBe("lastName");
  });

  test("blocked storage still keeps the choice for this page session", () => {
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const pref = createRosterSortPreference("t1");
    expect(() => pref.write("firstName")).not.toThrow();
    expect(pref.read()).toBe("firstName");
    spy.mockRestore();
  });

  test("switching back to Last name persists too", () => {
    const pref = createRosterSortPreference("t1");
    pref.write("firstName");
    pref.write("lastName");
    expect(localStorage.getItem("lyfelabz.roster.sort.t1")).toBe("lastName");
    expect(pref.read()).toBe("lastName");
  });
});
