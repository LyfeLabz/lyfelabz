import type { CallableFunction, CallableOptions, CallableRequest } from "firebase-functions/v2/https";
import { platformCallable, requireDistrictContext } from "../shared";
import { assertTeachingAllowed } from "./recipient-policy";

// Public callable boundary. Original handlers retain their existing ownership,
// role and tenant checks; neither hidden navigation nor client state grants rights.
export function teachingCallable<T = unknown, R = unknown>(handler: (request: CallableRequest<T>) => R | Promise<R>): CallableFunction<T, R | Promise<R>>;
export function teachingCallable<T = unknown, R = unknown>(options: CallableOptions, handler: (request: CallableRequest<T>) => R | Promise<R>): CallableFunction<T, R | Promise<R>>;
export function teachingCallable<T = unknown, R = unknown>(optionsOrHandler: CallableOptions | ((request: CallableRequest<T>) => R | Promise<R>), maybeHandler?: (request: CallableRequest<T>) => R | Promise<R>): CallableFunction<T, R | Promise<R>> {
  const handler = typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler;
  if (handler === undefined) throw new Error("A callable handler is required.");
  const wrapped = async (request: CallableRequest<T>): Promise<R> => {
    const actor = await requireDistrictContext(request);
    if (actor.role === "teacher") await assertTeachingAllowed(actor);
    return handler(request);
  };
  Object.defineProperty(wrapped, "name", { value: handler.name });
  return typeof optionsOrHandler === "function" ? platformCallable(wrapped) : platformCallable(optionsOrHandler, wrapped);
}
