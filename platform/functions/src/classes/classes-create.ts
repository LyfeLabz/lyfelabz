import { randomBytes } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  classCreationDocRef,
  classDocRef,
  log,
  writeAuditEvent,
  type ClassCreationWrite,
  type ClassRecord,
} from "../shared";

// Client-supplied request payload for classesCreate. The teacher supplies
// the target classId explicitly so the callable is idempotent against
// replays and never silently mints a second class document for the same
// classroom. `title`, `grade`, and `block` are the teacher-authored
// metadata fields per Data Model §3.3. `academicTerm` is the sole
// optional metadata field accepted at creation in Sprint 4B; `coTeacherIds`
// and `joinCodeExpiresAt` remain reserved per §3.3 and are not writable
// through this path. Ownership fields (`teacherId`, `schoolId`) are never
// carried on the request: `teacherId` is derived from the authenticated
// caller and `schoolId` is derived from the caller's canonical custom
// claim.
export type ClassesCreateRequest = {
  readonly classId: string;
  readonly title: string;
  readonly grade: string;
  readonly block: string;
  readonly academicTerm?: string;
};

// Return payload of a successful class-creation call. `alreadyCreated` is
// `true` when the call is a no-op idempotent replay of a previously
// successful creation, and `false` when this call wrote the canonical
// classes/{classId} document. `joinCode` is echoed so the teacher UI can
// display the server-generated code without a second read; the field is
// generated at initial creation and preserved on idempotent replay.
export type ClassesCreateResponse = {
  readonly classId: string;
  readonly joinCode: string;
  readonly alreadyCreated: boolean;
};

// URL-safe token constraint for the client-supplied classId, matching the
// convention already established for schoolId in Sprint 4A.
const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// Single-letter block identifier per Data Model §3.3 ("A through G"). The
// constraint is intentionally strict so classroom-mode blocks are stored
// canonically across every dashboard.
const BLOCK_PATTERN = /^[A-G]$/;

// Grade token constraint. LyfeLabz grade tokens today are "6", "7", "8"
// (per the g6/g7/g8 file-naming rule in CLAUDE.md), plus the tolerated
// alternates for future grade bands. A short alphanumeric window keeps the
// value canonical without pre-committing to a fixed enumeration.
const GRADE_PATTERN = /^[A-Za-z0-9]{1,8}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertAuthenticatedTeacher(
  request: CallableRequest<unknown>,
): { readonly uid: string; readonly schoolId: string } {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throw new PlatformError(
      "classes.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  const token = auth.token as
    | { readonly role?: unknown; readonly schoolId?: unknown }
    | undefined;
  if (!token || token.role !== "teacher") {
    throw new PlatformError(
      "classes.unauthorized",
      "Caller must be an active teacher.",
    );
  }
  if (!isNonEmptyString(token.schoolId)) {
    throw new PlatformError(
      "classes.unauthorized",
      "Caller is missing a canonical schoolId claim.",
    );
  }
  return { uid: auth.uid, schoolId: token.schoolId };
}

function validateRequest(data: unknown): ClassesCreateRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "classes.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  if (!isNonEmptyString(payload.classId)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
  const classId = payload.classId.trim();
  if (!CLASS_ID_PATTERN.test(classId)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a URL-safe token (letters, digits, hyphens, underscores).",
    );
  }

  if (!isNonEmptyString(payload.title)) {
    throw new PlatformError(
      "classes.invalidTitle",
      "title must be a non-empty string.",
    );
  }
  const title = payload.title.trim();

  if (!isNonEmptyString(payload.grade)) {
    throw new PlatformError(
      "classes.invalidGrade",
      "grade must be a non-empty string.",
    );
  }
  const grade = payload.grade.trim();
  if (!GRADE_PATTERN.test(grade)) {
    throw new PlatformError(
      "classes.invalidGrade",
      "grade must be a short alphanumeric token.",
    );
  }

  if (!isNonEmptyString(payload.block)) {
    throw new PlatformError(
      "classes.invalidBlock",
      "block must be a non-empty string.",
    );
  }
  const block = payload.block.trim().toUpperCase();
  if (!BLOCK_PATTERN.test(block)) {
    throw new PlatformError(
      "classes.invalidBlock",
      "block must be a single letter A through G.",
    );
  }

  const out: {
    classId: string;
    title: string;
    grade: string;
    block: string;
    academicTerm?: string;
  } = { classId, title, grade, block };

  if (payload.academicTerm !== undefined) {
    if (!isNonEmptyString(payload.academicTerm)) {
      throw new PlatformError(
        "classes.invalidAcademicTerm",
        "academicTerm, when supplied, must be a non-empty string.",
      );
    }
    out.academicTerm = payload.academicTerm.trim();
  }

  return out;
}

function existingMatchesRequest(
  existing: ClassRecord,
  actor: { uid: string; schoolId: string },
  input: ClassesCreateRequest,
): boolean {
  if (existing.teacherId !== actor.uid) return false;
  if (existing.schoolId !== actor.schoolId) return false;
  if (existing.title !== input.title) return false;
  if (existing.grade !== input.grade) return false;
  if (existing.block !== input.block) return false;
  if ((existing.academicTerm ?? undefined) !== (input.academicTerm ?? undefined)) {
    return false;
  }
  return true;
}

// Server-generated join code per Data Model §3.3. The field is required on
// classes/{classId} to satisfy the canonical read shape. Join-code
// lookup, rotation, and expiration flows are intentionally out of scope
// for Sprint 4B; the code is generated once at creation, preserved on
// idempotent replay, and never read as an identifier by any Sprint 4B
// callable. Eight uppercase hex characters supply ~4B distinct codes,
// which is comfortably beyond a single school's classroom count and
// avoids ambiguous glyphs.
function generateJoinCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// classesCreate
//
// Canonical creation of a classes/{classId} document per Data Model §3.3.
// Callable by an authenticated teacher whose canonical custom claims
// (`{ role: "teacher", schoolId }`) were issued by teachersApproveVerification
// in Sprint 2. Ownership fields are server-derived, never client-supplied:
// `teacherId` is the caller's uid and `schoolId` is the caller's claim.
//
// Every side effect flows through the canonical shared helpers:
//   - existing-record read via `classDocRef(classId).get()`      (typed ref)
//   - creation write via `classCreationDocRef(classId).set(...)` (typed ref)
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// Idempotency: an existing classes/{classId} owned by the caller under the
// same school with matching canonical metadata returns
// `alreadyCreated: true` and the previously stored joinCode. A conflicting
// existing document (different owner, different school, or different
// metadata) is rejected with `classes.conflict`.
async function classesCreateHandler(
  request: CallableRequest<unknown>,
): Promise<ClassesCreateResponse> {
  const actor = assertAuthenticatedTeacher(request);
  const input = validateRequest(request.data);

  const existingSnapshot = await classDocRef(input.classId).get();
  if (existingSnapshot.exists) {
    const existing = existingSnapshot.data();
    if (existing && existingMatchesRequest(existing, actor, input)) {
      safeLog(() =>
        log.info("classes.createIdempotent", {
          actorUserId: actor.uid,
          classId: input.classId,
        }),
      );
      return {
        classId: input.classId,
        joinCode: existing.joinCode,
        alreadyCreated: true,
      };
    }
    throw new PlatformError(
      "classes.conflict",
      "A class with this id already exists with different canonical fields.",
    );
  }

  const joinCode = generateJoinCode();
  const creation: ClassCreationWrite = {
    teacherId: actor.uid,
    schoolId: actor.schoolId,
    title: input.title,
    grade: input.grade,
    block: input.block,
    joinCode,
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
    ...(input.academicTerm !== undefined
      ? { academicTerm: input.academicTerm }
      : {}),
  };

  await classCreationDocRef(input.classId).set(creation);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "classes.created",
    targetType: "class",
    targetId: input.classId,
    schoolId: actor.schoolId,
  });

  safeLog(() =>
    log.info("classes.created", {
      actorUserId: actor.uid,
      classId: input.classId,
      schoolId: actor.schoolId,
    }),
  );

  return { classId: input.classId, joinCode, alreadyCreated: false };
}

export const classesCreate = onCall(classesCreateHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __classesCreateHandler = classesCreateHandler;
