import type { CallableFunction, CallableOptions, CallableRequest } from "firebase-functions/v2/https";
import { platformCallable, requireDistrictContext } from "../shared";
import { assertTeachingAllowed } from "./recipient-policy";

type Handler<T, R> = (request: CallableRequest<T>) => R | Promise<R>;

// Runs before the teaching guard's first Firestore read. A domain uses it only
// to establish preconditions that must precede any Firestore use (Teacher Units
// binds its runtime identity to the shared Admin Firestore instance). It grants
// nothing: the guard and the original handler still run their full checks.
export type TeachingPreflight = () => Promise<void>;

// Public callable boundary. Original handlers retain their existing ownership,
// role and tenant checks; neither hidden navigation nor client state grants rights.
export function teachingCallable<T = unknown, R = unknown>(handler: Handler<T, R>): CallableFunction<T, R | Promise<R>>;
export function teachingCallable<T = unknown, R = unknown>(options: CallableOptions, handler: Handler<T, R>): CallableFunction<T, R | Promise<R>>;
export function teachingCallable<T = unknown, R = unknown>(optionsOrHandler: CallableOptions | Handler<T, R>, maybeHandler?: Handler<T, R>): CallableFunction<T, R | Promise<R>> {
  const handler = typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler;
  if (handler === undefined) throw new Error("A callable handler is required.");
  return guardedTeachingCallable(typeof optionsOrHandler === "function" ? undefined : optionsOrHandler, handler);
}

// Single implementation of the teaching guard. `teachingCallable` and domain
// wrappers that need a preflight (see teacherUnits/teacher-units-callable.ts)
// share it so the guard logic exists exactly once.
export function guardedTeachingCallable<T = unknown, R = unknown>(options: CallableOptions | undefined, handler: Handler<T, R>, preflight?: TeachingPreflight): CallableFunction<T, R | Promise<R>> {
  const wrapped = async (request: CallableRequest<T>): Promise<R> => {
    if (preflight !== undefined) await preflight();
    const actor = await requireDistrictContext(request);
    if (actor.role === "teacher") await assertTeachingAllowed(actor);
    return handler(request);
  };
  Object.defineProperty(wrapped, "name", { value: handler.name });
  return options === undefined ? platformCallable(wrapped) : platformCallable(options, wrapped);
}
