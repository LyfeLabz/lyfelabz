# Engineering Backlog (non-security)

**Status:** Opened 2026-10-30 from the Student Support V2 production release (`RELEASE_2026-10-30_STUDENT_SUPPORT_V2.md`). Items are recorded, not scheduled; none is implemented. Security findings stay in the `SECURITY_BACKLOG_*.md` documents.

Priority: P1 affects real teacher workflows now; P2 is a correctness gap with a workaround; P3 is UX polish.

## Product items

### P1 - My Units cold-start reliability
- **Observed:** after idle, `teacherUnitsCapabilities` took 29 s (staging); the client discards capability results older than 10 s, so status becomes "unavailable" and every My Units action is disabled with no message until reload.
- **Investigate:** capability timeout versus cold start, loading-state handling, retry, a visible Try again, disabled-control messaging, and whether minimum instances are justified.

### P1 - Student roster cold-start latency
- **Observed:** production 2026-10-30, the class Students tab showed "We couldn't load your students. Please try again." once; `enrollmentsListForClass` had a 70.6 s request. A retry loaded the roster.
- **Investigate:** cold-start cost and timeout of `enrollmentsListForClass`, client retry behavior on the Students tab. Related prior note: Student Detail open latency.

### P2 - Student Detail deep-link persistence
- **Observed:** refreshing or hash-navigating to a Support Teacher Student Detail URL returns to the Student Support list.
- **Investigate:** restoring `#classes/student/...` for grantees through the existing startup-hash path, with server authorization still deciding access.

### P3 - Capability revalidation UX
- **Observed:** the enabled My Units capability expires after 30 s; after inactivity the first click only revalidates and the intended action needs a second click.

### P3 - Sharing confirmation message lifecycle
- **Observed:** after re-sharing, the earlier "Removed ... access" status line stays visible next to "Access granted to N students."

## Operational items

- **gradeImprovementsListForStudent instance limit.** The 2026-10-30 scoped deploy set `maxInstances 20` where it was previously unset; the source sets no limit. Owner accepted it. Investigate the mechanism (CLI or platform default) without changing production; decide separately whether to keep 20.
- **Production operator authentication after reboot.** The production operator impersonation profile currently lives in reboot-volatile temporary storage. Define a secure, owner-controlled way to re-establish it so emergency `availability close` stays available.
- **Durable rollback artifacts.** Keep each production release's closed-only build, Hosting pair and release records in durable private storage, not temporary directories.
- **Known emulator tooling failure (existing test issue).** `scripts/teacher-units-release/availability-control.emulator.test.cjs`, "legacy repair remains non-authorizing...": `TypeError: db.collection is not a function`. Retained as a pre-existing failure; not caused by Student Support V2.
