# shared/

Cross-domain utilities. Nothing here knows about a specific domain.

## Layout

- `types/` - Firestore document types. Single source of truth for document shapes.
- `errors/` - `PlatformError` base class and named subclasses.
- `logging/` - Structured logger wrapper over `firebase-functions/logger`.
- `auth/` - Canonical custom-claims writer.
- `firestore/` - Admin Firestore accessor and typed reference builders.
- `audit/` - Canonical `auditEvents` writer.

## Rules

- No import from a domain folder. `shared/` is a leaf, not a hub.
- No side effects at module load. Everything here is either a type, a pure function, or a factory.
