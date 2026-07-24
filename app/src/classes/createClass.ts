import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Sprint 20: internal-beta wire for the certified `classesCreate`
// callable. This module lives outside `src/shell/**` so the shell
// invariant (no firebase/functions imports, no httpsCallable) is
// preserved. See platform/functions/src/classes/classes-create.ts for
// the canonical server contract, including the classId, title, grade,
// and block validators, ownership derivation, idempotency, and
// server-generated join code.

export type CreateClassInput = {
  readonly title: string;
  readonly grade: string;
  readonly block: string;
};

export type CreateClassResult = {
  readonly classId: string;
  readonly joinCode: string;
  readonly alreadyCreated: boolean;
};

export type CreateClass = (input: CreateClassInput) => Promise<CreateClassResult>;

// URL-safe classId generator. Matches the server-side
// CLASS_ID_PATTERN `^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$`.
// Uses crypto.getRandomValues on browsers; falls back to Math.random
// only in environments where crypto is unavailable (never on the live
// platform).
const CLASS_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CLASS_ID_LENGTH = 20;

function generateClassId(): string {
  const g =
    typeof globalThis !== "undefined"
      ? (globalThis as { crypto?: Crypto }).crypto
      : undefined;
  const bytes = new Uint8Array(CLASS_ID_LENGTH);
  if (g && typeof g.getRandomValues === "function") {
    g.getRandomValues(bytes);
  } else {
    for (let i = 0; i < CLASS_ID_LENGTH; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < CLASS_ID_LENGTH; i += 1) {
    out += CLASS_ID_ALPHABET[bytes[i]! % CLASS_ID_ALPHABET.length];
  }
  return out;
}

type ClassesCreateResponse = {
  readonly classId?: unknown;
  readonly joinCode?: unknown;
  readonly alreadyCreated?: unknown;
};

export function createFirebaseCreateClass(functions: Functions): CreateClass {
  const callable = httpsCallable<
    {
      classId: string;
      title: string;
      grade: string;
      block: string;
    },
    ClassesCreateResponse
  >(functions, "classesCreate");
  return async (input) => {
    const classId = generateClassId();
    const { data } = await callable({
      classId,
      title: input.title,
      grade: input.grade,
      block: input.block,
    });
    const returnedId =
      typeof data?.classId === "string" && data.classId.length > 0
        ? data.classId
        : classId;
    const joinCode =
      typeof data?.joinCode === "string" ? data.joinCode : "";
    const alreadyCreated = data?.alreadyCreated === true;
    return Object.freeze({
      classId: returnedId,
      joinCode,
      alreadyCreated,
    });
  };
}
