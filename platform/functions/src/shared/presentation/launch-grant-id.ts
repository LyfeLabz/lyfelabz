import { randomBytes } from "node:crypto";

import { isValidGrantId } from "../types/launch-grant";

// F5.2 §3.6 grant-id generation - Persistent Student Differentiation, Slice 4.
//
// A grant id is 128 bits of cryptographically secure randomness rendered as
// exactly 32 lowercase hexadecimal characters. It is NEVER derived from
// content, a timestamp, a sequence, or any predictable input (§3.6): the grant
// is unguessable so that possession of a valid id cannot be forged offline,
// and it is not a UUID variant that would carry version/variant bits or a
// timestamp. `randomBytes(16)` is Node's CSPRNG (the same primitive the OAuth
// state store and LMS token store already rely on); `.toString("hex")` yields
// exactly 32 lowercase hex chars.
export function generateGrantId(): string {
  const id = randomBytes(16).toString("hex");
  // Defense-in-depth: assert the format the whole contract depends on before
  // the value is ever used as a document id. `randomBytes(16).toString("hex")`
  // is always 32 lowercase hex chars, so this can only fail if the crypto
  // primitive is monkeypatched in a broken way - fail loudly rather than mint
  // a malformed grant id.
  if (!isValidGrantId(id)) {
    throw new Error(
      "[launch-grant-id] generated id is not 32 lowercase hex chars (CSPRNG contract violated)",
    );
  }
  return id;
}
