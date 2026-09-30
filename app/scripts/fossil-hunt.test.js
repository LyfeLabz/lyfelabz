/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../../extension_fossil-hunt.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const main = scripts.find(script => script.includes('const LEVELS'));
const educator = scripts.find(script => script.includes("document.body.classList.toggle('ls-active'"));
const AM = 'Dactylioceras commune';
const SC = 'Scyphocrinites';
const TR = 'Paradoxides';
const BR = 'Mucrospirifer mucronatus';
const CR = 'Crinoid — type unidentified';
const GR = 'Graptolite — type unidentified';
let dom, w, app;
const el = id => w.document.getElementById(id);
const click = id => el(id).click();
const advance = ms => jest.advanceTimersByTime(ms);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  // No resources option and outside-only scripts: no network, analytics or shared runtime loads.
  dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://fossil-hunt.invalid/' });
  w = dom.window;
  w.setTimeout = setTimeout;
  w.clearTimeout = clearTimeout;
  w.requestAnimationFrame = callback => setTimeout(callback, 16);
  w.HTMLElement.prototype.scrollIntoView = jest.fn();
  w.fetch = jest.fn().mockRejectedValue(new Error('Network is stubbed; no real submissions'));
  w.eval(main + `\nwindow.testApp = { state, LEVELS, FOSSIL_INFO, QUIZ_DATA, currentLevel,
    getLayerById, markerEvidence, markerOrderAgrees, canCorrelate, correlationsComplete,
    puzzleComplete, canSubmit, handleLayerClick, handleOrderClick, showAgeCheck,
    handleAgeCheckAnswer, executeReset, switchDifficulty, setMode, renderClassroomPanel,
    renderLayers, renderGroups, updateFossilInfoPanel, showQuizReview, computeQuizScore };`);
  w.eval(educator);
  app = w.testApp;
});
afterEach(() => {
  dom.window.close();
  jest.clearAllTimers();
  jest.useRealTimers();
});

function selectDifficulty(mode) {
  if (app.state.difficulty === mode) return;
  app.switchDifficulty(mode);
  if (app.state.difficulty !== mode) app.switchDifficulty(mode);
}
function matchAll() {
  for (const group of Object.values(app.currentLevel().groups)) group.ids.forEach(app.handleLayerClick);
  expect(app.correlationsComplete()).toBe(true);
}
function orderAll() {
  app.currentLevel().ageOrderOldestFirst.forEach(app.handleOrderClick);
  expect(app.state.orderCorrect).toBe(true);
}
function reachFinal() {
  matchAll();
  orderAll();
  advance(900);
  expect(el('ageCheckOverlay').classList.contains('show')).toBe(true);
}
function solve() {
  reachFinal();
  app.handleAgeCheckAnswer(app.currentLevel().ageCheck.correct);
}
function answerQuiz(perfect = false) {
  app.QUIZ_DATA[app.state.difficulty].forEach(q => {
    const choice = perfect ? q.correct : (q.correct + 1) % 4;
    w.document.querySelector(`.quiz-question[data-qid="${q.id}"] .quiz-option[data-option-index="${choice}"]`).click();
  });
}
function readyToSubmit(perfect = false) {
  app.setMode(true);
  solve();
  advance(2500);
  click('victoryClose');
  answerQuiz(perfect);
  expect(app.canSubmit()).toBe(true);
}
function assertFresh(mode = app.state.difficulty) {
  expect(app.state).toMatchObject({ difficulty: mode, selected: null, matched: {}, completedGroups: [],
    errors: 0, hintsUsed: 0, hintIndex: 0, victoryShown: false, quizAnswers: {}, quizSubmitted: false,
    submitting: false, orderingPhase: false, orderSelected: [], orderCorrect: false,
    ageCheckAnswered: false, ageCheckCorrect: false, ageCheckLocked: false });
  for (const id of ['victoryOverlay', 'ageCheckOverlay', 'hintBox', 'orderingRevealBanner', 'diffWarning', 'missionChip']) {
    expect(el(id).classList.contains('show')).toBe(false);
  }
  expect(el('orderingPanel').classList.contains('hidden')).toBe(true);
  expect(el('quizQuestions').textContent).toBe('');
  expect(el('quizQuestions').dataset.built).toBe('');
  expect(el('quizLockedOverlay').classList.contains('hidden')).toBe(false);
  expect(el('fossilInfoContent').style.display).toBe('none');
  expect(el('fossilInfoName').textContent).toBe('');
  expect(el('submitSuccess').textContent).toBe('');
  expect(el('submitError').textContent).toBe('');
  expect(el('classroomSubmitBtn').textContent).toBe('Submit Score');
  expect(el('classroomSubmitBtn').disabled).toBe(true);
  expect(el('resetBtn').textContent).toBe('Reset Puzzle');
  expect(app.canSubmit()).toBe(false);
}

describe('approved scientific contract', () => {
  const expected = {
    practice: [
      ['Shell Fragment', AM, 'Fern Impression', SC, 'Rugose Coral', TR],
      ['Leaf Impression', AM, SC, 'Coral Fragment', TR],
      ['Fern Impression', AM, 'Coral — type unidentified', SC, 'Shell Fragment', TR]
    ],
    challenge: [
      ['Shell Fragment', CR, AM, BR, GR, SC, TR],
      ['Fern Impression', AM, CR, BR, SC, TR],
      ['Coral Fragment', AM, CR, BR, 'Rugose Coral', SC, TR]
    ]
  };
  test.each(['practice', 'challenge'])('%s keeps exact layer IDs, identities, roles and group order', mode => {
    selectDifficulty(mode);
    const level = app.currentLevel();
    const order = mode === 'practice' ? [TR, SC, AM] : [TR, SC, BR, AM];
    expect(level.ageOrderOldestFirst.map(id => level.groups[id].fossil)).toEqual(order);
    level.locations.forEach((loc, i) => {
      expect(loc.layers.map(l => l.fossil)).toEqual(expected[mode][i]);
      expect(loc.layers.map(l => l.id)).toEqual(expected[mode][i].map((_, j) => loc.name + j));
      expect(loc.layers.filter(l => l.role === 'marker').map(l => l.fossil)).toEqual([...order].reverse());
      loc.layers.forEach(layer => {
        if (order.includes(layer.fossil)) {
          expect(app.markerEvidence(layer)).toBeTruthy();
          expect(level.groups[layer.group].ids).toContain(layer.id);
        } else {
          expect(layer.role).toBe('context');
          expect(layer.group).toBeNull();
          expect(app.markerEvidence(layer)).toBeNull();
        }
        expect(layer.rock).not.toBe('Deep Lime');
      });
    });
    expect(app.markerOrderAgrees()).toBe(true);
  });

  test('named-marker brackets are enclosing intervals with scoped distribution, never exact lifespans', () => {
    const bounds = { [AM]: [184, 175], [SC]: [423, 413], [TR]: [507, 497], [BR]: [393, 382] };
    Object.entries(bounds).forEach(([name, [oldestMa, youngestMa]]) => {
      const info = app.FOSSIL_INFO[name];
      expect(info.interval).toMatchObject({ oldestMa, youngestMa, kind: 'enclosing geological interval' });
      expect(info.distribution.modelSites).toEqual(['A', 'B', 'C']);
      expect(info.source).toMatch(/^https:\/\//);
      expect(info.desc).toContain('not exact first-appearance or extinction dates');
      expect(info.commonGroup).toBeTruthy();
    });
    expect(app.FOSSIL_INFO[BR].distribution.description).toContain('regionally');
    expect(app.FOSSIL_INFO['Rugose Coral'].range).toContain('470–252 mya');
    expect(app.FOSSIL_INFO['Rugose Coral'].role).toBe('context');
    expect(app.FOSSIL_INFO[CR].range).toContain('480 mya to today');
  });

  test.each(['practice', 'challenge'])('%s columns admit ages consistent with all supplied broad evidence', mode => {
    // Feasibility witnesses only, not exact deposition ages or calculated taxon lifespans.
    const witnesses = mode === 'practice'
      ? [[150, 180, 300, 420, 450, 502], [150, 180, 420, 450, 502], [150, 180, 300, 420, 450, 502]]
      : [[150, 170, 180, 390, 400, 420, 502], [150, 180, 300, 390, 420, 502], [150, 180, 300, 390, 400, 420, 502]];
    selectDifficulty(mode);
    const broadBounds = { [CR]: [480, 0], [GR]: [520, 350], 'Rugose Coral': [470, 252], 'Fern Impression': [360, 0] };
    app.currentLevel().locations.forEach((loc, i) => loc.layers.forEach((layer, j) => {
      const age = witnesses[i][j];
      if (j) expect(age).toBeGreaterThan(witnesses[i][j - 1]);
      const info = app.FOSSIL_INFO[layer.fossil];
      const bounds = info.interval ? [info.interval.oldestMa, info.interval.youngestMa] : broadBounds[layer.fossil];
      if (bounds) {
        expect(age).toBeLessThanOrEqual(bounds[0]);
        expect(age).toBeGreaterThanOrEqual(bounds[1]);
      }
    }));
  });

  test('student Field Notes use the approved concise copy and define the age unit', () => {
    const notes = w.document.querySelector('.field-notes');
    expect(notes.querySelector('.field-notes-label').textContent).toBe('Field Notes');
    expect([...notes.querySelectorAll('p')].map(p => p.textContent)).toEqual([
      'Use fossils and their age ranges to match rock layers from different locations. Remember: in undisturbed rock layers, older layers are below younger layers.',
      'These rock layers are simplified examples. Use the fossil names and information provided as evidence. You do not need to memorize fossil names or dates. mya = million years ago.'
    ]);
    expect(notes.querySelector('strong').textContent).toBe('mya = million years ago.');
  });

  test('source, display data and rendered fossil cards consistently use the approved age unit', () => {
    const obsoleteAgeUnit = /\bMa\b/;
    expect(html).not.toMatch(obsoleteAgeUnit);
    expect(JSON.stringify([app.FOSSIL_INFO, app.LEVELS, app.QUIZ_DATA])).not.toMatch(obsoleteAgeUnit);
    for (const name of Object.keys(app.FOSSIL_INFO)) {
      app.updateFossilInfoPanel(name);
      expect(el('fossilInfoContent').textContent).not.toMatch(obsoleteAgeUnit);
    }
    expect(el('fossilTeacherNotes').textContent).not.toMatch(obsoleteAgeUnit);
  });

  test('all cards retain bounded precision and useful contextual evidence', () => {
    for (const [name, info] of Object.entries(app.FOSSIL_INFO)) {
      app.updateFossilInfoPanel(name);
      expect(el('fossilInfoRange').textContent).toBe(info.range);
      expect(el('fossilInfoDesc').textContent).toContain(info.desc);
      if (info.broadGroupHistory) expect(el('fossilInfoDesc').textContent).toContain(info.broadGroupHistory);
      expect(el('fossilInfoPill').textContent).not.toMatch(/Strong Index|Not an Index/);
    }
    for (const name of ['Shell Fragment', 'Coral Fragment', 'Fern Impression', 'Leaf Impression']) {
      expect(app.FOSSIL_INFO[name].desc).toMatch(/diagnostic/);
    }
    expect(html).not.toMatch(/exactly once|exactly ONE layer|must appear in only one|Deeper means older|Only layers with the same fossil|formed at the same time|488 to 252|Strong Index Fossil|Not an Index Fossil/);
  });

  test.each(['practice', 'challenge'])('%s hints scaffold evidence without enumerating answers', mode => {
    selectDifficulty(mode);
    app.currentLevel().hints.forEach((hint, i) => {
      click('hintBtn');
      expect(el('hintText').textContent).toBe(hint);
      expect(hint).not.toMatch(/\b[ABC][0-6]\b|Dactylioceras|Scyphocrinites|Paradoxides|Mucrospirifer|exactly once|one layer per/);
      expect(app.state.hintsUsed).toBe(i + 1);
    });
    expect(app.currentLevel().hints[0]).toMatch(/identification/);
    expect(app.currentLevel().hints[1]).toMatch(/Compare/);
    expect(app.currentLevel().hints[2]).toMatch(/Check/);
  });
});

describe.each(['practice', 'challenge'])('%s matching and reasoning', mode => {
  beforeEach(() => selectDifficulty(mode));
  test.each([false, true])('all supported pairs work in reverse=%s direction without duplicate completion', reverse => {
    for (const [groupId, group] of Object.entries(app.currentLevel().groups)) {
      const ids = reverse ? [...group.ids].reverse() : group.ids;
      ids.forEach(app.handleLayerClick);
      expect(app.state.completedGroups.filter(id => id === groupId)).toHaveLength(1);
      expect(el('feedbackText').textContent).toContain('documented distribution');
      expect(el('feedbackText').textContent).toContain('does not establish exact simultaneity');
      app.handleLayerClick(ids[0]);
      app.handleLayerClick(ids[1]);
      expect(app.state.completedGroups.filter(id => id === groupId)).toHaveLength(1);
    }
    expect(app.state.errors).toBe(0);
    expect(app.correlationsComplete()).toBe(true);
  });
  test('same-site selections do not correlate, and differing markers are rejected', () => {
    const groups = Object.values(app.currentLevel().groups);
    app.handleLayerClick(groups[0].ids[0]);
    app.handleLayerClick(groups[1].ids[0]);
    expect(app.state.matched).toEqual({});
    expect(app.canCorrelate(app.getLayerById(groups[0].ids[0]), app.getLayerById(groups[1].ids[0]))).toBe(false);
    app.handleLayerClick(groups[0].ids[1]);
    expect(app.state.errors).toBe(1);
    expect(app.state.matched).toEqual({});
  });
  test('broad or unidentified evidence is insufficient in both directions', () => {
    const ids = mode === 'practice' ? ['A0', 'C4'] : ['A1', 'B2'];
    for (const pair of [ids, [...ids].reverse()]) {
      pair.forEach(app.handleLayerClick);
      expect(app.state.matched).toEqual({});
      expect(el('feedbackText').textContent).toMatch(/identification|identified/);
    }
    expect(app.state.errors).toBe(2);
  });
  test.each(['role', 'markerId', 'group', 'distribution', 'interval'])('rejects malformed asymmetric %s evidence in either direction', field => {
    const group = app.currentLevel().groups.G1;
    const first = app.getLayerById(group.ids[0]);
    const second = app.currentLevel().locations[1].layers.find(l => l.id === group.ids[1]);
    if (field === 'role') second.role = 'context';
    if (field === 'markerId') second.markerId = 'unverified';
    if (field === 'group') second.group = 'G2';
    if (field === 'distribution') app.FOSSIL_INFO[second.fossil].distribution.modelSites = ['A', 'C'];
    if (field === 'interval') app.FOSSIL_INFO[second.fossil].interval.youngestMa = 999;
    expect(app.canCorrelate(first, second)).toBe(false);
    expect(app.canCorrelate(second, first)).toBe(false);
    [group.ids.slice(0, 2), group.ids.slice(0, 2).reverse()].forEach(ids => ids.forEach(app.handleLayerClick));
    expect(app.state.matched).toEqual({});
  });
  test('internal group equality alone cannot justify differing identifications', () => {
    const group = app.currentLevel().groups.G1;
    const second = app.currentLevel().locations[1].layers.find(l => l.id === group.ids[1]);
    second.fossil = SC;
    expect(app.canCorrelate(app.getLayerById(group.ids[0]), second)).toBe(false);
  });
  test.each(['reverse', 'mixed'])('rejects %s order, then accepts a correct retry', kind => {
    matchAll();
    const correct = [...app.currentLevel().ageOrderOldestFirst];
    const wrong = kind === 'reverse' ? [...correct].reverse() : [correct[1], correct[0], ...correct.slice(2)];
    wrong.forEach(app.handleOrderClick);
    expect(app.state.orderCorrect).toBe(false);
    expect(app.state.errors).toBe(1);
    expect(el('feedbackText').textContent).toContain('undisturbed');
    advance(2400);
    expect(app.state.orderSelected).toEqual([]);
    orderAll();
  });
  test('rejects an authored order inconsistent with columns or temporal evidence', () => {
    app.currentLevel().ageOrderOldestFirst.reverse();
    expect(app.markerOrderAgrees()).toBe(false);
    const group = app.currentLevel().groups.G1;
    expect(app.canCorrelate(app.getLayerById(group.ids[0]), app.getLayerById(group.ids[1]))).toBe(false);
  });
  test('each final-check distractor prompts a retry without completing the run', () => {
    reachFinal();
    const check = app.currentLevel().ageCheck;
    check.options.forEach((_, i) => {
      if (i === check.correct) return;
      app.handleAgeCheckAnswer(i);
      expect(app.state.ageCheckCorrect).toBe(false);
      expect(app.puzzleComplete()).toBe(false);
      expect(el('ageCheckFeedback').textContent).toBe(check.wrongFeedback);
      click('ageCheckRetry');
    });
  });
  test('final check requires ordering, permits retries, and only the correct path unlocks the quiz', () => {
    app.setMode(true);
    app.showAgeCheck();
    expect(el('ageCheckOverlay').classList.contains('show')).toBe(false);
    reachFinal();
    const correct = app.currentLevel().ageCheck.correct;
    app.handleAgeCheckAnswer((correct + 1) % 4);
    expect(app.state.ageCheckAnswered).toBe(true);
    expect(app.state.ageCheckCorrect).toBe(false);
    expect(el('quizQuestions').textContent).toBe('');
    expect(el('ageCheckRetry').classList.contains('show')).toBe(true);
    app.handleAgeCheckAnswer(correct); // Locked until the explicit retry.
    expect(app.state.ageCheckCorrect).toBe(false);
    advance(3000);
    expect(app.state.victoryShown).toBe(false);
    click('ageCheckRetry');
    app.handleAgeCheckAnswer(correct);
    expect(app.state.ageCheckCorrect).toBe(true);
    expect(el('quizQuestions').children).toHaveLength(10);
    expect(el('ageCheckFeedback').textContent).toBe(app.currentLevel().ageCheck.correctFeedback);
    advance(2500);
    expect(el('victoryOverlay').classList.contains('show')).toBe(true);
    expect(el('victoryAgeText').textContent).toContain('Unmatched layers above');
  });
});

test('Challenge retains inspection but hides eligibility verdicts and undiscovered answers in both legends', () => {
  selectDifficulty('challenge');
  app.setMode(true);
  expect(el('groupsLegend').textContent).not.toMatch(/Dactylioceras|Scyphocrinites|Paradoxides|Mucrospirifer/);
  expect(el('matchProgressGrid').textContent).not.toMatch(/Dactylioceras|Scyphocrinites|Paradoxides|Mucrospirifer/);
  click('layer-A2');
  expect(w.document.querySelectorAll('.fossil-layer.dimmed')).toHaveLength(0);
  expect(w.document.querySelectorAll('.index-badge')).toHaveLength(0);
  expect(el('fossilInfoPill').style.display).toBe('none');
  click('layer-A1');
  expect(el('fossilInfoName').textContent).toBe(CR);
  click('missionChipCancel');
  click('layer-A2');
  click('layer-B1');
  expect(el('groupsLegend').textContent).toContain(AM);
  expect(el('groupsLegend').textContent).not.toContain(BR);
});

test('Practice reference labels and Educator guidance preserve the bounded model', () => {
  expect(w.document.querySelectorAll('.index-badge')).toHaveLength(9);
  expect(el('layer-A1').textContent).toContain('A1 · Ammonite');
  expect(w.document.querySelector('.hero-badge').textContent).toBe('EXTENSION');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'i', ctrlKey: true, altKey: true, bubbles: true }));
  expect(w.document.body.classList.contains('ls-active')).toBe(true);
  const notes = el('fossilTeacherNotes').textContent;
  expect(notes).toMatch(/Required Grade 6 activity; ESS1-4 remains classification C/);
  expect(notes).toMatch(/not exact taxon lifespans/);
  expect(notes).toMatch(/Student Evidence Architecture/);
  expect(notes).toMatch(/independent reasoning/);
  expect(notes).toMatch(/not an actual measured outcrop/);
  expect(notes).toMatch(/G3 → G2 → G1/);
  expect(notes).toMatch(/G4 → G3 → G2 → G1/);
});

describe.each(['practice', 'challenge'])('%s reset and delayed callbacks', mode => {
  beforeEach(() => selectDifficulty(mode));
  const stages = ['before progress', 'partial match', 'completed correlations', 'delayed wrong order',
    'delayed final check', 'final-check display', 'wrong final check', 'correct final check',
    'delayed victory', 'quiz display', 'submission display'];
  test.each(stages)('reset at %s clears the run and stays cleared after every old timer', async stage => {
    app.setMode(true);
    el('studentNameInput').value = 'Local test student';
    el('teacherSelect').value = 'mr-brown';
    el('blockInput').value = 'B';
    click('hintBtn');
    if (stage === 'partial match') app.currentLevel().groups.G1.ids.slice(0, 2).forEach(app.handleLayerClick);
    if (stage === 'completed correlations') matchAll();
    if (stage === 'delayed wrong order') {
      matchAll();
      [...app.currentLevel().ageOrderOldestFirst].reverse().forEach(app.handleOrderClick);
    }
    if (stage === 'delayed final check') { matchAll(); orderAll(); }
    if (['final-check display', 'wrong final check', 'correct final check', 'delayed victory', 'quiz display', 'submission display'].includes(stage)) {
      reachFinal();
      if (stage === 'wrong final check') app.handleAgeCheckAnswer((app.currentLevel().ageCheck.correct + 1) % 4);
      if (['correct final check', 'delayed victory', 'quiz display', 'submission display'].includes(stage)) app.handleAgeCheckAnswer(app.currentLevel().ageCheck.correct);
      if (stage === 'delayed victory') advance(2200);
      if (['quiz display', 'submission display'].includes(stage)) { advance(2500); answerQuiz(true); }
      if (stage === 'submission display') {
        w.fetch.mockResolvedValue({ json: async () => ({ status: 'success' }) });
        click('classroomSubmitBtn');
        await flush();
        expect(app.state.quizSubmitted).toBe(true);
      }
    }
    const scroll = el('continue').scrollIntoView;
    scroll.mockClear();
    app.executeReset();
    assertFresh();
    advance(10000);
    assertFresh();
    expect(scroll).not.toHaveBeenCalled();
    expect(app.state.classroomMode).toBe(true);
    expect(el('studentNameInput').value).toBe('Local test student');
    expect(el('teacherSelect').value).toBe('mr-brown');
    expect(el('blockInput').value).toBe('B');
  });
  test.each(['practice', 'challenge'])('fresh %s run cannot reuse a previous successful or wrong final check', mode => {
    selectDifficulty(mode);
    for (const answerCorrectly of [false, true]) {
      reachFinal();
      const correct = app.currentLevel().ageCheck.correct;
      app.handleAgeCheckAnswer(answerCorrectly ? correct : (correct + 1) % 4);
      app.executeReset();
      reachFinal();
      expect(app.state.ageCheckCorrect).toBe(false);
      expect(app.state.victoryShown).toBe(false);
      expect(app.puzzleComplete()).toBe(false);
      app.executeReset();
    }
  });
  test.each(['practice', 'challenge'])('switch away from %s guards pending wrong-order, final-check and victory callbacks', mode => {
    for (const pending of ['wrong-order', 'final-check', 'victory']) {
      selectDifficulty(mode);
      matchAll();
      if (pending === 'wrong-order') [...app.currentLevel().ageOrderOldestFirst].reverse().forEach(app.handleOrderClick);
      else {
        orderAll();
        if (pending === 'victory') { advance(900); app.handleAgeCheckAnswer(app.currentLevel().ageCheck.correct); advance(2200); }
      }
      const other = mode === 'practice' ? 'challenge' : 'practice';
      app.switchDifficulty(other);
      expect(app.state.difficulty).toBe(mode); // Existing two-click confirmation preserved.
      app.switchDifficulty(other);
      assertFresh(other);
      advance(10000);
      assertFresh(other);
    }
  });
  test('reset button confirmation and expiry leave appropriate labels', () => {
    click('resetBtn');
    assertFresh();
    app.currentLevel().groups.G1.ids.slice(0, 2).forEach(app.handleLayerClick);
    click('resetBtn');
    expect(el('resetBtn').textContent).toContain('confirm');
    advance(3000);
    expect(el('resetBtn').textContent).toBe('Reset Puzzle');
    expect(Object.keys(app.state.matched)).toHaveLength(2);
    click('resetBtn');
    click('resetBtn');
    assertFresh();
  });
});

describe.each(['practice', 'challenge'])('%s quiz and stubbed submission', mode => {
  beforeEach(() => selectDifficulty(mode));
  test('preserves ten four-option questions with review explanations and letter keys', () => {
    const questions = app.QUIZ_DATA[mode];
    expect(questions).toHaveLength(10);
    expect(questions.map(q => q.id)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    questions.forEach(q => {
      expect(q.options).toHaveLength(4);
      expect(q.correct).toBeGreaterThanOrEqual(0);
      expect(q.correct).toBeLessThan(4);
      expect(q.explanation.length).toBeGreaterThan(40);
    });
  });
  test.each(['correlations', 'order', 'final check', 'ten responses'])('submission enforces %s even if the button is forced enabled', requirement => {
    readyToSubmit();
    if (requirement === 'correlations') delete app.state.matched[app.currentLevel().groups.G1.ids[0]];
    if (requirement === 'order') app.state.orderCorrect = false;
    if (requirement === 'final check') app.state.ageCheckCorrect = false;
    if (requirement === 'ten responses') delete app.state.quizAnswers[10];
    expect(app.canSubmit()).toBe(false);
    el('classroomSubmitBtn').disabled = false;
    click('classroomSubmitBtn');
    expect(w.fetch).not.toHaveBeenCalled();
  });
  test('submits nonperfect results with the exact unchanged payload and prevents repeat submissions', async () => {
    readyToSubmit(false);
    el('studentNameInput').value = ' Test Student ';
    el('teacherSelect').value = 'ms-gay';
    el('blockInput').value = 'C';
    w.fetch.mockResolvedValue({ json: async () => ({ status: 'success' }) });
    click('classroomSubmitBtn');
    app.renderClassroomPanel();
    expect(el('classroomSubmitBtn').disabled).toBe(true);
    await flush();
    expect(w.fetch).toHaveBeenCalledTimes(1);
    const [url, request] = w.fetch.mock.calls[0];
    expect(url).toContain('script.google.com/macros/s/');
    expect(request.method).toBe('POST');
    const payload = Object.fromEntries(request.body.entries());
    expect(Object.keys(payload).sort()).toEqual(['resourceId', 'grade', 'studentName', 'teacher', 'block', 'score', 'difficulty',
      'groupsMatched', 'errors', 'hintsUsed', ...Array.from({ length: 10 }, (_, i) => 'q' + (i + 1))].sort());
    expect(payload).toMatchObject({ resourceId: 'extension_fossil-hunt', grade: '6', studentName: 'Test Student',
      teacher: 'ms-gay', block: 'C', difficulty: mode, score: '0/10', errors: '0', hintsUsed: '0',
      groupsMatched: mode === 'practice' ? '3/3' : '4/4' });
    app.QUIZ_DATA[mode].forEach(q => expect(payload['q' + q.id]).toBe('ABCD'[(q.correct + 1) % 4]));
    expect(app.state.quizSubmitted).toBe(true);
    expect(w.document.querySelectorAll('.quiz-explanation')).toHaveLength(10);
    expect(w.document.querySelectorAll('.correct-review')).toHaveLength(10);
    expect(w.document.querySelectorAll('.wrong-review')).toHaveLength(10);
    app.showQuizReview();
    expect(w.document.querySelectorAll('.quiz-explanation')).toHaveLength(10);
    app.setMode(false); app.setMode(true);
    click('classroomSubmitBtn');
    expect(w.fetch).toHaveBeenCalledTimes(1);
    expect(el('classroomSubmitBtn').textContent).toBe('Submitted');
  });
  test('responses freeze during the request and failure allows retry', async () => {
    readyToSubmit(true);
    let reject;
    w.fetch.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    click('classroomSubmitBtn');
    const before = { ...app.state.quizAnswers };
    w.document.querySelector('.quiz-option').click();
    expect(app.state.quizAnswers).toEqual(before);
    reject(new Error('Stubbed failure'));
    await flush();
    expect(app.state.submitting).toBe(false);
    expect(app.canSubmit()).toBe(true);
    expect(el('submitError').style.display).toBe('block');
    w.fetch.mockResolvedValue({ json: async () => ({ status: 'success' }) });
    click('classroomSubmitBtn');
    await flush();
    expect(app.state.quizSubmitted).toBe(true);
    expect(el('submitError').style.display).toBe('none');
  });
  test.each(['reset', 'switch'])('late success and failure after %s cannot mark the new run submitted', async action => {
    for (const outcome of ['success', 'failure']) {
      selectDifficulty(mode);
      readyToSubmit();
      let resolve, reject;
      w.fetch.mockImplementation(() => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
      click('classroomSubmitBtn');
      if (action === 'reset') app.executeReset();
      else selectDifficulty(mode === 'practice' ? 'challenge' : 'practice');
      if (outcome === 'success') resolve({ json: async () => ({ status: 'success' }) });
      else reject(new Error('Old request failed'));
      await flush();
      advance(10000);
      assertFresh();
    }
  });
});
