# auth/

Authentication triggers and helpers.

## Scope

- Firebase Auth `onCreate` trigger that mirrors the user into `users/{uid}` (lands in Sprint 1 Step 8 as `authOnUserCreate`).
- Future: role assignment helpers, custom claims management, sign-out cleanup.

## Not in scope

- Sign-in UI. Authentication is client-driven; this domain observes it.
- Callable functions that create users. Firebase Auth owns user creation.
