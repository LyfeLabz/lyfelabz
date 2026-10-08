import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  LAB_REPORT_FORMAT_VERSION,
  PlatformError,
  STUDENT_LAB_REPORT_SCHEMA_VERSION,
  log,
  platformCallable,
  runFirestoreTransaction,
  studentLabReportCreationDocRef,
  studentLabReportDocRef,
  studentLabReportUpdateDocRef,
} from "../shared";
import {
  assertActiveStudent,
  assertRecordOwnedBy,
  readReportId,
  requestObject,
  safeLog,
} from "./lab-report-access";
import {
  isBlankLabReport,
  normalizeLabReport,
  serializeLabReport,
  type LabReportPayload,
} from "./lab-report-validation";

export type LabReportsSaveRequest = {
  readonly reportId?: string;
  readonly expectedRevision: number;
  readonly saveId: string;
  readonly report: unknown;
  readonly allowBlank?: boolean;
};

export type LabReportsSaveResponse = {
  readonly revision: number;
  // false when the call wrote nothing: an identical report, or a retry of a
  // save that already landed. Both are successful acknowledgements.
  readonly persisted: boolean;
  readonly updatedAtMillis: number;
};

const SAVE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_REVISION = Number.MAX_SAFE_INTEGER - 1;

function validateRequest(data: unknown): {
  readonly reportId: string;
  readonly expectedRevision: number;
  readonly saveId: string;
  readonly report: LabReportPayload;
  readonly allowBlank: boolean;
} {
  const payload = requestObject(data);
  for (const key of ["studentId", "uid", "schoolId", "districtId", "revision"]) {
    if (key in payload) {
      throw new PlatformError(
        "labReports.invalidRequest",
        `Server-owned field "${key}" is not permitted on the request.`,
      );
    }
  }
  const reportId = readReportId(payload);
  const expectedRevision = payload.expectedRevision;
  if (
    typeof expectedRevision !== "number" ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision > MAX_REVISION
  ) {
    throw new PlatformError("labReports.invalidRequest", "expectedRevision must be a non-negative integer.");
  }
  const saveId = payload.saveId;
  if (typeof saveId !== "string" || !SAVE_ID_PATTERN.test(saveId)) {
    throw new PlatformError("labReports.invalidRequest", "saveId must be a URL-safe token.");
  }
  const allowBlank = payload.allowBlank ?? false;
  if (typeof allowBlank !== "boolean") {
    throw new PlatformError("labReports.invalidRequest", "allowBlank must be a boolean.");
  }
  return { reportId, expectedRevision, saveId, report: normalizeLabReport(payload.report), allowBlank };
}

// labReportsSave
//
// Writes the caller's own Lab Report Assistant draft with revision-based
// optimistic concurrency (the established accommodations CAS pattern):
//
//   - `expectedRevision` must equal the stored revision (0 when absent).
//     A mismatch is `labReports.writeConflict` carrying only the current
//     revision; the client then reads the current report and asks the
//     student which version to keep. Stale tabs, restored tabs, and a
//     second device can never overwrite a newer revision.
//   - A retry of a save that already landed (same `saveId`, stored
//     revision exactly one past `expectedRevision`) is acknowledged, not a
//     conflict, so a lost response never produces a false conflict.
//   - An identical report is acknowledged without a write.
//   - A blank report never replaces a report with student writing unless
//     the request says `allowBlank` (the student's own Start over or
//     clearing). This blocks the "empty editor overwrote my work" failure
//     class even if a client bug sends a blank report at the right revision.
//
// Ownership: the document path is the caller's verified uid. The ownership
// stamp is written once on creation and is structurally unreachable on
// update. Logs never include report content.
async function labReportsSaveHandler(
  request: CallableRequest<unknown>,
): Promise<LabReportsSaveResponse> {
  const actor = await assertActiveStudent(request);
  const input = validateRequest(request.data);
  const { json, bytes } = serializeLabReport(input.report);
  const blank = isBlankLabReport(input.report);

  const outcome = await runFirestoreTransaction(async (tx) => {
    const snapshot = await tx.get(studentLabReportDocRef(actor.uid, input.reportId));
    const current = snapshot.exists ? snapshot.data() : undefined;
    if (current) assertRecordOwnedBy(current, actor);
    const currentRevision = current?.revision ?? 0;

    if (input.expectedRevision !== currentRevision) {
      if (
        current &&
        current.lastSaveId === input.saveId &&
        currentRevision === input.expectedRevision + 1
      ) {
        return { revision: currentRevision, persisted: false, kind: "replay" as const };
      }
      throw new PlatformError(
        "labReports.writeConflict",
        "expectedRevision does not match the current report revision.",
        undefined,
        { revision: currentRevision },
      );
    }

    if (current && current.reportJson === json) {
      return { revision: currentRevision, persisted: false, kind: "unchanged" as const };
    }

    if (current && blank && !input.allowBlank) {
      let storedBlank = false;
      try {
        storedBlank = isBlankLabReport(normalizeLabReport(JSON.parse(current.reportJson)));
      } catch {
        storedBlank = false;
      }
      if (!storedBlank) {
        throw new PlatformError(
          "labReports.blankOverwriteRefused",
          "A blank report cannot replace a saved report without confirmation.",
        );
      }
    }

    const now = FieldValue.serverTimestamp();
    if (!current) {
      tx.create(studentLabReportCreationDocRef(actor.uid, input.reportId), {
        schemaVersion: STUDENT_LAB_REPORT_SCHEMA_VERSION,
        reportId: input.reportId,
        scope: "personal",
        studentId: actor.uid,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
        reportFormatVersion: LAB_REPORT_FORMAT_VERSION,
        reportJson: json,
        reportBytes: bytes,
        revision: 1,
        lastSaveId: input.saveId,
        createdAt: now,
        updatedAt: now,
      });
      return { revision: 1, persisted: true, kind: "created" as const };
    }
    const nextRevision = currentRevision + 1;
    tx.update(studentLabReportUpdateDocRef(actor.uid, input.reportId), {
      reportFormatVersion: LAB_REPORT_FORMAT_VERSION,
      reportJson: json,
      reportBytes: bytes,
      revision: nextRevision,
      lastSaveId: input.saveId,
      updatedAt: now,
    });
    return { revision: nextRevision, persisted: true, kind: "updated" as const };
  });

  safeLog(() =>
    log.info("labReports.saved", {
      actorUserId: actor.uid,
      outcome: outcome.kind,
      revision: outcome.revision,
      reportBytes: bytes,
    }),
  );
  return { revision: outcome.revision, persisted: outcome.persisted, updatedAtMillis: Date.now() };
}

export const labReportsSave = platformCallable(labReportsSaveHandler);

// Exported for direct unit testing without the callable wrapper.
export const __labReportsSaveHandler = labReportsSaveHandler;
