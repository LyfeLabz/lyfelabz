# Lab Report Assistant Cloud Autosave

**Status:** Implemented in the repository, inactive in production. Not deployed.
**Established:** October 8, 2026.
**Surfaces:** `tool_lab-report-assistant.html`, `assets/lab-report-assistant.js`,
`assets/lab-report-cloud-sync.js`, `assets/lyfelabz-lab-report-cloud.js`
(built from `app/src/labReport/`), `platform/functions/src/labReports/`,
`platform/firebase/firestore.rules`.

This document is the canonical reference for how the Lab Report Assistant
saves a signed-in student's report to their LyfeLabz account, and for
activating, verifying, and rolling it back.

---

## 1. Why

The tool previously saved one report to `localStorage`
(`lyfelabz:lab-report-assistant:v1`) only. Browser storage belongs to one
browser profile on one hostname, so work appeared lost when a student changed
devices, used a different hostname (`lyfelabz.com`, `www`, `app`), used a
guest or session-only profile, or edited in two tabs (the second tab silently
stopped saving while the student kept typing).

## 2. Architecture

| Layer | Responsibility |
| --- | --- |
| `labReportsGet`, `labReportsSave` (callables) | Identify the student from the verified ID token (`requireDistrictContext`, role `student`, canonical record wins); read or write only that student's report; revision CAS; validation and size limits. |
| `studentLabReports/{studentId}/reports/active` | One private draft per student. Server-only; every client role is denied by Rules. |
| `assets/lyfelabz-lab-report-cloud.js` | Firebase transport: shared client config (`firebase-config.ts`), shared Google sign-in settings (`googleSignInProvider.ts`), callable error classification. No Firestore access. |
| `assets/lab-report-cloud-sync.js` | Sync engine: which version loads, debounced autosave, bounded retries, conflicts, per-account browser backup, moving an unowned browser report into the account. Pure logic, no DOM or Firebase. |
| `assets/lab-report-assistant.js` | The tool. Host gating, status and account UI, version chooser, backup files, editor lock. |

**Why callables, not direct client Firestore writes.** The platform's
established student write path is server-authoritative callables (for example
`assessmentSessionsAutosave`); Rules keep every student record server-only.
Callables give canonical identity checks (active student, claims agree with
`users/{uid}`), a transactional revision check, server timestamps, and payload
validation without opening any new Rules surface or index. No Rules change is
needed for the feature to work (the terminal default-deny already covers the
path); the explicit deny block added for this collection documents intent and
is behavior-identical.

**Why the app origin only.** Firebase Auth persistence is per origin. Students
already sign in at `app.lyfelabz.com`, and lessons link the tool there
(`/tool_lab-report-assistant.html` from `app.lyfelabz.com` lessons). The
marketing site intentionally loads no Firebase SDK. The tool page is byte-
identical on both Hosting sites (shared path class), so behavior is chosen by
hostname at runtime:

| Host | Behavior |
| --- | --- |
| `app.lyfelabz.com` | Cloud saving when `CLOUD_PRODUCTION_ENABLED` is `true` (currently `false`). |
| `lyfelabz-staging.web.app`, `lyfelabz-staging.firebaseapp.com` | Cloud saving (staging project config from `assets/lyfelabz-firebase-config.js`). |
| `localhost`, `127.0.0.1` | Cloud saving against the local emulators. |
| `lyfelabz.com`, `www.lyfelabz.com`, `lyfelabz-staging-marketing.web.app` | Browser-only. When the matching app host has cloud saving, a notice explains how to move a report there with a backup file. |
| Anything else | Browser-only, unchanged behavior. |

The Firebase scripts are injected only on cloud hosts, so apex and `www`
visitors download no Firebase code.

## 3. Data model

`studentLabReports/{studentId}/reports/{reportId}` (only `reportId: "active"`
is accepted today):

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Record envelope version (1). |
| `reportId`, `scope` | `"active"`, `"personal"`. A future assignment-linked report would use a distinct deterministic id (for example `assignment_{assignmentId}`) and `scope: "assignment"`; the callables refuse other ids until that is designed. |
| `studentId`, `schoolId`, `districtId` | Ownership stamp, written on creation, structurally unreachable on update. |
| `reportFormatVersion` | The tool's report `version` (1). Newer versions are refused, and a client that reads one locks editing rather than overwrite it. |
| `reportJson`, `reportBytes` | The validated report serialized with a canonical key order (Firestore cannot store the table's nested arrays; one string also avoids per-field index entries for student text). Max 256 KiB. |
| `revision`, `lastSaveId` | Optimistic concurrency and idempotent retry. |
| `createdAt`, `updatedAt` | Server timestamps. |

There is no history subcollection and no teacher-readable copy.

## 4. Save protocol

- `labReportsSave({ expectedRevision, saveId, report, allowBlank })`.
- `expectedRevision` must equal the stored revision (0 if none), else
  `labReports.writeConflict` with only `{ revision }`.
- A resend of a save that already landed (same `saveId`, stored revision is
  exactly `expectedRevision + 1`) is acknowledged, so a lost response never
  becomes a false conflict. The client resends an in-doubt save verbatim.
- An identical report is acknowledged without a write.
- A blank report never replaces a report with student writing unless
  `allowBlank` is set. The client sets it only when the student's own edit or
  Start over produced the blank report.
- Validation errors never echo student text; logs carry uid, revision,
  outcome, and byte size only.

## 5. Client behavior

**Opening.** The editor is locked ("Opening your report...") until the sign-in
state and the cloud report are known. Edits during loading are held. Nothing
is written to the cloud during initialization except a revision-checked
fast-forward of this account's own unsaved browser backup.

| Situation | Result |
| --- | --- |
| Cloud report, nothing local | Cloud report opens. |
| Unsaved backup from the same revision | Backup opens and saves (nothing newer exists). |
| Unsaved backup and a newer cloud revision with different content | Student chooses; both shown with Download a copy. |
| Same content | Opens silently. |
| Cloud unreachable or offline | Account backup (or an empty report) opens; status "Saved on this device only"; reconnect checks the cloud revision before anything is written. |
| Signed out | The unowned browser report, as before, with a sign-in prompt. |
| Teacher, admin, or unfinished student account | Browser-only, with an explanation. |
| Corrupt browser data | Ignored and left untouched. |
| Newer report version in the cloud | Editing locked, "Reload the page". |

Timestamps are displayed only; revisions decide.

**Autosave.** Every edit updates the page and the per-account browser backup
immediately. The cloud save runs 2 s after typing pauses, at least every 10 s
during continuous typing, and on tab hide or page hide. One request is in
flight at a time. Network failures retry at 2, 4, 8, 16, 32 s and then stop
with "Unable to save - action needed" and a Try again button (also retried on
`online`, on returning to the tab, and at most once a minute while typing).
Leaving with unsaved cloud changes triggers the browser's leave prompt.

**Statuses** (sticky bar, text plus a colored dot, not color alone):
`Opening your report...`, `Saving...`, `Saved to cloud`,
`Saved on this device only`, `Unable to save - action needed`. Problems and
their actions appear in a `role="alert"` region; routine detail in a polite
status region; the sticky indicator is not a live region so screen readers are
not interrupted on every autosave.

**Conflicts.** A rejected stale revision (another tab, another device, a tab
restored from history) locks editing and shows the account version beside this
tab's version with previews, "Keep this version", and "Download a copy".
Matching content resolves silently. Returning to a tab after 60 s or restoring
it from the back-forward cache re-reads the cloud when there are no unsaved
edits, so stale tabs usually update before the student types.

**Tabs on one device.** The tab where the student last typed owns the
per-account backup. Another tab is paused (editor inert, alert, "Edit in this
tab instead"); its unsaved work is pushed first so it is never stranded, and
taking over offers every distinct version. In browser-only mode the same lock
replaces the old "saving is paused" message that let students keep typing.

**Accounts and shared Chromebooks.** Reports are only shown to their owner.
On sign-out or an account change (including one made in another tab or in My
Science), the page is cleared before anything else renders. The per-account
backup is removed when it holds nothing unsaved; unsaved work is kept for its
owner only and is never shown to anyone else. Signing out from the tool with
unsaved work waits briefly and then asks first.

**Start over** in cloud mode clears the account report (revision-checked,
`allowBlank`) after a confirmation that says so.

## 6. Existing browser reports (migration)

Browser storage cannot be read across origins; the tool does not try.

1. **Same origin (`app.lyfelabz.com`).** When a student signs in and this
   browser has the unowned report (`lyfelabz:lab-report-assistant:v1`) with
   different content, the tool asks: "Is this your report?" (account empty) or
   "Two reports found" (account has a report). Nothing is uploaded without a
   choice, the browser report is never deleted, and the decision is
   remembered per account and per report content (a hash, not a copy), so it
   is not asked again or imported twice. Shared-device risk is why this is
   never automatic.
2. **Other hostnames (`lyfelabz.com`, `www`).** Reports stay where they are;
   there is no redirect. "Download backup file" saves a JSON file; on
   `app.lyfelabz.com`, "Open backup file" loads it (asking first if it would
   replace different work), and it then autosaves. When production cloud
   saving is active, apex and `www` show these steps with a plain link to the
   app host (no report data in the URL, no cross-origin messaging).

Backup files work today in browser-only mode too.

## 7. Cost (estimates, not measurements)

Per open: 1 callable, 3 reads (user, school, report). Per save: 1 callable,
3 reads, 1 write. No listeners, no polling, no scheduled jobs, no minimum
instances. Assume a 45-minute session with about 120 saves (debounce plus the
10 s ceiling while typing) and a few freshness checks:

| Daily active students | Saves (writes) | Reads | Invocations |
| --- | --- | --- | --- |
| 100 | ~12,000 | ~37,000 | ~12,500 |
| 500 | ~60,000 | ~185,000 | ~62,000 |
| 1,000 | ~120,000 | ~370,000 | ~125,000 |
| 5,000 | ~600,000 | ~1.85 M | ~620,000 |

At list Firestore and Cloud Functions prices this is cents per day at 100 to
500 students and on the order of a few dollars per day at 5,000 (writes about
$1, reads about $1, invocations and compute a few dollars), partly inside the
free tier. Documents are at most 256 KiB (typical reports are a few KiB).
Confirm against the billing account's actual rates before activation.

## 8. Privacy and retention

- Private to the student: no teacher, administrator, class, or analytics
  surface reads it; Rules deny all client access including the owner.
- No report content in logs, error messages, URLs, or audit events.
- Retention: one current draft per student, overwritten on each save and
  cleared by Start over.
- V1 retention decision (October 8, 2026): active student lab reports have no
  automatic expiration. Long-term retention and deletion governance for this
  collection remain a separate future decision.

## 9. Activation sequence (not executed)

Every step is a separately authorized action.

1. Review and commit the change set.
2. **Staging Functions:** `firebase deploy --only functions:labReportsGet,functions:labReportsSave --project lyfelabz-staging`.
3. **Staging Rules (included, behavior-identical):** the explicit `studentLabReports` deny block ships in the staging release. This deploys the whole rules file, so first confirm in the console's Rules history that staging's currently deployed Rules match the expected repository baseline (the last rules commit before this change, `87fe7c1`); if they differ, stop and report before deploying. Then run `npm --prefix platform/firebase run test:rules` and `firebase deploy --only firestore:rules --project lyfelabz-staging`.
4. **Staging Hosting:** the normal paired release from a clean checkout of the commit (`prepare.cjs --project lyfelabz-staging`, `--config firebase.staging.json`, `--only hosting:app,hosting:marketing`, then `certify.cjs`). Staging hosts are cloud-enabled without any gate change.
5. **Staging verification** (section 10).
6. **Production Functions:** same deploy with `--project lyfelabz-prod`. Hosting has not changed, so students see nothing new.
7. **Production Rules (optional):** as step 3 with `--project lyfelabz-prod`.
8. **Open the gate:** set `CLOUD_PRODUCTION_ENABLED = true` in `assets/lab-report-assistant.js` (update the host-gating test), commit.
9. **Production Hosting:** paired release of that commit, then certify.
10. Production smoke test with a designated test student.

Functions must be live before step 9. If Hosting ships first anyway, saves
fail as retryable errors and work stays in the browser.

## 10. Staging verification plan

With a staging test student, on `lyfelabz-staging.web.app/tool_lab-report-assistant.html`:
sign in from the page; type and see `Saving...` then `Saved to cloud`; reload
and confirm restore; open on a second browser or profile and confirm restore;
edit in both and confirm the chooser and that the kept version wins; open two
tabs and confirm the pause and "Edit in this tab instead"; go offline
(DevTools) and confirm `Saved on this device only`, then reconnect; sign out
and confirm the page clears; sign in as a second student and confirm an empty
separate report; sign in as a teacher and confirm browser-only; seed an
unowned browser report before signing in and confirm the "Is this your
report?" prompt; download a backup on `lyfelabz-staging-marketing.web.app`
and open it on the app host; check that Functions logs contain no report text.

## 11. Rollback

- **Fast, client-only:** set `CLOUD_PRODUCTION_ENABLED = false` and release
  Hosting. The tool returns to browser-only saving. Cloud reports stay
  stored; per-account browser backups remain in each browser.
- **Hosting rollback:** the paired rollback in
  `DOMAIN_AND_HOSTING_CONTRACT.md`. The previous tool reads only the original
  browser key, which this feature never deletes or rewrites, so students keep
  their pre-existing browser reports. Work written only while cloud mode was
  active stays in the cloud and in that browser's per-account backup key until
  the feature is re-enabled.
- **Functions:** leaving the two callables deployed is harmless; deleting them
  is not required for rollback.
- No migration ran, so there is no data to undo.

## 12. Verification performed (October 8, 2026)

- Unit: Functions `src/labReports` (48 tests), engine (37), page integration
  (18), transport (23), existing tool suite (65, one test updated for the
  intentional multi-tab lock), Rules emulator suite for this collection (3).
- Real browser against local emulators (Auth, Firestore, Functions, Hosting;
  `ux-review-seed.js` fictional accounts): signed-out panel; sign-in as a
  seeded student; first save created revision 1 with the server ownership
  stamp after one debounced write for 41 keystrokes; restore with empty
  browser storage; a simulated second-device write (revision 2) caused a real
  `writeConflict`, the chooser, and the kept version saved as revision 3;
  sign-out cleared the page and storage; a teacher got browser-only saving;
  a second student got a separate empty report; no report text in emulator
  logs; no horizontal overflow at 375 px.
- The emulator popup could not complete inside the in-app browser pane (it
  navigates the tab instead of opening a popup), so sign-in was established
  with an emulator Google credential in the same Auth persistence. Real Google
  sign-in from the page is unverified until staging.
