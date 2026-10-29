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
  };
}

const GRANT_OUTCOMES = new Set(["shared", "alreadyShared", "failed"]);
const REVOKE_OUTCOMES = new Set(["revoked", "alreadyRevoked", "failed"]);

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

function parseRevokeManyResult(raw: unknown): SupportRevokeManyResult | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as CallableRecord;
  if (!isString(r.grantId) || !isString(r.outcome) || !REVOKE_OUTCOMES.has(r.outcome)) return null;
  return { grantId: r.grantId, outcome: r.outcome as SupportRevokeManyResult["outcome"] };
}

export function createStudentSupportSeam(
  functions: Functions,
  revisionContent: AssessmentRevisionContentReader | null,
): StudentSupportSeam {
  const listMine = httpsCallable(functions, "supportAccessListMine");
  const listForClass = httpsCallable(functions, "supportAccessListForClass");
  const grantMany = httpsCallable(functions, "supportAccessGrantMany");
  const revoke = httpsCallable(functions, "supportAccessRevoke");
  const revokeMany = httpsCallable(functions, "supportAccessRevokeMany");
  return {
    listShared: async () => {
      const res = await listMine({});
      const data = (res.data ?? {}) as CallableRecord;
      const list = Array.isArray(data.students) ? data.students : [];
      return list.map(parseSharedStudent).filter((s): s is SharedStudent => s !== null);
    },
    listForClass: async (classId) => {
      const res = await listForClass({ classId });
      const data = (res.data ?? {}) as CallableRecord;
      const list = Array.isArray(data.grants) ? data.grants : [];
      return list.map(parseGrant).filter((g): g is SupportGrant => g !== null);
    },
    grantMany: async (input) => {
      const res = await grantMany({
        classId: input.classId,
        studentIds: [...input.studentIds],
        granteeEmails: [...input.granteeEmails],
      });
      const data = (res.data ?? {}) as CallableRecord;
      if (!Array.isArray(data.results)) throw new Error("supportAccess.malformedResponse");
      return data.results.map(parseGrantManyResult).filter((r): r is SupportGrantManyResult => r !== null);
    },
    revoke: async (grantId) => {
      await revoke({ grantId });
    },
    revokeMany: async (grantIds) => {
      const res = await revokeMany({ grantIds: [...grantIds] });
      const data = (res.data ?? {}) as CallableRecord;
      if (!Array.isArray(data.results)) throw new Error("supportAccess.malformedResponse");
      return data.results.map(parseRevokeManyResult).filter((r): r is SupportRevokeManyResult => r !== null);
    },
    listAttemptsForStudent: createAttemptsListForStudentCallable(functions),
    revisionContent,
  };
}
