import { type CallableRequest } from "firebase-functions/v2/https";

import {
  ACTIVE_LAB_REPORT_ID,
  PlatformError,
  requireDistrictContext,
  type StudentLabReportRecord,
} from "../shared";

export type LabReportActor = {
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
};

// The caller must be an authenticated, active student whose token claims
// agree with the canonical `users/{uid}` record (the record wins). The uid
// comes only from the verified ID token, never from the request payload.
export async function assertActiveStudent(
  request: CallableRequest<unknown>,
): Promise<LabReportActor> {
  const context = await requireDistrictContext(request);
  if (context.role !== "student") {
    throw new PlatformError("role-forbidden", "Caller must be an active student.");
  }
  return { uid: context.uid, schoolId: context.schoolId, districtId: context.districtId };
}

// Only the single active report exists today. Any other id is refused so a
// future report family is an explicit change, not an accidental write.
export function readReportId(payload: Record<string, unknown>): string {
  const reportId = payload.reportId ?? ACTIVE_LAB_REPORT_ID;
  if (reportId !== ACTIVE_LAB_REPORT_ID) {
    throw new PlatformError("labReports.invalidRequest", "reportId is not supported.");
  }
  return reportId;
}

export function requestObject(data: unknown): Record<string, unknown> {
  if (data === null || data === undefined) return {};
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError("labReports.invalidRequest", "Request payload must be an object.");
  }
  return data as Record<string, unknown>;
}

// Defense in depth: the path is already keyed by the caller's uid, so a
// stored record can only disagree through data corruption or a migration
// error. Refuse rather than disclose or overwrite.
export function assertRecordOwnedBy(record: StudentLabReportRecord, actor: LabReportActor): void {
  if (record.studentId !== actor.uid) {
    throw new PlatformError("labReports.notOwned", "Caller does not own this report.");
  }
  if (record.districtId !== actor.districtId) {
    throw new PlatformError("district-mismatch", "Caller does not have access to this report.");
  }
}

export function timestampMillis(value: unknown): number | null {
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

export function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}
