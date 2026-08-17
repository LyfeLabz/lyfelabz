# Sprint 25 - B6 Certification Findings

Status: B6 PASSED on clean-environment retest (see §3). Certification is no
longer stopped at B6 and advances to the next runbook scenario. The two
secondary client defects in §2 (2.A draft-persisted wording, 2.B reload
hydration) remain OPEN; B6's passing happy path does not exercise either, so
neither is proven fixed. This document records the defects discovered while
executing B6 (successful LyfeLabz assignment with Google Classroom publication
OFF), the bounded fixes applied to reach the PASS, and the retained defect
trail.

Style: no em dashes. Use " - " (spaced hyphen).

---

## 1. B6 primary blocker (FIXED in the certification seed)

### 1.1 Symptom

During B6, `assignmentsCreateDraft` succeeded for both class rows, but
`assignmentsPublish` failed before commit. The durable draft assignment
documents existed as `status=draft`, yet publication never advanced them to
`published`.

### 1.2 Root cause

`assignmentsPublish` refuses a `draft -> published` transition unless the
referenced lesson already has a deployed assessment. It resolves the current
deployed revision through `resolveCurrentAssessmentRevisionId(lessonSlug)`
(`platform/functions/src/shared/assessment-identifiers.ts`), which reads
`assessments/assessment_<lessonSlug>` and throws `assessments.notDeployed`
when that document (or its `currentRevisionId`) is absent. See
`assignments-publish.ts` (the `resolveCurrentAssessmentRevisionId` call before
the batch commit) and ASSESSMENT_SCORING_CONTRACT.md §12.1.

The certification seed (`platform/functions/seed-emulator.js`) seeded identity
and org data only (`districts`, `schools`, `users`, `lmsProviders`, and the
Auth teacher). It never seeded any assessment. The `assessments` collection
was empty, so publication of every cert lesson failed at
`resolveCurrentAssessmentRevisionId`. This is an ENVIRONMENT defect, not a
defect in `assignmentsPublish`.

### 1.3 Fix (this task)

The seed now deploys a legitimate assessment for every cert lesson through the
certified deployment pipeline (`deployAssessmentRevision`), the sole
legitimate writer of `assessments/*`, `assessmentRevisions/*`, and
`assessmentAnswerKeys/*`. No production callable was changed; no validation
was weakened; there is no certification-only branch and no bypass around
`resolveCurrentAssessmentRevisionId`. The emulator now contains the exact
backend prerequisite production publication expects.

Certification lesson set (bounded, canonical source of truth in
`platform/functions/src/scripts/assessments/cert-lessons.ts`):

| Lesson slug | Assessment id | Current revision id |
|---|---|---|
| `what-is-life` | `assessment_what-is-life` | `assessment_what-is-life__r1` |
| `cell-types` | `assessment_cell-types` | `assessment_cell-types__r1` |
| `biological-evolution` | `assessment_biological-evolution` | `assessment_biological-evolution__r1` |

`verify-seed.js` now fails startup if any cert lesson's assessment, current
revision, or revision/lesson pairing is missing or malformed, so this
environment defect cannot silently recur.

---

## 2. Secondary defects discovered during B6 (OPEN - not fixed here)

These are genuine implementation defects in the client publication surface.
They are NOT the reason `assignmentsPublish` failed, and they are
intentionally NOT fixed in this bounded seed task. They remain OPEN.

### 2.A Draft-persisted failure wording

When `assignmentsCreateDraft` succeeds but `assignmentsPublish` fails, the
client currently reports "LyfeLabz assignment was not created" even though a
durable draft assignment document exists. The message contradicts the
persisted state. The draft was created; only publication failed.

Classification: client wording/state-reporting defect. OPEN.

### 2.B Assigned-state inconsistency between same-session and reload

Same-session lifecycle requires a successful publication before a lesson is
marked "✓ Assigned". Reload hydration, however, marks draft-only lessons
(publication never succeeded) as "✓ Assigned". The two code paths disagree on
what "Assigned" means, so a lesson whose publish failed can appear assigned
after reload while it would not appear assigned in the same session.

Classification: client hydration/state-consistency defect. OPEN.

### 2.C Relationship to B6

Both secondary defects surface on the exact failure path B6 exercises
(draft persisted, publish failed). With the primary blocker fixed, the cert
lessons' publish now succeeds, so B6's own pass path no longer hits these
defects. They still require their own fix before the failure-path scenarios
(for example B16, B23) can be certified, and are tracked here as OPEN.

---

## 3. B6 status - PASS (clean-environment retest)

B6: PASS.

The operator re-ran B6 from a completely clean, deterministically-seeded
certification state and it passed. The assignment completed successfully, the
success toast was clearly visible, and the lesson card changed immediately to
"✓ Assigned" without a page refresh.

This PASS was reached only after the full corrective sequence below. The order
matters and is preserved here so the defect trail is not rewritten:

1. assignmentId correction (shared `assignmentId` derivation).
2. Functions emulator restart (so the corrected runtime was in effect).
3. success-toast presentation correction (the success banner/toast now
   presents on the confirmed happy path).
4. certification deployed-assessment seed correction (§1.3 - the seed deploys
   `what-is-life`, `cell-types`, `biological-evolution` assessments through the
   certified pipeline; `verify-seed.js` gates on `cert assessments: ALL
   PRESENT`).
5. a completely clean emulator restart and canonical reseed (fresh emulators,
   no imported snapshot, `seed-emulator.js`, then `verify-seed.js` PASS), with
   no old failed drafts present.

Clean baseline at retest: classes 0, enrollments 0, lmsClassLinks 0,
auditEvents 0. The teacher then recreated one native LyfeLabz class and one
active Google-Classroom-linked class through the UI, ran B6 on a seeded cert
lesson with both classes selected and "Also publish to Google Classroom" left
OFF, and clicked Assign once.

Observed browser result: PASS. Assignment scheduled; success toast visible;
card flipped to "✓ Assigned" with no refresh. This confirms the B6 pass/fail
criterion: assigning works with publication off and no publish callable fires
(activation without publication is supported).

The earlier B6 failures - caused by the missing deployed-assessment
certification prerequisite - are therefore resolved.

### 3.1 Secondary defects: still OPEN after the B6 PASS

The clean B6 PASS does NOT prove either secondary defect fixed. Both live on
the draft-persisted / publish-failed path, which B6's publication-OFF happy
path never enters:

- 2.A draft-persisted failure wording - OPEN. The "LyfeLabz assignment was not
  created" copy still renders on the `assigned === 0` branch
  (`app/src/shell/surfaces/curriculum.ts`), which is exactly the
  draft-persisted-but-publish-failed case.
- 2.B reload hydration treating draft-only state as "✓ Assigned" - OPEN. The
  same-session lifecycle and reload hydration still disagree on what "Assigned"
  means for a lesson whose publish failed.

Both remain latent and must be fixed before the failure-path scenarios (for
example B16, B20, B23) can be certified. They are NOT in B6's scope and are NOT
fixed by this PASS.
