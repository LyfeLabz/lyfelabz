import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import { createAttemptsListForStudentCallable } from "../assignments/detail/attempts-wire";
import type { AssessmentRevisionContentReader } from "../assignments/detail/question-summary";
import type {
  SharedStudent,
  StudentSupportSeam,
  SupportGrant,
  SupportGrantFailureReason,
  SupportGrantManyResult,
  SupportRevokeManyResult,
} from "./types";

export type { SharedStudent, StudentSupportSeam, SupportGrant } from "./types";
export { supportAccessErrorCode } from "./types";

// Student Support Access (PDR-032, docs/platform/STUDENT_SUPPORT_ACCESS.md):
// entry-point wires for the `supportAccess*` callables. Kept apart from the
// surfaces so tests inject in-memory fakes and the surfaces stay
// firebase-free. Authorization is entirely server-side; nothing here is a
// security control.

type CallableRecord = Readonly<Record<string, unknown>>;
const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function parseSharedStudent(raw: unknown): SharedStudent | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as CallableRecord;
  if (
    !isString(r.grantId) ||
    !isString(r.classId) ||
    !isString(r.studentId) ||
    !isString(r.studentDisplayName)
  ) {
    return null;
  }
  return {
    grantId: r.grantId,
    classId: r.classId,
    classTitle: isString(r.classTitle) ? r.classTitle : "Class",
    studentId: r.studentId,
    studentDisplayName: r.studentDisplayName,
    ownerDisplayName: isString(r.ownerDisplayName) ? r.ownerDisplayName : "Teacher",
    classBlock: isString(r.classBlock) ? r.classBlock : null,
  };
}

function parseGrant(raw: unknown): SupportGrant | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as CallableRecord;
  if (
    !isString(r.grantId) ||
    !isString(r.classId) ||
    !isString(r.studentId) ||
    !isString(r.studentDisplayName)
  ) {
    return null;
  }
  return {
    grantId: r.grantId,
    classId: r.classId,
    studentId: r.studentId,
    studentDisplayName: r.studentDisplayName,
    granteeDisplayName: isString(r.granteeDisplayName) ? r.granteeDisplayName : "Teacher",
    granteeEmail: isString(r.granteeEmail) ? r.granteeEmail : null,
    ...(isString(r.authorizationId) ? { authorizationId: r.authorizationId } : {}),
    ...(r.invitationOnly === true ? { invitationOnly: true } : {}),
    ...(isString(r.relationshipId) ? { relationshipId: r.relationshipId } : {}),
    ...(r.status === "pending" || r.status === "pendingActivation" || r.status === "active" || r.status === "removed" || r.status === "superseded" ? { status: r.status } : {}),
  };
}

const GRANT_OUTCOMES = new Set(["shared", "pending", "alreadyShared", "failed"]);

function parseGrantManyResult(raw: unknown): SupportGrantManyResult | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as CallableRecord;
  if (!isString(r.studentId) || !isString(r.granteeEmail) || !isString(r.outcome) || !GRANT_OUTCOMES.has(r.outcome)) {
    return null;
  }
  return {
    studentId: r.studentId,
    granteeEmail: r.granteeEmail,
    outcome: r.outcome as SupportGrantManyResult["outcome"],
    reason: isString(r.reason) ? (r.reason as SupportGrantFailureReason) : null,
  };
}

export function createStudentSupportSeam(
  functions: Functions,
  revisionContent: AssessmentRevisionContentReader | null,
): StudentSupportSeam {
  let supportRecipient = false;
  const revokeTargets = new Map<string, CallableRecord>();
  const reconcile = httpsCallable(functions, "supportAccessReconcileMine");
  const revokeAuthorization = httpsCallable(functions, "supportAccessV21RevokeAuthorization");
  const removeRecipient = httpsCallable(functions, "supportAccessV21RemoveRecipient");
  const listMine = httpsCallable(functions, "supportAccessListMine");
  const listForClass = httpsCallable(functions, "supportAccessListForClass");
  const grantMany = httpsCallable(functions, "supportAccessV21GrantMany");
  const readGeneration = httpsCallable(functions, "supportAccessMutationGeneration");
  let generation: number | null = null;
  const pendingOperations = new Map<string, { operationId: string; expectedGeneration: number }>();
  async function mutate(call: typeof revokeAuthorization, intent: CallableRecord): Promise<CallableRecord> {
    const key = JSON.stringify(intent);
    let operation = pendingOperations.get(key);
    if (!operation) {
      if (generation === null) throw new Error("Refresh LyfeLabz to change Student Support access.");
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      const operationId = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      operation = { operationId, expectedGeneration: generation };
      pendingOperations.set(key, operation);
    }
    try {
      const response = await call({ ...intent, ...operation });
      pendingOperations.delete(key);
      if (generation === operation.expectedGeneration) generation++;
      return response.data as CallableRecord;
    } catch (err) {
      const failure = err as { code?: string; details?: { code?: string } };
      if (failure.code === "functions/not-found" || failure.details?.code === "supportAccess.refreshRequired" ||
        failure.details?.code === "supportAccess.conflict") {
        generation = null;
        pendingOperations.delete(key);
        throw new Error("Refresh LyfeLabz and review current Student Support access before trying again.");
      }
      throw err;
    }
  }
  async function revoke(grantId: string): Promise<void> {
    const target = revokeTargets.get(grantId);
    if (!target) throw new Error("Refresh LyfeLabz and review current Student Support access before trying again.");
    const result = await mutate(revokeAuthorization, target).catch((cause: unknown) => {
      throw new Error("Refresh LyfeLabz and review current Student Support access before trying again.", { cause });
    });
    if (result?.status !== "revoked") {
      throw new Error("Refresh LyfeLabz and review current Student Support access before trying again.");
    }
  }
  let reconciliation: Promise<void> | null = null;
  const reconcilePending = (): Promise<void> => {
    if (reconciliation !== null) return reconciliation;
    reconciliation = (async () => {
      let cursor: string | null = null;
      for (let page = 0; page < 100; page++) {
        const batch = (await reconcile({ cursor })).data as CallableRecord;
        if (batch?.remaining === false) break;
        if (typeof batch?.cursor !== "string" || page === 99) throw new Error("Support authorization could not finish. Try again.");
        cursor = batch.cursor;
      }
    })().finally(() => { reconciliation = null; });
    return reconciliation;
  };
  return {
    reconcilePending,
    isSupportWorkspaceEligible: () => supportRecipient,
    removeRecipient: async (relationshipId, grantId, cancelInvitation) => {
      await mutate(removeRecipient, { relationshipId, ...(grantId ? { grantId } : {}), ...(cancelInvitation ? { cancelInvitation: true } : {}) });
    },
    listShared: async () => {
      const res = await listMine({});
      const data = (res.data ?? {}) as CallableRecord;
      if (!Array.isArray(data.students)) throw new Error("supportAccess.malformedResponse");
      if (data.workspace !== undefined && (!data.workspace || typeof (data.workspace as CallableRecord).supportOnly !== "boolean")) throw new Error("supportAccess.malformedResponse");
      supportRecipient = data.workspace === undefined ? data.students.length > 0 : (data.workspace as CallableRecord).supportOnly === true;
      const list = data.students;
      const students = list.map(parseSharedStudent);
      if (students.some(student => student === null)) throw new Error("supportAccess.malformedResponse");
      return students as SharedStudent[];
    },
    listForClass: async (classId) => {
      generation = null;
      const generationResult = await readGeneration({}).catch(() => null);
      const res = await listForClass({ classId, includeAuthorizations: true });
      const data = (res.data ?? {}) as CallableRecord;
      const list = Array.isArray(data.grants) ? data.grants : [];
      const parsed = list.map(parseGrant);
      if (parsed.some(grant => grant === null)) throw new Error("supportAccess.malformedResponse");
      const grants = parsed as SupportGrant[];
      const value = (generationResult?.data as CallableRecord | undefined)?.generation;
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) generation = value;
      revokeTargets.clear();
      for (const grant of grants) {
        if (grant.status === "active" || grant.status === undefined) {
          revokeTargets.set(grant.grantId, { grantId: grant.grantId });
        } else if ((grant.status === "pending" || grant.status === "pendingActivation") &&
          grant.authorizationId && !revokeTargets.has(grant.grantId)) {
          revokeTargets.set(grant.grantId, { authorizationId: grant.authorizationId });
        }
      }
      return grants;
    },
    grantMany: async (input) => {
      const data = await mutate(grantMany, {
        classId: input.classId,
        studentIds: [...input.studentIds],
        granteeEmails: [...input.granteeEmails],
      });
      if (!Array.isArray(data?.results)) throw new Error("supportAccess.malformedResponse");
      return data.results.map(parseGrantManyResult).filter((r): r is SupportGrantManyResult => r !== null);
    },
    revoke,
    revokeMany: async (grantIds) => {
      const results: SupportRevokeManyResult[] = [];
      for (const grantId of grantIds) {
        try {
          await revoke(grantId);
          results.push({ grantId, outcome: "revoked" });
        } catch (err) {
          if (results.length === 0) throw err;
          results.push({ grantId, outcome: "failed" });
        }
      }
      return results;
    },
    listAttemptsForStudent: createAttemptsListForStudentCallable(functions),
    revisionContent,
  };
}
