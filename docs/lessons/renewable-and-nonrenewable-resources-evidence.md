# Renewable and Nonrenewable Resources: evidence and implementation notes

## Standards authority

Massachusetts STE is the only standards authority. The target is 7.MS-ESS3-4,
currently [Massachusetts 7.ESS.3.4](https://www.doe.mass.edu/frameworks/search/Map.aspx?ST_CODE=Sci.7.ESS.3.04).
It requires an evidence-supported mitigation argument concerning population growth
and per-capita resource use; its clarification calls for historical evidence.
Massachusetts 4.ESS.3.1 classification and 5.ESS.3.1 community practices are
prerequisite review. No NGSS standards or derived alignment resources were used.

Student target: **I can use historical evidence to argue how a human activity or
technology can reduce environmental impacts associated with population growth and
resource use per person.**

The written argument is primary performance evidence requiring teacher review.
The selected-response quiz checks knowledge and data interpretation, not mastery
of the entire standard. This case supports reasoning about freshwater demand;
it does not measure every environmental impact.

## Evidence A: frozen historical values

Authority: NYC Department of Environmental Protection / NYC Open Data,
[Water Consumption in the City of New York](https://data.cityofnewyork.us/Environment/Water-Consumption-In-The-City-Of-New-York/ia2d-e54m),
dataset `ia2d-e54m`.

These are the frozen values in the human-approved implementation authorization,
implemented October 1, 2026. The authorization supplies no dataset export timestamp;
none is invented. Do not silently substitute a newer dataset vintage. The data
portal was not readable through the research tool during implementation; the
approved ledger is the value authority for this lesson.

Geography: New York City. Consumption is average daily use for the indicated year,
not total use over the entire year. NYC population is not the population of all
customers served by the wider supply system.

| Year | Population (people) | Total consumption (million gallons/day) | Average use (gallons/person/day) |
| --- | ---: | ---: | ---: |
| 1990 | 7,335,650 | 1,423.8 | 194.09 |
| 2000 | 8,008,278 | 1,240.4 | 154.89 |
| 2010 | 8,175,133 | 1,039.0 | 127.09 |

The desktop HTML table and narrow-screen year records contain identical values
and units. Mutually exclusive CSS `display: none` rules expose only the active
representation to assistive technology. No decorative graph is used.

## Calculations and rounding

Number of people × average water use per person each day = total water use each day.

`people × gallons/person/day = gallons/day`

Approved worked example:

`8,175,133 × 127.09 ≈ 1,039,000,000 gallons/day`

The exact product of the displayed inputs is 1,038,975,153.97 gallons/day. The
approximation sign is required because the per-person figure is rounded to two
decimals. 1,039.0 million gallons/day = 1,039,000,000 gallons/day.

Endpoint differences calculated from the frozen rows: population increased by
839,483 people; displayed average use decreased by 67.00 gallons/person/day;
total consumption decreased by 384.8 million gallons/day (1,423.8 − 1,039.0).
As percentages of the 1990 values, population increased about 11.4%, average use
per person decreased about 34.5%, and total consumption decreased about 27.0%; the
lesson shows these in an optional check after students read the table, with a note
that three anchor years do not show the path in between.
These are derived calculations, not extra historical observations. The quiz
supplies the total-use endpoints when asking about their difference.

Per-capita use distributes aggregate city consumption across population. It
includes uses beyond homes and is not identical individual behavior. Both
population and average use can change. More people increase total use if average
use stays fixed; sufficiently lower average use can offset population growth.
The lesson uses units and a worked example, not an algebra mini-unit.

## Evidence B: demand on the water supply

Scientific/context authority: [NYC DEP, Drinking Water](https://www.nyc.gov/site/dep/water/drinking-water.page)
and [Water Supply System](https://www.nyc.gov/site/dep/water/water-supply.page).
DEP describes the freshwater system serving NYC. Present-day population or demand
figures on those pages are not substituted for the frozen historical values.

Total demand measures use of, and pressure on, supplies. Resource consumption is
not identical to environmental damage. Lower demand alone does not establish
improved water quality, ecological recovery, or increased reservoir storage;
those claims require separate measurements. DEP is an evidence/science authority,
not a standards authority.

## Evidence C: documented intervention

Primary authority: [NYC DEP, Water Conservation Report - Annual Update, June 2011](https://www.nyc.gov/assets/dep/downloads/pdf/water/drinking-water/water-conservation-report-annual-update-2011.pdf),
printed page 15, “City-Wide Conservation Program (Toilet Rebate Program).”
DEP reports the **1994–1997** program replaced approximately **1.3 million toilets**
and reduced consumption by approximately **90 million gallons/day**.

Corroboration: [NYC DEP press release, March 16, 2012](https://www.nyc.gov/html/dep/html/press_releases/12-19pr.shtml).
That release discusses the earlier program as context for a proposed later program.
The lesson does not mix their fixture counts or projected savings.

The savings figure is an approximate DEP-reported program attribution, not a
controlled causal estimate for the full 1990–2010 trend. DEP also documents other
conservation and system-management activities, including metering and hydrant
management. Do not attribute the entire historical decline to toilet replacement,
or invent allocations of the remaining decline to specific programs.

Efficient fixtures can provide sanitation using less water per flush, lowering
average use and potentially total demand. These findings cannot predict identical
future savings in another town or establish water-quality improvement, ecosystem
recovery, or increased reservoir storage. A town needs information about its
fixtures, use, participation, and future population.

## Supporting science

Incoming sunlight is an energy flow; using it does not alter tomorrow's solar
input. There is no universal rule that renewable energy is replaced at the rate
people use it. Freshwater and biomass are replenishable material supplies; local
use, natural replenishment, pollution, and delivery limits matter. Geothermal
reservoirs require management. Wind and hydroelectric generation vary with
conditions. Renewable does not mean unlimited or environmentally perfect.

Coal formed mainly from ancient land plants. Petroleum and much natural gas
formed from buried organic material including microscopic aquatic organisms.
Uranium is finite nuclear fuel, not a fossil fuel; fission is not combustion.
These concise references support the investigation without expanding it into
a geology or reactor unit.

## Teacher review and evidence method

Students identify measurements, find patterns, compare population and average use,
examine total use, connect demand to the supply, evaluate intervention evidence,
and select relevant evidence. Discussion or personal notes are not persisted.
There is one collected town argument, in `#el-thinking`, with optional stems.
Do not prescribe a viewpoint or sentence count.

Review for a defensible claim; accurate historical and program evidence (at least
two specific pieces); population/per-person/total reasoning; a mitigation mechanism;
and a causal or transfer limitation. Reading and clicking do not demonstrate the
argument performance. Educator disclosures separate prerequisites, supporting
science, interpretation, actual performance, and optional enrichment, without
inflated DOK/Bloom labels.

The model appears after confirmed submission or completed unsaved practice, not
before students reason. An uncertain assigned result preserves the readable,
selectable response on the page and keeps the model hidden.

## Assessment and submission architecture

Canonical revision: `assessment_renewable-and-nonrenewable-resources__r2`.
Ten four-option single-choice items follow the approved blueprint. Data-dependent
stems include their values for teacher review. Answer positions: `BDACBADCAB`
(A:3, B:3, C:2, D:2), without quality warnings or failures.

Immutable r1 payload, before and after SHA-256:
`1360acbf31cb2aaacfb90e335516e2337e7256526e031db25e6d516abbef1769`.

The existing generator produces r1 and r2 renditions and revision routing tables.
**Architectural limitation:** historical renditions preserve historical quiz content
but use current instruction and current Show Your Thinking content. The r1 quiz
retains obsolete explanations; it was not rewritten. This does not implement
immutable historical writing-prompt snapshots. Use current r2 for remediation.

The V2 submission call remains
`lessonQuiz.finalize(selectedAnswers, { writtenResponse: thinkingText })`.
The visible 10,000-character maximum matches the adapter. Both UI state and a
submission guard reject over-limit programmatic input without truncating it.
Unfinished writing is not autosaved; no draft persistence was added. Submitted
writing stays read-only, selectable, and resizable. Assigned finalized and uncertain
attempts cannot reset locally and hide Try Again. Existing return-to-assignments
behavior remains. Unsaved practice may reset with explicit unsaved wording.
No shared production runtime or attempt lifecycle was modified.

## Scope

The authorized implementation is 20 project files (15 existing, 5 new), including
generated artifacts from the targeted builder. Only the existing HQIM row changes.
No images are created, no shared runtime is edited, and this work stays uncommitted.
Human browser verification, especially real assigned submission and teacher
visibility, remains required before the human commit/push decision.
