/** @jest-environment jsdom */
"use strict";
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const builder = require('../index.cjs');
const F = require('../assessmentFidelity.cjs');
const Q = require('../assessmentQuality.cjs');
const ROOT = path.resolve(__dirname, '../../../..');
const SLUG = 'renewable-and-nonrenewable-resources';
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const source = read(`lesson-sources/lesson_${SLUG}.html`);
const html = builder.buildLesson({ slug: SLUG, target: 'v2', write: false }).bytes;
const payload = JSON.parse(read(`platform/functions/src/scripts/assessments/${SLUG}.r2.json`));
const byId = id => document.getElementById(id);
function mount(assigned = false, outcome = () => Promise.resolve({ ok: true })) {
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  Element.prototype.scrollIntoView = jest.fn(function(options) {
    return { id: this.id, options, model: byId('el-think-model').classList.contains('show'),
      status: byId('el-submit-status').textContent, headline: byId('el-score-num').textContent,
      message: byId('el-score-msg').textContent };
  });
  window.matchMedia = jest.fn(() => ({ matches: false }));
  window.lyfelabz = { lessonQuiz: { hasAssignmentContext: () => assigned, autosave: jest.fn(), finalize: jest.fn(outcome) } };
  const at = html.indexOf('function elSubmitQuiz(');
  const script = html.slice(html.lastIndexOf('<script>', at) + 8, html.indexOf('</script>', at));
  return new Function(script + '\nreturn { select: elSelectAnswer, submit: elSubmitQuiz, reset: elResetQuiz, build: elBuildQuiz, refresh: elRefreshSubmitState, questions: elQuizQuestions, state: elQuizState };')();
}
function answer(q, text = 'My claim uses Evidence A and DEP’s program finding, with a limitation.') {
  q.questions.forEach((item, i) => q.select(i, item.correct));
  byId('el-thinking').value = text;
  q.refresh();
}
function landing() { return Element.prototype.scrollIntoView.mock.results.at(-1).value; }
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
afterEach(() => { document.body.innerHTML = ''; delete window.lyfelabz; jest.useRealTimers(); });

test('one required writer, exact town task, evidence support, and optional scaffolds', () => {
  mount();
  expect(document.querySelectorAll('textarea')).toHaveLength(1);
  expect(byId('el-thinking').required).toBe(true);
  expect(document.querySelector('label[for="el-thinking"]').textContent).toContain('argument');
  expect(byId('argument-prompt').textContent).toContain('A town expects its population to grow');
  expect(byId('argument-prompt').textContent).toContain('Cite at least two specific pieces of evidence');
  expect(byId('argument-prompt').textContent).toContain('State one thing this evidence cannot establish');
  expect(byId('el-think').textContent).toContain('This supports my claim because…');
  expect(byId('el-think').textContent).toContain('Use enough evidence and reasoning to fully support your claim.');
});

test.each([
  ['1990', '7,335,650', '1,423.8', '194.09'],
  ['2000', '8,008,278', '1,240.4', '154.89'],
  ['2010', '8,175,133', '1,039.0', '127.09'],
])('Evidence A preserves the same %s values in table and mobile record', (year, population, total, average) => {
  mount();
  const row = [...document.querySelectorAll('tbody tr')].find(x => x.textContent.includes(year));
  const record = [...document.querySelectorAll('.evidence-records article')].find(x => x.textContent.includes(year));
  for (const value of [population, total, average]) { expect(row.textContent).toContain(value); expect(record.textContent).toContain(value); }
  for (const unit of ['people', 'million gallons/day', 'gallons/person/day']) { expect(document.querySelector('thead').textContent).toContain(unit); expect(record.textContent).toContain(unit); }
});

test('responsive evidence uses mutually exclusive display, real table headers, and no decorative graph', () => {
  mount();
  expect(source).toContain('.evidence-records { display: none; }');
  expect(source).toMatch(/@media \(max-width: 680px\) \{\s*\.evidence-table \{ display: none; \}\s*\.evidence-records \{ display: block; \}/);
  expect(document.querySelectorAll('th[scope="col"]')).toHaveLength(4);
  expect(document.querySelectorAll('th[scope="row"]')).toHaveLength(3);
  expect(byId('evidence').querySelector('svg, canvas, img')).toBeNull();
});

test('the central model has units, rounded example, conditional population logic, and aggregate-average caveat', () => {
  mount(); const text = byId('impact').textContent;
  for (const value of ['people × gallons/person/day = gallons/day', '8,175,133 × 127.09 ≈ 1,039,000,000 gallons/day', 'if average use stays the same', 'can offset population growth', 'not identical individual behavior', 'not identical quantities']) expect(text).toContain(value);
});

test('historical intervention and causal limits are source-linked', () => {
  mount(); const text = byId('evidence-c').textContent;
  for (const value of ['1994–1997', '1.3 million toilets', '90 million gallons/day', 'DEP-reported', 'did not necessarily cause the entire', 'Other conservation', 'water quality', 'ecosystem recovery', 'reservoir increases', 'identical future savings']) expect(text).toContain(value);
  expect(byId('evidence-a').querySelector('a').href).toContain('ia2d-e54m');
  expect(byId('evidence-c').querySelector('a').href).toContain('water-conservation-report-annual-update-2011.pdf');
  expect(byId('evidence-b').textContent).toContain('does not itself measure water quality');
});

test('current instruction corrects classification, fossil/nuclear, and local renewability science', () => {
  mount();
  expect(byId('explore').textContent).toContain('does not mean unlimited local availability');
  expect(byId('journey').textContent).toContain('Ancient land plants');
  expect(byId('journey').textContent).toContain('microscopic aquatic organisms');
  expect(byId('journey').textContent).toContain('Uranium is not a fossil fuel');
  expect(byId('storage').textContent).toContain('does not make tomorrow’s sunlight arrive faster or slower');
  expect(source).not.toMatch(/replaced as fast as we use|race between two rates|single idea.*sorts every resource|arrives free|never runs out|Bloom|DOK [1-4]/i);
});

test('seven evidence reasoning steps precede one collected argument and no answer is revealed initially', () => {
  mount();
  expect(byId('evidence').querySelectorAll('ol li')).toHaveLength(7);
  expect(source.indexOf('Investigate before making a claim')).toBeLessThan(source.indexOf('id="el-think"'));
  expect(byId('el-think-model').classList.contains('show')).toBe(false);
  expect(byId('explain').querySelector('.talk-card').textContent).toContain('Would you keep or revise your original prediction?');
  expect(byId('el-think-model').textContent).not.toContain('rate of replacement');
});

test('Educator Mode distinguishes prerequisite, performance, method, and enrichment with native disclosures', () => {
  mount();
  expect(byId('educator-toggle')).toBeNull();
  const notes = [...document.querySelectorAll('details.edu-note')];
  expect(notes.length).toBeGreaterThan(5);
  expect(notes.every(n => n.firstElementChild.tagName === 'SUMMARY')).toBe(true);
  const text = notes.map(n => n.textContent).join(' ');
  for (const value of ['7.ESS.3.4', 'prerequisite', 'requires teacher review', 'aggregate averages', 'frozen values', 'approximate program savings', 'Optional transfer']) expect(text).toContain(value);
});

test('selector native buttons synchronize pressed state without taking focus', () => {
  mount();
  const buttons = [...document.querySelectorAll('.source-buttons button')];
  expect(buttons).toHaveLength(5);
  expect(document.querySelector('.source-buttons').getAttribute('aria-label')).toBe('Renewable energy sources');
  const at = html.indexOf('const layerData =');
  const script = html.slice(at, html.indexOf('</script>', at));
  const select = new Function(script + '\nreturn layerClick;')();
  buttons[3].focus(); select(4);
  expect(buttons.filter(b => b.getAttribute('aria-pressed') === 'true')).toEqual([buttons[3]]);
  expect(document.activeElement).toBe(buttons[3]);
  expect(byId('ld-body').textContent).toContain('faster than regrowth');
});

test('glossary uses native disclosures and every local link resolves', () => {
  mount();
  expect(document.querySelectorAll('details.glossary-card')).toHaveLength(9);
  for (const link of document.querySelectorAll('a[href^="#"]')) expect(byId(link.getAttribute('href').slice(1))).not.toBeNull();
  expect(document.querySelector('details.glossary-card button')).toBeNull();
});

test('quiz uses labeled radio groups and wrapping keyboard navigation', () => {
  const q = mount();
  expect(document.querySelectorAll('[role="radiogroup"]')).toHaveLength(10);
  const radio = byId('el-q-0-0'); radio.focus();
  radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  expect(q.state.selected[0]).toBe(3);
  expect(byId('el-q-0-3').getAttribute('aria-checked')).toBe('true');
  expect(document.activeElement).toBe(byId('el-q-0-3'));
  expect(radio.tabIndex).toBe(-1);
});

test('10000 characters are accepted intact at finalize', async () => {
  const q = mount(true); answer(q, 'x'.repeat(10000)); q.submit(); await settle();
  expect(byId('el-thinking').maxLength).toBe(10000);
  expect(window.lyfelabz.lessonQuiz.finalize.mock.calls[0][1].writtenResponse).toHaveLength(10000);
});

test('over-limit programmatic input is blocked without truncation, including whitespace', () => {
  const q = mount(true); const text = 'x'.repeat(10000) + ' '; answer(q, text); q.submit();
  expect(byId('el-thinking').value).toBe(text);
  expect(byId('el-submit-btn').disabled).toBe(true);
  expect(byId('thinking-error').textContent).toContain('all your text remains here');
  expect(document.activeElement).toBe(byId('el-thinking'));
  expect(window.lyfelabz.lessonQuiz.finalize).not.toHaveBeenCalled();
  expect(q.state.submitted).toBe(false);
});

test('blank writing and missing selections cannot submit', () => {
  const q = mount(true); answer(q, '  '); q.submit();
  expect(q.state.submitted).toBe(false);
  byId('el-thinking').value = 'A claim'; q.state.selected[0] = null; q.submit();
  expect(window.lyfelabz.lessonQuiz.finalize).not.toHaveBeenCalled();
});

test('unfinished writing is not claimed or sent as autosaved', () => {
  const q = mount(true); answer(q);
  for (const args of window.lyfelabz.lessonQuiz.autosave.mock.calls) expect(args).toHaveLength(1);
  expect(byId('thinking-help').textContent).toContain('not autosaved');
});

test('pending assigned submission preserves text, prevents reset and duplicate finalize, and hides model', async () => {
  const q = mount(true, () => new Promise(() => {})); answer(q); const text = byId('el-thinking').value;
  q.submit(); q.submit(); q.reset(); q.build(); await settle();
  expect(window.lyfelabz.lessonQuiz.finalize).toHaveBeenCalledTimes(1);
  expect(byId('el-thinking').value).toBe(text);
  expect(byId('el-thinking').readOnly).toBe(true);
  expect(byId('el-thinking').disabled).toBe(false);
  expect(byId('el-reset-btn').hidden).toBe(true);
  expect(byId('el-think-model').classList.contains('show')).toBe(false);
  expect(byId('back-to-assignments').classList.contains('show')).toBe(true);
  expect(landing()).toMatchObject({ id: 'el-score', model: false, status: 'Submitting...' });
  expect(landing().message).not.toContain('was submitted');
});

test('success confirms teacher review, does not claim mastery, and never jumps on a perfect score', async () => {
  jest.useFakeTimers(); const q = mount(true); answer(q); q.submit(); await settle(); jest.runAllTimers();
  expect(byId('el-score-msg').textContent).toBe('Knowledge and data check: 10/10. Your argument was submitted for teacher review.');
  expect(byId('el-think-model').classList.contains('show')).toBe(true);
  expect(byId('el-submit-status').textContent).toContain('not been automatically evaluated');
  expect(landing()).toMatchObject({ id: 'el-score', model: true, message: byId('el-score-msg').textContent, status: byId('el-submit-status').textContent });
  expect(Element.prototype.scrollIntoView.mock.results.every(r => r.value.id === 'el-score')).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  expect(document.activeElement).toBe(byId('el-score'));
  q.reset(); expect(q.state.submitted).toBe(true);
  expect(source).not.toContain('continueTimer');
});

test.each([
  ['refusal', () => Promise.resolve({ ok: false, message: '<img src=x onerror=alert(1)>' })],
  ['null', () => Promise.resolve(null)],
  ['invalid result', () => Promise.resolve({})],
  ['rejection', () => Promise.reject(new Error('network'))],
  ['synchronous failure', () => { throw new Error('adapter'); }],
])('%s is unconfirmed, preserves the response, and blocks assigned reset', async (_name, outcome) => {
  const q = mount(true, outcome); answer(q); const text = byId('el-thinking').value;
  q.submit(); await settle(); q.reset();
  expect(byId('el-score-num').textContent).toBe('Submission unconfirmed');
  expect(byId('el-score-msg').textContent).toBe('Submission could not be confirmed. Your response remains on this page.');
  expect(byId('el-thinking').value).toBe(text);
  expect(byId('el-think-model').classList.contains('show')).toBe(false);
  expect(byId('el-score').querySelector('img')).toBeNull();
  expect(q.state.submitted).toBe(true);
  expect(landing()).toMatchObject({ id: 'el-score', model: false, headline: 'Submission unconfirmed', status: byId('el-submit-status').textContent });
  expect(document.activeElement).toBe(byId('el-score'));
});

test('unsaved practice shows model, uses truthful wording, and may reset', () => {
  const q = mount(); answer(q); q.submit();
  expect(window.lyfelabz.lessonQuiz.finalize).not.toHaveBeenCalled();
  expect(byId('el-submit-status').textContent).toContain('Practice complete. Your score and argument were not submitted to a teacher.');
  expect(byId('el-think-model').classList.contains('show')).toBe(true);
  expect(landing()).toMatchObject({ id: 'el-score', model: true, status: byId('el-submit-status').textContent });
  expect(landing().status).toContain('Exploration mode');
  expect(document.activeElement).toBe(byId('el-score'));
  q.reset(); expect(byId('el-thinking').value).toBe('');
  expect(byId('el-thinking').readOnly).toBe(false); expect(q.state.submitted).toBe(false);
});

test('submitted radios retain checked selections, announce correct answers in text, and reject changes', () => {
  const q = mount(); answer(q); q.submit(); const prior = q.state.selected[0]; q.select(0, (prior + 1) % 4);
  expect(q.state.selected[0]).toBe(prior);
  expect(byId(`el-q-0-${prior}`).getAttribute('aria-checked')).toBe('true');
  expect(byId(`el-q-0-${prior}`).getAttribute('aria-disabled')).toBe('true');
  expect(byId('el-feedback-0').textContent).toContain('Your answer: B. Correct answer: B.');
});

test('reduced motion requests instant result scrolling and stops decorative animation in source', () => {
  const q = mount(); window.matchMedia = () => ({ matches: true }); answer(q); q.submit();
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
  expect(source).toContain("if (!motion.matches) frame = requestAnimationFrame(draw)");
  expect(source).toContain("motion.addEventListener('change', syncMotion)");
  expect(byId('stars').getAttribute('aria-hidden')).toBe('true');
  expect(source).toContain('animation: none !important');
});

test('r1 stays byte immutable and r2 fidelity and answer-position quality pass', () => {
  const bytes = fs.readFileSync(path.join(ROOT, `platform/functions/src/scripts/assessments/${SLUG}.r1.json`));
  expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe('1360acbf31cb2aaacfb90e335516e2337e7256526e031db25e6d516abbef1769');
  expect(payload.items).toHaveLength(10);
  expect(payload.items.every(item => item.itemType === 'singleChoice' && item.options.length === 4)).toBe(true);
  expect(F.checkFidelity(SLUG, payload, F.extractCanonicalQuiz(html, SLUG))).toEqual([]);
  expect(Q.evaluatePayload(payload).hard).toEqual([]);
  expect(Q.evaluatePayload(payload).warnings).toEqual([]);
});

test.each([1, 2])('r%s route declares and preserves its quiz with current instruction and writer', revision => {
  const rendition = read(`app/lessons/assessment-revisions/lesson_${SLUG}__r${revision}.html`);
  const expected = JSON.parse(read(`platform/functions/src/scripts/assessments/${SLUG}.r${revision}.json`));
  expect(rendition).toContain(`"assessmentRevisionId":"assessment_${SLUG}__r${revision}"`);
  expect(F.checkFidelity(SLUG, expected, F.extractCanonicalQuiz(rendition, SLUG))).toEqual([]);
  expect(rendition).toContain('A town expects its population to grow');
  const routes = JSON.parse(read('app/src/assignments/studentList/assessment-revision-paths.json'));
  expect(routes.lessons[SLUG][`assessment_${SLUG}__r${revision}`]).toBe(`/app/lessons/assessment-revisions/lesson_${SLUG}__r${revision}.html`);
});


test.each([true, false])('delayed success positions completed presentation for perfect=%s', async perfect => {
  let resolve; const q = mount(true, () => new Promise(r => { resolve = r; })); answer(q);
  if (!perfect) q.select(0, (q.questions[0].correct + 1) % 4);
  q.submit(); q.submit(); await settle();
  expect(landing()).toMatchObject({ model: false, status: 'Submitting...' });
  resolve({ ok: true }); await settle();
  expect(landing()).toMatchObject({ id: 'el-score', model: true, headline: perfect ? '10/10' : '9/10',
    status: 'Submitted to your teacher. The argument has not been automatically evaluated.',
    options: { behavior: 'smooth', block: 'start' } });
  expect(byId('el-thinking').readOnly).toBe(true);
  expect(byId('el-reset-btn').hidden).toBe(true);
  expect(window.lyfelabz.lessonQuiz.finalize).toHaveBeenCalledTimes(1);
});

test('fossil reference presents two ordered formation pathways, not one generic line', () => {
  mount(); const paths = document.querySelector('.fossil-pathways');
  const lists = paths.querySelectorAll('ol'); expect(lists).toHaveLength(2);
  expect([...lists[0].children].map(x => x.textContent)).toEqual(['Ancient land plants', 'Burial and compaction', 'Geologic change over millions of years', 'Coal']);
  expect([...lists[1].children].map(x => x.textContent)).toEqual(['Remains of microscopic aquatic organisms', 'Sediment burial', 'Heating and geologic change over millions of years', 'Petroleum and natural gas']);
  expect(lists[0].firstElementChild.textContent).not.toBe(lists[1].firstElementChild.textContent);
  expect(paths.textContent).toContain('millions of years');
  expect(paths.textContent).toContain('Natural gas can also form in other ways.');
  expect(paths.textContent).not.toContain('Simplified pathways');
  // Endpoints identify each pathway; no in-row label repeats a product before its process.
  expect(paths.querySelectorAll('h3, h4')).toHaveLength(0);
  expect(lists[0].getAttribute('aria-label')).toBe('Coal formation');
  const nuclear = document.querySelector('.nuclear-line').textContent;
  expect(nuclear).toContain('nonrenewable');
  expect(nuclear).toContain('not a fossil fuel');
  expect(byId('journey').querySelector('.fossil-pathways [tabindex], .fossil-pathways button, .fossil-pathways a')).toBeNull();
  expect(document.querySelector('#journey').textContent).not.toContain('Ancient organic matter → burial and geologic change → fossil fuels');
});

test('opening shows the lesson, driving question, and coal/solar scene together', () => {
  mount();
  const hero = document.querySelector('header.hero');
  expect(hero.querySelector('h1').textContent).toBe('Renewable and Nonrenewable Resources');
  expect(hero.querySelector('.dq-text').textContent).toBe('As a city grows, must its resource use and environmental impacts grow too? How could technology change what happens?');
  const scene = hero.querySelector('figure svg[role="img"]');
  expect(scene.getAttribute('aria-label')).toMatch(/coal plant burns coal fuel.*solar panels convert incoming sunlight/);
  expect(hero.querySelector('.hero-id h1')).not.toBeNull();
  expect(hero.querySelector('.hero-copy').children).toHaveLength(1);
  expect(hero.querySelector('.hero-copy > .driving-question')).not.toBeNull();
  expect(document.querySelector('main > button')).toBeNull();
});

test('vocabulary uses the canonical intro, chevrons, and one open card at a time', async () => {
  mount();
  expect(byId('vocab').querySelector('.section-desc').textContent).toBe('Choose a card to see what each word means.');
  const cards = [...document.querySelectorAll('details.glossary-card')];
  expect(cards.every(c => c.querySelector('summary .gc-chev[aria-hidden="true"]'))).toBe(true);
  const at = html.indexOf('const layerData =');
  new Function(html.slice(at, html.indexOf('</script>', at)))();
  const toggled = () => new Promise(resolve => setTimeout(resolve, 0));
  cards[0].open = true; await toggled();
  cards[4].open = true; await toggled();
  expect(cards.filter(c => c.open)).toEqual([cards[4]]);
});

test('lesson source contains no em dashes', () => {
  expect(source).not.toContain('\u2014');
});

test('Evidence A check reveal reports 1990 to 2010 changes calculated from the table, not new data', () => {
  mount();
  const cells = year => [...[...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(year)).querySelectorAll('td')].map(td => Number(td.textContent.replace(/,/g, '')));
  const [p90, a90, t90] = cells('1990'); const [p10, a10, t10] = cells('2010');
  const pct = (from, to) => (Math.abs(to - from) / from * 100).toFixed(1);
  const reveal = byId('evidence-a').querySelector('details.reveal').textContent;
  expect(reveal).toContain(`up about ${pct(p90, p10)}%`);
  expect(reveal).toContain(`down about ${pct(a90, a10)}%`);
  expect(reveal).toContain(`down about ${pct(t90, t10)}%`);
  expect([pct(p90, p10), pct(a90, a10), pct(t90, t10)]).toEqual(['11.4', '34.5', '27.0']);
  expect(reveal).toContain('do not show what happened in between');
});

test('student controls are labeled native controls with visible state, and writing requirements are not controls', () => {
  mount();
  for (const el of document.querySelectorAll('main button, main summary, main textarea')) {
    expect((el.getAttribute('aria-label') || el.textContent).trim()).not.toBe('');
  }
  expect(byId('into').querySelector('.do-this').textContent).toBe('Choose a source.');
  expect([...document.querySelectorAll('.reasoning-check .do-this')].map(x => x.textContent)).toEqual(['Select one.', 'Select one.']);
  const at = html.indexOf('const layerData =');
  new Function(html.slice(at, html.indexOf('</script>', at)))();
  const choices = [...document.querySelectorAll('.reasoning-check')[0].querySelectorAll('button')];
  expect(choices.every(b => b.getAttribute('aria-pressed') === 'false')).toBe(true);
  choices[1].click();
  expect(choices.map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  expect(choices[1].classList.contains('choice-wrong')).toBe(true);
  expect(byId('argument-prompt').querySelector('input, button, [role="checkbox"]')).toBeNull();
  expect(byId('el-submit-btn').hasAttribute('aria-describedby')).toBe(false);
  expect(byId('submit-hint')).toBeNull();
});

test('final cleanup: no jump links into the writing task or back to the evidence, and explicit Turn & Talk moments', () => {
  mount();
  expect(document.querySelector('a[href="#el-think"]')).toBeNull();
  expect(byId('el-think').querySelector('a[href="#evidence"]')).toBeNull();
  expect(byId('el-think').textContent).not.toMatch(/Any defensible claim is fine|no required length/);
  expect(document.querySelector('.think-intro')).toBeNull();
  expect(byId('el-think').firstElementChild.textContent).toContain('Show Your Thinking');
  expect(byId('el-think').querySelector('.think-grid, .think-brief, .think-write')).toBeNull();
  const talk = byId('explain').querySelector('.talk-card');
  expect(talk.querySelector('.predict-label').textContent).toBe('Think');
  expect(talk.querySelector('button, a, input, textarea, details, [tabindex]')).toBeNull();
  expect(byId('explain').textContent).not.toContain('Which uncertainty remains?');
  expect(byId('el-think').querySelector('details.reveal:not([open]) > summary').textContent).toBe('Sentence starters (optional)');
});

test('individual-first: thinking checkpoints work for one student alone and are not collected', () => {
  mount();
  const visible = document.querySelector('main').textContent;
  for (const phrase of [/turn\s*&\s*talk/i, /with a partner/i, /tell a partner/i, /your partner/i, /with your group/i, /as a class/i, /classmate/i, /discuss with/i, /talk it through/i]) {
    expect(visible).not.toMatch(phrase);
  }
  const checkpoints = [...document.querySelectorAll('.predict-card')];
  expect(checkpoints.map(c => c.closest('section').id)).toEqual(['engage', 'explain']);
  for (const card of checkpoints) {
    expect(card.querySelector('.predict-label').textContent).toBe('Think');
    expect(card.querySelector('button, a, input, textarea, select, details, [tabindex]')).toBeNull();
  }
  expect(byId('explain').textContent).toContain('What evidence changed or strengthened your thinking?');
  expect(document.querySelectorAll('textarea')).toHaveLength(1);
});

test('Show Your Thinking uses the single-column LyfeLabz pattern and keeps the full four-part task', () => {
  mount();
  const box = byId('el-think');
  expect(box.querySelector('.think-grid, .think-brief, .think-write, .think-task, .think-intro, .think-lead')).toBeNull();
  const order = [...box.children].map(el => el.id || el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : ''));
  expect(order.slice(0, 7)).toEqual(['h3.think-eyebrow', 'argument-prompt', 'p.think-sub', 'details.reveal', 'label', 'thinking-help', 'el-thinking']);
  expect(box.querySelector('details.reveal').open).toBe(false);
  expect([...byId('argument-prompt').querySelectorAll('.think-req')].map(r => r.textContent)).toEqual([
    'Explain what happened to NYC’s population, average water use per person, and total water demand between 1990 and 2010.',
    'Cite at least two specific pieces of evidence, including the historical data and DEP’s finding about the replacement program.',
    'Explain how the evidence supports your claim.',
    'State one thing this evidence cannot establish about the town.',
  ]);
  expect(byId('thinking-help').textContent).toBe('Your work is not autosaved. Keep this page open until your submission is confirmed.');
  expect(byId('thinking-help').textContent).not.toMatch(/10,000|saved automatically|will be saved/);
  expect(byId('thinking-count').textContent).toBe('0 / 10,000 characters');
  expect(document.querySelector('label[for="el-thinking"]').textContent).toBe('Your argument');
});

test('Educator Mode: the lesson only consumes the homepage state and offers no local control or shortcut', () => {
  mount();
  expect(byId('educator-toggle')).toBeNull();
  expect(document.querySelector('footer').textContent).not.toMatch(/For Educators|Educator Mode/);
  expect(document.querySelector('.edu-footer, [class*="edu-toggle"], [id*="edu-toggle"]')).toBeNull();
  expect(source).not.toMatch(/(?:setItem|removeItem)\(\s*['"]lyfelabz-ls['"]/);
  expect(source).not.toMatch(/toggleEducator|EDUCATOR MODE HOTKEY|e\.key\.toLowerCase\(\) === 'i'/);
  expect(source).toContain(".edu-note { display: none; }");
  expect(source).toContain("body.ls-active details.edu-note { display: block;");
  const init = "try { if (sessionStorage.getItem('lyfelabz-ls') === 'on') document.body.classList.add('ls-active'); } catch (_) {}";
  expect(source).toContain(init);
  const canvasAt = html.indexOf("var canvas = document.getElementById('stars');");
  const pageScript = html.slice(html.lastIndexOf('<script>', canvasAt) + 8, html.indexOf('</script>', canvasAt));
  HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillRect() {} });
  window.matchMedia = () => ({ matches: true, addEventListener() {} });
  for (const state of [null, 'on']) {
    document.body.classList.remove('ls-active');
    window.sessionStorage.clear();
    if (state) window.sessionStorage.setItem('lyfelabz-ls', state);
    new Function(init)();
    new Function(pageScript)();
    const before = document.body.classList.contains('ls-active');
    expect(before).toBe(state === 'on');
    for (const mod of [{ metaKey: true }, { altKey: true }]) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, ...mod }));
    }
    expect(document.body.classList.contains('ls-active')).toBe(before);
    expect(window.sessionStorage.getItem('lyfelabz-ls')).toBe(state);
  }
  expect(document.querySelectorAll('details.edu-note').length).toBeGreaterThan(5);
  expect(document.querySelectorAll('textarea')).toHaveLength(1);
  expect(document.querySelectorAll('[role="radiogroup"]')).toHaveLength(10);
});
