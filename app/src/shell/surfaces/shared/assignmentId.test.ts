/**
 * Focused regression suite for assignmentId minting.
 *
 * Sprint 25 certification scenario B6 failed at the very first callable:
 * `assignmentsCreateDraft` rejected both createDraft requests with
 *
 *   {
 *     "error": {
 *       "details": { "code": "assignments.invalidAssignmentId" },
 *       "message": "assignmentId must be a URL-safe token (letters,
 *                   digits, hyphens, underscores).",
 *       "status": "INVALID_ARGUMENT"
 *     }
 *   }
 *
 * Root cause: the previous minter tail-sliced an over-length id and could
 * emit one beginning with "-", which violates the server pattern. These
 * tests exercise real-length certification identifiers and bind the
 * client output to the exact server validation rule.
 */
import * as fs from "fs";
import * as path from "path";
import {
  mintAssignmentId,
  ASSIGNMENT_ID_PATTERN,
  MAX_ASSIGNMENT_ID_LENGTH,
} from "./assignmentId";

// A certification-style Firebase teacher uid (28 chars, mixed case).
const CERT_TEACHER_UID = "kJ8sQ2mZ1pXvL7nR4tB9wY0cD3gH";

// Realistic 20-char Firestore/class ids (the alphabet classId.ts emits,
// plus a mixed-case auto-id shape Firestore itself can produce).
const CLASS_IDS = [
  "a1b2c3d4e5f6g7h8i9j0",
  "zx9wv8ut7sr6qp5on4ml",
  "Kp0Lq9Mr8Ns7Ot6Pu5Qv",
] as const;

// Long lesson slugs, including the specific ones named by certification.
const LESSON_SLUGS = [
  "parts-of-an-ecosystem",
  "what-is-life",
  "body-systems",
  "earths-place-in-the-universe",
] as const;

const NONCE = "a1b2c3d4e5f6"; // 12-char mintNonce() shape

describe("mintAssignmentId — server pattern conformance", () => {
  it("emits a valid, <=64-char id for every real-length combination", () => {
    for (const slug of LESSON_SLUGS) {
      for (const classId of CLASS_IDS) {
        const id = mintAssignmentId(CERT_TEACHER_UID, slug, classId, NONCE);
        expect(id).toMatch(ASSIGNMENT_ID_PATTERN);
        expect(id.length).toBeLessThanOrEqual(MAX_ASSIGNMENT_ID_LENGTH);
        // The exact B6 failure mode: never begin (or end) with a separator.
        expect(id.startsWith("-")).toBe(false);
        expect(id.endsWith("-")).toBe(false);
        expect(id).toMatch(/^[a-zA-Z0-9]/);
        expect(id).toMatch(/[a-zA-Z0-9]$/);
      }
    }
  });

  it("stays valid for the longest certification slug (over-length input)", () => {
    // teacher(28) + slug(28) + class(20) + nonce(12) => readable form is
    // 93 chars, well over the 64-char limit, so truncation is exercised.
    const id = mintAssignmentId(
      CERT_TEACHER_UID,
      "earths-place-in-the-universe",
      CLASS_IDS[0],
      NONCE,
    );
    expect(id).toMatch(ASSIGNMENT_ID_PATTERN);
    expect(id.length).toBeLessThanOrEqual(MAX_ASSIGNMENT_ID_LENGTH);
    // Preserves the readable leading sentinel rather than tail-slicing.
    expect(id.startsWith("a-earths-place-in-the-universe")).toBe(true);
  });
});

describe("mintAssignmentId — determinism", () => {
  it("returns the same id for the same logical input", () => {
    for (const slug of LESSON_SLUGS) {
      const a = mintAssignmentId(CERT_TEACHER_UID, slug, CLASS_IDS[0], NONCE);
      const b = mintAssignmentId(CERT_TEACHER_UID, slug, CLASS_IDS[0], NONCE);
      expect(a).toBe(b);
    }
  });
});

describe("mintAssignmentId — uniqueness", () => {
  it("produces a different id for a different nonce", () => {
    const slug = "earths-place-in-the-universe";
    const a = mintAssignmentId(CERT_TEACHER_UID, slug, CLASS_IDS[0], "nonce0000001");
    const b = mintAssignmentId(CERT_TEACHER_UID, slug, CLASS_IDS[0], "nonce0000002");
    expect(a).not.toBe(b);
  });

  it("produces a different id for a different class id", () => {
    // The load-bearing case a blind tail-slice broke: with long teacher +
    // slug, a differing class id sits outside the retained 64-char tail,
    // so two classes could collide. The digest keeps them distinct.
    const slug = "earths-place-in-the-universe";
    const a = mintAssignmentId(CERT_TEACHER_UID, slug, CLASS_IDS[0], NONCE);
    const b = mintAssignmentId(CERT_TEACHER_UID, slug, CLASS_IDS[1], NONCE);
    const c = mintAssignmentId(CERT_TEACHER_UID, slug, CLASS_IDS[2], NONCE);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("produces a different id for a different teacher uid", () => {
    const slug = "earths-place-in-the-universe";
    const a = mintAssignmentId(CERT_TEACHER_UID, slug, CLASS_IDS[0], NONCE);
    const b = mintAssignmentId(
      "ZZ8sQ2mZ1pXvL7nR4tB9wY0cD3gH",
      slug,
      CLASS_IDS[0],
      NONCE,
    );
    expect(a).not.toBe(b);
  });

  it("keeps every id in a full certification cross-product distinct", () => {
    const ids = new Set<string>();
    let count = 0;
    for (const slug of LESSON_SLUGS) {
      for (const classId of CLASS_IDS) {
        ids.add(mintAssignmentId(CERT_TEACHER_UID, slug, classId, NONCE));
        count += 1;
      }
    }
    expect(ids.size).toBe(count);
  });
});

// -----------------------------------------------------------------------------
// Contract test: bind the client minter to the server validation rule.
// -----------------------------------------------------------------------------
//
// The server enforces its own ASSIGNMENT_ID_PATTERN inside
// assignments-create-draft.ts. This test reads that server source, extracts
// the literal, and asserts (a) the client mirror is byte-identical and
// (b) every minted id satisfies the actual server regex. If the server
// rule ever changes, this test fails loudly instead of certification.
describe("mintAssignmentId — server contract binding", () => {
  const serverFile = path.resolve(
    __dirname,
    "../../../../../platform/functions/src/assignments/assignments-create-draft.ts",
  );

  function readServerPattern(): RegExp {
    const src = fs.readFileSync(serverFile, "utf8");
    const match = src.match(
      /const ASSIGNMENT_ID_PATTERN\s*=\s*(\/[^\n;]*\/)\s*;/,
    );
    if (!match) {
      throw new Error(
        `Could not locate ASSIGNMENT_ID_PATTERN in ${serverFile}`,
      );
    }
    const literal = match[1];
    const lastSlash = literal.lastIndexOf("/");
    const body = literal.slice(1, lastSlash);
    const flags = literal.slice(lastSlash + 1);
    return new RegExp(body, flags);
  }

  it("client ASSIGNMENT_ID_PATTERN is byte-identical to the server rule", () => {
    const serverPattern = readServerPattern();
    expect(ASSIGNMENT_ID_PATTERN.source).toBe(serverPattern.source);
    expect(ASSIGNMENT_ID_PATTERN.flags).toBe(serverPattern.flags);
  });

  it("every minted id passes the actual server regex", () => {
    const serverPattern = readServerPattern();
    for (const slug of LESSON_SLUGS) {
      for (const classId of CLASS_IDS) {
        const id = mintAssignmentId(CERT_TEACHER_UID, slug, classId, NONCE);
        // A fresh regex per assertion avoids lastIndex statefulness.
        expect(new RegExp(serverPattern.source).test(id)).toBe(true);
      }
    }
  });
});
