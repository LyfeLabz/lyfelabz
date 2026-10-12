import { teacherUnitsAvailable } from "./releaseAvailability";
import type { TeacherUnitsSurfaceSeam } from "./unitsController";

// The factory is lazy: closed releases construct no adapters, stores or controllers.
export function teacherUnitsReleaseBoundary(factory: () => TeacherUnitsSurfaceSeam): TeacherUnitsSurfaceSeam | null {
  return teacherUnitsAvailable() ? factory() : null;
}
