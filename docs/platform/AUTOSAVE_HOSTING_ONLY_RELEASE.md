# Autosave Hosting-only release (prepared November 2, 2026)

Status: implementation ready for review/commit; no commit, push, live inspection,
Firebase data change or deployment performed. Production release is NOT yet ready.
This mode extends the existing paired Hosting prepare/predeploy/certify pipeline.

## Source and scope

Use `codex/autosave-hosting-release` in the isolated
`/Users/breezy/.codex/worktrees/autosave-hosting-release/lyfelabz` checkout.
Its uncommitted correction is based on
`d48bda890401bfb5b26ad3e408c2c0175f176eb2` (`feature/assessment-runtime-packaging-v2`).
That commit already contains `8720dab` autosave reliability, `d48bda8` runtime
packaging and `b00744c` Student Support V2 production closure. Do not cherry-pick
either autosave commit. The older branch's unique `4a009b4` registry retry patch
is byte-equivalent to `c67c122` already in this history. No integration is needed.
The original `lyfelabz` checkout's 18 uncommitted files must stay untouched. The
unrelated dirty `lyfelabz-frontend-only-release` checkout is also outside this work.

The production record `RELEASE_2026-10-30_STUDENT_SUPPORT_V2.md` documents backend
source `3cbfdcf621bb1912c9f3188cbef8696e1b644593`, backend build
`5700f199e1c42a061ea681645b9d5c25fd1b361812da078fad17f7626103a0a0`, enabled
policy instance `19592fb6-bddc-45d7-8c64-df2d50cabfcc`, generation 6. These are
historical facts, not an observation of today's deployment. Reconcile against
fresh provider evidence before proceeding; do not automatically repair drift.

`assessmentSessionsBegin` retains its existing source `maxInstances: 20`.
This release deploys no Functions, so it does not apply any source-side scaling
setting to production. All deployed Function limits and Classroom bindings must
remain identical before and after this release.

## Blocker and bounded correction

`general` uses the canonical closed Teacher Units compiler substitution. It cannot
preserve the existing enabled My Units UI. Target-bound `teacher-units` uses the
policy-capable compiler, but builds a new clean policy-controlled Functions
artifact, requires its source SHA to equal the Hosting source SHA, and compares it
to the deployed build. Building from a new Hosting commit therefore fails against
the unchanged deployed backend. Neither changing the label to general nor
redeploying Functions is an acceptable fix for this release.

The explicit `teacher-units-hosting-only` route:

- Uses the existing target/origin-bound `teacher-units` compiler profile. It
  neither invents a client gate nor grants availability.
- Reads the existing policy before and after the current nine-endpoint Option B
  observation. Requires a valid enabled schema-2 policy, accepted v3 protocol,
  matching approved backend build and placement. Captures the full policy and
  its metadata. Closed/missing/invalid policy is refused, without changing it.
- Records a clean Hosting SHA separately from the deployed backend's original
  source SHA. Requires the backend SHA to be an ancestor and unchanged tracked
  Teacher Units client/backend source directories, including worktree changes.
  A new Teacher Units implementation needs a separate compatibility review.
- Pins the complete backend observation except observation clocks: source
  generations, build/runtime inventory, revisions/configuration, inventory,
  database, Rules resource/hash, required indexes and reviewed configuration.
  Full policy bytes and updateTime participate, so generation or policy changes
  refuse even if an operator changes back to similar values.
- Reuses active Option B configuration, artifact, Rules approval and compatibility
  checks against the original backend-scoped candidate. It does not weaken the
  existing same-SHA check or relabel the Hosting SHA as the backend SHA.
- Recompiles and checks the app output, HTML entry and target; rebuilds the
  assessment runtime before both packagers; preserves pair parity, routing,
  navigation, served-byte checks and rollback baselines.
- Retrieves fresh backend/policy evidence during prepare, each target's predeploy
  and certification, comparing the original pin. It never rebuilds/redeploys
  Functions in this mode. Local Functions compilation supplies tooling modules
  only; it is not candidate backend identity.
- Emits a distinct receipt with Hosting SHA, backend SHA/build, policy instance
  and generation, both Hosting versions, rollback pair and retained approvals.
  It is historical release evidence, never activation authority or a replacement
  for the existing backend enable/close workflow.

No backend source, runtime security policy, Firestore rules/indexes, secret
bindings, Firebase configuration or application behavior changes in this patch.
Existing `general`, `teacher-units` and staging-only UX modes remain distinct.

## Human sequence (do not execute deployment without authorization)

1. In GitHub Desktop, add the isolated checkout above as a local repository and
   select `codex/autosave-hosting-release`. Do not switch the older dirty checkout.
   Confirm HEAD is `d48bda8` and both autosave commits are ancestors. Review exactly
   the 12 files listed below, including the evidence schema/refusal tests.
2. Commit only those 12 genuinely new correction files. Suggested message:
   **Certify Hosting releases against unchanged Teacher Units backends**.
   Do not select runtime assets, dependencies, dist records or any original WIP.
3. Push this branch only after approval. Review the branch/CI in GitHub. Record
   the approved full commit SHA as `LYFE_RELEASE_SHA`. Do not merge or cherry-pick
   the autosave changes again. Keep the reviewed branch's resulting commit intact
   through staging and production; a changed SHA needs renewed staging acceptance.
4. Use a clean checkout of that approved commit. Install locked dependencies
   sequentially (`npm --prefix app ci`, then `npm --prefix platform/functions ci`).
   Run `npm --prefix platform/functions run build` once to supply local tooling
   libraries. This is local compilation, not a deployment or backend approval.
   Require `git status --porcelain` to be empty. A generated runtime difference
   must be investigated and reviewed; never discard source changes to force it.
5. Obtain the existing schema-2 Rules approval/report/approved digest and the
   schema-2 configuration approval for EACH environment's currently deployed
   backend. Reuse unchanged, valid source-scoped Rules evidence; do not rewrite
   it to fit. The configuration approval must retain the DEPLOYED backend's
   source/build identity, not the new Hosting SHA. File paths and owner approval
   digest are private inputs, not known defaults. If unavailable or incompatible,
   STOP. No new backend deployment, close/prepare/enable policy operation or
   secret rebinding is part of this sequence.
6. Save the shell helpers below and set the six explicit environment-specific
   inputs. Capture staging's before snapshot; run staging prepare with
   `--expect-sha`; inspect its new/changed files, both live rollback versions,
   backend source/build and policy pin. Retain its prepare/pair records outside
   the repository before deploying. Inspect that only the intended autosave and
   release-tool changes are present. Any unexpected routing/Teacher Units
   change stops the release.
7. After separate staging deployment authorization, deploy the paired targets
   and certify with the commands below. Both predeploys repeat the compatibility
   observation. Certification must emit `teacher-units-hosting-only` and
   `unchanged-enabled-backend-observed`. Capture/compare the after snapshot.
8. Browser acceptance on staging: autosave a choice then edit text while saving;
   verify the latest state survives reload/reopen; exercise rapid edits, retry
   after interrupted connectivity, final submission/review, and saved/progress
   feedback. Verify My Units list/get/create/update/resources/reorder/archive/
   restore using disposable staging fixtures, registry retry, Student Support V2
   workspace and revocation paths, and marketing-to-app navigation. Preserve
   test evidence and owner acceptance for THIS exact Hosting SHA and backend pin.
   Staging writes use staging fixtures only, never production students.
9. Only after acceptance and separate production authorization, use the SAME
   clean approved SHA. Switch explicit environment inputs to production and
   capture its before snapshot. Prepare production; review both current rollback
   baselines and historical production identity above against the actual pin.
   An operator decision is required for drift, not an automated policy change.
10. Deploy only the two Hosting targets, certify, and capture/compare after state.
    Perform read-only production acceptance: saved assessment reload/review using
    an approved test account, intact My Units/Unit Results and Student Services,
    existing Student Support reads, redirects and navigation. Do not create units,
    grants, attempts or edit real student records for production verification.
    Any writable production acceptance requires a separately approved fixture.
    Retain exact SHA, all paired version IDs, prepared/certified receipts,
    snapshots/diffs, approvals, staging acceptance and browser results privately.

Set inputs explicitly per environment. These variables are placeholders to fill
with the approved private evidence paths/digest, not new evidence generated here:

```sh
cd /Users/breezy/.codex/worktrees/autosave-hosting-release/lyfelabz
LYFE_RELEASE_SHA='<full approved commit SHA>'
LYFE_PROJECT='lyfelabz-staging' # later: lyfelabz-prod
LYFE_CONFIG='firebase.staging.json' # later: firebase.json
LYFE_RULES_APPROVAL='/absolute/path/to/existing-environment-rules-approval.json'
LYFE_RULES_REPORT='/absolute/path/to/approved-rules-report.json'
LYFE_APPROVAL_DIGEST='<approved 64-character Rules approval digest>'
LYFE_CONFIGURATION_APPROVAL='/absolute/path/to/deployed-backend-configuration-approval.json'
LYFE_EVIDENCE='/absolute/path/to/private/release-evidence/staging' # distinct production directory later
mkdir -p "$LYFE_EVIDENCE"

prepare_hosting() {
  node scripts/hosting-release/prepare.cjs \
    --project "$LYFE_PROJECT" --intent teacher-units-hosting-only \
    --expect-sha "$LYFE_RELEASE_SHA" \
    --rules-approval "$LYFE_RULES_APPROVAL" --rules-report "$LYFE_RULES_REPORT" \
    --approval-digest "$LYFE_APPROVAL_DIGEST" \
    --configuration-approval "$LYFE_CONFIGURATION_APPROVAL"
}
certify_hosting() {
  node scripts/hosting-release/certify.cjs \
    --project "$LYFE_PROJECT" --intent teacher-units-hosting-only \
    --rules-approval "$LYFE_RULES_APPROVAL" --rules-report "$LYFE_RULES_REPORT" \
    --approval-digest "$LYFE_APPROVAL_DIGEST" \
    --configuration-approval "$LYFE_CONFIGURATION_APPROVAL"
}
# Invoke in this order for staging, then production after staging acceptance:
# snapshot_functions "$LYFE_EVIDENCE/before-functions.json"
# prepare_hosting
# Review and retain prepare + pair records; obtain deployment authorization.
# firebase deploy --only hosting:app,hosting:marketing --config "$LYFE_CONFIG" \
#   --project "$LYFE_PROJECT" --message "release $LYFE_RELEASE_SHA" --non-interactive
# certify_hosting
# snapshot_functions "$LYFE_EVIDENCE/after-functions.json"
# diff -u "$LYFE_EVIDENCE/before-functions.json" "$LYFE_EVIDENCE/after-functions.json"
```

Define the following read-only snapshot helper before calling the sequence above.
It uses the existing GET-only API client and pagination; records all Function
identities/scaling/secret references (never Secret Manager values) and the raw
Teacher Units policy. No student collection is read. Require an empty diff.
The new receipt additionally verifies the detailed nine-endpoint backend pin.

```sh
snapshot_functions() {
  node - "$LYFE_PROJECT" "$1" <<'NODE'
const fs=require('node:fs');
const H=require('./scripts/hosting-release/backend-state.cjs');
const project=process.argv[2],file=process.argv[3];
require('./scripts/hosting-release/contract.cjs').environmentForProject(project);
(async()=>{
  const get=H.readApi({token:H.tokenFromGcloud()});
  const functions=await H.list(get,`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/-/functions`,'functions');
  const identities=functions.map(f=>({name:f.name,state:f.state,updateTime:f.updateTime,
    build:f.buildConfig?.build??null,service:f.serviceConfig?.service??null,
    revision:f.serviceConfig?.revision??null,min:f.serviceConfig?.minInstanceCount??null,
    max:f.serviceConfig?.maxInstanceCount??null,
    secretEnvironmentVariables:f.serviceConfig?.secretEnvironmentVariables??[],
    secretVolumes:f.serviceConfig?.secretVolumes??[]})).sort((a,b)=>a.name.localeCompare(b.name));
  const policy=await get(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/platformConfig/teacherUnitsAvailability`);
  fs.writeFileSync(file,H.canonical({project,functions:identities,policy})+'\n',{mode:0o600});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
NODE
}
```

The snapshot list is an additional operational comparison, not proof of effective
IAM or a replacement for the existing release gates. Secret-binding array order
changes may produce a conservative false-positive diff; inspect it, do not skip
comparison. Read-only access failures stop preparation. Changes occurring after
certification remain an operational race; the runtime continues to enforce policy
and fresh discovery. Paired Hosting publication is not atomic.

## Rollback

On either-target deployment/certification failure, retain the failure output and
restore BOTH sites to the baseline versions recorded by THAT environment's fresh
prepare record, including a site that appears successful. Use the exact pair of
`firebase hosting:clone` commands printed by prepare/certify. Their form is:

```sh
firebase hosting:clone '<app-site>@<prepared-app-baseline>' '<app-site>:live' --project '<explicit-project>' --non-interactive
firebase hosting:clone '<marketing-site>@<prepared-marketing-baseline>' '<marketing-site>:live' --project '<explicit-project>' --non-interactive
```

Verify both resulting versions/routing/served baseline bytes and teacher access;
run `snapshot_functions` again and require no backend, policy, generation, scaling
or Classroom secret-binding differences. Do not certify the rolled-back pair as
this new release: it has the previous source/versions. No policy close, enable,
generation rollback, Functions rollback or secret changes are part of this
Hosting-only rollback. If the original backend/policy itself has changed, stop
and use the separately authorized backend incident workflow; do not reconcile it
automatically. A rollback requires its own human deployment authorization.

## Commit selection and local validation

Select exactly 12 files:

1. `.github/workflows/platform-ci.yml`
2. `docs/platform/AUTOSAVE_HOSTING_ONLY_RELEASE.md`
3. `docs/platform/DOMAIN_AND_HOSTING_CONTRACT.md`
4. `docs/platform/U2_6_RELEASE_READINESS_RUNBOOK.md`
5. `scripts/hosting-release/backend-state.cjs`
6. `scripts/hosting-release/build-pair.cjs`
7. `scripts/hosting-release/certify.cjs`
8. `scripts/hosting-release/prepare.cjs`
9. `scripts/hosting-release/release.cjs`
10. `scripts/hosting-release/unchanged-backend.cjs`
11. `scripts/hosting-release/unchanged-backend.test.cjs`
12. `scripts/teacher-units-release/option-b-observation.cjs`

Local validation, sequential with no more than two Jest workers:

- Functions local tooling compilation succeeds.
- 22 new unchanged-backend tests pass, exercising actual predeploy/certify producers using
  synthetic provider/Hosting transports. No live records are created or read.
- 265 existing backend-state, release and Option B observation regressions pass.
- Application and assessment runtime rebuild succeed; runtime equals the tracked
  base asset byte-for-byte. Pair/configuration checks cover stale assets, compiler
  failure, mismatched shared bytes, routing and required ownership/parity: 28 tests pass.
- Compiler, save coordinator and lesson quiz autosave suites: 132 tests pass with two workers.
- Source `assessmentSessionsBegin` maxInstances remains 20; no backend source diff.
- Original 18 file contents are checked against pre-work SHA-256 hashes.

No clean committed production candidate has been built or certified yet. Local
synthetic success is not deployment readiness. Current provider identity, approval
attachments, staging browser acceptance and owner production approval remain gates.
