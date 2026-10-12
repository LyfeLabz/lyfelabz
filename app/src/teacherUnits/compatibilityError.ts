// Local pre-dispatch error; server-supplied codes cannot establish non-execution.
export class TeacherUnitsCompatibilityError extends Error {
  readonly code = "teacherUnits.compatibilityBlocked";
  constructor() { super("Teacher Units compatibility could not be verified; no mutation was dispatched."); this.name = "TeacherUnitsCompatibilityError"; }
}
