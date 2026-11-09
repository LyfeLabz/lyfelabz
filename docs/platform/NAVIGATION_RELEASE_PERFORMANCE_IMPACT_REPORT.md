# LYFELABZ NAVIGATION RELEASE — PERFORMANCE IMPACT REPORT

November 8, 2026 · Production project `lyfelabz-prod`

## Executive summary

The release made Student Detail usable **16.50 ms sooner at the median** in a controlled local comparison, from 69.45 ms to 52.95 ms across 10 trials per version. It also eliminated one student-assignment request per standard visit. When the roster was delayed until both student reads had started, the release eliminated one grade-history request and one student-assignment request per visit. Browser Forward and reload restored the intended Student Detail and its assignment context in all 10 new trials, compared with zero for the previous version.

Class opening, the Students list, Assignment Summary, and browser Back showed no clear timing gain. The data supports a focused improvement to Student Detail and more reliable navigation. It does not establish a production latency change.

## Compared releases and measurement setup

| Version | Exact source SHA | Certified app / marketing Hosting |
|---|---|---|
| Previous | `16b959e4bec22108a6ee9b2b5feb7ef0f781ae26` | `732c250490ffb2d4` / `a05ef6a6219e5fa5` |
| New | `fa50cb0152be5dc9ce54d365018f8e5f31489188` | `57877ff8acfcb2a1` / `3cc89fcdfaf080e7` |

Each app bundle was built locally under Node 22 from an exact Git archive using the same locked dependencies. The benchmark swapped only the bundle and reused the same static assets, headless Chrome 157.0.8103.38, loopback Firebase Hosting, Auth, Firestore and Functions emulators, production-lineage backend fixtures, and synthetic teacher, class, students and assignment. The Chrome HTTP cache and Back/Forward cache were disabled for both versions. Each trial began from a fresh document with the same synthetic teacher already signed in. The standard sequence was Classes → open class → Students → Assignments → Assignment Summary → Student Detail → browser Back → Forward → reload → Back to assignment. Four five-trial blocks ran old, new, new, old, with an uncounted warm-up before each block. Delayed-response trials used the same setup and held named responses at the browser boundary.

Usable means the class title and tabs, student list, assignment roster row, or populated Student Detail body were visible, depending on the destination. The harness polled for those markers roughly every 15 ms and measured elapsed time through the browser automation interface. It counted callable POSTs without CORS preflights. Browser Forward and return each had a 2.2-second completion window, and reload had 3.2 seconds. A missed destination counts as a reliability failure rather than a timing sample.

Raw trials, per-bundle hashes, harness, and checksums are in the private archive at `LyfeLabz-Certification/production-hosting-deployment-fa50cb0-2026-11-08T23-46-26Z/performance/`.

## Measured timing and navigation reliability

Timings are medians in milliseconds, with the observed range in parentheses. Δ is new minus previous. Each row has 10 attempted standard trials per version. A speed percentage is shown only where both builds completed the same action.

| Action | Previous | New | Δ | Improvement and confidence |
|---|---:|---:|---:|---|
| Classes → class workspace | 4.6 (3.5–6.9) | 4.7 (3.5–6.5) | +0.1 ms | −2.2%. Within measurement noise. |
| Students tab → usable roster | 37.55 (19.3–43.6) | 36.65 (19.2–38.9) | −0.90 ms | +2.4%. Overlapping ranges and below polling cadence. |
| Assignment click → usable Summary | 54.6 (50.4–128.4) | 55.1 (51.2–58.6) | +0.5 ms | −0.9%. No clear median change. |
| Summary student click → usable Student Detail | 69.45 (52.0–86.9) | 52.95 (50.2–56.5) | **−16.50 ms** | **23.8% shorter locally.** A small sample with partially overlapping ranges and roughly one poll interval of median separation. |
| Browser Back → usable Summary | 55.85 (35.7–61.8) | 57.15 (39.9–65.0) | +1.30 ms | −2.3%. Both versions succeeded 10/10. No clear timing change. |
| Browser Forward → usable Student Detail | 0/10 restored | 10/10, 69.7 (65.5–90.3) | +10 successes, +100 pp | No old timing for the intended destination. |
| Reload → Student Detail with assignment origin | 0/10 restored | 10/10, 117.2 (109.6–131.6) | +10 successes, +100 pp | No old timing for the intended destination. |
| Back to assignment after reload | 0/10 end-to-end | 10/10, 36.85 (33.9–40.8) from Back click | +10 successes, +100 pp | The old build could return from an uninterrupted visit after a fresh re-entry (10/10, median 37.35 ms). That is a different path. |

The old build showed usable Student Detail while the URL remained `#classes` in all 10 standard trials. The new build recorded the student and assignment origin in all 10. This explains the difference between the page rendering successfully on initial click and the browser restoring the same destination later.

## Network requests and delayed responses

Each count below was consistent in every trial for the indicated scenario. Timing percentages above come from measured elapsed time. Request percentages here describe traffic only.

| Local scenario and metric | Previous | New | Δ | Reduction or reliability change | Trials per version |
|---|---:|---:|---:|---|---:|
| Standard class visit through Summary, before Student Detail · roster POSTs | 1 | 1 | 0 | 0% | 10 |
| Standard Student Detail · roster POSTs | 1 | 1 | 0 | 0% | 10 |
| Standard Student Detail · grade-history POSTs | 1 | 1 | 0 | 0% | 10 |
| Standard Student Detail · student-assignment POSTs | 2 | 1 | −1 | **50%** | 10 |
| Late roster · student-assignment POSTs across all three response orderings | 2 | 1 | −1 | **50%** | 9 |
| Late roster · grade-history POSTs when both reads had settled or grade history was pending | 2 | 1 | −1 | **50%** | 6 |
| Late roster · grade-history POSTs when assignments were still pending and grade history had yet to start | 1 | 1 | 0 | 0% | 3 |
| Late roster · duplicate grade-history and assignment POSTs combined, when both reads had started | 2 extra | 0 extra | −2 | **100% of the observed duplicates** | 6 |
| Late roster · total roster POSTs through Student Detail | 2 | 2 | 0 | 0% | 9 |
| Held assignment response released after browser Back · stayed on Summary | 3/3 | 3/3 | 0 pp | Both passed this scenario. An assignment POST was issued in each version. | 3 |

In the third delayed-roster ordering, releasing the roster while assignments were pending caused one extra assignment POST in the old build and none in the new build. Previous/Next became available once the roster arrived in all nine trials per version. Those controls still depend on the roster response.

## Technical changes and teacher-facing effects

| Changed source file | Change and practical effect |
|---|---|
| `app/src/shell/surfaces/classes.ts` | The old view could request student assignments and grade history again when a late roster redrew Student Detail. The new view reuses each request within the same class and student visit, including when it has already settled. A new student visit resets the reads. The grade-history cache also clears after an Undo attempt so the next read can reflect server state. This cuts duplicate network work without serving another student's data or retaining a result across visits. |
| `app/src/shell/surfaces/classes.ts` | Successful roster reads were already reused within an open class. The change makes failed roster reads retry after an explicit Students action, history restore, or Try again, instead of starting another fetch on incidental redraws. The successful-read benchmark found the same roster counts. A failure-driven retry reduction was not timed here. |
| `app/src/shell/navigationHistory.ts` | History entries and URL hashes now carry the nested destination and, for Student Detail reached from Summary, the assignment identifier. This gives reload and Forward enough context to recover the intended page. |
| `app/src/shell/shell.ts` | The shell restores nested destinations after startup or browser history navigation and reuses the matching Summary entry when returning from Student Detail. Pending route work is scoped to the current mount and intent. Teachers can reload, move between students, and return to the assignment without losing their place in the measured flow. |
| `app/src/index.ts` | Restoring an assignment origin can require a fresh read of that assignment under the existing owner-only Firestore rule. The result must still belong to the current teacher, school, and class and be published or closed. A stale session or replacement seam invalidates the result. This supports correct restoration and can add a read to a cold restore. |
| `app/src/shell/surfaces/curriculum.ts` and `app/src/shell/surfaces/workspace.ts` | Curriculum exposes the eligibility check to the Classes path. Workspace passes the restoration intent even when the student display name must be recovered after a reload. These changes support restoration and do not independently establish a speed gain. |

The remaining six changed files are tests. `shell.navigation-history.nested-pages.test.ts`, `shell.navigation-history.shared-students.test.ts`, `shell.registry-restore.test.ts`, and `shell.student-navigation.test.ts` cover nested destinations, shared access and pending registry state. `classes.roster-retry.test.ts` and `classes.student-detail.test.ts` cover deliberate retry and per-visit request reuse.

The implementation checks that asynchronous results still belong to the active intent or mount before applying them. This prevents obsolete work from replacing the current view. It does not establish that an already-issued HTTP request was aborted. Both versions passed the narrow held-response Back test. The retained new-version acceptance suite also passed both held-callable supersession cases and rejected stale or mismatched assignment origins. Those additional cases provide correctness evidence for the new build, without a comparable old-build result.

## Limitations and overall assessment

The results describe one synthetic class and assignment on one Mac. The app was built for a local harness, with no production network, CDN, or live user timing. Chrome attempted a font request that the loopback-only sandbox blocked for both versions. The sample sizes and polling cadence make small timing differences inconclusive. The two builds were run in balanced blocks, but laptop load and warmed emulator state can still affect measurements. The benchmark did not measure large rosters, mobile devices, failure-retry latency, grade mutation behavior, teacher-perceived wait, or platform-wide performance.

The authenticated production smoke test independently confirmed the intended navigation, one successful POST for each student read in one observed visit, and zero console messages when inspected. It provides a live correctness check, without an old-build timing control. The evidence supports a local Student Detail latency gain, fewer duplicate reads, and reliable restoration of the assignment context. Classes, Students, and Assignment Summary have no demonstrated speed gain in this comparison.
