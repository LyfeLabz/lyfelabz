import * as fs from "fs";
import * as path from "path";

import { planAssessmentRevision } from "./assessment-deployment";
import {
  allowedOptionIdsByItem,
  describeInvalidResponse,
  findInvalidResponse,
  narrowToDisplayedOptions,
} from "./response-validation";

// F5.3 Slice 2 - the shared revision-bound response validator used by both
// autosave and finalize. Pure: no Firestore, no answer key.

const REVISION = {
  items: [
    {
      itemId: "q1",
      itemType: "singleChoice",
      options: [{ optionId: "A" }, { optionId: "B" }, { optionId: "C" }, { optionId: "D" }],
    },
    {
      itemId: "q2",
      itemType: "singleChoice",
      options: [{ optionId: "A" }, { optionId: "B" }],
    },
  ],
};

describe("findInvalidResponse", () => {
  const allowed = allowedOptionIdsByItem(REVISION);

  it("admits canonical optionIds, partial submissions, and no answers", () => {
    expect(findInvalidResponse([{ itemId: "q1", response: "D" }, { itemId: "q2", response: "A" }], allowed)).toBeNull();
    expect(findInvalidResponse([{ itemId: "q2", response: "B" }], allowed)).toBeNull();
    expect(findInvalidResponse([], allowed)).toBeNull();
  });

  it.each([
    ["unknown item", [{ itemId: "q9", response: "A" }], "unknownItem"],
    ["optionId of another item", [{ itemId: "q2", response: "C" }], "unknownOption"],
    ["unknown optionId", [{ itemId: "q1", response: "E" }], "unknownOption"],
    ["case variant", [{ itemId: "q1", response: "a" }], "unknownOption"],
    ["null", [{ itemId: "q1", response: null }], "nonStringResponse"],
    ["number", [{ itemId: "q1", response: 0 }], "nonStringResponse"],
    ["object", [{ itemId: "q1", response: { optionId: "A" } }], "nonStringResponse"],
  ])("rejects %s", (_label, responses, reason) => {
    expect(findInvalidResponse(responses, allowed)).toMatchObject({ reason, index: 0 });
  });

  it("reports the first invalid element in array order", () => {
    expect(
      findInvalidResponse(
        [{ itemId: "q1", response: "A" }, { itemId: "q2", response: "Z" }, { itemId: "q9", response: "A" }],
        allowed,
      ),
    ).toEqual({ index: 1, itemId: "q2", reason: "unknownOption" });
  });

  it("refuses every response to an item type without an admissibility rule", () => {
    const index = allowedOptionIdsByItem({
      items: [{ itemId: "q1", itemType: "freeText", options: [{ optionId: "A" }] }],
    });
    expect(findInvalidResponse([{ itemId: "q1", response: "A" }], index)).toMatchObject({
      reason: "unsupportedItemType",
    });
  });

  it("diagnostics name the item and rule but never the submitted value", () => {
    const message = describeInvalidResponse({ index: 3, itemId: "q4", reason: "unknownOption" });
    expect(message).toBe(`responses[3] (itemId "q4") is not one of the item's optionIds.`);
  });
});

describe("canonical four-choice compatibility with every committed payload", () => {
  // The canonical lesson runtime maps display index -> OPTION_LETTERS[index]
  // (app/src/runtime/entry.ts). Every letter it can send for an item must be
  // admitted, or hardening would break existing canonical lessons.
  const OPTION_LETTERS = ["A", "B", "C", "D"];
  const dir = path.join(__dirname, "..", "scripts", "assessments");
  const files = fs.readdirSync(dir).filter((f) => /\.r\d+\.json$/.test(f)).sort();

  it("discovers the committed payloads", () => {
    expect(files.length).toBeGreaterThanOrEqual(49);
  });

  it.each(files)("%s admits every runtime letter and nothing else", (file) => {
    const plan = planAssessmentRevision(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
    const allowed = allowedOptionIdsByItem(plan.revisionWrite);
    for (const item of plan.revisionWrite.items) {
      const letters = OPTION_LETTERS.slice(0, item.options.length);
      for (const response of letters) {
        expect(findInvalidResponse([{ itemId: item.itemId, response }], allowed)).toBeNull();
      }
      expect(findInvalidResponse([{ itemId: item.itemId, response: "E" }], allowed)).not.toBeNull();
    }
  });
});

describe("narrowToDisplayedOptions (F5.3 Slice 5)", () => {
  const allowed = allowedOptionIdsByItem(REVISION);

  it("admits only options that are canonical AND displayed", () => {
    const narrowed = narrowToDisplayedOptions(allowed, new Map([
      ["q1", new Set(["C", "A", "D"])],
      ["q2", new Set(["A", "B"])],
    ]));
    expect(findInvalidResponse([{ itemId: "q1", response: "C" }], narrowed)).toBeNull();
    expect(findInvalidResponse([{ itemId: "q1", response: "B" }], narrowed)).toMatchObject({ reason: "unknownOption" });
  });

  it("never widens past the canonical revision (a displayed id the revision lacks stays refused)", () => {
    const narrowed = narrowToDisplayedOptions(allowed, new Map([["q2", new Set(["A", "B", "Z"])]]));
    expect(findInvalidResponse([{ itemId: "q2", response: "Z" }], narrowed)).toMatchObject({ reason: "unknownOption" });
  });

  it("an item the presentation does not display admits nothing; unsupported types stay refused", () => {
    const narrowed = narrowToDisplayedOptions(allowed, new Map([["q1", new Set(["A", "B"])]]));
    expect(findInvalidResponse([{ itemId: "q2", response: "A" }], narrowed)).toMatchObject({ reason: "unknownOption" });
    const withUnsupported = narrowToDisplayedOptions(
      allowedOptionIdsByItem({ items: [{ itemId: "q1", itemType: "freeText", options: [{ optionId: "A" }] }] }),
      new Map([["q1", new Set(["A"])]]),
    );
    expect(findInvalidResponse([{ itemId: "q1", response: "A" }], withUnsupported)).toMatchObject({ reason: "unsupportedItemType" });
  });
});
