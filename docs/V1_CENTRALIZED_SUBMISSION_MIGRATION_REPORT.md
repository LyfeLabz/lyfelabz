# V1 Centralized Submission Migration Report

Sprint: S3C - Repository-Wide Centralized Submission Migration

## Summary

All 16 V1 submission-capable resource pages have been migrated from legacy per-teacher GET endpoints to the deployed centralized Google Apps Script POST backend.

Centralized endpoint:
`https://script.google.com/macros/s/AKfycbwdrSOGpB6_lWb7zbNjgADTw8DM-AZgVrB1iS2GPrsSMSM0I8GvWqVcLFHK-LGDP7f5VQ/exec`

## Files Migrated

### Investigations (5)

| File | Grade | Endpoint Constant | Questions |
|---|---|---|---|
| investigation_cell-energy.html | 6 | CE_ENDPOINT | 10 MC |
| investigation_gray-zone.html | 6 | GZ_ENDPOINT | 8 MC |
| investigation_protein-pathway.html | 6 | PP_ENDPOINT | 8 MC |
| investigation_amplitude-challenge.html | 6 | AC_ENDPOINT | 5 MC |
| investigation_population-patterns.html | 7 | POP_ENDPOINT | 10 MC |

### Extensions (5)

| File | Grade | Endpoint Constant | Questions |
|---|---|---|---|
| extension_chernobyl-frogs.html | 6 | CF_ENDPOINT | 4 open text |
| extension_fossil-hunt.html | 6 | FH_ENDPOINT | 10 MC |
| extension_hidden-world-of-matter.html | 6 | BB_ENDPOINT | 10 MC |
| extension_neuron-explorer.html | 6 | NE_ENDPOINT | 8 MC |
| extension_virus.html | 6 | VI_ENDPOINT | 8 MC |

### Simulations (4)

| File | Grade | Endpoint Constant | Questions |
|---|---|---|---|
| simulation_beetle-island.html | 6 | BI_ENDPOINT | 4 open text |
| simulation_eclipse-alignment.html | 6 | EA_ENDPOINT | 5 MC |
| simulation_floatlandia-fracture.html | 6 | FF_ENDPOINT | 5 MC |
| simulation_gravity-wells.html | 6 | GW_ENDPOINT | 5 MC |

### Engineering Challenges (1)

| File | Grade | Endpoint Constant | Questions |
|---|---|---|---|
| challenge_welcome-to-floatia.html | 6 | WF_ENDPOINT | 10 MC |

### Games (1)

| File | Grade | Endpoint Constant | Questions |
|---|---|---|---|
| game_layer-detective.html | 6 | LD_ENDPOINT | 5 MC |

## Changes Applied Per File

Every migrated file received the same canonical set of changes:

1. Teacher option values changed to canonical keys:
   - G6: `mr-brown`, `ms-gay`
   - G7: `mr-kankel`, `mr-rovner`

2. Legacy per-teacher endpoint map removed and replaced with single `const XX_ENDPOINT` constant pointing to the centralized URL.

3. Submit function rewritten to:
   - Send `resourceId` and `grade` instead of `tab`
   - Send `teacher` as the canonical key (not a display name)
   - Send `score` in `'X/Y'` format (not `quizScore` or `percent`)
   - Send `q1`-`qN` individual answer fields
   - Use `fetch(ENDPOINT, { method: 'POST', body: params })`
   - Parse JSON response and branch on `data.status === 'success'`
   - Preserve all registered `extendedFields` unchanged

4. Banned fields removed: `tab`, `quizScore` (as submission field name), `percent`, `mode: 'no-cors'`

## Extended Fields Preserved

| Resource | Extended Fields |
|---|---|
| investigation_amplitude-challenge | answers |
| investigation_cell-energy | answers |
| investigation_fossil-hunt | quizAnswers, difficulty |
| simulation_beetle-island | environment, eventType, totalGens, accuracy, prediction |
| game_layer-detective | hintsUsed, quizAnswers |

## Repository-Wide Validation Results

| Check | Result |
|---|---|
| Banned field `tab:` in submission params | 0 matches |
| Banned field `quizScore:` in submission params | 0 matches |
| Banned field `percent:` in submission params | 0 matches |
| `mode: 'no-cors'` in submission code | 0 matches |
| Legacy SCRIPT_URLS / SHEET_URLS / CHECKPOINT_URLS constants | 0 matches |
| Display-name teacher keys in option values | 0 matches |
| Legacy per-teacher endpoint URLs | 0 matches |
| Files with centralized endpoint | 16 |

## Out of Scope (Not Modified)

Per sprint constraints, the following were not touched:

- `game_photon-runner.html`
- `game_evolution-clicker.html`
- Wonderbox pages
- Firebase V2 code
- Cloud Functions
- Lesson files (no submission capability)

## Manual Browser Test Matrix

For each migrated file, verify the following in classroom mode:

1. **Practice mode guard**: submit with mode = practice. Confirm score reveals locally, no network request fires.
2. **Validation guard**: submit with name, teacher, or block missing. Confirm error messaging and button not locked.
3. **Successful submission**: fill all required fields, complete activity, submit. Confirm:
   - Button transitions to "Submitted" / locked state
   - Success message appears with student name and score
   - No console errors
   - Network request is POST to the centralized endpoint
   - Server returns `{"status":"success"}`
4. **Network failure**: disconnect network, submit. Confirm error message appears and button is re-enabled for retry.

Priority files for manual testing (highest traffic):

- `simulation_beetle-island.html` (extendedFields: environment simulation state)
- `extension_fossil-hunt.html` (extendedFields: difficulty level)
- `game_layer-detective.html` (extendedFields: hintsUsed, quizAnswers)
- `investigation_population-patterns.html` (G7, mr-kankel/mr-rovner keys)
