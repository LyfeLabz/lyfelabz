# LyfeLabz Cloud Functions

Cloud Functions source for the LyfeLabz platform. TypeScript, Node 20, strict mode.

## Layout

```
src/
    index.ts        Top-level entry. Re-exports each domain's public surface.
    auth/           Authentication triggers (Firebase Auth onCreate, etc.).
    teachers/       Teacher-facing callable functions.
    students/       Student-facing callable functions.
    classes/        Class lifecycle: join codes, enrollment, membership.
    submissions/    Assignment submission finalization and rollups.
    assignments/    Assignment authoring and lifecycle.
    audit/          Audit-record helpers and any audit-only triggers.
    shared/         Cross-domain utilities:
                        types/      Firestore document types (single source of truth).
                        errors/     PlatformError base class + subclasses.
                        logging/    Structured-logger wrapper around firebase-functions/logger.
```

Every domain folder owns its own README describing what belongs inside it. Sprint 1 creates the folders empty; later sprints add code to a folder that already exists.

## Scripts

- `npm run build` - compile TypeScript to `lib/`.
- `npm run typecheck` - `tsc --noEmit`.
- `npm run lint` - ESLint over `src/`.

## Status

Sprint 1 Step 7: scaffold only. No function behavior is implemented. The `authOnUserCreate` trigger lands in Sprint 1 Step 8.

See:

- `docs/platform/LYFELABZ_ENGINEERING_STANDARDS.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/LYFELABZ_SPRINT_1_FIREBASE_FOUNDATION.md`
