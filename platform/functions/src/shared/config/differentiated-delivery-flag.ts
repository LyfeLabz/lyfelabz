import { getAdminFirestore } from "../firestore/admin";

import { PLATFORM_CONFIG_COLLECTION } from "./teacher-pilot-allowlist";

// F5.2 §8.6 - the server-owned operational differentiated-delivery disable,
// Persistent Student Differentiation Slice 4.
//
// `differentiatedDeliveryEnabled` is a single runtime platform-delivery SAFETY
// SWITCH (§8.6, §11, §16). It is NOT an accommodation state, NOT a new
// architecture root, and NOT an IEP/plan concept. It exists so that P1's
// covered-no-ref begin refusal (`BEGIN_REQUIRES_LAUNCH`, Slice 6) cannot
// strand active students when the launch-grant / client-delivery
// infrastructure is intentionally rolled back while differentiated coverage
// remains published: disabling delivery first converts those launches into
// truthful `canonicalFallback` rather than refusals (§8.6, §14 rollback,
// §15 slice rollback).
//
// Storage (§16 resolved for Slice 4): the existing server-only
// `platformConfig` collection, at `platformConfig/differentiatedDelivery`,
// body `{ enabled: boolean }`. Reusing `platformConfig` (which already carries
// `teacherPilotAllowlist`) satisfies "follow current repo convention rather
// than over-designing" and inherits the collection's deny-all Rules block:
// no student or ordinary client can read, set, assert, override, or bypass it,
// and no accommodation-request shape carries it (§8.6 ownership, §11). It is
// changed only by an Admin-credentialed operator (Console or an ADC script),
// never from a client and never by a teacher surface.
//
// FAIL-CLOSED ROLLOUT GATE (Slice 4 human-review correction). Although F5.2
// §8.6 describes the steady-state as enabled ("NORMAL=true"), the staged
// rollout is deliberately fail-closed: differentiated delivery is enabled ONLY
// when the trusted server-owned document explicitly carries the boolean
// `enabled === true`. Absence of proof of an explicit enable never authorizes
// differentiated delivery, because during rollout Slice 5 client routing and
// Slice 6 session/grant binding do not yet exist, no differentiated
// presentation has completed staging certification, and teacher activation
// stays dark until Slice 7. Enabling differentiated delivery is therefore a
// deliberate operator action (write `{ enabled: true }`), not the default.
//
// This is an operational rollout-safety interpretation of the server-owned
// enable gate ONLY. It does not change any student-accommodation semantics: an
// active accommodation stays active regardless of this flag, the accommodation
// record/history and the presentation index are never mutated by it, and when
// an operator later sets `enabled: true` the same active accommodation resumes
// differentiated resolution with no accommodation migration, history rewrite,
// teacher reactivation, or student-config rewrite.

export const DIFFERENTIATED_DELIVERY_CONFIG_DOC_ID = "differentiatedDelivery";

// Canonical read shape of `platformConfig/differentiatedDelivery`. `enabled`
// is typed `unknown` so a malformed/partial document is tolerated by the
// reader and resolved by the "explicit false only" rule below.
export type DifferentiatedDeliveryConfigDoc = {
  readonly enabled?: unknown;
};

// Read the operational flag, fail-closed. Returns `true` (ENABLED) ONLY when
// the config document exists AND its `enabled` field is the boolean `true`.
// Every other state - absent document, absent field, non-boolean value, or an
// explicit `false` - returns `false` (DISABLED). Performs no mutation and never
// returns a client-supplied value.
//
// A read failure is NOT swallowed here: the exception propagates to the
// caller's Op C boundary, where the resolver's certified internal-failure
// posture yields a canonical (never differentiated) response with no grant and
// telemetry (F5.2 §8.5 row 8). Inability to read the flag therefore can never
// authorize differentiated delivery.
export async function isDifferentiatedDeliveryEnabled(): Promise<boolean> {
  const snapshot = await getAdminFirestore()
    .collection(PLATFORM_CONFIG_COLLECTION)
    .doc(DIFFERENTIATED_DELIVERY_CONFIG_DOC_ID)
    .get();

  if (!snapshot.exists) return false;

  const data = snapshot.data() as DifferentiatedDeliveryConfigDoc | undefined;
  // Explicit-true-only enable: differentiated delivery is authorized only by a
  // deliberate boolean `true`. Absence, a missing field, or a malformed value
  // all fail closed to disabled.
  return data?.enabled === true;
}
