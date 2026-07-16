# LyfeLabz V1 Centralized Assessment Submission Architecture

**Status:** Final design. Approved for implementation.
**Date:** 2026-07-14
**Governs:** The Google Apps Script submission pipeline for all Assessment v2 resources.
**Implements:** Refinements to the architecture implicit in `LyfeLabz_GScript_v2.js` and `docs/components/submission-system.md`.

This document is the single implementation contract for the LyfeLabz centralized submission system. Where this document and any prior version conflict, this document prevails.

---

## 1. Purpose

LyfeLabz serves instructional resources (lessons, investigations, extensions, simulations, games, engineering challenges) on static GitHub Pages. These resources collect student quiz responses and Show Your Thinking responses in Classroom Mode and need to deliver that data to teachers without a custom backend.

The centralized submission system routes every resource's data through a single Google Apps Script web app to the appropriate teacher spreadsheet. This architecture describes the exact contract that resources, the script, and the registries must follow.

---

## 2. Architectural Decisions

These three decisions are final. There is exactly one approved approach for each.

### 2.1 Submission Method

**HTTP POST using `application/x-www-form-urlencoded`.**

This is the only approved method. No GET fallback exists.

The client sends a POST request. The body is URL-encoded key-value pairs. The Apps Script handler is `doPost(e)`. The script reads fields from `e.parameter`, which works identically for form-encoded POST bodies as for GET query strings in the Google Apps Script environment.

If a Google Apps Script limitation with `doPost` is discovered during implementation, the architecture will be revised at that time. No fallback is designed in advance.

### 2.2 Timestamp Authority

**The Apps Script generates the submission timestamp. The client never provides one.**

The client payload does not include a timestamp field of any kind. No `submittedAt`, no `timestamp`, no `clientTime` field.

The server writes `new Date()` as the first value of every row. This is the authoritative, consistent record of when the submission was received.

Removing the client timestamp eliminates clock skew, timezone ambiguity, and the possibility of a student manipulating the recorded time.

### 2.3 Resource Identity and Registry

**`resourceId` is the permanent identity. `displayTitle` is the student-facing name. `worksheetName` is derived from `displayTitle` by default.**

See Section 4 for the full Resource Registry specification.

---

## 3. System Overview

```
Student browser (Classroom Mode)
  - student selects teacher and block
  - page provides resourceId and grade
         |
         |  HTTP POST  application/x-www-form-urlencoded
         v
Google Apps Script web app (doPost handler)
         |
         |  1. Validate resourceId against Resource Registry
         |  2. Validate teacher against Teacher Registry
         |  3. Validate grade against Resource Registry entry
         |  4. Validate teacher grade matches resource grade
         |  5. Obtain spreadsheet from Teacher Registry
         |  6. Derive worksheet from Resource Registry
         |  7. Generate timestamp via new Date()
         |  8. Write submission row
         v
Appropriate teacher spreadsheet
  - One worksheet per registered resource
  - Shared schema: Timestamp | Student Name | Block | Q1..QN | Score | Show Your Thinking
```

The same resource (e.g., "Earth's Layers") can be submitted to any teacher registered for that grade. The teacher is a payload field supplied by the student. The resource registry validates the resource. The teacher registry validates the teacher and provides the spreadsheet destination.

---

## 4. Resource Registry

The Resource Registry contains resource information only. It does not determine which teacher spreadsheet receives the submission. Teacher routing is the responsibility of the Teacher Registry (Section 5).

### 4.1 Fields

Every resource that submits to the Assessment v2 system is registered in the Resource Registry in `LyfeLabz_GScript_v2.js`. Each entry has these fields:

| Field | Required | Description |
| --- | --- | --- |
| `resourceId` | Yes | The registry key. A stable slug that identifies the resource permanently. This is the value the client sends in the payload. Uses the LyfeLabz file naming convention (e.g., `lesson_what-is-life`, `lesson_g7_earths-layers`). Never changes. |
| `displayTitle` | Yes | The student-facing and teacher-facing name of the resource. Used as the worksheet tab label. Appears in the daily digest email. |
| `grade` | Yes | The grade this resource belongs to. One of `6` or `7`. Used to validate that the submitted teacher belongs to the correct grade. |
| `resourceType` | Yes | One of `lesson`, `investigation`, `simulation`, `extension`, `challenge`. |
| `expectedQuestionCount` | Yes | The number of quiz questions. Used to validate that all `q1` through `qN` fields are present in the payload. |
| `thinkingRequired` | Yes | Boolean. If `true`, the server rejects submissions where `thinking` is missing or empty. |
| `worksheetName` | No | Explicitly set only when the worksheet name must differ from `displayTitle`. See 4.3 for override conditions. |
| `headerColor` | No | Optional hex color for the header row background. Defaults to the script constant if omitted. |
| `fontColor` | No | Optional hex color for the header row text. Defaults to the script constant if omitted. |

### 4.2 Default Worksheet Behavior

When `worksheetName` is absent, the server uses `displayTitle` as the worksheet name.

This is the normal case. Most resources register in a single line:

```javascript
'lesson_what-is-life': {
  displayTitle: 'What Is Life',
  grade: 6,
  resourceType: 'lesson',
  expectedQuestionCount: 10,
  thinkingRequired: true,
  headerColor: '#2ecc71',
  fontColor: '#0a1f0a',
},
'lesson_g7_earths-layers': {
  displayTitle: "Earth's Layers",
  grade: 7,
  resourceType: 'lesson',
  expectedQuestionCount: 10,
  thinkingRequired: true,
  headerColor: '#7a8fa6',
  fontColor: '#ffffff',
},
```

The sheet tab label for "What Is Life" will be "What Is Life". The client sends `resourceId=lesson_what-is-life`. The server resolves "What Is Life" as the worksheet name.

### 4.3 Override Behavior

`worksheetName` is set explicitly only when:

- The `displayTitle` exceeds the Google Sheets worksheet name limit (100 characters in the API; 31 characters as a practical convention for readability in compact sheet-tab views).
- The `displayTitle` conflicts with another registered resource's derived worksheet name.
- A special character in `displayTitle` would cause a Sheets API error.

When an override is present, it controls the worksheet name. The `displayTitle` continues to appear in the daily digest email and any other display contexts.

```javascript
'challenge_welcome-to-floatia': {
  displayTitle: 'Welcome to Floatia: Engineering Challenge',
  grade: 6,
  resourceType: 'challenge',
  expectedQuestionCount: 5,
  thinkingRequired: true,
  worksheetName: 'Welcome to Floatia',
  headerColor: '#ff5470',
  fontColor: '#ffffff',
},
```

### 4.4 Why This Design Reduces Long-Term Maintenance

The `resourceId` is the permanent contract between the client and the server. It uses the same stable slugs as the repository file-naming convention and never changes.

The `displayTitle` can evolve as curriculum language matures without breaking any client payload. A renamed lesson requires one registry update (the `displayTitle` field), not a client change.

If the `worksheetName` were always required, every registry entry would repeat the display title verbatim. The default derivation eliminates that redundancy and prevents the two values from silently diverging.

Registering a new resource is always one entry in the common case.

---

## 5. Teacher Registry

The Teacher Registry maps canonical teacher keys to their spreadsheet destinations. It is the sole source of truth for teacher routing. The Resource Registry does not participate in teacher routing.

### 5.1 Fields

Each teacher entry has these fields:

| Field | Required | Description |
| --- | --- | --- |
| `teacherKey` | Yes | The registry key and canonical payload value. Lowercase kebab-case (e.g., `mr-brown`, `ms-gay`). This is what the client sends in the `teacher` payload field. Never changes. |
| `displayName` | Yes | Human-readable name for digest emails and error messages (e.g., `Mr. Brown`). |
| `grade` | Yes | The grade this teacher teaches. One of `6` or `7`. Used to validate that submitted resources belong to this teacher's grade. |
| `spreadsheetId` | Yes | The actual Google Sheets spreadsheet ID for this teacher's spreadsheet. Hardcoded directly in the Teacher Registry. No Script Properties lookup is required at runtime. |
| `active` | Yes | Boolean. If `false`, the server rejects submissions for this teacher key. |

### 5.2 V1 Teacher Registry

The V1 system registers four teachers:

```javascript
TEACHER_REGISTRY = {
  'mr-brown': {
    displayName:   'Mr. Brown',
    grade:         6,
    spreadsheetId: '1GvsLh1t-ImQA8OZZlEWmqNPwonv2_NFpoxUNyBZeZso',
    active:        true,
  },
  'ms-gay': {
    displayName:   'Ms. Gay',
    grade:         6,
    spreadsheetId: '13sE2DOslTklgebTHfBSFK5KFIkmy82XhOwLCnQCxVZ4',
    active:        true,
  },
  'mr-kankel': {
    displayName:   'Mr. Kankel',
    grade:         7,
    spreadsheetId: '1myEk9L0fha7k_sA8KjbvVRpwb_K6EUdILdGs-92-TYI',
    active:        true,
  },
  'mr-rovner': {
    displayName:   'Mr. Rovner',
    grade:         7,
    spreadsheetId: '1c3uRwvZsRmAgL7Paih1l-ow0rnbHAQcM2fFf1UBDGlg',
    active:        true,
  },
}
```

### 5.3 Spreadsheet ID Storage

V1 hardcodes spreadsheet IDs directly in the Teacher Registry. Each `spreadsheetId` field contains the actual Google Sheets ID string.

V1 serves four teachers for one academic year. Simplicity is preferred over runtime configurability. When V2 replaces this backend, the Teacher Registry will be migrated at that time. No Script Properties setup is required to operate V1.

### 5.4 Teacher Key Format

Teacher keys use lowercase kebab-case. The student-facing teacher select uses these exact values as option values. The server does not normalize case. A key that does not match exactly is rejected.

### 5.5 Adding a Teacher

1. Create or designate the teacher's spreadsheet and grant edit access to the Apps Script owner account.
2. Add the teacher entry to `TEACHER_REGISTRY` in the script, with the actual spreadsheet ID in the `spreadsheetId` field.
3. Add the teacher as a select option on every grade-appropriate page.
4. Deploy the updated script.

No per-page endpoint changes are required.

### 5.6 Removing a Teacher

Set `active: false` in the registry. Deploy. Submissions for that teacher key are rejected. The spreadsheet and its historical data are not touched.

---

## 6. Payload Contract

### 6.1 Fields

The client sends exactly these fields in the POST body:

| Field | Value | Notes |
| --- | --- | --- |
| `resourceId` | The registered resource slug | Required. Server refuses if unknown. |
| `grade` | The grade of this resource (`6` or `7`) | Required. Hard-coded by the page. The student does not select this. |
| `teacher` | Canonical teacher key (e.g., `mr-brown`) | Required. Selected by the student. Server refuses if unknown or inactive. |
| `studentName` | Student's full name | Required. |
| `block` | Class block identifier (A-G) | Required. |
| `q1` through `qN` | The student's answer to each quiz question | One field per question, sequentially numbered. N matches `expectedQuestionCount` for this resource. All N fields must be present. |
| `score` | Score string (e.g., `9/10`, `14/15`) | Required. |
| `thinking` | Show Your Thinking response text | Only sent by resources where `thinkingRequired` is `true`. Required and must be non-empty for those resources. Resources without a Show Your Thinking prompt do not send this field and do not receive a Show Your Thinking column. |

No other fields are sent. No `percent` field. No `tab` field. No `submittedAt` field.

### 6.2 Example

A Grade 6 ten-question lesson submits:

```
POST [script-url]
Content-Type: application/x-www-form-urlencoded

resourceId=lesson_what-is-life
&grade=6
&teacher=mr-brown
&studentName=Alex+Reyes
&block=B
&q1=B&q2=C&q3=A&q4=D&q5=B&q6=C&q7=A&q8=B&q9=C&q10=D
&score=9%2F10
&thinking=A+virus+is+missing+the+ability+to+use+energy+on+its+own%2C+so+it+is+not+truly+alive.
```

The same resource submitted to a different Grade 6 teacher:

```
POST [script-url]
Content-Type: application/x-www-form-urlencoded

resourceId=lesson_what-is-life
&grade=6
&teacher=ms-gay
&studentName=Jordan+Kim
&block=D
&q1=A&q2=C&q3=A&q4=D&q5=B&q6=C&q7=A&q8=B&q9=C&q10=D
&score=8%2F10
&thinking=Viruses+cannot+reproduce+without+a+host+cell.
```

Both submissions use the same `resourceId`. The `teacher` field determines which spreadsheet receives the data.

### 6.3 Client Implementation

```javascript
const payload = new URLSearchParams({
  resourceId: 'lesson_what-is-life',   // hard-coded per page
  grade: '6',                           // hard-coded per page
  teacher: teacherKey,                  // from student's teacher select
  studentName: studentName,
  block: block,
  ...questionEntries,                   // q1: 'B', q2: 'C', ... q10: 'D'
  score: '9/10',
  thinking: thinkingText,
});

fetch(LYFELABZ_CENTRAL_ENDPOINT, {
  method: 'POST',
  body: payload,
})
```

The client must not set `Content-Type` manually when using `URLSearchParams` - the browser sets it automatically to `application/x-www-form-urlencoded`.

`LYFELABZ_CENTRAL_ENDPOINT` is a single constant defined at the top of each page's quiz script block. It is identical across all pages.

Note: Google Apps Script web apps deployed as "execute as: me, accessible by: anyone" accept cross-origin POST requests from static pages. No `cors` workaround is needed on the client side. The response is a JSON string from `ContentService`.

---

## 7. Server Behavior

### 7.1 Handler

The script implements `doPost(e)`. `e.parameter` contains all submitted fields. `doGet` is not used for submission routing.

### 7.2 Routing Sequence

The server executes validation in this order. Any failure returns an error response immediately and writes nothing to any spreadsheet.

1. **Resource validation.** Read `e.parameter.resourceId`. If absent or not in the Resource Registry, reject with `"Unknown resource: <resourceId>"`.

2. **Teacher validation.** Read `e.parameter.teacher`. If absent or not in the Teacher Registry, reject with `"Unknown teacher: <teacher>"`. If the teacher is registered but `active` is `false`, reject with `"Teacher is not active: <teacher>"`.

3. **Grade validation.** Read `e.parameter.grade`. If it does not match the `grade` field in the Resource Registry entry, reject with `"Grade mismatch: payload says <grade>, resource is grade <resourceGrade>"`.

4. **Teacher grade validation.** If the teacher's `grade` in the Teacher Registry does not match the Resource Registry `grade`, reject with `"Teacher <teacher> is grade <teacherGrade>, resource is grade <resourceGrade>"`. This prevents a Grade 6 resource from routing to a Grade 7 teacher's spreadsheet.

5. **Question completeness.** Verify that all of `q1` through `qN` are present, where N is `expectedQuestionCount` for this resource. Reject with `"Missing questions: expected <N>, found <found>"`.

6. **Thinking validation.** If `thinkingRequired` is `true` for this resource, verify that `thinking` is non-empty. Reject with `"Show Your Thinking response is required for this resource"`.

7. **Spreadsheet access.** Read `spreadsheetId` directly from the Teacher Registry entry. Open the spreadsheet. On failure, log the error and return `"Could not access teacher spreadsheet"`.

8. **Worksheet resolution.** Derive `worksheetName` from the Resource Registry entry (see Section 7.3). Get or create the worksheet in the teacher's spreadsheet.

9. **Row write.** Generate the server timestamp, build the row, and insert at position 2.

### 7.3 Worksheet Name Resolution

```
worksheetName = RESOURCE_REGISTRY[resourceId].worksheetName
                ?? RESOURCE_REGISTRY[resourceId].displayTitle
```

If `worksheetName` is explicitly set in the registry, use it. Otherwise use `displayTitle`. This is the only place in the system where worksheet name resolution occurs.

### 7.4 Timestamp Generation

The server calls `new Date()` to produce the submission timestamp. This value is the first element of every row. The client never provides a timestamp.

### 7.5 Row Schema

The standard worksheet schema is:

```
Timestamp | Student Name | Block | Q1 | Q2 | ... | QN | Score | Show Your Thinking
```

The Show Your Thinking column is present **only when `thinkingRequired` is `true`** for the resource. Resources without a Show Your Thinking prompt (investigations, simulations, extensions, games, and the engineering challenge) use a shorter schema with no blank trailing column:

```
Timestamp | Student Name | Block | Q1 | Q2 | ... | QN | Score
```

Extended fields, when registered, appear after Score (or after Show Your Thinking when present).

The number of Q columns varies by resource. The server walks `q1`, `q2`, ... `qN` sequentially based on `expectedQuestionCount` for this resource.

The leading columns (Timestamp, Student Name, Block) are constant. Score is always present. Show Your Thinking is conditional on `thinkingRequired`.

Rows are inserted at position 2 so the most recent submission appears at the top, below the frozen header.

### 7.6 Header Row

If the worksheet does not yet exist, the server creates it, freezes row 1, and writes the header row. On every submission, the server verifies that the header row matches the expected schema and updates it if the question count has changed.

---

## 8. Response Contract

The server returns JSON via `ContentService`:

```json
{ "status": "success", "message": "Row added to What Is Life" }
```

On error:

```json
{ "status": "error", "message": "Unknown teacher: ms-smith" }
```

The client treats any response with `status !== 'success'` as a submission failure and must preserve student work on screen.

---

## 9. Client Requirements

### 9.1 Page-Level Constants

Every standard V1 page defines these constants in its quiz script block:

```javascript
const LYFELABZ_CENTRAL_ENDPOINT = 'https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec';
const RESOURCE_ID = 'lesson_what-is-life';  // stable slug for this page
const GRADE = '6';                           // hard-coded grade for this page
```

`LYFELABZ_CENTRAL_ENDPOINT` is identical across all pages. `RESOURCE_ID` and `GRADE` are unique to each page. Students never see or modify these values.

### 9.2 Student Selections

The student selects:

- **Teacher** from a grade-appropriate dropdown. Option values use canonical teacher keys (`mr-brown`, `ms-gay` for Grade 6; `mr-kankel`, `mr-rovner` for Grade 7).
- **Block** from A-G.

### 9.3 Mode Enforcement

Practice Mode does not submit. The POST request is only made in Classroom Mode after the student presses Submit.

### 9.4 Validation Before Submit

The Submit button is disabled until:
- Teacher is selected.
- Block is selected.
- Student name is non-empty.
- All quiz questions are answered.
- The Show Your Thinking textarea contains non-whitespace text (when required for this resource).

These conditions are enforced in the client before any POST is attempted.

### 9.5 Failure Handling

If the POST fails (network error, server error response), the client must:
- Show a visible failure state to the student.
- Leave all student responses intact on screen.
- Not attempt automatic retry.

The student can attempt to resubmit manually.

### 9.6 Success State

On success, the client reveals the model answer for Show Your Thinking and shows the quiz answer explanations. This reveal is gated on the POST response, not on the submit button press.

---

## 10. Daily Digest

The centralized Apps Script includes a time-triggered daily digest function. It reads each configured teacher's spreadsheet, scans the registered worksheets for rows whose Timestamp falls within the digest window, and sends a formatted summary.

Teacher spreadsheets are identified through the Teacher Registry. The digest does not maintain a separate list of spreadsheets.

The digest sends only when at least one submission exists in the window. Quiet days produce no email and leave the last-sent timestamp unchanged, so the next digest's window reaches back to the last real email.

The digest email does not expose answer data or Show Your Thinking content. It shows: assignment name, teacher name, student name, block, score, and submission time.

---

## 11. Registry Maintenance

### 11.1 Adding a Resource

Add one entry to the Resource Registry in `LyfeLabz_GScript_v2.js`. The entry becomes part of the server allowlist immediately on the next deployment. Any `resourceId` not in the registry is refused.

### 11.2 Adding a Teacher

Follow Section 5.5. No per-page endpoint changes are required. No resource registry changes are required.

### 11.3 Removing a Resource

Remove the entry from the Resource Registry. New submissions for that resource are refused. The historical worksheet in the teacher's spreadsheet is not deleted.

### 11.4 Removing a Teacher

Set `active: false` in the Teacher Registry entry. See Section 5.6.

### 11.5 Renaming a Resource

1. Update `displayTitle` in the Resource Registry entry. The `resourceId` does not change and no client changes are required.
2. If the worksheet tab name should also change, set `worksheetName` to the previous display title until a manual tab rename is performed in the spreadsheet, then remove the override.

### 11.6 Separation of Concerns

The Resource Registry and the Teacher Registry serve distinct purposes and must not be merged.

- The Resource Registry answers: "What is this resource, how many questions does it have, and what is its worksheet name?"
- The Teacher Registry answers: "Where does this teacher's spreadsheet live, and is this teacher active?"

Routing is the intersection: the resource provides its grade, the teacher provides their grade and spreadsheet, and the server validates that both agree before writing.

---

## 12. Non-Goals

This system does not:

- Authenticate submitters. All submissions are anonymous with respect to the server. Identity is student-provided.
- Prevent duplicate submissions. A student who reloads and resubmits will produce two rows.
- Transform or score answers on the server. The client computes and submits the final score string.
- Produce per-item correctness analysis. The Score column is sufficient for the teacher workflow.
- Support server-side validation of score values.
- Serve any GET response for submission routing. `doGet` is unused for submission.
- Store data beyond the appropriate teacher spreadsheet. No secondary logging, no Firestore, no Firebase.
- Handle Photon Runner or Evolution Clicker leaderboards. Those systems are independent.
- Handle Wonderbox question submissions. That system is independent.

---

## 13. Consistency Checklist

Before implementation, verify:

- [ ] `doPost(e)` is the only submission handler. `doGet` is not used for new submissions.
- [ ] Every page sends `resourceId`, `grade`, `teacher`, `studentName`, `block`, `q1` through `qN`, `score`, and `thinking` in the payload.
- [ ] `grade` is hard-coded per page. Students cannot modify it.
- [ ] `teacher` is supplied by the student's selection and uses canonical lowercase kebab-case keys.
- [ ] `new Date()` is the only timestamp source. No `submittedAt` field exists anywhere in the payload or the schema.
- [ ] `worksheetName` defaults to `displayTitle`. Only explicit override entries in the registry differ.
- [ ] The row schema is consistent: Timestamp first, Show Your Thinking last.
- [ ] The server validates `teacher` against the Teacher Registry before opening any spreadsheet.
- [ ] The server validates that the teacher's `grade` matches the resource's `grade` before writing.
- [ ] Spreadsheet routing uses the Teacher Registry. The Resource Registry does not determine the destination spreadsheet.
- [ ] Worksheet selection uses the Resource Registry.
- [ ] Spreadsheet IDs are hardcoded in the Teacher Registry. No Script Properties lookup is used for routing.
- [ ] Practice Mode produces no POST.
- [ ] The Submit button is disabled until teacher, block, name, all questions, and thinking (when required) are provided.
- [ ] A failed POST leaves student work intact.
- [ ] The success reveal (model answer + explanations) is gated on a successful POST response.
- [ ] `LYFELABZ_CENTRAL_ENDPOINT` is the same constant on every page. No per-teacher endpoint maps exist anywhere in the repository.
