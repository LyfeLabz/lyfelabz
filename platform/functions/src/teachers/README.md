# teachers/

Teacher-facing callable functions.

## Scope

- Class creation and archival.
- Assignment authoring lifecycle actions that require server authority.
- Roster management operations that are not simple client writes.

## Not in scope

- Read-only teacher queries. Those go through Firestore directly, gated by rules.
- Student-facing operations. See `students/`.
