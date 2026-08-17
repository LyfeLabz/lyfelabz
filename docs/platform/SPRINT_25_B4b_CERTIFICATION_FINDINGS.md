# Sprint 25 - B4b Certification Findings

Status: B4b PASSED. The Assign dialog topic selector populated from the real
linked Google Classroom course against the widened connection, "No topic"
remained the default, and the real course topic "Final Exam" appeared as an
available option. B4b is a read-only checkpoint: no topic was selected, Google
Classroom publication remained disabled, no assignment was created, and no
Google Classroom mutation occurred. Certification advances to B7.

Style: no em dashes. Use " - " (spaced hyphen).

---

## 1. Checkpoint under test

B4b (browser certification checklist §B4b): "Topic selector populates from real
Google (post-consent)." Pass criterion: the real Google Classroom topic appears
in the selector against the widened connection, with "No topic" as the default.

The read is performed by the `lmsClassesListTopics` callable, which resolves the
LMS-linked class -> connection -> token, then fetches topics through the
vendor-neutral provider adapter (`adapter.listClassTopics` ->
`GET /v1/courses/{id}/topics`). Topics are LMS-owned and are never mirrored into
Firestore (`classes-list-topics.ts` header; PDR-020g), so the only possible
source of a topic name in the selector is a live provider response.

---

## 2. Operator (browser) evidence

After a hard reload, the operator opened Curriculum -> Assign for Biological
Evolution. In the Assign dialog:

- The `LyfeLabz Testing - Grade 7` row showed an enabled Google Classroom topic
  dropdown.
- Opening the dropdown displayed: `✓ No topic` and `Final Exam`.
- "No topic" remained the selected/default value.
- "Final Exam" is an actual topic that already exists in the real linked Google
  Classroom course "LyfeLabz Testing."
- "Also publish to Google Classroom" remained unchecked.
- The operator did NOT select "Final Exam."
- The operator did NOT click Assign.
- The unrelated `B6 Testing Class` row (not the Google-Classroom-linked class
  under test) showed Google Classroom topic = "None."

---

## 3. Backend (Functions emulator) evidence

Source: `platform/firebase/firebase-debug.log` (Functions emulator runtime log,
project `lyfelabz-prod`, region `us-central1`).

### 3.1 The successful B4b invocation

The topic dropdown population corresponds to the `lmsClassesListTopics`
invocation at `2026-08-16T17:27:39` (POST after its CORS OPTIONS preflight):

```
[2026-08-16T17:27:39.469Z] Accepted request POST .../lmsClassesListTopics
[info] Beginning execution of "us-central1-lmsClassesListTopics"
[info] > Callable request verification passed  {verifications:{app:MISSING,auth:VALID}}
[info] Finished "us-central1-lmsClassesListTopics" in 283.147375ms
```

- Executed successfully: clean `Beginning` -> `Finished` pair, no error emitted.
- Auth: `auth: VALID` (Firebase auth token verified; `app: MISSING` is expected
  under the emulator and is not a failure).
- No `lms.googleClassroomUpstreamDiagnostic` warning appears anywhere inside this
  invocation window. That temporary Sprint 25 B9 diagnostic (retained per
  PDR-030g) fires on every non-2xx upstream response. Its absence for this call
  establishes a 2xx upstream response - the topic fetch succeeded.
- No `401 invalid_token`, no `403 insufficient_scope`, no upstream authorization
  failure, no transport failure, no timeout for this call.
- 283 ms duration is consistent with real Firestore reads plus a live HTTPS
  round trip to Google, not a sub-millisecond local return.

### 3.2 The same callable and route proves the real transport (not a double)

The identical callable and identical upstream route `/v1/courses/{id}/topics`
produced genuine Google Classroom error envelopes on earlier attempts, before
the connection was widened. These are captured by the B9 diagnostic:

| Timestamp (UTC) | Callable | Upstream diagnostic |
|---|---|---|
| 2026-08-15T01:32:26 | lmsClassesListTopics | `401 UNAUTHENTICATED`, `wwwAuthenticateError: invalid_token`, route `/v1/courses/{id}/topics` |
| 2026-08-16T13:39:12 | lmsClassesListTopics | `403 PERMISSION_DENIED`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, `wwwAuthenticateError: insufficient_scope`, route `/v1/courses/{id}/topics` |
| 2026-08-16T13:40:12 | lmsClassesListTopics | `403 PERMISSION_DENIED`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, route `/v1/courses/{id}/topics` |
| 2026-08-16T17:06:45 | lmsClassesListTopics | `403 PERMISSION_DENIED`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, route `/v1/courses/{id}/topics` |
| 2026-08-16T17:27:39 | lmsClassesListTopics | none (clean, 2xx) - the B4b success |

`ACCESS_TOKEN_SCOPE_INSUFFICIENT` with a `WWW-Authenticate: ... error="insufficient_scope"`
challenge header is a Google Classroom API response shape. A local test double
does not synthesize Google's own scope-error envelope. The transport therefore
reached the real Google Classroom topics endpoint. Consistent with this, the
adapter's transport injection boundary exists only "so tests can stub"
(`providers/google-classroom/transport.ts`); no stub is injected in the
certification emulator, so the production HTTPS transport is in effect. The
callable also installs its production bindings at handler entry
(`ensureGoogleClassroomProductionBindings()`, the Sprint 25 B9 finding).

### 3.3 Linked Google Classroom course

The callable resolves topics only for the caller-owned, `linked` class routed
through the caller-owned `active` connection (ownership invariants in
`classes-list-topics.ts`). The upstream route observed for this callable is
`/v1/courses/{id}/topics`, i.e. a course-scoped topics read. The operator
screenshot confirms the row under test is the real linked course
`LyfeLabz Testing - Grade 7`. Incremental-consent callables
`lmsConnectionsBegin` / `lmsConnectionsComplete` ran earlier in the same session
(the B9/B10 widening), after which the previously scope-denied topics read on
the same connection succeeded.

### 3.4 The widened connection carried `classroom.topics.readonly`

Evidenced behaviorally, not by a printed scope string. The same connection's
topics read returned `ACCESS_TOKEN_SCOPE_INSUFFICIENT` at 13:39, 13:40, and
17:06, then returned a clean 2xx at 17:27 after the incremental consent
completed. The only change that turns a Google `insufficient_scope` on
`/v1/courses/{id}/topics` into success is granting `classroom.topics.readonly`.
LyfeLabz re-fetched topics from the real linked course on reopen (no cached
pre-consent failure), which is the widened-connection re-fetch B4b requires.

### 3.5 "Final Exam" correlation

The Functions runtime does not log successful response bodies, so the string
"Final Exam" does not appear in the backend log. It is established by
correlation, which is the defined shape of this checkpoint:

- Backend: the topics read executed against the real Google transport and
  returned a successful (2xx) response for the linked course.
- Architecture: topics are never seeded or stored in Firestore (verified: no
  topic appears in `seed-emulator.js`, `seed-cert-assessments.js`, or
  `verify-seed.js`; the callable never reads topics from Firestore), so the
  selector's contents can only have come from that live response.
- Operator screenshot: the selector rendered "Final Exam" (plus the "No topic"
  default) for that row.

The successful backend call is therefore the only possible source of the
"Final Exam" option the operator saw.

### 3.6 No mutation, no publication triggered by B4b

- The topics read is a `GET`; no coursework `POST`, create, or write was issued
  by this call.
- No `lmsAssignmentsPublish` invocation is associated with the 17:27 topic read.
- No `assignmentsCreateDraft` / `assignmentsPublish` fired as part of B4b; the
  operator did not click Assign and left publication unchecked.
- Google Classroom was read only. No Google Classroom state changed.

---

## 4. B4b acceptance decision

Comparing the operator screenshot evidence, the successful
`lmsClassesListTopics` backend evidence (§3.1), and the canonical B4b criteria
(checklist §B4b), every criterion is satisfied:

1. The callable executed successfully. PASS.
2. It used the linked Google Classroom course (owner-checked linked class ->
   active connection; course-scoped topics route). PASS.
3. It reached the real Google Classroom topic transport, not a local double
   (§3.2). PASS.
4. It completed with no `401 invalid_token`, no `403 insufficient scope`, no
   upstream authorization failure, no transport failure, no timeout (§3.1).
   PASS.
5. The returned topic data corresponds to the real topic "Final Exam" (§3.5).
   PASS.
6. No Google Classroom mutation occurred (§3.6). PASS.
7. No assignment or publication was triggered by B4b (§3.6). PASS.

**B4b: PASS.**

B4b was a read-only certification checkpoint:

- the widened connection contained `classroom.topics.readonly`;
- LyfeLabz re-fetched topics from the real linked Google Classroom course;
- the topic selector populated successfully;
- "No topic" remained the default;
- the real Google Classroom topic "Final Exam" appeared as an available option;
- no topic was selected;
- Google Classroom publication remained disabled;
- no assignment was created;
- no Google Classroom mutation occurred.

The widened-connection topic read is now verified, which is the prerequisite the
topic-publication scenarios (B8/B12) depend on.

B9 evidence is preserved. The temporary B9 upstream diagnostic in
`providers/google-classroom/transport.ts` is intentionally retained per PDR-030g
and is NOT removed by this task.
