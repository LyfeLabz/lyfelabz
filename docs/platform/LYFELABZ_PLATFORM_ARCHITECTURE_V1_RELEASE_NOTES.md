# LyfeLabz Platform Architecture Version 1.0 - Release Notes

**Date:** 2026-07-07
**Preceded by:** LYFELABZ_PLATFORM_ARCHITECTURE_CERTIFICATION.md
**Purpose:** Record the final Architecture Version 1.0 polishing pass. Every Critical finding raised by the certification is either resolved in place or documented as a deliberate deferral.
**Scope of changes:** Editorial and terminological only. No architectural redesign. No new concepts. No Firebase code, Security Rules, or Cloud Functions written.

This document closes the Platform Architecture phase.

---

## 1. Summary of Changes by Certification Finding

The certification's nine Critical findings were addressed as follows.

### 1.1 Curation vs Assignment terminology (Certification 3.1, 11.1)

**Resolution.** Amend PDR-010 to accept "assignment" as the neutral **schema and domain** term for the curation pointer record, and bind user-facing vocabulary in the same amendment.

**Applied changes:**

- `LYFELABZ_PLATFORM_DECISIONS.md` - PDR-010 gains a "Terminology Amendment (2026-07-07)" subsection that declares "assignment" the canonical schema name, and forbids the user-facing words "assigned," "due," "late," "overdue," "required," and "graded" in Teacher and Student UI. It also renames the underlying fields: `dueAt` becomes `windowClosesAt`; `allowLateSubmissions` is removed; `mode: graded` becomes `mode: classroom`.
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` - Section 2.1 gains the same terminology note. Section 3.6 (assignments) is rewritten to describe curation semantics, replaces `dueAt` with `windowClosesAt`, removes `allowLateSubmissions`, and changes `mode: practice or graded` to `mode: practice or classroom`. The lifecycle gains an `archived` state.
- `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` - Section 2.2.2a rewrites the "My Assignments (per class)" query to sort by `windowClosesAt` rather than `dueAt`, with an explicit note that the field is not a due date.
- `LYFELABZ_PLATFORM_DOMAIN_MODEL.md` - the Assignment entity definition gains the same terminology guardrail.
- `LYFELABZ_PLATFORM_ARCHITECTURE.md` - the Assignments data-domain paragraph gains a matching terminology footnote.
- `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` - "missing" is replaced with "not yet submitted" where appropriate, with an explicit reminder that "missing," "overdue," and "late" are forbidden in user-facing surfaces.
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` - the Assessment finalization and Scheduled maintenance sections adopt the reconciled vocabulary.

**Intent of PDR-010 is unchanged.** The amendment only draws the line between schema and UI explicitly.

### 1.2 Administrator terminology (Certification 3.2, 11.2)

**Resolution.** "Platform Administrator" is canonical in prose. The Firestore `role` field value is `platformAdministrator`.

**Applied changes:**

- `LYFELABZ_PLATFORM_ARCHITECTURE.md` - Section 4's top-tier role is renamed from "LyfeLabz Administrator" to "Platform Administrator." Every subsequent "LyfeLabz administrator" reference is normalized to "Platform Administrator" or "Platform Administrators."
- `LYFELABZ_PLATFORM_DECISIONS.md` - all "LyfeLabz Administrator" references normalized to "Platform Administrator." PDR-004 already reads "Platform Administrator" for the closed role set.
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` - Section 2.1 and Section 3.1 name the Firestore role values as `teacher`, `student`, and `platformAdministrator`. Future values (`parent`, `schoolAdministrator`, `districtAdministrator`) are listed as reserved.
- `LYFELABZ_PLATFORM_DOMAIN_MODEL.md` - the closed role list in Section 8 now enumerates Anonymous Visitor, Student, Teacher, and Platform Administrator, plus the anticipated Parent, School Administrator, and District Administrator.

### 1.3 Enrollment status vocabulary (Certification 3.3, 11.3)

**Resolution.** Canonical vocabulary is `active`, `transferred`, `withdrawn`, `archived`.

**Applied changes:**

- `LYFELABZ_PLATFORM_ARCHITECTURE.md` - the Enrollments paragraph in Section 6 lists the canonical statuses.
- `LYFELABZ_PLATFORM_DOMAIN_MODEL.md` - Section 5's Enrollment lifecycle uses the canonical statuses; Section 2 Enrollment lifecycle description updated accordingly.
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` - Section 3.4 adds the `archived` terminal state to the previously enumerated `active`, `transferred`, `withdrawn`.

### 1.4 Assignment lifecycle (Certification 3.4, 11.4)

**Resolution.** Canonical lifecycle is `draft`, `published`, `closed`, `archived`.

**Applied changes:**

- `LYFELABZ_FIRESTORE_DATA_MODEL.md` - Section 3.6 status enumeration adds `archived` with a rationale. The lifecycle paragraph is updated to name class-archival as the trigger.

### 1.5 Submission lifecycle (Certification 3.6, 11.5)

**Resolution.** The authoritative submission collection contains only `finalized` records. `submitted` exists as a transient in-transaction state and is never observable to any reader. There is no client-authored `in-progress` state on the authoritative collection.

**Applied changes:**

- `LYFELABZ_FIRESTORE_DATA_MODEL.md` - Section 3.7 replaces `status: in-progress, submitted, finalized` with `status: submitted, finalized`, and explains that only `finalized` is ever observable. Ownership language is updated to reflect that the server, not the student, creates the document.
- `LYFELABZ_PLATFORM_DOMAIN_MODEL.md` - Section 2 (Assessment Submission) and Section 5 (Lifecycles) both adopt the reconciled two-state lifecycle.
- `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` - Section 2 keeps its stricter language and now cross-references the reconciled data-model wording.

### 1.6 Operational constants (Certification 3, 7, 11.6)

**Resolution.** Concrete Version 1 defaults are attached to PDR-011 and PDR-012 as tunable recommended values, not immutable architectural decisions.

**Applied changes:**

- `LYFELABZ_PLATFORM_DECISIONS.md` - PDR-012 gains explicit Version 1 defaults for rate limiting (sign-in, join-code, submission writes, publication writes) and for session length (12 hours idle-tolerant, 24-hour hard maximum).
- `LYFELABZ_PLATFORM_DECISIONS.md` - PDR-011 gains explicit Version 1 retention defaults (submissions retained 3 years past class archival, then redacted; enrollments 3 years; archived classes 5 years). Legally significant events retained 7 years live plus indefinite cold storage.
- `LYFELABZ_PLATFORM_DECISIONS.md` - PDR-013 gains explicit Version 1 defaults for audit-log retention (24 months live in the `auditEvents` collection, then export to cold storage for 5 years, then destroy).

### 1.7 Audit architecture (Certification 3, 7, 11.7)

**Resolution.** The Firestore `auditEvents` collection **is** the platform's authoritative append-only audit sink. Cold-storage export is a retention mirror, not a second sink. Append-only is enforced by Security Rules that permit `create` from trusted server context only and forbid `update` and `delete` for every role, including Platform Administrator.

**Applied changes:**

- `LYFELABZ_FIRESTORE_DATA_MODEL.md` - Section 3.8 rewrites the `auditEvents` purpose paragraph to name the collection as the authoritative sink and to describe the append-only enforcement mechanism.
- `LYFELABZ_PLATFORM_DECISIONS.md` - PDR-012 and PDR-013 replace "streamed to a separate append-only sink" with the reconciled definition.
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md` - Section 11.8 restates the audit-log architecture in terms of the reconciled definition, including the invariant that no role, including Platform Administrator, may update or delete audit records.
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` - the Audit event creation responsibility paragraph is updated to name the Firestore `auditEvents` collection explicitly and to cite PDR-013 and Security Model Section 11.

### 1.8 Broken reference (Certification 3.5, 11.8)

**Resolution.** The stale forward reference to `LYFELABZ_TECHNICAL_CERTIFICATION_V1.md` is updated to point at the actual certification document.

**Applied changes:**

- `LYFELABZ_FIRESTORE_DATA_MODEL.md` - Section 1 prerequisite list now cites `LYFELABZ_PLATFORM_ARCHITECTURE_CERTIFICATION.md`.

### 1.9 Classroom Mode terminology (Certification 3.7, 11.9)

**Resolution.** The canonical mode vocabulary is `Practice Mode` and `Classroom Mode` (matching CLAUDE.md). The Assignment record's `mode` field takes the values `practice` and `classroom`. The word "graded" is not used at any layer.

**Applied changes:**

- `LYFELABZ_FIRESTORE_DATA_MODEL.md` - Section 3.6 `mode` values changed from `practice or graded` to `practice or classroom`, with an explicit statement that no `graded` mode exists.
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` - Section 2 gains a terminology note that binds Practice Mode and Classroom Mode as the only runtime modes and forbids "graded" at every layer.
- `LYFELABZ_PLATFORM_DECISIONS.md` - PDR-010 terminology amendment codifies the same rule.

---

## 2. Documents Updated

The following canonical documents in `docs/platform/` were updated during this pass:

- `LYFELABZ_PLATFORM_ARCHITECTURE.md`
- `LYFELABZ_PLATFORM_DECISIONS.md`
- `LYFELABZ_PLATFORM_DOMAIN_MODEL.md`
- `LYFELABZ_FIRESTORE_DATA_MODEL.md`
- `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md`
- `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md`
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md`
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`

The Architecture Review (`LYFELABZ_ARCHITECTURE_REVIEW.md`) was intentionally not modified. Per the certification, it is a historical review snapshot and should not be edited going forward. The certification itself (`LYFELABZ_PLATFORM_ARCHITECTURE_CERTIFICATION.md`) was also not modified for the same reason: it is the permanent record that produced the Critical list this document responds to.

---

## 3. Certification Findings Resolved

Confirmation that each Critical item in Section 11 of the certification is closed:

1. Curation vs Assignment reconciled through the PDR-010 Terminology Amendment. **Resolved.**
2. Top-tier operator role normalized to "Platform Administrator" everywhere. **Resolved.**
3. Enrollment lifecycle vocabulary normalized to `active, transferred, withdrawn, archived`. **Resolved.**
4. Assignment lifecycle gains `archived`. **Resolved.**
5. Submission `in-progress` reconciled: removed from the authoritative collection; `submitted` is transactional-only; readers see only `finalized`. **Resolved.**
6. Session length, rate limits, and retention windows attached to PDR-011, PDR-012, PDR-013 as recommended Version 1 defaults. **Resolved.**
7. Audit-log boundary clarified: Firestore `auditEvents` is the authoritative append-only sink; cold-storage export is a retention mirror. **Resolved.**
8. Stale prerequisite reference updated. **Resolved.**
9. Classroom Mode vs Graded Mode reconciled: canonical modes are Practice Mode and Classroom Mode; no `graded` at any layer. **Resolved.**

---

## 4. Recommendations Deliberately Deferred to Implementation

The certification also raised Important and Optional recommendations. These are intentionally deferred to the Platform Engineering phase, per Section 12 of the certification.

**Deferred to first engineering week (Important):**

- Content Security Policy and security-headers PDR before the first dashboard ships.
- Scoping grade-level rollout defaults at the district level from day one.
- Defining the process for maintaining the verified school Workspace domain list (PDR-003 operational detail).
- Encoding the denormalization discipline rule as a code-review checklist referenced from CLAUDE.md when platform work begins.
- Publishing a one-page terminology glossary alongside the Decisions log.
- Routing grade rollouts through the feature-flag system rather than through document writes.

**Deferred as defensible (Optional):**

- Named support-tooling design.
- Concrete feature-flag mechanism choice.
- Concrete class-level rollup shape.
- District analytics pipeline shape.

None of the above is architectural. Each is an engineering-week task. The architecture as written does not preclude any of them.

---

## 5. Governance

This document is the closing artifact of the Architecture phase. It is not itself a canonical architecture document. It records the final maintenance pass that made the corpus internally consistent.

Post-issuance rules:

- The eight canonical documents listed in Section 2, together with the Architecture Review and the Certification, are considered frozen at Version 1.0.
- Future changes to any load-bearing decision on the formal-review list in `LYFELABZ_PLATFORM_DECISIONS.md` require a new decision record superseding the current one, an impact assessment, and explicit owner acknowledgment.
- Smaller changes (tuning a rate-limit number, adjusting a retention window, renaming a status value) proceed through the normal PR-level decision-record process.
- No new architectural concepts are introduced without a documented review.

---

LyfeLabz Platform Architecture Version 1.0 is complete and ready to enter Platform Engineering.
