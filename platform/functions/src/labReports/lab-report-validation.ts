import { PlatformError } from "../shared";
import { LAB_REPORT_FORMAT_VERSION } from "../shared/types/student-lab-report";

// Structural validation for the Lab Report Assistant report payload. The
// browser tool (`assets/lab-report-assistant.js`) owns the report schema;
// this boundary does not duplicate its field list. It enforces the shape,
// types, key syntax, and size bounds that keep the record safe to store and
// small enough to stay well under the Firestore 1 MiB document limit.
//
// Error messages are static. They never echo student text, so a refused
// payload cannot leak report content into callable error logs.

export const LAB_REPORT_CHECK_SCHEMA = 2;
export const MAX_REPORT_BYTES = 256 * 1024;
export const MAX_RESPONSE_KEYS = 40;
export const MAX_RESPONSE_CHARS = 20_000;
export const MAX_CHECK_KEYS = 64;
export const MAX_SETTING_KEYS = 16;
export const MAX_TABLE_TITLE_CHARS = 300;
export const MAX_TABLE_CELL_CHARS = 1_000;
export const MIN_TABLE_ROWS = 2;
export const MAX_TABLE_ROWS = 10;
export const MIN_TABLE_COLUMNS = 2;
export const MAX_TABLE_COLUMNS = 6;

const RESPONSE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const CHECK_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,31}:[a-z][A-Za-z0-9]{0,31}$/;
const SECTION_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const SETTING_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,31}$/;
const REPORT_KEYS = new Set([
  "version",
  "checkSchema",
  "responses",
  "checks",
  "quantitativeTable",
  "activeSection",
  "settings",
]);

export type LabReportTable = {
  readonly title: string;
  readonly cells: readonly (readonly string[])[];
};

export type LabReportPayload = {
  readonly version: number;
  readonly checkSchema: number;
  readonly responses: Readonly<Record<string, string>>;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly quantitativeTable: LabReportTable | null;
  readonly activeSection: string;
  readonly settings: Readonly<Record<string, boolean>>;
};

function invalid(message: string): never {
  throw new PlatformError("labReports.invalidReport", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sortedRecord<T>(
  raw: unknown,
  label: string,
  maxKeys: number,
  keyPattern: RegExp,
  check: (value: unknown) => value is T,
): Record<string, T> {
  if (!isPlainObject(raw)) invalid(`report.${label} must be an object.`);
  const keys = Object.keys(raw);
  if (keys.length > maxKeys) invalid(`report.${label} has too many entries.`);
  const out: Record<string, T> = {};
  for (const key of keys.sort()) {
    if (!keyPattern.test(key)) invalid(`report.${label} has an invalid key.`);
    const value = raw[key];
    if (!check(value)) invalid(`report.${label} has an invalid value.`);
    out[key] = value;
  }
  return out;
}

const isResponse = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_RESPONSE_CHARS;
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

function normalizeTable(raw: unknown): LabReportTable | null {
  if (raw === null || raw === undefined) return null;
  if (!isPlainObject(raw)) invalid("report.quantitativeTable must be an object or null.");
  for (const key of Object.keys(raw)) {
    if (key !== "title" && key !== "cells") invalid("report.quantitativeTable has an unexpected key.");
  }
  const title = raw.title ?? "";
  if (typeof title !== "string" || title.length > MAX_TABLE_TITLE_CHARS) {
    invalid("report.quantitativeTable.title is invalid.");
  }
  const cells = raw.cells;
  if (!Array.isArray(cells) || cells.length < MIN_TABLE_ROWS || cells.length > MAX_TABLE_ROWS) {
    invalid("report.quantitativeTable.cells has an invalid row count.");
  }
  const first: unknown = cells[0];
  if (!Array.isArray(first) || first.length < MIN_TABLE_COLUMNS || first.length > MAX_TABLE_COLUMNS) {
    invalid("report.quantitativeTable.cells has an invalid column count.");
  }
  const columns = first.length;
  const rows = cells.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== columns) {
      invalid("report.quantitativeTable.cells rows must have equal length.");
    }
    return row.map((cell: unknown) => {
      if (typeof cell !== "string" || cell.length > MAX_TABLE_CELL_CHARS) {
        invalid("report.quantitativeTable.cells has an invalid cell.");
      }
      return cell;
    });
  });
  return { title, cells: rows };
}

// Validates and returns the report with a canonical key order so the
// serialized form is deterministic (equal reports serialize identically).
export function normalizeLabReport(raw: unknown): LabReportPayload {
  if (!isPlainObject(raw)) invalid("report must be an object.");
  for (const key of Object.keys(raw)) {
    if (!REPORT_KEYS.has(key)) invalid("report has an unexpected key.");
  }
  if (raw.version !== LAB_REPORT_FORMAT_VERSION) {
    throw new PlatformError(
      "labReports.unsupportedVersion",
      "report.version is not supported.",
    );
  }
  if (raw.checkSchema !== LAB_REPORT_CHECK_SCHEMA) invalid("report.checkSchema is not supported.");
  const activeSection = raw.activeSection ?? "question";
  if (typeof activeSection !== "string" || !SECTION_PATTERN.test(activeSection)) {
    invalid("report.activeSection is invalid.");
  }
  return {
    version: LAB_REPORT_FORMAT_VERSION,
    checkSchema: LAB_REPORT_CHECK_SCHEMA,
    responses: sortedRecord(raw.responses ?? {}, "responses", MAX_RESPONSE_KEYS, RESPONSE_KEY_PATTERN, isResponse),
    checks: sortedRecord(raw.checks ?? {}, "checks", MAX_CHECK_KEYS, CHECK_KEY_PATTERN, isBoolean),
    quantitativeTable: normalizeTable(raw.quantitativeTable),
    activeSection,
    settings: sortedRecord(raw.settings ?? {}, "settings", MAX_SETTING_KEYS, SETTING_KEY_PATTERN, isBoolean),
  };
}

export function serializeLabReport(report: LabReportPayload): {
  readonly json: string;
  readonly bytes: number;
} {
  const json = JSON.stringify(report);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > MAX_REPORT_BYTES) {
    throw new PlatformError(
      "labReports.reportTooLarge",
      `report exceeds the ${MAX_REPORT_BYTES}-byte limit.`,
    );
  }
  return { json, bytes };
}

// A report with no student writing and no table content. Self-checks,
// display settings, and the open section are not student work.
export function isBlankLabReport(report: LabReportPayload): boolean {
  if (Object.values(report.responses).some((value) => value.trim().length > 0)) return false;
  const table = report.quantitativeTable;
  if (table === null) return true;
  if (table.title.trim().length > 0) return false;
  return table.cells.every((row) => row.every((cell) => cell.trim().length === 0));
}
