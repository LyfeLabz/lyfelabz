# shared/logging/

Structured-logger wrapper over `firebase-functions/logger`.

All server code logs through this wrapper. Event names are dotted, past-tense, domain-first (e.g., `auth.userCreated`). Payloads are structured; no string interpolation of values into the message.
