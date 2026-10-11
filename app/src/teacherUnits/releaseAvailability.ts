// Production availability has no enabled state or operator override.
// The controlled compiler supplies this exact closed implementation.
export function teacherUnitsAvailable(): boolean { return false; }
export function requireTeacherUnitsAvailable(): void {
  if (!teacherUnitsAvailable()) throw new Error("Teacher Units unavailable in this release");
}
