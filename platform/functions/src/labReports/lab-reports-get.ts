import { type CallableRequest } from "firebase-functions/v2/https";

import { PlatformError, log, platformCallable, studentLabReportDocRef } from "../shared";
import {
  assertActiveStudent,
  assertRecordOwnedBy,
  readReportId,
  requestObject,
  safeLog,
  timestampMillis,
} from "./lab-report-access";

export type LabReportsGetResponse =
  | { readonly exists: false; readonly revision: 0 }
  | {
      readonly exists: true;
      readonly revision: number;
      readonly report: unknown;
      readonly updatedAtMillis: number | null;
    };

// labReportsGet
//
// Returns the caller's own Lab Report Assistant draft, or `exists: false`.
// The student is identified only by the verified ID token; the request
// carries no student id. One document read after the identity check. Logs
// carry the uid, revision, and size only, never report content.
async function labReportsGetHandler(
  request: CallableRequest<unknown>,
): Promise<LabReportsGetResponse> {
  const actor = await assertActiveStudent(request);
  const reportId = readReportId(requestObject(request.data));

  const snapshot = await studentLabReportDocRef(actor.uid, reportId).get();
  const record = snapshot.exists ? snapshot.data() : undefined;
  if (!record) {
    safeLog(() => log.info("labReports.read", { actorUserId: actor.uid, exists: false }));
    return { exists: false, revision: 0 };
  }
  assertRecordOwnedBy(record, actor);

  let report: unknown;
  try {
    report = JSON.parse(record.reportJson);
  } catch {
    // The parser error is dropped on purpose: V8 quotes the input text.
    throw new PlatformError("labReports.corruptRecord", "The stored report could not be read.");
  }
  safeLog(() =>
    log.info("labReports.read", {
      actorUserId: actor.uid,
      exists: true,
      revision: record.revision,
      reportBytes: record.reportBytes,
    }),
  );
  return {
    exists: true,
    revision: record.revision,
    report,
    updatedAtMillis: timestampMillis(record.updatedAt),
  };
}

export const labReportsGet = platformCallable(labReportsGetHandler);

// Exported for direct unit testing without the callable wrapper.
export const __labReportsGetHandler = labReportsGetHandler;
