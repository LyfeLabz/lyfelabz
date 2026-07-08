# auth/

Authentication triggers and helpers.

## Scope

- `authOnUserCreate`: Firebase Auth `onCreate` trigger that provisions the canonical `users/{uid}` document. Idempotent via `.create()` + `ALREADY_EXISTS` handling. Writes only provisioning fields (`uid`, `email`, `displayName`, `photoURL`, `provider`, `createdAt`); `role` and `schoolId` are populated by later onboarding sprints.
- Future: role assignment helpers, custom claims management, sign-out cleanup.

## Not in scope

- Sign-in UI. Authentication is client-driven; this domain observes it.
- Callable functions that create users. Firebase Auth owns user creation.
