import * as fs from "fs";
import * as path from "path";

// Sprint 30 Show Your Thinking: repository-wide contract. Every lesson that
// renders a Show Your Thinking response and submits through the certified
// runtime must hand that text to `lessonQuiz.finalize`, in the canonical
// source and in both generated outputs. Before this, every lesson called
// `finalize(<state>.selected)` alone, so the written response never left the
// browser on the V2 path (only the v1 Apps Script post carried it).
//
// The v1 legacy Sheets post (`thinking`) must remain intact.

const REPO = path.resolve(__dirname, "../../..");

// Lessons with a known, deliberately deferred gap. Conducting Experiments has
// separate in-flight pilot work in its source; its finalize call is updated
// with that work. Remove the slug once it passes (the test below enforces it).
const PENDING = new Set(["conducting-experiments"]);

const FINALIZE_CALL = /window\.lyfelabz\.lessonQuiz\.finalize\(([^)]*)\)/g;
const CANONICAL_ARGS = /^\w+QuizState\.selected, \{ writtenResponse: \w*[tT]hinkingText \}$/;

type Artifact = { readonly slug: string; readonly kind: "source" | "v1" | "v2"; readonly file: string };

function listArtifacts(): Artifact[] {
  const out: Artifact[] = [];
  const add = (dir: string, kind: Artifact["kind"]) => {
    for (const name of fs.readdirSync(dir)) {
      const m = /^lesson_(.+)\.html$/.exec(name);
      if (m) out.push({ slug: m[1]!, kind, file: path.join(dir, name) });
    }
  };
  add(path.join(REPO, "lesson-sources"), "source");
  add(REPO, "v1");
  add(path.join(REPO, "app/lessons"), "v2");
  return out;
}

function finalizeArgs(html: string): string[] {
  return Array.from(html.matchAll(FINALIZE_CALL), (m) => m[1]!.trim());
}

const submitting = listArtifacts()
  .map((a) => ({ ...a, html: fs.readFileSync(a.file, "utf8") }))
  .filter((a) => a.html.includes("Show Your Thinking") && finalizeArgs(a.html).length > 0);

describe("Show Your Thinking reaches the certified finalize call", () => {
  it("covers every submitting lesson in all three forms", () => {
    const counts = { source: 0, v1: 0, v2: 0 };
    for (const a of submitting) counts[a.kind] += 1;
    expect(counts).toEqual({ source: 49, v1: 49, v2: 49 });
  });

  for (const a of submitting.filter((x) => !PENDING.has(x.slug))) {
    it(`${a.kind} lesson_${a.slug} passes its written response to finalize`, () => {
      const args = finalizeArgs(a.html);
      expect(args).toHaveLength(1);
      expect(args[0]).toMatch(CANONICAL_ARGS);
    });
  }

  for (const a of submitting.filter((x) => x.kind !== "v2" && !PENDING.has(x.slug))) {
    it(`${a.kind} lesson_${a.slug} keeps the legacy Sheets thinking field`, () => {
      expect(a.html).toMatch(/params\.set\('thinking', \w*[tT]hinkingText\)/);
    });
  }

  it("pending lessons are still pending (remove them from PENDING once fixed)", () => {
    for (const a of submitting.filter((x) => PENDING.has(x.slug))) {
      expect(finalizeArgs(a.html)[0]).not.toMatch(CANONICAL_ARGS);
    }
  });
});
