Staging differentiation certification variant fixtures
======================================================

These two `lesson_staging-cert-fixture__<presentationRevisionId>.html` files are
STAGING/TEST-ONLY certification fixtures for the persistent-differentiation
publication, hosted-byte-liveness, index-activation, and retention paths. They
are NOT instructional content and are NOT legitimate production presentation
revisions.

Why they live here (outside `app/lessons/variants/`)
----------------------------------------------------
They were originally committed under `app/lessons/variants/` and registered in
the production retention manifest (`app/lessons/variants/manifest.json`). That
placement made the production retention verifier
(`app/scripts/lessonBuilder/hostingExclusion.cjs`) require them to be
Hosting-deployable to production forever, and left the raw fixture HTML
publishable from the production Hosting root (`public: "."`).

Because they are staging-only, they were relocated here (Sprint 29G.5L.4):

- This directory is under `platform/**`, which `firebase.json` hosting.ignore
  excludes, so the fixtures are NOT publishable to production (or staging)
  Hosting by construction - no special-case ignore glob is needed.
- They are no longer in the production retention manifest, so the append-only
  production ledger and its "every retained presentation stays deployable"
  invariant apply only to real production presentations.

Where the staging certification still reads them
------------------------------------------------
The ASTRA-004 staging Hosting certification
(`platform/functions/src/scripts/astra004-hosting-prepare.ts` and its test)
reads the fixture bytes from the pinned Git history at commit `cb73aff` and from
the deployed staging origin, never from the working tree, so relocating them at
HEAD does not affect staging certification. The differentiation staging-cert
driver/seed reference only the logical lesson slug `staging-cert-fixture`
(Firestore seed data), never these files' path.
