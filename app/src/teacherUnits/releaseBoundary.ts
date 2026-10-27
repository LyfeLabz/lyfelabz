import { teacherUnitsAvailable } from "./releaseAvailability";
import type { TeacherUnitsSurfaceSeam } from "./unitsController";

// The factory is lazy: closed releases construct no adapters, stores, capability
// subscriptions or controllers. A future policy-capable profile is advisory;
// backend discovery remains required before any unit control is enabled.
export function teacherUnitsReleaseBoundary(factory: () => TeacherUnitsSurfaceSeam): TeacherUnitsSurfaceSeam | null {
  return teacherUnitsAvailable() ? factory() : null;
}
