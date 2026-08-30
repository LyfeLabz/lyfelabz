# LyfeLabz Teacher Platform - Human Acceptance Walkthrough (Sprint 28.5F)

This is your personal hands-on test of the frozen v1 Teacher and Student
experience. Everything runs on your own machine against local emulators.
Nothing here touches production, Google Classroom, or any real account.

You will sign in as fake local accounts, click through both experiences,
and judge how they feel. It should take about 15-20 minutes.

---

## Before you start

Open a terminal, go to the project folder, and run one command:

```bash
bash scripts/ux-review/start.sh
```

This builds the app, starts the local servers, and loads realistic test
data. The first run downloads a small emulator file, so give it a minute.

When it is ready you will see a box that says:

```
LyfeLabz UX review environment is READY.
```

Leave that terminal window open the whole time. It is running the local
site. (To stop later: press `Ctrl+C` in that window.)

---

## Open LyfeLabz

In your normal browser (Chrome is ideal), open:

```
http://127.0.0.1:5000/app/
```

You should see the LyfeLabz sign-in screen.

---

## Teacher login

1. Click **Continue with Google**.
2. A local "Sign-in with Google.com" chooser appears with three fake
   accounts. Click **UX Review Teacher**.
   - Do **not** click "Add new account".

You are now in the Teacher Workspace.

---

## Teacher walkthrough

Take your time and just notice how it feels. Suggested path:

1. Land on **Curriculum**. Scroll the lesson cards at a normal window size.
2. Notice there are 49 lessons; most are unassigned, and a few show that
   they are already assigned.
3. Click **Assign** on any lesson to open the assign dialog. Look it over.
   Then **Cancel** (no need to create a new assignment - the review data is
   already set up).
4. Open **Active Assignments**. You should see four published assignments
   (What Is Life?, Cell Types, Biological Evolution, Earth's Layers).
5. Open the **What Is Life?** assignment to see **Assignment Detail** inside
   the workspace shell.
6. Try **Close**, confirm, then **Reopen**. Watch the status change.
7. Find **Students not yet assigned**. **Late Review Student** should be
   there. Click **Add to assignment** and watch it succeed.
8. Use the top **Classes** navigation.
9. Open the **UX Review Science** class (a manual class, Grade 6 - Block A,
   with a join code).
10. Look at the **Snapshot** view, then the **Roster** view.
11. Go back to **Classes** and look at the **UX Review Classroom** card - it
    is the Google Classroom-linked class (no join code).
12. Open **Settings**, then **Connected Services**.
13. Return to **Curriculum**.

A note so nothing surprises you: in this v1, the class **Snapshot** and
**Roster** show example placeholder students by design (live class rosters
arrive in a later sprint). That is expected, not a bug.

---

## Switch to student

1. In the top corner, click **Sign out**.
2. Click **Continue with Google** again.
3. This time choose **UX Review Student**.

---

## Student walkthrough

1. Land on **My Assignments**. You should see four assignment cards.
2. Compare them: one is **Ready to Begin** (What Is Life?), and the others
   already show a result - **Improving**, **Well Done!**, and
   **Perfect Score**.
3. Switch to **My Results** and look at the recorded scores.
4. Return to **My Assignments**.
5. Open the **What Is Life?** assignment (the "Ready to Begin" one).
6. Work through the ten questions and **Submit**.
7. Notice the score, where the page lands after you submit, and the result
   styling.
8. Click **Back to My Assignments**.
9. Confirm that What Is Life? now looks "done" (quieter) but can still be
   reopened.
10. Open **My Results** and confirm your new score is listed.

---

## What to look for

You are the judge. As you click, ask yourself:

- Does it feel polished and finished?
- Is it always obvious what to click next?
- Does anything feel cramped, ugly, or confusing?
- Does Assignment Detail feel like part of the workspace, not a pop-up?
- Does teacher navigation feel natural?
- On the student side: would a Grade 6 student know what to do?
- Does unfinished work stand out from finished work?
- Are the cards easy to scan?
- Does finishing an assignment feel clear and rewarding?

---

## Reset (start over)

Easiest and cleanest: in the launcher window press **Ctrl+C**, then run
`bash scripts/ux-review/start.sh` again. You get a fresh, identical dataset
every time.

Faster, without restarting: in a second terminal run

```bash
bash scripts/ux-review/reseed.sh
```

This restores the original data in place - including putting What Is Life?
back to "Ready to Begin" if you completed it.

---

## Stop when finished

Go to the launcher window and press **Ctrl+C**. That stops everything.

If you closed that window and the site is still up, run:

```bash
bash scripts/ux-review/stop.sh
```

---

## Report back

Afterward, jot down:

- Anything confusing.
- Anything that looked off - spacing, buttons, cards, colors, hierarchy.
- Anything you wish worked differently.

Send those notes back and we will fold them into the v1 acceptance record.
