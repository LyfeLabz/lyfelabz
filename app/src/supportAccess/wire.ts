import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import { createAttemptsListForStudentCallable } from "../assignments/detail/attempts-wire";
import type { AssessmentRevisionContentReader } from "../assignments/detail/question-summary";
import type { SharedStudent, StudentSupportSeam, SupportGrant } from "./types";

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

export function createStudentSupportSeam(
  functions: Functions,
  revisionContent: AssessmentRevisionContentReader | null,
): StudentSupportSeam {
  const listMine = httpsCallable(functions, "supportAccessListMine");
  const listForClass = httpsCallable(functions, "supportAccessListForClass");
  const grant = httpsCallable(functions, "supportAccessGrant");
  const revoke = httpsCallable(functions, "supportAccessRevoke");
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
    grant: async (input) => {
      const res = await grant({
        classId: input.classId,
        studentId: input.studentId,
        granteeEmail: input.granteeEmail,
      });
      const data = (res.data ?? {}) as CallableRecord;
      const parsed = parseGrant(data.grant);
      if (parsed === null) throw new Error("supportAccess.malformedResponse");
      return parsed;
    },
    revoke: async (grantId) => {
      await revoke({ grantId });
    },
    listAttemptsForStudent: createAttemptsListForStudentCallable(functions),
    revisionContent,
  };
}
