# Pilot Content: Essential Questions and Learning Goals

**Phase:** A1 + A2 pilot (5 strongest lessons)
**Rule:** No invented science content. Every Essential Question is the page's existing driving question kept verbatim. Every goal is grounded in that page's existing quiz questions or checkpoints, cited inline.
**Specs:** docs/components/essential-question-block-v1.md, docs/components/learning-goals-block-v1.md

---

## lesson_nature-of-waves.html

### Essential Question

How can waves transfer energy without moving matter?

(Existing dq-text, unchanged. Relabel only.)

### Learning Goals

1. Explain what is actually moving when a wave travels, using the duck-on-a-pond example (quiz Q1, Q2)
2. Compare mechanical and electromagnetic waves and explain why sound cannot cross empty space but light can (quiz Q3, Q4, astronaut predict-then-reveal)
3. Identify the parts of a wave: peak, trough, resting position, wavelength, and amplitude (quiz Q5, Q6, labeling self-check)
4. Predict how wavelength, frequency, and energy change together (quiz Q7, Q8, Q10, inverse-relationship slider)
5. Use amplitude to compare the energy of two waves, like a calm day versus a storm (quiz Q9, contrasting-cases section)

## lesson_sun-earth-moon.html

### Essential Question

Why don't Earth and the Moon just fly apart or crash together?

(Existing dq-text, unchanged.)

### Learning Goals

1. Explain how gravity and motion balance to keep Earth and the Moon in orbit instead of crashing or flying apart (quiz Q2, Q3, Q8)
2. Tell the difference between rotation and revolution and give the time each takes for Earth and the Moon (quiz Q4, Q6, Q7, rotation-vs-revolution section)
3. Describe the Sun, Earth, and Moon as one system of objects that interact (quiz Q1, Q5, Q9)
4. Explain why scientists use models to study objects as large and far apart as the Sun, Earth, and Moon (quiz Q10)

## lesson_what-is-life.html

### Essential Question

If a virus can replicate, respond to its environment, and even evolve, what's missing that keeps it from being truly alive?

(Existing dq-text, unchanged.)

### Learning Goals

1. Use the six characteristics of life to decide whether something is alive, including tricky cases like fire (quiz Q1, Q2, Q5)
2. Explain why viruses are usually classified as nonliving (quiz Q6, "Back to Viruses" section, answers the EQ)
3. Give an example of homeostasis, like shivering when cold and sweating when hot (quiz Q3)
4. Explain why all living things are made of at least one cell (quiz Q4, "The Discovery of Cells" section)
5. Compare prokaryotic and eukaryotic cells, and unicellular and multicellular organisms (quiz Q7, Q8, Q9)

## lesson_body-systems.html

### Essential Question

When you sprint for a bus, what's actually happening inside your body, and how many systems kick in at once?

(Existing dq-text, unchanged.)

### Learning Goals

1. Put the levels of biological organization in order, from cells to tissues to organs to systems (quiz Q1, Q2, checkpoint)
2. Predict how damage at one level, like cells or an organ, affects the levels above it (quiz Q1, Q2, Q6)
3. Explain how systems depend on each other, like the circulatory system delivering what the respiratory and digestive systems take in (quiz Q3, Q7, Q8)
4. Match each type of waste to the organ that removes it, and explain why waste removal matters (quiz Q4, Q9)
5. Name the systems that work together when you sprint, answering the Essential Question (quiz Q10)

## lesson_eclipses.html

### Essential Question

If the Moon orbits Earth every month, why don't eclipses happen every month?

(Existing dq-text, unchanged.)

### Learning Goals

1. Explain the difference between a solar and a lunar eclipse, including which Moon phase each requires (quiz Q1, Q8, "Two Kinds of Eclipse" section)
2. Use the Moon's tilted orbit and its nodes to explain why eclipses do not happen every month (quiz Q5, Q7, Q9, "The Tilted Orbit" section, answers the EQ)
3. Describe what you would see from the umbra versus the penumbra during a solar eclipse (quiz Q2, Q3, Q4, "Anatomy of a Shadow" section)
4. Explain the size-and-distance coincidence that makes total solar eclipses possible from Earth (quiz Q10)

---

## Appendix A: Distribution safety assessment (Part 4)

**Overall rating: LOW RISK** for both micropasses on these five pages.

- **A1 (relabel): near-zero risk.** One text node per page. No CSS, JS, layout, or behavior involved.
- **A2 (goals block): low risk.** Purely additive markup plus one self-contained CSS block per page. Nothing existing is modified.

Specifics:

- **Files affected:** only the five pilot HTML files. No shared CSS or JS files exist to break (each page is self-contained), which is exactly why per-page micropasses are safe.
- **CSS impacts:** new `.learning-goals` / `.lg-*` rules are new class names with no existing usages (verified: zero hits repo-wide), so no selector collisions. The block lives inside the hero, which is a normal-flow container on all five pages; adding a sibling below `driving-question` cannot affect absolutely positioned hero floats.
- **Mobile:** the dq card is already fluid below its 760px max-width on all five pages; the goals card copies the same pattern. Verify at 360px.
- **Standards badges:** `stem-badge` and `ls-badge` rows sit in sections below the hero on all five pages, so the new block pushes them down but cannot overlap them. Badge tooltips open upward; the goals block sits above them in document order, so a hover tooltip could overlay the goals card visually, which is normal tooltip behavior, not a defect.
- **Classroom mode:** mode JS touches quiz and submission elements only; it never queries the hero. The new block is static HTML with no JS. No interaction.

**Stop conditions:**

1. Any page where the hero is not a normal-flow container or the dq block is absolutely positioned (none of the five).
2. A goal cannot be grounded in an existing quiz/checkpoint item: flag the page, do not invent.
3. Visual diff shows anything changed other than the label text (A1) or the added block (A2).
4. Console errors appear after the edit.
5. The goals card overflows or clips at 360px width and cannot be fixed by the shared CSS alone.
6. Any temptation to "also fix" nearby markup (eclipses' missing dq-body, body-systems' stray blank lines): log it, leave it.

## Appendix B: Micropass plan (Part 5)

**Micropass A1: Essential Question relabel**
- Pages: the five pilot lessons.
- Edit: change `<div class="dq-label">Driving Question</div>` to `Essential Question`. One line per page, nothing else.
- Verify: grep shows 0 "Driving Question" and 1 "Essential Question" per page; visual check that the hero is pixel-identical except the label; mobile layout unchanged; no overlap with standards rows; zero console errors.
- STOP. Do not continue to other pages or other components.

**Micropass A2: Learning Goals block**
- Pages: same five lessons. Run only after A1 is verified.
- Edit per page: add the CSS block (accent rgba copied from that page's own `.driving-question`) and the markup from this document, inserted after the dq block inside the hero.
- Verify: goals readable at a glance (3 to 5 items, observable verbs); spacing reads as a pair with the EQ card (0.9rem gap); responsive at 360px / 768px / desktop; badge rows below hero unmoved relative to each other; zero console errors.
- STOP. The remaining 31 pages wait for a separate decision after the pilot is reviewed.
