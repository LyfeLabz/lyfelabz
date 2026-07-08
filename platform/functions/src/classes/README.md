# classes/

Class lifecycle: join-code minting, enrollment transactions, membership changes.

## Scope

- Join-code generation and rotation with uniqueness guarantees.
- Enrollment writes that must be transactional across `classes/`, `memberships/`, and audit records.
- Membership removal.

## Not in scope

- Assignment authoring. See `assignments/`.
- Submission handling. See `submissions/`.
