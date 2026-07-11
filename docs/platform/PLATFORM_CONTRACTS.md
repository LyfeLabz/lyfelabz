# LyfeLabz Platform Contracts

**Status:** Authoritative for cross-cutting platform contracts.
**Purpose:** Centralize the reusable technical agreements that more than one LyfeLabz platform feature relies on, so future implementation sprints inherit consistent behavior instead of reinventing it.
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, PRESENT_MODE_ARCHITECTURE.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_JOURNEY.md, ASSIGN_EXPERIENCE.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, PLATFORM_STATE_MACHINE.md, SPRINT_HISTORY.md.

This document is authoritative for cross-cutting platform contracts. Feature architecture documents remain authoritative for feature-specific behavior. The broader platform architecture (`LYFELABZ_PLATFORM_ARCHITECTURE.md`) and the certified decision log (`LYFELABZ_PLATFORM_DECISIONS.md`) remain authoritative for platform identity, boundaries, and locked decisions. This document composes with those sources; it does not override them.

No implementation sprint may resolve a contradiction between this document and a certified feature architecture silently. Contradictions require a formal architecture amendment before any code changes.

---

## 1. Purpose and Scope

A platform contract is a reusable technical agreement that affects more than one platform feature or surface. Contracts here exist to prevent parallel conventions from emerging in feature architecture.

**What belongs in this document:**

- Naming and namespace conventions shared by more than one feature.
- Browser storage rules that apply across features.
- Client-side schema versioning conventions.
- Route and navigation boundaries shared by the Teacher Platform shell and the canonical instructional experience.
- The public and authenticated surface boundary contract.
- Privacy and projector-safety rules that apply to more than one surface.
- Accessibility contracts that apply repository-wide.
- Safe-failure rules for client-side context.
- The registry of contracts already certified by feature architecture.
- The process for adding or changing a platform contract.

**What does not belong in this document:**

- Feature-specific behavior. Present Mode's navigation, launch, and return script contract is defined in `PRESENT_MODE_ARCHITECTURE.md`. The Assign Experience dialog is defined in `ASSIGN_EXPERIENCE.md`. The Teacher Curriculum landing page is defined in the certified Sprint 6D history.
- Firestore data-model, security-rule, or callable definitions. Those live in `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, and `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`.
- Locked platform-identity or product decisions. Those live in `LYFELABZ_PLATFORM_DECISIONS.md`.
- Instructional style, editorial voice, or curricular architecture. Those live in `CLAUDE.md` and the instructional documents at the repository root.

The relationship is compositional: this document names the reusable contracts, feature architecture names how a feature uses them, and the platform architecture and decisions record the load-bearing boundaries both must respect.

---

## 2. Authority and Conflict Resolution

Precedence, most authoritative first:

1. `LYFELABZ_PLATFORM_ARCHITECTURE.md` for platform identity, roles, session model, and system boundaries.
2. `LYFELABZ_PLATFORM_DECISIONS.md` for locked platform decisions (PDR records).
3. `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, and `PLATFORM_STATE_MACHINE.md` for backend and lifecycle contracts.
4. Certified feature architecture documents (for example `PRESENT_MODE_ARCHITECTURE.md`, `ASSIGN_EXPERIENCE.md`, `TEACHER_JOURNEY.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md`) for feature-specific behavior.
5. This document for cross-cutting technical contracts.

If a contract in this document appears to conflict with a document higher on the precedence list, the higher-precedence document controls, and this document must be amended.

If a feature architecture appears to conflict with a contract in this document, the sprint must stop and report the conflict for architecture review. No implementation sprint may resolve the contradiction on its own. No implementation sprint may weaken a certified contract by writing code that silently overrides it.

New platform contracts may be added only through the amendment process in Section 13. Implementation alone cannot create a platform contract.

---

## 3. Contract Stability

Certified platform contracts are treated as stable public interfaces for the LyfeLabz platform. Implementation conforms to them; it does not redefine them.

- **Stable public interfaces.** Contracts recorded here name the reusable expectations that multiple features rely on. Once certified, a contract behaves like a public interface between features and should be depended on accordingly.
- **Infrequent change.** Contracts change only when there is a compelling architectural reason. Routine implementation convenience is not sufficient justification. Preference for a different key, a shorter name, or a slightly different shape is not a reason to amend a certified contract.
- **Backward compatibility is evaluated explicitly.** When a certified contract must change, architecture review considers backward compatibility, migration behavior, invalidation strategy, and implementation impact across the platform. Not every change must be backward compatible, but every change explicitly evaluates whether it needs to be.
- **Architecture first.** Implementation must never silently redefine a certified contract. If implementation reveals a better approach, the architecture is amended first, and only then does implementation change. A pull request that alters a certified value without a matching amendment is a defect.
- **Long-term consistency.** As LyfeLabz grows, these contracts provide predictable expectations across the Teacher Platform, the authenticated shell, browser storage, routing, client-side schemas, and future platform features. Developers should be able to rely on these contracts remaining stable over time.

---

## 4. Naming and Namespace Contracts

Every shared client-side key readable or writable by more than one script must use the following namespace pattern:

```text
lyfelabz.<feature>.<purpose>
```

Rules:

- `<feature>` is a stable product concept (for example `presentMode`), not an implementation detail (not `router`, not `state`, not `bootstrap`).
- `<purpose>` is a concise noun phrase describing what the key holds (for example `returnContext`).
- Keys must not use generic names such as `return`, `state`, `context`, `data`, `session`, `user`, or `config`.
- Keys must be documented in Section 12 before use.
- Renaming a key requires a documented migration or an explicit invalidation behavior. Silent renames are prohibited because they orphan values written by earlier clients.
- Private identity or authentication data must not be stored under any namespaced key unless a separate architecture amendment authorizes it.

The first certified key registered under this pattern is the Present Mode return-context marker:

```text
lyfelabz.presentMode.returnContext
```

See `PRESENT_MODE_ARCHITECTURE.md` §14.2 for the certified schema. See Section 12 of this document for the current registry.

---

## 5. Browser Storage Contracts

Browser storage roles are constrained. The mere existence of a storage mechanism does not authorize a feature to use it.

- **`sessionStorage`** is appropriate for tab-scoped, non-sensitive, temporary navigation context. It is the certified mechanism for the Present Mode return-context marker (`PRESENT_MODE_ARCHITECTURE.md` §14.1).
- **`localStorage`** must not be used for authenticated identity, authorization, class, student, assignment, submission, mastery, or accommodation state without a formal architecture amendment. A per-device instructional-side preference (for example the grade persistence option discussed in `PRESENT_MODE_ARCHITECTURE.md` §9) is not authorized until the Present Mode implementation sprint records the choice.
- **URL query parameters and URL fragments** must not contain teacher, class, student, assignment, submission, authentication, or analytics data. They must not contain raw storage values. They must not contain projector-visible identifiers.
- **Cookies** are not the standard client-side mechanism for feature state. Firebase Authentication's own persistence is not a general storage surface and must not be treated as one.

Additional rules that apply repository-wide:

- Browser storage is never an authorization boundary. Authorization is enforced by Firestore Rules and Cloud Functions, as defined by `LYFELABZ_FIREBASE_SECURITY_MODEL.md`.
- Client-side values must always be validated before use. Malformed or unsupported values must be rejected.
- Backend-authoritative state (roles, claims, lifecycle status, class ownership, enrollment, assignment, submission, score, and audit records) must not be replaced by browser storage. Browser storage may hold ephemeral navigation context only.
- The Present Mode return context is a certified example of tab-scoped navigation context. It is not a template for storing teacher or student data.
- **LMS integration artifacts are never persisted in browser storage.** OAuth access tokens, refresh tokens, LMS discovery results, LMS roster snapshots, LMS mirror records, and any payload that references an LMS-issued identifier must not be written to `localStorage`, `sessionStorage`, cookies, URL query parameters, or URL fragments. LMS tokens are server-only artifacts per PDR-019e and the External LMS Providers trust boundary in `LYFELABZ_FIREBASE_SECURITY_MODEL.md` §3.10. This rule is a restatement of the certified storage posture applied to the ratified LMS domain; no exception is authorized.

---

## 6. Versioned Client-Side Schema Contracts

Every structured client-side object shared between two contexts (for example between the Teacher Workspace and a script on the canonical instructional surface) must be versioned.

The certified example is the Present Mode return-context payload:

```ts
{
  version: 1;
  returnSurface: "curriculum";
}
```

Rules that apply to every versioned client-side schema:

- The `version` field is a numeric integer. The initial value is `1`.
- Unsupported `version` values must fail safely (the reader treats the payload as absent).
- Malformed JSON, missing required fields, and unexpected field types must fail safely.
- Only explicitly allowlisted values for each field may be accepted. Unrecognized values must be rejected.
- Extra fields must not be trusted. Readers must ignore fields they do not recognize and must not propagate them.
- Schema changes (a new field, a widened value set, a new `version`) require architecture review before implementation.
- Where practical, product concepts should be stored instead of raw implementation paths. `returnSurface: "curriculum"` names a Teacher Workspace surface. A raw URL such as `/app/curriculum` would couple the payload to the current router, force clients to interpret paths, and complicate any future route change. Product-concept identifiers are more durable than URLs.

---

## 7. Route and Navigation Contracts

This document does not redesign routes. It records the boundaries already certified by the platform architecture.

- The authenticated Teacher Platform lives under the canonical `/app/**` Hosting rewrite. The client-side router is scoped to that surface. See `LYFELABZ_PLATFORM_ARCHITECTURE.md` §16 and `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` Phase 3.
- The canonical public instructional experience is served from the repository root by Firebase Hosting. It has no client-side router and imports no Firebase SDK. See `PRESENT_MODE_ARCHITECTURE.md` §2.
- Curriculum is the teacher's primary landing surface inside the Teacher Workspace. See `TEACHER_EXPERIENCE_PHILOSOPHY.md` §3.2 and `TEACHER_JOURNEY.md`.
- Teacher Workspace destinations render through the shared workspace outlet under the canonical workspace-surface identifiers. The certified surface keys are the four keys currently used by the shell: `curriculum`, `classes`, `present-mode`, and `settings`. These identifiers name product surfaces, not URL paths.
- Product-surface identifiers and URL paths are related but not interchangeable. A `returnSurface` value is a workspace-surface identifier and must not be interpreted as a URL.
- Features must not introduce parallel routers, parallel workspace shells, or duplicate instructional surfaces. This restates PDR-007, PDR-017, and PDR-018.
- Browser navigation behavior (same-tab launch, exit affordance semantics, back-button behavior) is defined by feature architecture. Present Mode's certified same-tab launch is recorded in `PRESENT_MODE_ARCHITECTURE.md` §14.3.
- The canonical public instructional routes must not become dependent on teacher authentication. A public visitor's experience must remain identical whether or not a Teacher Workspace session exists on the same origin.

New routes are not created by this document. New workspace-surface identifiers must be introduced by the feature architecture that adds them and must appear here only after certification.

---

## 8. Public and Authenticated Surface Boundary

LyfeLabz composes two structurally separate surfaces on a single Firebase Hosting origin:

- The authenticated Teacher Platform (`/app/**`).
- The public canonical instructional experience (repository root).

They do not share a build system, a stylesheet, or a JavaScript runtime. The canonical surface has no client-side router and imports no Firebase SDK. This separation is load-bearing for security and privacy.

**Public instructional surfaces must not expose:**

- teacher identity or `uid`,
- teacher email,
- school identity,
- class identity,
- student identity,
- assignment status,
- submission status,
- authentication claims,
- analytics identifiers or events,
- scores or mastery signals,
- hidden session metadata.

Public surfaces must not read authenticated Teacher Platform session state, must not import Firebase Authentication, Firestore, or Functions SDKs, and must not reach around this boundary to read a signed-in user's claims. A narrowly scoped exception may be authorized only by a formal architecture amendment.

The Present Mode return script is the current approved exception. It reads only a validated, non-sensitive return-context marker under the certified `sessionStorage` key. It does not read Firebase Authentication state. It does not import any Firebase SDK. See `PRESENT_MODE_ARCHITECTURE.md` §5 and §14.4.

---

## 9. Privacy and Projector-Safety Contracts

Projector safety is a platform-wide requirement. Any surface that may appear on a classroom projector must default to student-safe content.

Prohibited on projector-visible surfaces (minimum list):

- teacher names,
- teacher email addresses,
- school identifiers,
- class names, blocks, or rosters,
- student names or identifiers,
- assignment or submission state,
- scores, mastery signals, and analytics,
- authentication status or session summaries,
- raw storage values, cache contents, or debug output,
- internal route metadata,
- backend configuration values,
- deployment identifiers.

A feature-specific architecture may impose stricter requirements. It may not weaken these requirements without a formal amendment. The Present Mode privacy posture (`PRESENT_MODE_ARCHITECTURE.md` §6 and §7) is the current strongest instance of this contract and must be treated as the floor for any projection-capable surface.

Private student information, including accommodations and modifications, is handled by the accommodation architecture pass described in `TEACHER_EXPERIENCE_PHILOSOPHY.md` §3.7. This document does not authorize any implementation of that pass.

---

## 10. Accessibility Contracts

Only reusable accessibility requirements already reflected in the certified architecture and repository standards are recorded here. A detailed accessibility specification remains a future document.

- Use semantic interactive elements. Buttons are buttons; links are links.
- Every interactive control is keyboard operable.
- Every interactive control has a clear accessible name.
- Focus is visible on every focusable element.
- No meaning is conveyed by color alone.
- No control is icon-only without an accessible text equivalent.
- Focus behavior after a surface change is logical and predictable. The Teacher Workspace convention is to focus the surface headline when a workspace surface mounts.
- Public lesson accessibility must be preserved. Instructional pages under repository preservation-mode rules in `CLAUDE.md` must not lose accessibility affordances.
- Custom modal and navigation behavior must not be introduced if the standard semantic pattern already satisfies the need.

These are minimums. A feature architecture may impose stricter requirements.

---

## 11. Safe-Failure Contracts

Client-side context is inherently untrusted. It must fail safely.

- Malformed JSON, missing fields, or unexpected types in a client-side payload must not crash the experience.
- Unsupported schema `version` values, unsupported enum values, and unexpected fields must be ignored.
- When optional context is missing, the associated optional feature must be absent. The primary experience must remain available.
- Users must not be redirected into authenticated surfaces because of a client-side marker. Authorization is never inferred from browser storage or URL parameters.
- The ordinary public behavior of the canonical instructional experience must remain available whether or not a return-context marker is present. See `PRESENT_MODE_ARCHITECTURE.md` §14.5 and §14.6.

The Present Mode return script is the concrete example: an invalid or absent marker results in no exit affordance and no other change to the page. It does not error, redirect, or degrade the public experience.

---

## 12. Certified Contract Registry

Only contracts already certified by the platform or feature architecture appear here. This registry is not a wish list.

| Contract | Certified value | Authority | First consumer | Status |
| --- | --- | --- | --- | --- |
| Teacher Platform route boundary | `/app/**` | `LYFELABZ_PLATFORM_ARCHITECTURE.md` §16, `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` Phase 3 | Teacher Workspace shell | Certified |
| Canonical public instructional route | `/` (repository root) | `PRESENT_MODE_ARCHITECTURE.md` §2, PDR-007, PDR-018 | Canonical LyfeLabz instructional experience | Certified |
| Browser storage namespace pattern | `lyfelabz.<feature>.<purpose>` | This document §4 | Present Mode return-context marker | Certified |
| Present Mode return-context storage key | `lyfelabz.presentMode.returnContext` | `PRESENT_MODE_ARCHITECTURE.md` §14.2 | Present Mode | Certified |
| Present Mode return-context schema version | `version: 1` | `PRESENT_MODE_ARCHITECTURE.md` §14.2 | Present Mode | Certified |
| Present Mode initial return surface | `returnSurface: "curriculum"` | `PRESENT_MODE_ARCHITECTURE.md` §14.2 | Present Mode | Certified |
| Present Mode launch navigation | Same-tab (`window.location.assign("/")`) | `PRESENT_MODE_ARCHITECTURE.md` §14.3 | Present Mode | Certified |
| Present Mode public-surface return behavior | Return script loads on the canonical instructional experience, no-ops without a valid marker, imports no Firebase SDK | `PRESENT_MODE_ARCHITECTURE.md` §14.4 through §14.6 | Present Mode | Certified |
| LMS integration surface identifier | `settings/integrations` under the workspace-surface identifier convention of §7 | `LMS_INTEGRATION_ARCHITECTURE.md` §3.5, `LMS_EXPERIENCE.md` §3 | LMS Integration Foundation phase | Reserved (live at Phase 9 certification) |
| LMS provider namespace | Closed set `lmsProviders` with initial value `googleClassroom` | `LMS_INTEGRATION_ARCHITECTURE.md` §3.3, §4.1, PDR-019h | LMS Integration Foundation phase | Reserved (live at Phase 9 certification) |
| LMS mirror record ownership convention | Every mirror record (`lmsConnections`, `lmsClassLinks`, `lmsRosterLinks`, `lmsAssignmentPublications`) carries an `ownerUid` denormalization to preserve rule-evaluation performance | `LYFELABZ_FIRESTORE_DATA_MODEL.md` §2.9.a, `LYFELABZ_FIREBASE_SECURITY_MODEL.md` §3.10 | LMS Integration Foundation phase | Reserved (live at Phase 9 certification) |
| LMS token storage prohibition on the client | LMS OAuth access tokens, refresh tokens, discovery results, roster snapshots, and mirror records are never written to `localStorage`, `sessionStorage`, cookies, URL query parameters, or URL fragments | This document §5; PDR-019e | LMS Integration Foundation phase | Certified |

Additions to this registry require the amendment process in Section 13.

Contracts marked "Reserved (live at Phase 9 certification)" are ratified into the certified corpus by `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` and become live public interfaces when the LMS Integration Foundation phase (`TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §4, Phase 9) certifies. Their reservation prevents a future sprint from inventing a parallel value silently.

---

## 13. Amendment Process

Adding or changing a platform contract requires the following steps:

1. Review the certified architecture, decision log, and this document to confirm no existing contract already covers the concern.
2. Identify every feature and surface the proposed contract affects.
3. Document the proposed contract in draft form, including value, authority, first consumer, and expected safe-failure behavior.
4. Evaluate the proposal against privacy, security, accessibility, routing, and migration effects. Confirm no PDR is silently violated.
5. Amend this document and any feature architecture the change touches.
6. Implementation begins only after documentation is certified.
7. Validate that repository behavior remains consistent with the amended contract.
8. Record the change in `SPRINT_HISTORY.md` under the sprint that introduces or modifies it.

Implementation alone cannot create a platform contract. A contract that appears in code without appearing here is a defect and must be either removed or documented through this process.

---

*End of platform contracts. Cross-cutting technical agreements are recorded here. Feature-specific behavior remains in feature architecture. Locked platform decisions remain in `LYFELABZ_PLATFORM_DECISIONS.md`.*
