# submissions/

Assignment submission creation, finalization, and (later) rollups.

## Sprint 5A scope

- `submissionsCreate`: creates a `submissions/{submissionId}` document in
  the transient `submitted` state per Data Model §3.7. Deterministic ID
  `{assignmentId}__{studentId}` enforces §5.6 uniqueness of the current
  attempt at the write boundary. Idempotent under a matching existing
  `submitted` record.
- `submissionsFinalize`: advances the lifecycle field from `submitted` to
  `finalized`, stamps `submittedAt` server-side, and preserves every
  frozen ownership field. Idempotent under an already-`finalized` record
  owned by the caller.

## Not in scope for Sprint 5A

- Teacher grading, rubrics, feedback, analytics, gradebook.
- Rollup maintenance per the Submission Rollup Strategy.
- Any client submission UI, teacher dashboard UI, administrator UI.
- Background processing and scheduled maintenance.
