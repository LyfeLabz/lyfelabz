/*
 * Shared content-hash utility.
 *
 * One SHA-256 implementation for the whole lesson-build tree: the
 * canonical build (index.cjs) and the differentiated-presentation
 * identity contract (variantIdentity.cjs) both hash exact final artifact
 * bytes through this function, never through a second implementation.
 */

"use strict";

const crypto = require("crypto");

function sha256Hex(bytes) {
  if (typeof bytes !== "string" && !Buffer.isBuffer(bytes)) {
    throw new Error("[hash] sha256Hex requires a string or Buffer of the exact bytes to hash");
  }
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

module.exports = { sha256Hex };
