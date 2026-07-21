/*
 * Configured-lesson registry. Aggregates every per-lesson config file.
 * The builder engine reads slugs from disk via config.listConfiguredSlugs
 * so this file is a convenience import point, not the source of truth.
 */

"use strict";

const fs = require("fs");
const path = require("path");

function loadAll() {
  const out = {};
  for (const name of fs.readdirSync(__dirname)) {
    if (!name.endsWith(".cjs") || name === "index.cjs") continue;
    const slug = name.slice(0, -".cjs".length);
    // eslint-disable-next-line global-require
    out[slug] = require(path.join(__dirname, name));
  }
  return out;
}

module.exports = { loadAll };
