import type { CallableFunction, CallableOptions, CallableRequest } from "firebase-functions/v2/https";
import { guardedTeachingCallable } from "../supportAccess/teaching-callable";
import { PRODUCTION_TEACHER_UNITS_ENFORCEMENT, requireRuntimeIdentity, type TeacherUnitsEndpoint } from "./a3-enforcement";

// Public boundary for the nine Teacher Units callables.
//
// Ordering contract: the A3 runtime identity binder (a3-runtime-identity.ts)
// can bind the shared Admin Firestore instance only while the installed SDK's
// settings are unfrozen, i.e. before ANY Firestore operation in the process.
// The Student Support teaching guard reads Firestore (requireDistrictContext,
// assertTeachingAllowed), so identity is resolved first, exactly as each
// handler did before the guard existed ("resolved before any tenant read").
// An unaccepted identity refuses here with runtimeIdentityUnavailable before
// any tenant read.
//
// Nothing is relaxed: the teaching guard then runs unchanged, and each handler
// still re-resolves identity (reusing the binding) and performs its own
// canonical teacher, tenant, ownership and Option B availability checks.
export function teacherUnitsCallable<T = unknown, R = unknown>(
  options: CallableOptions,
  endpoint: TeacherUnitsEndpoint,
  handler: (request: CallableRequest<T>) => R | Promise<R>,
): CallableFunction<T, R | Promise<R>> {
  return guardedTeachingCallable(options, handler, async () => {
    await requireRuntimeIdentity(PRODUCTION_TEACHER_UNITS_ENFORCEMENT, endpoint);
  });
}
