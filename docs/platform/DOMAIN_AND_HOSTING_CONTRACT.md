# LyfeLabz Domain and Hosting Contract

**Status:** Canonical. Governs domain ownership, Firebase Hosting targets, and
the paired Hosting release, certification, and rollback procedure.
**Established:** October 2026 (Phase 1 of the domain and Hosting architecture).
**Machine-readable contract:** `scripts/hosting-release/hosting-contract.json`.

Where an older document (sprint reports, `WWW_APP_LESSON_DELIVERY_2026-10-04.md`,
earlier runbooks) describes a different Hosting deploy procedure, this document
controls.

---

## 1. Domain ownership (locked)

### `lyfelabz.com` (and `www.lyfelabz.com`)

The public brand and front-door origin. It canonically owns the homepage `/`,
About and other public brand pages, `/privacy`, `/terms`, the blog, Wonder Box,
and similar marketing content.

### `app.lyfelabz.com`

The instructional and application origin. It canonically owns Teacher
Workspace, My Science, everything under `/app/**`, assignment deep links
(`https://app.lyfelabz.com/app/a/{assignmentId}`), the LMS OAuth callback
(`/app/lms-callback.html`), standard and v2 lessons, assessment revisions,
differentiated variants, simulations, investigations, extensions, challenges,
activities, games, maps, disease and system resources, instructional tools,
Ball Run, and future instructional resources.

### The app-root homepage exception

`https://app.lyfelabz.com/` intentionally serves the same homepage and catalog
as the apex. Student Explore LyfeLabz and return links navigate to `/` on the
application origin so per-tab session state (Back to My Science) survives. Its
canonical homepage URL remains `https://lyfelabz.com/`. Do not redirect the
app root to the apex.

### Current routing (unchanged by Phase 1)

- Marketing redirects `/app`, `/app/` and root `lesson_<slug>.html` (301) to
  the same path on `app.lyfelabz.com`, and rewrites `/privacy` and `/terms`.
- App redirects `/privacy` and `/terms` (301) to the apex.
- Other instructional resources are still served by both sites. Later phases
  (section 9) move them to app-only delivery.

---

## 2. Hosting targets

Production Firebase project `lyfelabz-prod` has two Hosting sites. The
repository-root `firebase.json` declares them as two deploy targets in a
`hosting` array. Entries name a `target`, never a hard-coded `site`.

| Target | Public directory | Production site | Domains |
| --- | --- | --- | --- |
| `app` | `dist/app-hosting` | `lyfelabz-prod` (default site) | `app.lyfelabz.com` |
| `marketing` | `dist/marketing` | `lyfelabz-marketing` | `lyfelabz.com`, `www.lyfelabz.com` |

`.firebaserc` owns the target-to-site mappings:

| Project | `app` | `marketing` |
| --- | --- | --- |
| `lyfelabz-prod` | `lyfelabz-prod` | `lyfelabz-marketing` |
| `lyfelabz-staging` | `lyfelabz-staging` | `lyfelabz-staging-marketing` |

Targets are local aliases only. Applying or editing them never changes a
site's custom-domain bindings; domains belong to sites. The real risk is a
mis-mapped target (for example `app` pointing at `lyfelabz-marketing`), so
`scripts/hosting-release/config.test.cjs` pins every mapping exactly and checks
them with firebase-tools' own target resolution.

There is no `firebase.marketing.json`. The marketing site deploys only as the
`marketing` target of `firebase.json`.

### Staging

`firebase.staging.json` is a committed, generated, **Hosting-only** config. It
is `firebase.json`'s two Hosting targets with each production origin in a
redirect destination replaced by its staging origin (`app.lyfelabz.com` to
`lyfelabz-staging.web.app`, `lyfelabz.com` to
`lyfelabz-staging-marketing.web.app`). Any other absolute destination fails
generation. Because it carries no Functions, Firestore, or Storage blocks, even
an accidental bare deploy with it can only touch Hosting.

- Regenerate: `node scripts/hosting-release/staging-config.cjs`
- Drift check: `node scripts/hosting-release/staging-config.cjs --check` (also
  enforced by `config.test.cjs` and `prepare`)

Staging mirrors production with a permanent second site in `lyfelabz-staging`:
site `lyfelabz-staging-marketing` (`https://lyfelabz-staging-marketing.web.app`,
no custom domain, no Auth setup; the homepage loads no Firebase SDK). Until that
site is created, a staging pair deploy fails on the marketing target, and the
staging app's `/privacy` and `/terms` redirects point at the not-yet-created
site. One-time creation (human-authorized; new infrastructure):

```sh
firebase hosting:sites:create lyfelabz-staging-marketing --project lyfelabz-staging
```

---

## 3. One build for both sites

Both targets use the same predeploy, `node scripts/hosting-release/build-pair.cjs`:

1. Assert the committed homepage catalog matches the curriculum registry
   (`assertCatalogCurrent`). Builders never regenerate the catalog; drift fails
   the build. Regenerate with `npm --prefix app run curriculum:build` and
   commit.
2. Build the application bundle (`npm --prefix app run build`).
3. Build both artifacts from their manifests
   (`scripts/app-hosting/public-files.json` composes
   `scripts/marketing-hosting/public-files.json`).
4. Run the pair gate (section 5).
5. Record source SHA and file hashes in `dist/hosting-release/pair-build.json`.

A two-target deploy runs it once per target; the second run rebuilds identical
bytes. Even an emergency single-target deploy therefore builds and gates both.

---

## 4. Path classes (`hosting-contract.json`)

Served inventories are modeled after Hosting `ignore` (same minimatch model as
`app/scripts/lessonBuilder/hostingExclusion.cjs`), not raw build directories.

| Class | Rule | Phase 1 |
| --- | --- | --- |
| Shared, must match (default) | Any path served by both targets is byte-identical | Homepage, `assets/**`, legal and About pages, root resources, `robots.txt`, `sitemap.xml`, `ball*/` |
| Marketing-only | Never served by app | `blog/**`, `wonderbox/**` |
| App-only | Never served by marketing | `app/**` |
| App-required | Must be served by app | `app/index.html`, `app/dist/bundle.js`, `app/lms-callback.html` |
| Host-specific | Shared path allowed to differ; needs a reason | Empty |

Every marketing path that is not marketing-only must also be served by app.

---

## 5. Release gates

| Gate | Where |
| --- | --- |
| `firebase.json` has exactly `app` and `marketing`, no `site`; `.firebaserc` mappings exact; no `firebase.marketing.json`; staging config generated and Hosting-only | `config.test.cjs`, `prepare` |
| Catalog matches registry; both homepage copies identical | builders, pair gate |
| Shared paths byte-identical (including runtime assets); marketing-only, app-only, app-required ownership | pair gate (`pair.test.cjs`) |
| Each builder's exact inventory, dependency and bundle-hygiene checks | `scripts/app-hosting`, `scripts/marketing-hosting` suites |
| Live routing config equals the local target config | `prepare` (reports), `certify` (enforces) |
| Every served path live equals the artifact; contract route and redirect samples; catalog navigation to current app lessons | `certify` |

Current GitHub Actions CI runs only for `platform/**` changes. It does **not**
run `npm --prefix app run verify`, `curriculum:verify`, or the Hosting suites.
`prepare` is the required release protection.

---

## 6. Release procedure

Build from an isolated clean checkout or worktree of the exact release commit
with real installed dependencies (`npm --prefix app ci`; never a symlinked
`node_modules`).

1. **Prepare** (never deploys):

   ```sh
   node scripts/hosting-release/prepare.cjs --project lyfelabz-prod --expect-sha <sha>
   ```

   Refuses: a missing or unsupported project (the `.firebaserc` default alias
   is never used), a dirty checkout, a SHA mismatch, config or catalog drift,
   failing `npm --prefix app run verify`, failing Hosting suites, or a failing
   pair gate. It records both sites' live versions as the rollback baseline,
   reports routing-config and byte changes per site, and prints the exact
   deploy and rollback commands. Records go to `dist/hosting-release/`
   (ignored; never commit them). Staging may use `--allow-dirty` and
   `--offline`; production may not.

2. **Deploy** (separately authorized):

   ```sh
   firebase deploy --only hosting:app,hosting:marketing --project lyfelabz-prod --message "release <sha>" --non-interactive
   ```

   Staging adds `--config firebase.staging.json --project lyfelabz-staging`.
   Never document or run a bare `firebase deploy` or `firebase deploy --only
   hosting`: with two targets, `--only hosting` deploys both sites, and a bare
   deploy also deploys Functions, Rules, indexes, and Storage.

3. **Certify** from the same checkout:

   ```sh
   node scripts/hosting-release/certify.cjs --project lyfelabz-prod
   ```

4. **Record** the certified pair (source SHA, both site versions, both previous
   versions) in the release report or ledger.

---

## 7. The two-site deploy is NOT atomic

firebase-tools (verified in 15.22.4) runs every predeploy, creates a version
per site, uploads each site's files, and only then finalizes and releases both
sites **concurrently** (`Promise.all`). There is no cross-site transaction and
no automatic rollback.

| Failure | Result | Recovery |
| --- | --- | --- |
| Build, gate, version creation, or upload | Neither site releases (unreleased versions are harmless) | Fix and rerun |
| Release phase: app released, marketing failed | Marketing stays on its previous version | Roll forward: rerun the deploy for `hosting:marketing` from the same checkout and SHA; otherwise roll app back to the pair baseline |
| Release phase: marketing released, app failed | Marketing may be newer than app | Roll forward app; otherwise roll marketing back |

If the two sites must ever be deployed separately, deploy **app first,
marketing second**: marketing redirects into app paths, so app must already
serve them.

---

## 8. Rollback

Every release is a pair: source SHA, app version, marketing version. A normal
rollback restores **both** sites to the previous certified pair with the
verified command form:

```sh
firebase hosting:clone lyfelabz-prod@<appVersion> lyfelabz-prod:live --project lyfelabz-prod
firebase hosting:clone lyfelabz-marketing@<marketingVersion> lyfelabz-marketing:live --project lyfelabz-prod
```

`prepare` prints these for the recorded baseline; `certify` prints them on
failure. Cloning restores the exact files and routing config of that version
without a rebuild. (Older documents show `hosting:clone <site>:<version>`,
which the CLI reads as a channel name, and `hosting:releases:rollback`, which
does not exist; do not use them.) Rebuilding a previous commit is a fallback
only.

A single-site rollback is an emergency state only. Record it as a split pair
and follow it with a coherent pair release.

---

## 9. Later phases (not implemented)

- Apex instructional redirects: every instructional resource prefix on the
  apex redirects to the same path on `app.lyfelabz.com`, derived from
  `app/src/curriculum/curriculum.resource-types.json`, with samples added to
  `hosting-contract.json`.
- Canonical normalization (instructional pages declare `app.lyfelabz.com`;
  broken Fossil Hunt, Chernobyl Frogs, and Cell Energy canonicals corrected).
- Per-host sitemap and robots, declared as host-specific exceptions with
  certification checks beside the existing ones in `certify.cjs`.
- Lab Report Assistant, Ball Run, and registry cleanup.
- CI coverage for `app verify` and the Hosting suites.
