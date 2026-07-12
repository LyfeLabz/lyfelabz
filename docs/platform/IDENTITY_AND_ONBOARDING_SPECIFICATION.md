# LyfeLabz Identity and Onboarding Specification

**Status:** Certified. Canonical single source of truth for LyfeLabz identity, onboarding, verification, roster authority, and the authenticated experience shell.
**Sprint of record:** Sprint 9C - Architecture Decision Workshop (Identity and Onboarding).
**Authoritative anchor:** PDR-023 (Identity and Onboarding Architecture). Precedent PDRs (PDR-002, PDR-003, PDR-004, PDR-005, PDR-015, PDR-019, PDR-020) are reconciled through this document.
**Companion documents:** `LYFELABZ_PLATFORM_DECISIONS.md`, `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_PLATFORM_DOMAIN_MODEL.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `PLATFORM_STATE_MACHINE.md`, `PLATFORM_CONTRACTS.md`, `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, `ASSESSMENT_PIPELINE_SPECIFICATION.md`, `PLATFORM_OPERATIONS_SPECIFICATION.md`, `LYFELABZ_SPRINT_2_ONBOARDING_AND_VERIFICATION.md`, `TEACHER_JOURNEY.md`.

This specification is the single source of truth for LyfeLabz identity behavior. Where any earlier document contradicts this specification, this specification controls. Superseding notices in affected documents point back here.

---

## 1. Identity Philosophy

LyfeLabz distinguishes three questions and answers each independently.

- **Authentication.** *Who are you?* Answered by the identity provider (Google Workspace at Version 1). Authentication proves possession of an external account. It grants no platform permissions.
- **Authorization.** *What are you allowed to do?* Answered by the platform's role and verification state. Authorization is granted by the platform, not by the identity provider.
- **Identity.** *Who are you within your school and district?* Answered by the LyfeLabz identity record. Identity ties an authenticated principal to a school, a district, and a role, and carries the educational history that belongs to the person.

Authentication alone never grants platform permissions. A successful Google sign-in produces an authenticated principal with no platform capabilities until identity resolution and, for teachers, verification complete.

---

## 2. Authentication vs Authorization

Authentication is the responsibility of the external identity provider. Authorization is the responsibility of the platform. The two never merge.

- Authentication tokens prove the caller controls an external account. They do not describe the caller's role, school, or class enrollments.
- Authorization is expressed through the platform's custom claims (`role`, `schoolId`, reserved `districtId`) and through the server-authoritative identity record on `users/{uid}`. Claims are written only when the user's `status` is `active` per `PLATFORM_STATE_MACHINE.md`.
- Anonymous exploration is permitted. Anonymous exploration produces no identity record and no attempt (`ASSESSMENT_PIPELINE_SPECIFICATION.md`).
- Signing in is not the same as being authorized. A signed-in user with no active claims sees an experience appropriate to their in-progress lifecycle state, not a locked dashboard.

The authentication provider may change. Identity does not. Additional providers may be linked to an existing LyfeLabz identity without changing the identity itself.

---

## 3. Identity Architecture

Every LyfeLabz identity is a server-authoritative record on `users/{uid}` created by the platform through the provisioning trigger and completed through onboarding. The identity architecture obeys the following invariants.

- **Server-authoritative.** No client is trusted to declare who a user is.
- **Atomic.** Each identity-changing operation is a single transactional step.
- **Idempotent.** Repeated invocations of the same operation with the same inputs produce the same terminal state.
- **Additive.** Identity records grow through additive writes. No canonical field is renamed at the record level; historic renames are documented as amendments and never as silent migrations.
- **Two-layered.** The provider layer (Google account, or a future provider) authenticates. The platform layer (LyfeLabz identity record) authorizes.
- **Two identity families.** Teacher identities and student identities are governed by distinct provisioning, verification, and lifecycle rules. Neither family ever silently becomes the other.

---

## 4. Teacher Identity

Teachers hold a dedicated teacher identity that is separate from any student identity.

- Teachers enter through a dedicated teacher sign-in flow. This flow is signposted, distinct from student onboarding, and never reachable by accident from a student surface.
- Teachers authenticate using their district-issued Google Workspace account. Personal Google accounts are refused by the teacher onboarding callable per PDR-002 and produce an `auth.activationRejected` audit event with no state change.
- Post-authentication, teachers complete institutional verification before receiving any capabilities beyond an in-progress screen.
- Verification, once complete, grants access to the Teacher Workspace, class creation (import or manual), Google Classroom integration under `LMS_INTEGRATION_ARCHITECTURE.md`, roster views, and access to student attempts under `ASSESSMENT_PIPELINE_SPECIFICATION.md`.
- Unverified teacher identities may not create classes, import from Google Classroom, generate join codes, view rosters, or read student data. The pre-verification experience communicates state; it never silently exposes capabilities.

Teacher identity is district-bound. Section 8 defines the district architecture that gives this rule meaning. Section 15 defines the teacher lifecycle within it.

---

## 5. Student Identity

Students hold a permanent LyfeLabz Student ID linked to a Google account.

- The LyfeLabz Student ID is the authoritative identifier. It is issued by the platform, is never transferred between people, and outlives any change in enrolled class or school within its district.
- The Google account is the authentication provider. Additional providers may be linked in a future sprint without changing the Student ID.
- Students own their educational history. Their history follows the Student ID, not the class or the teacher.
- Students never manage identity. Students never select themselves from a roster, never enter identity fields on a form, and never resolve identity ambiguity by hand.

Student identity is created only at first successful Google sign-in, not at roster import. See §11.

---

## 6. District Architecture

The certified organizational hierarchy is:

```
Platform
  |
District
  |
School
  |
Teacher Identity
  |
Class
  |
Enrollment
```

- **Districts are security boundaries.** Every identity, school, class, roster, and attempt lives inside exactly one district. Cross-district reads and writes are refused at the security-rule and callable layers.
- **A school belongs to exactly one district.** School boundaries do not span districts.
- **A class belongs to exactly one school.** Class boundaries do not span schools.
- **A teacher identity belongs to exactly one district.** Within that district, a teacher identity may be explicitly authorized for more than one school. Cross-school authorization is a Platform Administrator or school-administrator action, never a self-serve claim.
- **A student identity belongs to exactly one district at a time.** Students who move to a new district produce a new identity (see §14).

The Domain Model previously described the District entity as "Future." This specification promotes the District to a first-class, load-bearing entity. `LYFELABZ_PLATFORM_DOMAIN_MODEL.md` and `LYFELABZ_FIRESTORE_DATA_MODEL.md` are reconciled in Sprint 9C to reflect this promotion.

---

## 7. School Architecture

Schools are the primary institutional container beneath a district.

- Each school has a stable identifier assigned at creation and never changed. Renames are display-only.
- Each school belongs to exactly one district.
- Each school defines the set of teacher identities authorized to teach within it and the set of class records owned by those teachers.
- Schools are archived, never deleted. Historical roster and attempt attribution survive archival.
- A teacher identity may hold authorized membership in multiple schools within the same district. Multi-school authorization is expressed as an explicit set of school memberships on the identity record, not as a duplicated identity per school.

---

## 8. Class Architecture

A class is the operational unit of a teacher's instruction.

- A class is owned by exactly one teacher identity (PDR-005; PDR-019j). Multi-teacher references remain the additive extension defined by PDR-005.
- A class belongs to exactly one school.
- A class belongs to exactly one school year (PDR-006).
- A class has exactly one **roster authority** (§9).
- A class has exactly one **enrollment source** (join code or LMS link) per PDR-019i.
- A class is archived, never deleted. Enrollment records and attempts survive archival.
- New classes are created only through the `Classes` workspace using `+ Add Class`. Settings never creates classes.

Class creation offers exactly two options:

- **Import from Google Classroom** (§10). The class is created LMS-linked. The roster authority is Google Classroom.
- **Create Class Manually** (§11). The class is created LyfeLabz-owned. The roster authority is LyfeLabz. A join code is generated at creation.

---

## 9. Roster Authority

Every class has exactly one roster authority. The rule admits no ambiguity and no override.

- **LMS-linked classes.** Google Classroom is the roster authority. The LyfeLabz roster is a mirror. Join-code redemption is refused server-side against a linked class (PDR-019i). Continuous synchronization keeps the mirror aligned with the upstream roster.
- **Manual classes.** LyfeLabz is the roster authority. Students join by redeeming a server-generated join code (§12). Google Classroom performs no writes into the class.
- **No hybrid roster authority is permitted.** A class is never partially owned by two authorities. Attempts to add students to a linked class through join codes, or to import Google Classroom students into a manual class without converting the class, are refused.

Roster displays visually reflect activation state (§13). Activation status is never conveyed by color alone (`PLATFORM_CONTRACTS.md` accessibility rules).

---

## 10. Google Classroom Integration

Google Classroom is the preferred onboarding path per `LMS_INTEGRATION_ARCHITECTURE.md` and PDR-020a.

- The teacher imports classes from Google Classroom through the Teacher Workspace.
- The import creates the class in the LyfeLabz-linked state and pulls the current Google Classroom roster.
- Roster synchronization is continuous within the manual-first posture of PDR-019c. The mirror is refreshed on teacher-initiated refresh at Version 1; automatic synchronization remains a reversible, opt-in extension.
- Students join simply by signing in. No join code is required. No teacher-managed enrollment step is required.
- The teacher never maintains a duplicate roster. `LYFELABZ_PLATFORM_DECISIONS.md` PDR-019a's complement-not-replace rule remains load-bearing.

Google Classroom User ID is the primary identity-matching key (§13). Email address is the secondary validator.

---

## 11. Manual Class Creation

Manual classes exist for teachers whose classes are not represented in Google Classroom or who choose the manual path.

- The teacher creates the class from `Classes` -> `+ Add Class` -> `Create Class Manually`.
- The server generates a join code (§12) at creation.
- The teacher shares the join code with students.
- Students authenticate with Google, redeem the join code, and become enrolled.

Manual classes remain LyfeLabz-owned for their entire lifecycle. A manual class does not become LMS-linked through student action. Conversion (if ever authorized) is a Platform-Administrator-recorded operation. No form of join-code enrollment produces an enrollment in an LMS-linked class.

---

## 12. Join Code Architecture

Join codes are the enrollment credential for manual classes and only for manual classes.

- **Server-generated.** Codes are minted by a callable. Clients never mint codes.
- **Unique.** Codes are unique across the active code space at issue time. Collisions are refused server-side and re-drawn.
- **Revocable.** Teachers may revoke a code without archiving the class.
- **Replaceable.** Teachers may rotate a code. The prior code is retired. Existing enrollments are not affected.
- **Disabled after archive.** Archiving a class disables its active code.
- **Never anonymous.** Redemption requires an authenticated Google session. Anonymous redemption is refused.
- **Class-scoped.** Redemption maps to exactly one class. A code never maps to a district or a school.

Redemption is atomic and idempotent. Repeated redemption of the same code by the same authenticated principal produces the same terminal enrollment, not a duplicate. Redemption against a linked class is refused server-side (PDR-019i).

Join codes are not identities. Redemption produces enrollments; it never provisions a student identity that did not exist. See §11 and §13.

---

## 13. Teacher Verification

Verification is the load-bearing gate between an authenticated teacher and a capability-bearing teacher identity.

### 13.1 Preferred path - Verification code

The preferred path is a one-time, institution-bound verification code.

- Codes are single-use.
- Codes expire.
- Codes are revocable.
- Codes are server-validated.
- Codes are issued by a Platform Administrator or by an authorized school administrator (future).
- Codes are bound to the issuing district and school. Redemption against a mismatched district or school is refused.

The teacher pastes the code once during onboarding. On successful validation, the teacher identity is verified and enters the `active` status per `PLATFORM_STATE_MACHINE.md`. The Sprint 2 `teachers.verificationApproved` audit event is produced by the callable that redeems a valid verification code.

### 13.2 Fallback - Request Teacher Access

For teachers whose schools have not yet been issued verification codes, or whose codes are unavailable, the fallback is the Request Teacher Access workflow.

- The teacher submits a request from the onboarding surface.
- The identity remains in `pendingVerification` (per `PLATFORM_STATE_MACHINE.md`) until a Platform Administrator approves or denies.
- Approval produces `teachers.verificationApproved` and transitions the identity to `active`.
- Denial produces `teachers.verificationDenied` and returns the identity to `provisioned` (Sprint 2 §4.5, unchanged).

### 13.3 Invisibility principle

Verification is completed once. After completion, the teacher never sees verification affordances again. The verified teacher's ordinary workflows must contain no residual verification chrome.

PDR-003 previously anchored verification to a maintained list of verified school Workspace domains as the automated path. This specification supersedes that mechanism with the verification-code mechanism, which is stronger against personal-domain edge cases and does not depend on maintaining a domain allowlist. `LYFELABZ_SPRINT_2_ONBOARDING_AND_VERIFICATION.md` §4.3 already deferred the domain list to a later sprint; this specification retires the domain-list approach entirely.

---

## 14. Teacher Onboarding

Teacher onboarding is the sequence that turns an authenticated Google Workspace principal into a verified teacher identity.

1. The teacher arrives at the dedicated teacher sign-in surface.
2. The teacher authenticates with a district Google Workspace account.
3. The provisioning trigger writes the canonical `users/{uid}` record in the `provisioned` state (Sprint 2 §4.1; unchanged).
4. The teacher confirms role selection through the callable that produces `teachers.verificationRequested`. If the account is personal, the callable produces `auth.activationRejected` with no state change.
5. The teacher completes verification via §13.1 (code) or §13.2 (request).
6. On verification, custom claims (`role: "teacher"`, `schoolId`, reserved `districtId`) are written by the canonical claims helper (Sprint 2 §4.4).
7. The teacher enters the Teacher Workspace and proceeds to class creation (§10 or §11).

No workflow step ever exposes teacher capabilities before verification succeeds.

---

## 15. Student Onboarding

Student onboarding is the sequence that establishes a student identity and enrolls the student in one or more classes.

1. The student arrives at any surface that requires authentication (assessment, assignment, workspace).
2. The student signs in with Google.
3. On first successful sign-in, the platform provisions the LyfeLabz Student ID and the canonical `users/{uid}` record.
4. Identity matching (§16) resolves the sign-in to the correct student on any pre-existing rosters.
5. For LMS-linked classes, enrollment is created by the Google Classroom mirror. For manual classes, the student redeems a join code.
6. The student proceeds to the surface that required authentication. Return-to-location is preserved (§20).

Students never see verification screens. Students never resolve identity ambiguity. Students never select themselves from a roster.

---

## 16. First Sign-In Activation

Roster import does not create a student identity. Student identities are created only after first successful Google sign-in.

- On roster import (from Google Classroom or from any future roster source), the teacher immediately sees the imported roster in the class. Roster entries in this state are labeled **Awaiting first sign-in**.
- The imported roster entry is not a student identity. It is a placeholder that names the expected student.
- On first successful Google sign-in matched to the roster entry (§17), the platform provisions the student identity, links it to the roster entry, and transitions the roster entry from **Awaiting first sign-in** to **Active**.
- The transition is atomic and idempotent. Repeated first sign-ins on the same account do not produce duplicate identities.
- The teacher's roster reflects activation state visually. Activation is never represented by color alone.

Explicit consequence: a student who never signs in is never provisioned as a LyfeLabz identity. The roster placeholder is retained until the roster authority removes it.

---

## 17. Identity Matching

Identity matching resolves an authenticated principal to the correct student roster entry.

- **Primary key.** Google Classroom User ID. Where an LMS-linked class exists, the User ID is the authoritative match.
- **Secondary validator.** Email address. Email is used to validate and disambiguate a User ID match; it is never sufficient on its own to match across roster authorities.
- **Never manual.** Students never see and never operate a roster picker. If matching is ambiguous, the sign-in is held for administrative resolution rather than resolved by student choice.
- **Server-authoritative.** Matching is performed inside a callable. No client is trusted to declare identity.

Matching is idempotent. Repeated sign-ins by the same principal produce the same identity resolution.

---

## 18. Student Transfers

Student educational history belongs to the student, not to the class or the teacher.

- Transfers within the same district (new class, new teacher, new school) never create a new student identity. The LyfeLabz Student ID is preserved.
- The teacher's dashboard displays only work completed while the student was enrolled in that teacher's class. Historical work with other teachers is not surfaced to a new teacher.
- Transfers do not delete prior enrollments. Prior enrollments remain visible to the prior class's teacher for the class's historical view.
- Cross-district moves produce a new LyfeLabz Student ID in the new district. The prior district's identity is retained for historical continuity within that district. No cross-district identity linking occurs automatically.

Class snapshot behavior (`CLASS_SNAPSHOT_EXPERIENCE.md`) governs class-at-submission attribution and is unchanged by this specification.

---

## 19. Teacher Lifecycle

Teacher identity is district-bound and evolves within a single district.

- A teacher identity is created in one district. It never migrates.
- Changing districts creates a new LyfeLabz teacher identity in the new district. The prior district's identity becomes inactive there.
- No automatic identity linking occurs across districts. If a district ever asks for a cross-district view, it is a Platform Administrator activity, not a self-serve one.
- Instructional history remains associated with the district where it was authored. It does not follow the teacher to a new district.
- Within a district, a teacher identity may belong to multiple schools where explicitly authorized (§7).
- Teacher identity archival (retirement from the platform) is a Platform Administrator action. Archived identities preserve their instructional history and their historical class attributions.

---

## 20. Identity States

The canonical account lifecycle field is `status` on `users/{uid}` per `PLATFORM_STATE_MACHINE.md`. This specification introduces no new lifecycle field and no parallel state.

- `provisioned` - Sprint 1 provisioning has completed. No capabilities are granted.
- `pendingVerification` (teachers only) - Verification request has been submitted; no capabilities are granted.
- `active` - Onboarding and (for teachers) verification have completed. Custom claims are written.
- `awaitingFirstSignIn` - Applied to a roster placeholder that has not yet been resolved to a signed-in student. This is a roster-level state, not a user-level state. It has no `users/{uid}` document.
- Suspension, reinstatement, and archival remain deferred to their dedicated sprint per Sprint 2 §10 and `PLATFORM_STATE_MACHINE.md`.

The Sprint 2 audit vocabulary (`auth.userProvisioned`, `auth.activationRejected`, `students.activated`, `teachers.verificationRequested`, `teachers.verificationApproved`, `teachers.verificationDenied`) is preserved unchanged.

---

## 21. Identity Race Conditions

Every identity-changing operation is server-authoritative, atomic, and idempotent. The prohibitions are absolute.

- No duplicate student identities may be created.
- No duplicate teacher identities may be created within the same district.
- No duplicate enrollments may be produced for the same (student, class) pair.
- No duplicate roster activations may be produced on repeated first sign-in.
- No duplicate teacher verification may be produced on repeated code redemption.
- Teacher imports from Google Classroom are idempotent. Re-import produces the same class, the same roster, and the same enrollments.
- Join-code redemption is idempotent. Repeated redemption by the same principal produces the same enrollment.

Where a race is theoretically possible (concurrent first sign-ins, concurrent code redemption, concurrent roster refresh), the resolving callable uses transactional writes so that exactly one outcome is recorded.

---

## 22. Global Header and Authentication Experience

The authenticated experience shell is uniform across LyfeLabz.

### 22.1 Global header

A persistent global header appears on every LyfeLabz surface. Its layout is fixed.

- **Far left.** `LYFELABZ` wordmark. Returns to home.
- **Upper right.** Identity control. Anonymous visitors see `Sign In`. Authenticated users see their display name and a disclosure caret (`Teacher Name ▾` or `Student Name ▾`).
- **Far right.** Hamburger menu.

Identity is never hidden inside the hamburger menu. The identity control is a peer of the wordmark, not a sub-item of navigation.

The same header appears on:

- Homepage
- Lessons
- Extensions
- Investigations
- Teacher Workspace
- Student Workspace
- Every future platform surface

Surfaces styled as isolated instructional artifacts (for example Present Mode per PDR-018b) are the sole exception, and only where the surface intentionally omits the authenticated shell.

### 22.2 Authentication experience

- The homepage remains openly explorable.
- `Sign In` remains globally visible.
- Authentication becomes required only when a capability depends on identity. Examples: recording an assessment attempt, entering the Teacher Workspace, entering the Student Workspace, accessing student assignments.
- After authentication, users return to the exact location they were using before signing in. Return-to-location is preserved through the redirect and is not lost across a sign-in.

Authentication should always be available, but it should only become necessary when it provides immediate value to the user.

---

## 23. Identity Principles

The following principles are load-bearing.

1. Authentication is not authorization.
2. Teachers and students follow different onboarding journeys.
3. Google Classroom is the preferred onboarding path.
4. Join codes exist only for manual classes.
5. Every class has exactly one roster authority.
6. Students own their educational history.
7. Teachers see only instructional relationships to their own classes.
8. Teacher identities are district-bound.
9. Student identities are permanent within a district.
10. Identity creation is server-authoritative.
11. Identity operations are atomic and idempotent.
12. Students should never understand the identity architecture.
13. Teachers should never maintain duplicate rosters.
14. Verification should become invisible after completion.
15. The platform adapts to schools. Schools do not adapt to the platform.
16. Authentication should always be available. It should only become necessary when it provides immediate value.

---

## 24. Relationship to Prior Architecture

This specification reconciles the following certified documents.

- `LYFELABZ_PLATFORM_DECISIONS.md`
  - PDR-002 is preserved. Google Workspace remains the sole Version 1 authentication provider; personal Google accounts are refused at onboarding.
  - PDR-003 is amended. The verified-domain automated path is retired in favor of the verification-code path (§13.1) with the Request Teacher Access fallback (§13.2). PDR-003's reconsideration criterion (district integration providing authoritative teacher rosters) is preserved as a future path.
  - PDR-004 is preserved. The closed role model is unchanged. No new role is introduced.
  - PDR-005 is preserved. Class ownership is unchanged. Multi-school teacher membership is expressed at the teacher-identity layer, not by relaxing class ownership.
  - PDR-015 is amended. The District entity is promoted from "reachable expansion" to a first-class, load-bearing entity that acts as the security boundary in the certified hierarchy (§6).
  - PDR-019 is preserved and clarified. Roster authority language in this specification restates PDR-019b and PDR-019i in identity terms. Nothing in this specification widens LMS surface area.
  - PDR-020 is preserved. Google Classroom remains the initial implementation target of the LMS integration.
- `LYFELABZ_PLATFORM_DOMAIN_MODEL.md` - District moves from `Future` to a first-class entity. Teacher membership across multiple schools within a district is documented as an explicit membership set. Roster authority is added as a first-class attribute of a class.
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` - District identifiers become required references on schools and are reserved on user records per Sprint 2 §4.4. Roster placeholders (`awaitingFirstSignIn`) are a roster-level state and not a `users/{uid}` state.
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md` - District identifiers become a required boundary for cross-user reads. Roster placeholder documents are readable by the owning teacher and unwriteable by clients. Join-code redemption remains server-only.
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` - Verification-code redemption and join-code redemption are named as callable surfaces. Roster placeholder activation on first sign-in is a callable-driven, transactional operation. Custom claims shape (`role`, `schoolId`, reserved `districtId`) is unchanged.
- `LYFELABZ_SPRINT_2_ONBOARDING_AND_VERIFICATION.md` - Preserved. Every Sprint 2 audit event, callable, and rule remains valid. The verification-code path arrives as an extension of `teachers.verificationApproved`; the fallback path continues to use the Sprint 2 request/approve/deny flow.
- `PLATFORM_STATE_MACHINE.md` - Preserved. No new lifecycle field is introduced. `awaitingFirstSignIn` is added as a roster-level, not user-level, state and is described in this specification.
- `PLATFORM_CONTRACTS.md` - Preserved. Activation status is never represented by color alone.
- `LMS_INTEGRATION_ARCHITECTURE.md` and `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` - Preserved. Roster authority language is aligned; nothing in this specification widens or narrows the LMS surface.
- `ASSESSMENT_PIPELINE_SPECIFICATION.md` - Preserved. Anonymous exploration produces no attempt. Authenticated authorized attempts require an active identity per this specification.
- `PLATFORM_OPERATIONS_SPECIFICATION.md` - Preserved. Authentication session policy under PDR-022g remains the operational definition of session persistence; identity persistence and authentication persistence are peers, not aliases.
- `TEACHER_JOURNEY.md` and `TEACHER_EXPERIENCE_PHILOSOPHY.md` - Reconciled through the class creation rule (§8): class creation lives in the `Classes` workspace, never in `Settings`. Any prior language that placed class creation in `Settings` is superseded.

---

## 25. Change Discipline

- This specification is the single source of truth for LyfeLabz identity behavior. Amendments to this specification travel through PDR-023 and are recorded here.
- Downstream documents that describe identity behavior must defer to this specification. Superseding notices remain in place until each document is next revised.
- Identity-affecting sprints must first amend this specification or a subordinate document. Sprint discretion does not extend to changing the identity architecture.
- Where a downstream document appears to conflict with this specification, this specification controls until the downstream document is reconciled.

---

## 26. Change Log

- 2026-07-12 - Initial certified Identity and Onboarding Specification established. Sections 1 through 26. PDR-023 anchors the specification. Reconciliation notices added to `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-002, PDR-003, PDR-004, PDR-005, PDR-015, PDR-019, PDR-020), `LYFELABZ_PLATFORM_DOMAIN_MODEL.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_SPRINT_2_ONBOARDING_AND_VERIFICATION.md`, `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `PLATFORM_STATE_MACHINE.md`, `PLATFORM_CONTRACTS.md`, `LMS_INTEGRATION_ARCHITECTURE.md`, `TEACHER_JOURNEY.md`, and `TEACHER_EXPERIENCE_PHILOSOPHY.md`.
