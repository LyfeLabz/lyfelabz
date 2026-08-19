# Sprint 27 Phase 8 - Narrow Live Google Provider Certification

Status: COMPLETE. This report records the single narrow live-provider
assertion Sprint 27 reserved for real Google: that a real Google Classroom
`courses.courseWork.create` accepts the Sprint 27 server-generated,
assignment-aware LyfeLabz deep-link URL and creates the coursework record.
No production deployment occurred. Nothing was staged, committed, or pushed.
All Sprint 27 implementation remains uncommitted.

Companion documents: `SPRINT_27_DEFINITION.md`,
`SPRINT_27_ARCHITECTURAL_BLUEPRINT.md`, `SPRINT_27_IMPLEMENTATION_PLAN.md`,
`SPRINT_27_PHASE_6_VALIDATION_REPORT.md`,
`SPRINT_27_PHASE_7_BROWSER_CERTIFICATION.md`.

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level break.

---

## 1. Disposition

**PHASE 8 LIVE PROVIDER CERTIFIED - READY FOR CLOSEOUT.**

A single genuine `courses.courseWork.create` against the real linked Google
Classroom course accepted the server-built
`https://app.lyfelabz.com/app/a/{assignmentId}` link material and returned a
real coursework record. A read-back from the live Google Classroom API
confirmed the created coursework's stored material link is exactly that
server-built deep-link URL - not a bare lesson URL, not a localhost URL, and
not any client-supplied URL. No OAuth widening or reconnection was required;
the existing certified publication authorization was sufficient. No operator
Google interaction was needed (the stored credential was alive). No student
interaction and no production deployment were required, by design.

## 2. Environment

- **Emulator suite** (project `lyfelabz-prod`, singleProjectMode): Auth
  `127.0.0.1:9099`, Firestore `127.0.0.1:8080`, Functions `127.0.0.1:5001`,
  Hosting `127.0.0.1:5000`, Storage `127.0.0.1:9199`, UI `127.0.0.1:4000`.
- **Functions under test:** the Sprint 27 build (`platform/functions/lib`),
  loaded by the Functions emulator. `lmsAssignmentsPublish`,
  `lmsDeepLinkResolve`, and `studentsCompleteLmsOnboarding` all initialized.
  `lmsAssignmentsPublish` is the Sprint 27 Phase 4 version that constructs the
  Classroom destination server-side via `buildAssignmentDeepLinkUrl` and no
  longer accepts a client `lyfelabzAssignmentUrl`.
- **Data of record:** the Sprint 26 certified snapshot
  `platform/firebase/sprint26-certified-cert-state` (imported read-only), which
  carries the real Google-linked class `3la0b7o2jgw03cfzebw5`, the real class
  link `c5bafe12` to Google course `871447706346`, and the widened
  `cert-teacher-001` publication connection. Export-on-exit was directed to a
  fresh directory (`sprint27-phase8-cert-state`) so the certified input snapshot
  is never overwritten.
- **Phase 7 evidence preserved:** the Phase 7 Sprint 27 emulator was stopped
  cleanly, writing its `--export-on-exit ./sprint27-cert-state` export to disk
  (Phase 7 state is now durable, not only in memory). Its ports were then reused
  for this Phase 8 emulator. The on-disk Sprint 25/26 exports were untouched.
- **Real Google boundary:** the Google Classroom production transport and
  secrets (`GOOGLE_CLASSROOM_CLIENT_ID`, `GOOGLE_CLASSROOM_CLIENT_SECRET`,
  `GOOGLE_CLASSROOM_REDIRECT_URI`) are configured through the existing
  `platform/functions/.env.local` and `.secret.local`. No secret value was read,
  printed, or recorded.

## 3. Certification target (the remaining live assertion)

A real Google Classroom `courses.courseWork.create` accepts the Sprint 27
server-generated assignment-aware URL `https://app.lyfelabz.com/app/a/{assignmentId}`
and successfully creates the coursework record. Everything downstream of a
student clicking that URL was certified in Phase 7 (Paths A-D and all negative
assertions). The resolver requires no live-provider evidence.

## 4. Live Google target

- **Google Classroom course:** `871447706346` ("LyfeLabz Testing") - the
  established Sprint 25/26 certification course, owned by the `cert-teacher-001`
  certification Google account. No new course was created. No real student PII is
  involved and no real student is enrolled on that course's roster.
- **LyfeLabz class:** `3la0b7o2jgw03cfzebw5` (`enrollmentSource: lms`, active),
  linked to course `871447706346` through class link
  `3la0b7o2jgw03cfzebw5__googleclassroom__c5bafe12` (status `linked`,
  connection `googleclassroom__cert-teacher-001`).

## 5. OAuth state

Existing publication authorization was sufficient; no widening and no
reconnection were required. The `googleclassroom__cert-teacher-001` connection
was `status: active` with the four certified scopes, including the load-bearing
teacher write scope `https://www.googleapis.com/auth/classroom.coursework.students`
(`scopesUpdatedAt 2026-08-18T12:05:01.734Z`). The stored credential was live:
`resolveLiveCredential` produced a usable access token and the publish path
issued the coursework POST with no `lms.insufficientScope` and no
`lms.reconnectRequired`. No account chooser was shown because no OAuth flow was
initiated at all. Sprint 25 B13 was not reopened; no grant was manipulated.

## 6. LyfeLabz assignment (safe, recognizable identifiers)

- **Assignment id:** `s27cert-deeplink-1`.
- **Title:** `Sprint 27 Deep Link Certification`.
- **Lesson / mode:** `cell-types`, `classroom` mode (assessment revision
  `assessment_cell-types__r1`, deployed in the snapshot). The lesson identity is
  immaterial to the Phase 8 assertion; the deep-link URL is built from the
  `assignmentId` alone.
- **Creation path (canonical callables, real teacher auth):** a minted emulator
  ID token for `cert-teacher-001` (custom claims role `teacher`, school-beta,
  district-beta) drove `assignmentsCreateDraft` -> `draft`, then
  `assignmentsPublish` -> `published` (`alreadyPublished: false`, recipients
  frozen), then `lmsAssignmentsPublish`. No Firestore document was hand-edited.

## 7. Server-built URL (the exact non-secret destination)

```
https://app.lyfelabz.com/app/a/s27cert-deeplink-1
```

Constructed server-side by the sole authorized producer
`buildAssignmentDeepLinkUrl(assignmentId)`
(`platform/functions/src/lms/deep-link-url.ts`), invoked by
`lmsAssignmentsPublish` from the authoritative `assignmentId` it loads. The
client supplied no destination; the `lyfelabzAssignmentUrl` request field no
longer exists in the publish contract. The URL carries no query, no fragment,
no alternate host, no scheme other than https, no lesson slug, and no
identifier other than the opaque `assignmentId`.

## 8. Google result

- `lmsAssignmentsPublish` returned `status: "succeeded"`.
- **Google coursework id:** `875115775254`.
- **Publication id:** `s27cert-deeplink-1__googleclassroom__6687e707`.
- **Stored Classroom URL:** `https://classroom.google.com/c/ODcxNDQ3NzA2MzQ2/a/ODc1MTE1Nzc1MjU0/details`
  (base64 segments decode to course `871447706346` / coursework `875115775254`).
- **Persisted publication record** `lmsAssignmentPublications/s27cert-deeplink-1__googleclassroom__6687e707`:
  `status: succeeded`, `assignmentId: s27cert-deeplink-1`,
  `classId: 3la0b7o2jgw03cfzebw5`, `ownerUid: cert-teacher-001`,
  `schoolId: school-beta`, `providerId: googleClassroom`,
  `lmsClassId: 871447706346`, `lmsAssignmentId: 875115775254`,
  `publishedAt: 2026-08-19T14:00:50.496Z`. Exactly one such record; no
  duplicate, no orphan.
- **Audit:** exactly one `lms.assignmentPublished` event, actor
  `cert-teacher-001`, target `s27cert-deeplink-1`, payload `providerId`,
  `linkId`, `lmsClassId: 871447706346`, `lmsAssignmentId: 875115775254`,
  `publicationId`. No token, no student PII, no Google identity.

### 8.1 Live read-back (decisive material-link evidence)

A read-only `GET courses/871447706346/courseWork/875115775254` against the real
Google Classroom API (using the server-resolved credential; the token value was
never printed) returned:

```
id:            875115775254
courseId:      871447706346
title:         Sprint 27 Deep Link Certification
state:         PUBLISHED
workType:      ASSIGNMENT
alternateLink: https://classroom.google.com/c/ODcxNDQ3NzA2MzQ2/a/ODc1MTE1Nzc1MjU0/details
materials:     [ { link: { url: "https://app.lyfelabz.com/app/a/s27cert-deeplink-1",
                           title: "LyfeLabz Platform" } } ]
```

The coursework Google actually stored carries the server-built deep-link URL as
its sole material link. Google resolved that host and returned the page title
"LyfeLabz Platform", confirming the host serves the app shell.

## 9. Evidence chain (why this proves Google accepted the Sprint 27 URL)

1. **Server-built, not client-supplied.** The publish contract has no
   `lyfelabzAssignmentUrl` field; `lmsAssignmentsPublish` builds the URL solely
   through `buildAssignmentDeepLinkUrl(assignmentId)`. Any residual client value
   is ignored. Proven by source and by `assignments-publish.test.ts`.
2. **Assignment-aware URL reached Google.** The read-back shows the created
   coursework's material link is exactly
   `https://app.lyfelabz.com/app/a/s27cert-deeplink-1`, carrying the LyfeLabz
   `assignmentId`.
3. **Google accepted it and created the record.** `courses.courseWork.create`
   returned coursework `875115775254` in course `871447706346` with
   `state: PUBLISHED`; the LyfeLabz record and audit agree.
4. **Corresponds to the intended course.** Both the returned URL decode and the
   read-back `courseId` are `871447706346`, the class's linked course.
5. **No legacy / localhost / arbitrary URL.** The material link is the canonical
   `app.lyfelabz.com/app/a/{assignmentId}`; there is no bare `lesson_*.html`,
   no `localhost`, and no client-influenced destination.

## 10. Production deployment status

**Not deployed.** Sprint 27 is entirely uncommitted and undeployed; HEAD is
`76f0162`. The Phase 8 assertion concerns Google accepting the URL material,
which it did. The `/app/a/{assignmentId}` deep-link ROUTE behavior (the
`lmsDeepLinkResolve` authorization and silent arrival) becomes available in
production only after the Sprint 27 release is deployed (Sprint 29 owns the
production release). Today `app.lyfelabz.com` serves the app shell at that host
(hence Google's "LyfeLabz Platform" title), but the assignment-aware resolver
route resolves live only post-deployment. No deployment was performed to make
the URL resolve during Phase 8.

## 11. Cleanup disposition

The temporary coursework `875115775254` in course `871447706346` is **retained
as certification evidence**, following the Sprint 25/26 convention (their cert
courseworks `874752057518`, `874953414061`, `874954047705` were likewise
retained). Its id and full result are recorded above. It may be manually
archived or deleted later; no student is notified because the cert course has no
real student roster. Nothing was deleted before recording the result.

## 12. Security / privacy review

- No OAuth access token, refresh token, client secret, or authorization code was
  printed, logged, or recorded. The read-back script resolved the credential
  server-side and printed only non-secret coursework metadata.
- Leakage sweep across the cert publication record and `auditEvents`: zero
  token-, refresh-token-, access-token-, client-secret-shaped strings; no
  cert-teacher email in the publication document.
- The deep-link URL carries only the opaque `assignmentId` - no token, session,
  score, student, Google identity, or Classroom identifier.
- Enrollment, recipient, and district boundaries are unchanged; Phase 8 created
  no enrollment and no recipient and mutated no frozen-recipient population.

## 13. Defects / corrections

None. No code change was required for Phase 8. The Phase 7 and Phase 6
deterministic evidence remains current (no source changed), so no suite was
re-run for ceremony.

## 14. Remaining work

- **Phase 9 - Closeout only** (Sprint 27 completion report; final certification
  findings; preserved-invariant confirmation).
- **Sprint 28 deferred (not implemented here):**
  - **O1** - the teacher-facing "Close assignment" control did not render on the
    Classroom-linked Assignment Detail; the closed-assignment negative was
    certified through the canonical `assignmentsClose` callable. Defer UI
    investigation/polish to Sprint 28.
  - **O2** - after submitting a v2 assessment, the browser can land with the top
    of the score/results area scrolled off; the student had to scroll up. Deferred
    v2 lesson-migration / Sprint 28 UX item.

## 15. Git / Firebase / Google state

- **Tracked / untracked / staged:** unchanged from the pre-Phase-8 working tree
  plus this new report and the one-line Phase 8 status edit in
  `SPRINT_27_IMPLEMENTATION_PLAN.md`. Nothing staged.
- **Commits / pushes / deployments:** none. HEAD remains `76f0162`.
- **Local Firebase:** the Phase 7 Sprint 27 emulator was cleanly stopped
  (state exported to `sprint27-cert-state`); a Phase 8 emulator imported
  `sprint26-certified-cert-state` read-only and exports to
  `sprint27-phase8-cert-state`; the certified input snapshot was not overwritten;
  no Firestore rules changed.
- **Live Google:** exactly one new coursework `875115775254` created in course
  `871447706346` (retained as evidence). No grant, scope, connection, or other
  Google resource was modified. No coursework was deleted.

*End of Phase 8 live-provider certification.*
