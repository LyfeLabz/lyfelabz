// F5.3 Slice 2 - revision-bound response validation.
//
// The ONE validator both authoritative boundaries share
// (ASSESSMENT_SCORING_CONTRACT.md §16 item 8): `assessmentSessionsAutosave`
// rejects an invalid response before it is stored, and
// `assessmentAttemptsFinalize` re-validates the stored responses inside the
// scoring transaction before anything is scored. A response is valid only
// when its `itemId` names an item of the session's frozen assessment revision
// and its value is admissible for that item's `itemType`. For the v1
// `singleChoice` type that means a string equal to one of the item's
// canonical `optionId` values (§8.2, §8.3). Anything else fails closed: it is
// never stored by autosave and never silently scored as incorrect.
//
// The validator reads only the student-visible revision (item ids, item
// types, option ids). It never sees the answer key, so no correctness data
// can reach a client through a validation message.
//
// Per-item-type branching follows §15.4: a future item type adds its own
// admissibility rule here. Until it does, responses to an item of an
// unsupported type are refused rather than accepted opaquely.
//
// F5.3 Slice 5: `allowedOptionIdsByItem` is the canonical admissible set; for
// a session that froze an assessment presentation, both boundaries narrow it
// with `narrowToDisplayedOptions` before calling `findInvalidResponse`.

export type ResponseValidationRevision = {
  readonly items?: ReadonlyArray<{
    readonly itemId: string;
    readonly itemType: string;
    readonly options?: ReadonlyArray<{ readonly optionId: string }>;
  }>;
};

// itemId -> admissible single-choice optionIds, or `null` when the item's
// type has no admissibility rule yet (every response to it is refused).
export type AllowedResponseIndex = ReadonlyMap<string, ReadonlySet<string> | null>;

export type InvalidResponseReason =
  | "unknownItem"
  | "unsupportedItemType"
  | "nonStringResponse"
  | "unknownOption";

export type InvalidResponse = {
  readonly index: number;
  readonly itemId: string;
  readonly reason: InvalidResponseReason;
};

export function allowedOptionIdsByItem(
  revision: ResponseValidationRevision,
): AllowedResponseIndex {
  const index = new Map<string, ReadonlySet<string> | null>();
  for (const item of revision.items ?? []) {
    if (item.itemType === "singleChoice") {
      index.set(
        item.itemId,
        new Set((item.options ?? []).map((option) => option.optionId)),
      );
    } else {
      index.set(item.itemId, null);
    }
  }
  return index;
}

// F5.3 Slice 5: narrows the canonical admissible set to the options a frozen
// assessment presentation DISPLAYED for each item (canonical AND displayed).
// An item the presentation does not display is left with no admissible
// option, and an item type without a rule stays refused. A canonical option
// the presentation deliberately omitted (a three-choice presentation's fourth
// distractor) is therefore refused even though the revision contains it.
export function narrowToDisplayedOptions(
  allowed: AllowedResponseIndex,
  displayedByItem: ReadonlyMap<string, ReadonlySet<string>>,
): AllowedResponseIndex {
  const narrowed = new Map<string, ReadonlySet<string> | null>();
  for (const [itemId, canonical] of allowed) {
    if (canonical === null) {
      narrowed.set(itemId, null);
      continue;
    }
    const displayed = displayedByItem.get(itemId) ?? new Set<string>();
    narrowed.set(itemId, new Set([...canonical].filter((optionId) => displayed.has(optionId))));
  }
  return narrowed;
}

// Returns the first invalid response (in array order), or null when every
// response is admissible. Missing items are not checked here: an unanswered
// item is the absence of its element (§8.4) and is scored by the scorer.
export function findInvalidResponse(
  responses: ReadonlyArray<{ readonly itemId: string; readonly response: unknown }>,
  allowed: AllowedResponseIndex,
): InvalidResponse | null {
  for (let index = 0; index < responses.length; index += 1) {
    const { itemId, response } = responses[index];
    if (!allowed.has(itemId)) {
      return { index, itemId, reason: "unknownItem" };
    }
    const optionIds = allowed.get(itemId);
    if (optionIds === null || optionIds === undefined) {
      return { index, itemId, reason: "unsupportedItemType" };
    }
    if (typeof response !== "string") {
      return { index, itemId, reason: "nonStringResponse" };
    }
    if (!optionIds.has(response)) {
      return { index, itemId, reason: "unknownOption" };
    }
  }
  return null;
}

// Client-safe diagnostic. Names only the item and the rule; it never echoes
// the submitted value or any revision/answer-key content.
export function describeInvalidResponse(invalid: InvalidResponse): string {
  const at = `responses[${String(invalid.index)}] (itemId "${invalid.itemId}")`;
  switch (invalid.reason) {
    case "unknownItem":
      return `${at} is not an item of this assessment revision.`;
    case "unsupportedItemType":
      return `${at} has an item type that does not accept responses.`;
    case "nonStringResponse":
      return `${at} must be the selected optionId string.`;
    case "unknownOption":
      return `${at} is not one of the item's optionIds.`;
  }
}
