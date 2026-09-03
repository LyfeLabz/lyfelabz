import * as fs from "fs";
import * as path from "path";

// F5.2 Slice 5 boundary guard. The client transports the OPAQUE launchRef to
// `assessmentSessionsBegin` and nothing more. It must never author a presentation
// selector (`variantKey`/`presentationRevisionId`) or a `deliveryOutcome` on any
// request: Slice 6 derives the pair from the validated launch grant and persists
// the outcome server-side. This proves the begin request layer stays within the
// Slice 5 seam (transport only, no enforcement, no client-authored delivery
// claims).

const ENTRY_SRC = fs.readFileSync(path.resolve(__dirname, "entry.ts"), "utf8");

describe("assessment-begin request boundary (F5.2 Slice 5)", () => {
  test("the begin request the client builds carries only assignmentId and the opaque launchRef", () => {
    // The single request-shape literal built for begin.
    expect(ENTRY_SRC).toContain("{ assignmentId, launchRef }");
    expect(ENTRY_SRC).toContain("{ assignmentId }");
  });

  test("the runtime never authors a presentation pair or deliveryOutcome on a request", () => {
    // These are server-authored (grant-bound) or server-derived; the client
    // must never send them. A match here would mean the client crossed the
    // Slice 6 boundary.
    for (const forbidden of [
      "variantKey",
      "presentationRevisionId",
      "deliveryOutcome",
      "outcomeAtIssuance",
    ]) {
      expect(ENTRY_SRC).not.toContain(forbidden);
    }
  });
});
