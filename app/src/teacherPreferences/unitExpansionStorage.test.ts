/**
 * @jest-environment jsdom
 *
 * My Units expansion preference: units expand by default, each unit's
 * collapse is remembered per teacher and per browser, and unreadable or
 * blocked storage degrades to the default without throwing.
 */
import {
  _resetUnitExpansionSessionForTest,
  clearAllStoredUnitExpansion,
  isUnitExpanded,
  writeUnitExpanded,
} from "./unitExpansionStorage";

beforeEach(() => {
  localStorage.clear();
  clearAllStoredUnitExpansion();
});

test("a unit with no saved preference is expanded", () => {
  expect(isUnitExpanded("t1", "u1")).toBe(true);
});

test("each unit's state is independent and survives a reload", () => {
  writeUnitExpanded("t1", "u1", false);
  _resetUnitExpansionSessionForTest();
  expect(isUnitExpanded("t1", "u1")).toBe(false);
  expect(isUnitExpanded("t1", "u2")).toBe(true);
  writeUnitExpanded("t1", "u1", true);
  _resetUnitExpansionSessionForTest();
  expect(isUnitExpanded("t1", "u1")).toBe(true);
});

test("preferences are teacher-specific", () => {
  writeUnitExpanded("t1", "u1", false);
  expect(isUnitExpanded("t2", "u1")).toBe(true);
  expect(isUnitExpanded("t1", "u1")).toBe(false);
});

test("corrupt stored values read as no preference", () => {
  localStorage.setItem("lyfelabz.units.collapsed.t1", "{not json");
  expect(isUnitExpanded("t1", "u1")).toBe(true);
  _resetUnitExpansionSessionForTest();
  localStorage.setItem("lyfelabz.units.collapsed.t1", JSON.stringify({ u1: true }));
  expect(isUnitExpanded("t1", "u1")).toBe(true);
});

test("blocked storage keeps the choice in memory for the session", () => {
  const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceeded");
  });
  try {
    expect(() => writeUnitExpanded("t1", "u1", false)).not.toThrow();
    expect(isUnitExpanded("t1", "u1")).toBe(false);
  } finally {
    spy.mockRestore();
  }
});
