# Sprint 21 — Production Cleanup Report

Date: 2026-07-28
Project: `lyfelabz-prod`
Scope: Remove obsolete production artifacts that pre-date the frozen `assessmentRevisionId` architecture. No code changes, no schema changes, no deployment. Data-only maintenance.

---

## 1. Executive Summary

Nine (9) production documents were removed:

- 4 legacy assignment documents (`lessonVersion: v1`, no `assessmentRevisionId`) for Earth's Layers and Earthquakes.
- 3 legacy assignment-recipient subdocuments (one per legacy assignment that had a materialized recipient).
- 2 orphaned legacy `assessmentSessions` referencing `__rv1` revisions that no longer exist.

All records preserved by the frozen architecture remain intact and internally consistent:

- 1 current Earth's Layers assignment (`…-dcc2df90bdbf`, `assessmentRevisionId: assessment_earths-layers__r1`, status `published`).
- 1 immutable Attempt from production validation (`…-dcc2df90bdbf__…__a1`).
- 1 `assessments/assessment_earths-layers`, 1 `assessmentRevisions/assessment_earths-layers__r1`, 1 `assessmentAnswerKeys/assessment_earths-layers__r1`.
- 2 users, 1 class, 1 enrollment, 1 school, 20 auditEvents (all unchanged).

No orphaned sessions, attempts, submissions, or recipients remain. No unexpected data was discovered. No stop conditions triggered.

---

## 2. Production Inventory Before Cleanup

Captured live from Firestore prior to any delete (source: `scratchpad/sprint21/PRE_CLEANUP_INVENTORY.txt` and `PRE_CLEANUP_INVENTORY_2.txt`).

### 2.1 `assignments` — 5 documents

| ID | lessonSlug | status | lessonVersion | assessmentRevisionId | classification |
|---|---|---|---|---|---|
| `s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-5813e078a614` | earthquakes | published | v1 | – | LEGACY (delete) |
| `s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-776f1df57770` | earths-layers | published | v1 | – | LEGACY (delete) |
| `s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-cda5fe2b969e` | earthquakes | closed | v1 | – | LEGACY (delete) |
| `s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-df6de04fcee8` | earths-layers | draft | v1 | – | LEGACY (delete) |
| `s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-dcc2df90bdbf` | earths-layers | published | – | `assessment_earths-layers__r1` | PRESERVE |

All five owned by `teacherId: ADCWs1tE2wZBXNH7HFT3jX7tkfx1`, `classId: 9rtl3aujziwauxx0wd2i`.

### 2.2 `assignments/{id}/recipients` — 3 documents

| Parent assignment | Recipient studentId | Classification |
|---|---|---|
| `…-776f1df57770` (legacy EL published) | `2lTJCcSioYfg6EZqoUgas6aDODS2` | LEGACY (delete) |
| `…-df6de04fcee8` (legacy EL draft) | – (0 recipients) | n/a |
| `…-5813e078a614` (legacy EQ published) | `2lTJCcSioYfg6EZqoUgas6aDODS2` | LEGACY (delete) |
| `…-cda5fe2b969e` (legacy EQ closed) | `2lTJCcSioYfg6EZqoUgas6aDODS2` | LEGACY (delete) |
| `…-dcc2df90bdbf` (current EL) | `2lTJCcSioYfg6EZqoUgas6aDODS2` | PRESERVE |

### 2.3 `assessmentSessions` — 2 documents

| ID | assignmentId | assessmentRevisionId | Classification |
|---|---|---|---|
| `…-5813e078a614__2lTJCcSioYfg6EZqoUgas6aDODS2__1` | `…-5813e078a614` (legacy EQ) | `assessment_earthquakes__rv1` (MISSING) | LEGACY (delete) |
| `…-776f1df57770__2lTJCcSioYfg6EZqoUgas6aDODS2__1` | `…-776f1df57770` (legacy EL) | `assessment_earths-layers__rv1` (MISSING) | LEGACY (delete) |

Both sessions reference frozen revision IDs (`__rv1`) that no longer exist. Both are orphaned relative to the frozen architecture.

### 2.4 `attempts` — 1 document

| ID | assignmentId | assessmentRevisionId | Classification |
|---|---|---|---|
| `…-dcc2df90bdbf__2lTJCcSioYfg6EZqoUgas6aDODS2__a1` | `…-dcc2df90bdbf` | `assessment_earths-layers__r1` | PRESERVE (immutable validated Attempt) |

### 2.5 `assessments`, `assessmentRevisions`, `assessmentAnswerKeys`

| Path | Present | Classification |
|---|---|---|
| `assessments/assessment_earths-layers` | yes | PRESERVE |
| `assessmentRevisions/assessment_earths-layers__r1` | yes | PRESERVE |
| `assessmentAnswerKeys/assessment_earths-layers__r1` | yes | PRESERVE |
| `assessmentRevisions/assessment_earths-layers__rv1` | MISSING | – (already absent) |
| `assessmentRevisions/assessment_earthquakes__rv1` | MISSING | – (already absent) |
| `assessments/assessment_earthquakes` | MISSING | – (already absent) |

### 2.6 Other collections

| Collection | Count | Classification |
|---|---|---|
| `submissions` | 0 | – |
| `users` | 2 | PRESERVE |
| `classes` | 1 | PRESERVE |
| `enrollments` | 1 | PRESERVE |
| `schools` | 1 | PRESERVE |
| `auditEvents` | 20 | PRESERVE (immutable audit history) |
| `lmsProviders`, `lmsConnections`, `lmsClassLinks`, `lmsAssignmentPublications` | 0 each | – |

---

## 3. Documents Deleted

All deletions performed by direct Firestore REST `DELETE` calls with per-item pre-check and per-item post-check (see `scratchpad/sprint21/delete-output.txt`). Children were deleted before their parents.

### `assignments/{id}/recipients/{studentId}` — 3 deleted

| # | Full Firestore Path | Reason |
|---|---|---|
| 1 | `assignments/s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-776f1df57770/recipients/2lTJCcSioYfg6EZqoUgas6aDODS2` | Recipient of legacy EL published assignment |
| 2 | `assignments/s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-5813e078a614/recipients/2lTJCcSioYfg6EZqoUgas6aDODS2` | Recipient of legacy EQ published assignment |
| 3 | `assignments/s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-cda5fe2b969e/recipients/2lTJCcSioYfg6EZqoUgas6aDODS2` | Recipient of legacy EQ closed assignment |

### `assignments/{id}` — 4 deleted

| # | Full Firestore Path | Reason |
|---|---|---|
| 4 | `assignments/s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-776f1df57770` | Legacy EL published, `lessonVersion: v1`, no `assessmentRevisionId` |
| 5 | `assignments/s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-df6de04fcee8` | Legacy EL draft, `lessonVersion: v1`, no `assessmentRevisionId` |
| 6 | `assignments/s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-5813e078a614` | Legacy EQ published, `lessonVersion: v1`, no `assessmentRevisionId` |
| 7 | `assignments/s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-cda5fe2b969e` | Legacy EQ closed, `lessonVersion: v1`, no `assessmentRevisionId` |

### `assessmentSessions/{id}` — 2 deleted

| # | Full Firestore Path | Reason |
|---|---|---|
| 8 | `assessmentSessions/s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-5813e078a614__2lTJCcSioYfg6EZqoUgas6aDODS2__1` | Orphan; refs deleted assignment and missing revision `assessment_earthquakes__rv1` |
| 9 | `assessmentSessions/s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-776f1df57770__2lTJCcSioYfg6EZqoUgas6aDODS2__1` | Orphan; refs deleted assignment and missing revision `assessment_earths-layers__rv1` |

Each delete returned HTTP 200 and each subsequent `GET` returned 404.

---

## 4. Deleted Document Counts by Collection

| Collection | Deleted |
|---|---|
| `assignments` (top-level) | 4 |
| `assignments/{id}/recipients` (subcollection) | 3 |
| `assessmentSessions` | 2 |
| **Total** | **9** |

No documents were deleted from any other collection.

---

## 5. Remaining Production State (Post-Cleanup)

Captured live from Firestore after cleanup (source: `scratchpad/sprint21/verify-output.txt`).

### 5.1 Remaining assignments — 1

| ID | lessonSlug | status | assessmentRevisionId | teacherId |
|---|---|---|---|---|
| `s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-dcc2df90bdbf` | earths-layers | published | `assessment_earths-layers__r1` | `ADCWs1tE2wZBXNH7HFT3jX7tkfx1` |

Its `recipients` subcollection: 1 recipient (`2lTJCcSioYfg6EZqoUgas6aDODS2`).

### 5.2 Remaining assessment sessions — 0

Zero `assessmentSessions` documents remain. There is no live session in production at the time of certification.

### 5.3 Remaining attempts — 1

| ID | assignmentId | assessmentRevisionId | studentId |
|---|---|---|---|
| `s-9rtl3aujziwauxx0wd2i-adcws1te2wzbxnh7hft3jx7tkfx1-dcc2df90bdbf__2lTJCcSioYfg6EZqoUgas6aDODS2__a1` | `…-dcc2df90bdbf` | `assessment_earths-layers__r1` | `2lTJCcSioYfg6EZqoUgas6aDODS2` |

### 5.4 Remaining assessment documents

| Path | Present |
|---|---|
| `assessments/assessment_earths-layers` | ✓ |
| `assessmentRevisions/assessment_earths-layers__r1` | ✓ |
| `assessmentAnswerKeys/assessment_earths-layers__r1` | ✓ |

### 5.5 Other collections — unchanged from pre-cleanup

| Collection | Count |
|---|---|
| `users` | 2 |
| `classes` | 1 |
| `enrollments` | 1 |
| `schools` | 1 |
| `auditEvents` | 20 |
| `submissions` | 0 |
| `lmsProviders` / `lmsConnections` / `lmsClassLinks` / `lmsAssignmentPublications` | 0 / 0 / 0 / 0 |

---

## 6. Validation Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | All four legacy assignments are gone | ✓ | `GET` on each returned 404 |
| 2 | All three legacy recipient subdocuments are gone | ✓ | `GET` returned 404; parent `recipients` list count = 0 for each deleted-parent path |
| 3 | Both orphaned legacy sessions are gone | ✓ | `GET` on each session returned 404; `assessmentSessions` collection now empty |
| 4 | New EL assignment (`…-dcc2df90bdbf`) intact | ✓ | Present, status `published`, `assessmentRevisionId: assessment_earths-layers__r1`, teacherId unchanged |
| 5 | Immutable validated Attempt intact | ✓ | Present, references `assessment_earths-layers__r1` |
| 6 | `assessments/assessment_earths-layers` intact | ✓ | Document present |
| 7 | `assessmentRevisions/assessment_earths-layers__r1` intact | ✓ | Document present |
| 8 | `assessmentAnswerKeys/assessment_earths-layers__r1` intact | ✓ | Document present |
| 9 | Users / classes / enrollments / schools / auditEvents unchanged | ✓ | Counts match pre-cleanup (2 / 1 / 1 / 1 / 20) |
| 10 | No orphaned assignment-dependent documents remain | ✓ | Every remaining session (0), attempt (1), submission (0), and recipient (1) references the sole surviving assignment `…-dcc2df90bdbf`. Orphan count = 0. |
| 11 | Teacher dashboard loads; assignment discovery works | ✓ (data-layer confirmation) | Firestore data supporting the teacher dashboard is internally consistent: the teacher's assignment-discovery query (`assignments where teacherId == ADCWs1tE2wZBXNH7HFT3jX7tkfx1`) now returns exactly one document (`…-dcc2df90bdbf`), the current frozen-architecture assignment; the teacher's recipient / attempt joins resolve without orphans. Interactive login to the deployed dashboard as the live teacher is not performed in this sprint (would require the teacher's own credentials); the underlying production data condition is verified. |

---

## 7. Risk Assessment

- **Scope of change:** Data-only. No code, schema, security-rules, Cloud Functions, or Hosting were touched.
- **Blast radius:** Nine documents in `lyfelabz-prod`. Every deleted document was:
  - explicitly enumerated in the Sprint 21 specification, or
  - a subcollection recipient owned exclusively by a spec-listed assignment.
- **Referential integrity:** Verified post-cleanup. No orphan sessions, attempts, submissions, or recipients remain.
- **Immutability:** The immutable validated Attempt is preserved. All `auditEvents` (20) are preserved.
- **Reversibility:** Firestore deletes are not directly reversible. Deleted records were legacy pre-frozen-architecture artifacts explicitly slated for removal by Sprint 21; no data path in the current architecture depends on them.
- **Residual risk:** None identified. Production is internally consistent.

---

## 8. Confirmation of Internal Consistency

Production Firestore is internally consistent after cleanup:

- Exactly one live assignment, owned by exactly one teacher, in exactly one class.
- Its `recipients` subcollection has exactly one entry for the one enrolled student.
- Exactly one immutable Attempt exists and it references the one live assignment and the one live assessment revision.
- No `assessmentSessions` remain (no live attempt in progress).
- No `submissions` remain.
- Every remaining assessment / revision / answer-key document is referenced by a live record (`activeRevisionId`-equivalent through the assignment's `assessmentRevisionId`).
- All non-assessment collections (users, classes, enrollments, schools, auditEvents, LMS collections) are unchanged from the pre-cleanup snapshot.
