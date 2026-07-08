# LyfeLabz Emulator Suite Guide

Sprint 1 development and verification happen exclusively against the Firebase Emulator Suite. No live deploys occur during Sprint 1.

## Configured emulators

| Emulator     | Port |
|--------------|------|
| Auth         | 9099 |
| Firestore    | 8080 |
| Functions    | 5001 |
| Storage      | 9199 |
| Emulator UI  | 4000 |

`singleProjectMode` is enabled so the emulators only accept requests for the configured project (`lyfelabz-prod`), preventing accidental cross-project contamination during local development.

## Starting the emulators

From `platform/firebase/`, run:

```
firebase emulators:start
```

The Emulator UI will be available at `http://localhost:4000` once the suite is running.

## Intentionally deferred emulators

The following emulators are intentionally not configured yet. Each will be added by the sprint step that introduces its backing configuration:

- **Hosting** - deferred until a `hosting` block exists in `firebase.json`. Sprint 1 does not configure Hosting for production; it will be initialized minimally in a later step so future sprints can build on it.

Each emulator is added only after the configuration it depends on is in place.

## Prerequisites

The Firebase Emulator Suite requires a Java runtime (JDK 11 or newer) for the Firestore emulator. If `firebase emulators:start` fails on Firestore startup, verify Java is installed and available on `PATH`.

## Deploy policy

No `firebase deploy` command should be run during Sprint 1. All verification happens against the local Emulator Suite. Deploy configuration is a later sprint.
