import { log } from "../shared";
import { getAdminFirestore } from "../shared/firestore/admin";
import {
  AVAILABILITY_POLICY_PATH,
  validateAvailabilityPolicy,
} from "../teacherUnits/availability-policy";

// Teacher Units Expansion P1: the availability gate for the READ-ONLY unit
// projection that `assignmentsListForStudent` and
// `assessmentStudentAssignmentsForClass` attach to their responses.
//
// Source of truth: the same operator-controlled Option B policy document the
// Teacher Units management callables read
// (`platformConfig/teacherUnitsAvailability`), parsed by the same canonical
// validator (`validateAvailabilityPolicy`). The projection is open only when
// that document exists, validates for THIS project, and is `enabled`. Missing,
// malformed, wrong-project, and `closed` all mean closed, so an operator
// close (or recoverClosed) hides unit organization from students and support
// teachers too.
//
// Deliberately NOT applied here: the management path's runtime-identity and
// build-eligibility checks (`evaluateAvailabilityInTransaction`). Those bind
// the nine Teacher Units Cloud Run services (service name == endpoint) and the
// approved Teacher Units build; they cannot evaluate a different service
// without changing `teacherUnits/`, which P1 does not do. This gate never
// authorizes any unit read or write by itself: every projected unit is still
// filtered to the authorized class owner, school, grade, and the viewer's
// already-authorized assignments (see `teacher-unit-projection.ts`).
//
// Project binding: the expected identity is the policy's own environment and
// project number with the RUNTIME project id (`GCLOUD_PROJECT`). firebase-tools
// writes `GCLOUD_PROJECT` and `FIREBASE_CONFIG` (both the `--project` target)
// into every deployed function's environment, and the Functions emulator sets
// them too; the Admin SDK's default app selects its database from the same
// variables, so this is the project whose Firestore was read. A user .env
// cannot override them (reserved keys). The canonical validator pins production
// and staging ids to their project numbers, so a policy copied from another
// project never validates. An absent runtime project id fails closed.

export type TeacherUnitProjectionPolicyState = "enabled" | "closed";

// Firestore read errors propagate to the caller, which treats them as
// "projection unavailable" (never as an authorization result).
export async function readTeacherUnitProjectionPolicy(): Promise<TeacherUnitProjectionPolicyState> {
  const runtimeProjectId = process.env.GCLOUD_PROJECT;
  if (typeof runtimeProjectId !== "string" || runtimeProjectId.length === 0) return "closed";

  const snapshot = await getAdminFirestore().doc(AVAILABILITY_POLICY_PATH).get();
  if (!snapshot.exists) return "closed";
  const raw: unknown = snapshot.data();
  if (raw === null || typeof raw !== "object") return "closed";
  const fields = raw as Record<string, unknown>;
  const parsed = validateAvailabilityPolicy(raw, {
    environment: fields.environment,
    projectId: runtimeProjectId,
    projectNumber: fields.projectNumber,
    region: "us-central1",
    databaseId: "(default)",
  });
  if (!parsed.ok) {
    try {
      log.warn("assignments.unitProjectionPolicyInvalid", { reason: parsed.issue.reason });
    } catch {
      // Logging is observability, not lifecycle.
    }
    return "closed";
  }
  return parsed.value.mode === "enabled" ? "enabled" : "closed";
}
