// Sprint 30 roster polish: the teacher's roster sort preference - "how I
// prefer student names to be sorted" - shared by every Teacher Workspace
// student roster (Classes -> class -> Students, and an assignment's roster
// in Assignment Detail) so the two surfaces can never disagree.
//
// Pure and firebase-free. Persistence lives in `rosterSortStorage.ts`; this
// module only defines the choices, the comparator, the roster-row name
// presentation, and the compact control.
//
// The only authoritative student name is the single resolved roster display
// name (PDR-028); no structured first/last fields exist. Sort keys are
// derived from it for ORDERING and roster-row presentation only (see
// `formatRosterName`); the stored name is never rewritten:
//   - whitespace is trimmed and collapsed;
//   - last name = the final word ("Smith-Jones" stays whole); everything
//     before it is the first-name portion;
//   - a single-word name sorts by that word under either order;
//   - the server's "Name unavailable" fallback sorts after every named
//     student.
// Multi-word surnames and suffixes are knowingly not handled; that needs
// structured name fields.

export type RosterSortOrder = "lastName" | "firstName";

export const DEFAULT_ROSTER_SORT_ORDER: RosterSortOrder = "lastName";

export const ROSTER_SORT_OPTIONS: ReadonlyArray<{
  readonly value: RosterSortOrder;
  readonly label: string;
}> = Object.freeze([
  Object.freeze({ value: "lastName" as const, label: "Last name (A-Z)" }),
  Object.freeze({ value: "firstName" as const, label: "First name (A-Z)" }),
]);

export const isRosterSortOrder = (value: unknown): value is RosterSortOrder =>
  value === "lastName" || value === "firstName";

// Read/write seam for the persisted preference. A surface given no seam uses
// the default and keeps any change for its own lifetime only.
export type RosterSortPreference = {
  readonly read: () => RosterSortOrder;
  readonly write: (order: RosterSortOrder) => void;
};

const FALLBACK_DISPLAY_NAME = "Name unavailable";

export type RosterNameSortKey = {
  readonly unnamed: boolean;
  readonly last: string;
  readonly first: string;
};

export function rosterNameSortKey(displayName: string): RosterNameSortKey {
  const normalized = displayName.trim().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized === FALLBACK_DISPLAY_NAME) {
    return { unnamed: true, last: "", first: "" };
  }
  const words = normalized.split(" ");
  return {
    unnamed: false,
    last: words[words.length - 1] as string,
    first: words.slice(0, -1).join(" "),
  };
}

type NamedStudent = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

const compareText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

// Deterministic comparator for the chosen order. Last name: last, then
// first portion. First name: first portion (or the single word), then last.
// Both then fall through to the full display name and finally studentId.
export function compareRosterNames(
  order: RosterSortOrder,
): (a: NamedStudent, b: NamedStudent) => number {
  return (a, b) => {
    const ka = rosterNameSortKey(a.studentDisplayName);
    const kb = rosterNameSortKey(b.studentDisplayName);
    if (ka.unnamed !== kb.unnamed) return ka.unnamed ? 1 : -1;
    const primary =
      order === "firstName"
        ? compareText(ka.first || ka.last, kb.first || kb.last) ||
          compareText(ka.last, kb.last)
        : compareText(ka.last, kb.last) || compareText(ka.first, kb.first);
    if (primary !== 0) return primary;
    const byName = compareText(a.studentDisplayName, b.studentDisplayName);
    if (byName !== 0) return byName;
    return a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0;
  };
}

// How a roster ROW presents a name under the chosen order, so the list reads
// the way it is sorted: Last name mode shows "Brown, Christopher"; First name
// mode shows the name exactly as resolved. Presentation only - the stored
// display name is never changed, and Student Detail keeps the natural name.
// A one-word name and the "Name unavailable" fallback are shown unchanged in
// either mode, so no malformed comma output is possible.
export function formatRosterName(
  displayName: string,
  order: RosterSortOrder,
): string {
  if (order !== "lastName") return displayName;
  const key = rosterNameSortKey(displayName);
  if (key.unnamed || key.first.length === 0) return displayName;
  return `${key.last}, ${key.first}`;
}

export function sortRosterStudents<T extends NamedStudent>(
  students: ReadonlyArray<T>,
  order: RosterSortOrder,
): T[] {
  return [...students].sort(compareRosterNames(order));
}

// The compact sort control shared by both roster surfaces: a visible "Sort"
// label bound to a native select, so keyboard and screen-reader behavior is
// the platform's own. Changing it calls `onChange` immediately; the caller
// persists the choice and reorders its list in place (no reload).
export function createRosterSortControl(
  doc: Document,
  idPrefix: string,
  order: RosterSortOrder,
  onChange: (order: RosterSortOrder) => void,
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "shell-roster-sort";
  wrap.setAttribute("data-testid", `${idPrefix}-sort`);

  const selectId = `${idPrefix}-sort-select`;
  const label = doc.createElement("label");
  label.className = "shell-roster-sort-label";
  label.htmlFor = selectId;
  label.textContent = "Sort";
  wrap.appendChild(label);

  const select = doc.createElement("select");
  select.id = selectId;
  select.className = "shell-roster-sort-select";
  select.setAttribute("data-testid", selectId);
  select.setAttribute("aria-label", "Sort students by");
  for (const option of ROSTER_SORT_OPTIONS) {
    const opt = doc.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    select.appendChild(opt);
  }
  select.value = order;
  select.addEventListener("change", () => {
    if (isRosterSortOrder(select.value)) onChange(select.value);
  });
  wrap.appendChild(select);
  return wrap;
}
