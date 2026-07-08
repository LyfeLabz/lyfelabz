import { FieldValue } from "firebase-admin/firestore";
import { auth } from "firebase-functions/v1";

import type { UserRecord } from "firebase-admin/auth";

import {
  PlatformError,
  log,
  userDocRef,
  type UserProvisioningWrite,
} from "../shared";

const FIRESTORE_ALREADY_EXISTS = 6;

function isAlreadyExistsError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === FIRESTORE_ALREADY_EXISTS
  );
}

function resolveProvider(user: UserRecord): string {
  return user.providerData[0]?.providerId ?? "unknown";
}

function buildPayload(user: UserRecord): UserProvisioningWrite {
  const optional: {
    email?: string;
    displayName?: string;
  } = {};
  if (user.email) optional.email = user.email;
  if (user.displayName) optional.displayName = user.displayName;

  return {
    authUid: user.uid,
    status: "provisioned",
    createdAt: FieldValue.serverTimestamp(),
    ...optional,
  };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not provisioning. A logger failure after the
    // Firestore write has succeeded (or after a failure is already being
    // rethrown) must not itself become the outcome of the trigger.
  }
}

export const authOnUserCreate = auth.user().onCreate(async (user) => {
  if (!user.uid) {
    const err = new PlatformError(
      "auth.invalidUserRecord",
      "Auth user record is missing uid.",
    );
    safeLog(() =>
      log.error("auth.userCreateFailed", { uid: null, cause: err.code }),
    );
    throw err;
  }

  const provider = resolveProvider(user);

  try {
    await userDocRef(user.uid).create(buildPayload(user));
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      safeLog(() =>
        log.info("auth.userCreateSkipped", {
          uid: user.uid,
          reason: "already-exists",
        }),
      );
      return;
    }
    const cause = err instanceof Error ? err.name : "unknown";
    safeLog(() => log.error("auth.userCreateFailed", { uid: user.uid, cause }));
    throw err;
  }

  safeLog(() => log.info("auth.userCreated", { uid: user.uid, provider }));
});
