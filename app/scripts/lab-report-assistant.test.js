/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'tool_lab-report-assistant.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/lab-report-assistant.js'), 'utf8');
const KEY = 'lyfelabz:lab-report-assistant:v1';
const titles = ['Investigation Question + Scientific Background', 'Variables', 'Hypothesis', 'Materials', 'Procedure', 'Data & Observations', 'Discussion', 'Review & Export'];
const pills = ['Question + Background', 'Variables', 'Hypothesis', 'Materials', 'Procedure', 'Data', 'Discussion', 'Review & Export'];
const discussionLabels = ['Claim', 'Evidence', 'Reasoning', 'Hypothesis Supported?', 'Challenges & Improvements', 'Future Experiments'];
let dom, w;
const el = id => w.document.getElementById(id);
const click = id => el(id).click();
const jump = step => el('step-links').children[step].click();
function input(key, text) {
  const element = el(`field-${key}`);
  element.value = text;
  element.dispatchEvent(new w.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function createTable(columns = 2, rows = 2) {
  const selects = w.document.querySelectorAll('.table-size-controls select');
  selects[0].value = String(columns); selects[0].dispatchEvent(new w.Event('change', { bubbles: true }));
  selects[1].value = String(rows); selects[1].dispatchEvent(new w.Event('change', { bubbles: true }));
  w.document.querySelector('.table-size-controls button').click();
}
function tableInput(row, column, text) {
  const element = w.document.querySelector(`[data-table-cell="${row}:${column}"]`);
  element.value = text;
  element.dispatchEvent(new w.Event('input', { bubbles: true }));
}
function mount(saved, setup = () => {}) {
  dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lyfelabz.invalid/tool_lab-report-assistant.html' });
  w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = jest.fn();
  w.confirm = jest.fn(() => false);
  w.print = jest.fn();
  w.speechSynthesis = { speak: jest.fn(), cancel: jest.fn() };
  w.SpeechSynthesisUtterance = function(text) { this.text = text; };
  if (saved !== undefined) w.localStorage.setItem(KEY, saved);
  setup(w);
  w.eval(script);
}
beforeEach(() => mount());
afterEach(() => { dom.window.close(); jest.restoreAllMocks(); });
function remount(setup) {
  const saved = w.localStorage.getItem(KEY);
  dom.window.close(); mount(saved === null ? undefined : saved, setup);
}
function fillAllExcept(excluded = []) {
  input('labTitle', 'A lab title'); input('studentName', 'A student');
  for (let step = 0; step < 7; step++) {
    jump(step);
    for (const element of w.document.querySelectorAll('#step-content textarea, #step-content select')) {
      if (!element.name) continue;
      if (!excluded.includes(element.name)) input(element.name, element.tagName === 'SELECT' ? 'Supported by the results' : `Work for ${element.name}`);
    }
    if (step === 5 && !excluded.includes('quantitativeData')) {
      createTable(); input('tableTitle', 'Trial results'); tableInput(0, 0, 'Trial'); tableInput(1, 0, 'Trial 1');
    }
  }
}

test('page renders without a framework or auth and is included in both hosting artifacts', () => {
  expect(w.document.title).toBe('LyfeLabz | Lab Report Assistant');
  expect(el('local-notice').textContent).toBe('One active report is saved on this browser and device only. It does not sync or submit to your teacher. Download your work before starting over.');
  expect(html).not.toContain('On a shared device, other people using this browser can see it.');
  expect(el('speech-status').textContent).toBe('');
  expect(el('save-status').textContent).toBe('');
  expect(w.getComputedStyle(el('speech-status')).display).toBe('none');
  expect(w.getComputedStyle(el('save-status')).display).toBe('none');
  expect(w.document.querySelector('.hero-badge.ct-tool-pill').textContent).toBe('TOOL');
  expect(fs.existsSync(path.join(root, 'tool_lab-report-assistant.html'))).toBe(true);
  expect(fs.existsSync(path.join(root, 'extension_lab-report-assistant.html'))).toBe(false);
  expect(el('step-title').textContent).toBe(titles[0]);
  expect(html).toContain('src="assets/lab-report-assistant.js"');
  expect(html).toContain('The report editor did not load.');
  expect(el('step-content').textContent).not.toContain('did not load');
  const publicManifest = require('../../scripts/marketing-hosting/public-files.json');
  expect(publicManifest.files).toEqual(expect.arrayContaining(['tool_lab-report-assistant.html', 'assets/lab-report-assistant.js']));
  const { collectApprovedCopies } = require('../../scripts/app-hosting/build.cjs');
  expect(collectApprovedCopies(root).map(item => item.destination)).toEqual(expect.arrayContaining(['tool_lab-report-assistant.html', 'assets/lab-report-assistant.js']));
});

test.each(['lesson-sources/lesson_conducting-experiments.html', 'lesson_conducting-experiments.html', 'app/lessons/lesson_conducting-experiments.html', 'lesson-sources/variants/conducting-experiments.reading-adapted.html'])('%s links More Learning to the reusable tool', filename => {
  const lesson = new JSDOM(fs.readFileSync(path.join(root, filename), 'utf8'));
  const link = lesson.window.document.querySelector('#continue a.cont-card.tool');
  expect(link.getAttribute('href')).toBe('/tool_lab-report-assistant.html');
  expect(link.textContent).toContain('Lab Report Assistant');
  expect(link.querySelector('.cont-cat').textContent).toBe('Tool');
  lesson.window.close();
});

test('Tool uses the shared neutral identity across hub, hero, and current More Learning cards', () => {
  const tokens = fs.readFileSync(path.join(root, 'content-type-tool.css'), 'utf8');
  expect(tokens).toContain('--ct-tool: #f1f5f9;');
  expect(tokens).toContain('--ct-tool-muted: #cbd5e1;');
  expect(tokens).toContain('--ct-tool-rgb: 241, 245, 249;');
  expect(tokens).not.toMatch(/2dd4bf|99f6e4|0d9488|45, 212, 191/i);
  expect(tokens).toMatch(/\.ct-tool-pill\s*\{[^}]*width: max-content;[^}]*border: 1px solid rgba\(var\(--ct-tool-rgb\), 0\.68\);[^}]*background: rgba\(var\(--ct-tool-rgb\), 0\.1\);[^}]*color: var\(--ct-tool\)/);
  expect(tokens).toContain('.high-contrast .ct-tool-pill');
  expect(tokens).toContain('@media (forced-colors: active)');
  expect(html).toContain('href="/content-type-tool.css"');
  expect(html).toContain('<span class="hero-badge ct-tool-pill">TOOL</span>');
  const manifest = require('../../scripts/marketing-hosting/public-files.json');
  expect(manifest.files).toContain('content-type-tool.css');
  const hub = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  expect(hub).toContain('href="/content-type-tool.css"');
  expect(hub).toMatch(/\.ulink\.tool\s*\{[^}]*var\(--ct-tool-rgb\)/);
  expect(hub).toMatch(/\.ulink\.tool\s*\{[^}]*color: var\(--ct-tool\)/);
  expect(hub).toContain('<span class="ulink tool legend-pill">Tool</span>');

  const currentVariant = require('../lessons/variants/manifest.json')
    .filter(entry => entry.lessonSlug === 'conducting-experiments' && entry.variantKey === 'reading-adapted').at(-1);
  const lessons = [
    'lesson-sources/lesson_conducting-experiments.html',
    'lesson-sources/variants/conducting-experiments.reading-adapted.html',
    'lesson_conducting-experiments.html',
    'app/lessons/lesson_conducting-experiments.html',
    currentVariant.path,
  ];
  const prompt = 'Try it yourself: Pick one of your own “Why does that happen?” questions and plan a fair test on paper. Name the independent variable you would change, the dependent variable you would measure, and the controls you would keep the same. Then review your plan: Is there anything else you would need to control to make it a fair test?';
  for (const filename of lessons) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    const lesson = new JSDOM(source);
    const card = lesson.window.document.querySelector('#continue a.cont-card.tool');
    expect(card.getAttribute('href')).toBe('/tool_lab-report-assistant.html');
    expect(card.querySelector('.cont-cat').textContent).toBe('Tool');
    expect(source).toContain('href="/content-type-tool.css"');
    expect(source).toMatch(/\.cont-card\.tool\s*\{[^}]*var\(--ct-tool-rgb\)/);
    expect(source).toMatch(/\.cont-card\.tool::before\s*\{[^}]*var\(--ct-tool\)[^}]*var\(--ct-tool-muted\)/);
    expect(source).toMatch(/\.cont-card\.tool \.cont-cat\s*\{[^}]*var\(--ct-tool\)/);
    for (const state of ['link', 'visited', 'hover', 'focus-visible', 'active']) {
      expect(source).toContain(`.cont-card.tool:${state} .cont-link`);
    }
    expect(source).toMatch(/\.cont-card\.tool:active \.cont-link\s*\{[^}]*var\(--ct-tool-rgb\)/);
    expect(lesson.window.document.querySelector('#continue .continue-intro').textContent).toBe(prompt);
    expect(source).not.toContain('Extension challenge:');
    expect(source).not.toContain('trade plans with a partner');
    lesson.window.close();
  }
});

test('all seven sections and review are reachable with jumps and previous/next; heading receives focus', () => {
  expect([...el('step-links').children].map(button => button.textContent)).toEqual(pills.map((label, index) => `${index + 1}. ${label}`));
  titles.forEach((title, index) => { jump(index); expect(el('step-title').textContent).toBe(title); expect(w.document.activeElement).toBe(el('step-title')); });
  expect(el('next').hidden).toBe(true);
  click('previous'); expect(el('step-title').textContent).toBe('Discussion');
  jump(0); expect(el('previous').disabled).toBe(true);
  click('next'); expect(el('step-title').textContent).toBe('Variables');
});

test('responses, checklist, active step, and accessibility preferences restore after a new page instance', () => {
  input('investigationQuestion', 'How does surface texture affect travel distance?');
  w.document.querySelector('.self-check input').click();
  click('toggle-large'); jump(6);
  input('claim', 'My observed result');
  remount();
  expect(el('step-title').textContent).toBe('Discussion');
  expect(el('save-status').textContent).toBe('');
  expect(el('field-claim').value).toBe('My observed result');
  expect(w.document.documentElement.classList.contains('large-text')).toBe(true);
  jump(0);
  expect(el('field-investigationQuestion').value).toContain('surface texture');
  expect(w.document.querySelector('.self-check input').checked).toBe(true);
  expect(el('report-progress').value).toBe(0); // Required report details are still missing.
});

test.each([[1, 'variables', 'Variables'], [2, 'hypothesis', 'Hypothesis'], [5, 'data', 'Data & Observations'], [7, 'review', 'Review & Export']])
('section %i persists as stable key %s across a new page instance', (index, key, title) => {
  jump(index);
  const saved = JSON.parse(w.localStorage.getItem(KEY));
  expect(saved.activeSection).toBe(key);
  expect(saved).not.toHaveProperty('step');
  remount();
  expect(el('step-title').textContent).toBe(title);
  expect(el('step-links').children[index].getAttribute('aria-current')).toBe('step');
  expect(w.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  expect(saved).not.toHaveProperty('scrollY');
});

test.each([undefined, '', 'retired-section', 5, {}, null])
('missing or invalid saved active section %s starts at Question + Background', activeSection => {
  const report = { version: 1, checkSchema: 2, responses: { investigationQuestion: 'Saved question' }, checks: {}, step: 5 };
  if (activeSection !== undefined) report.activeSection = activeSection;
  dom.window.close(); mount(JSON.stringify(report));
  expect(el('step-title').textContent).toBe(titles[0]);
  expect(el('field-investigationQuestion').value).toBe('Saved question');
});

test('reset cancels safely, then clears only the namespaced report after confirmation', () => {
  input('investigationQuestion', 'Keep this?');
  jump(5);
  w.localStorage.setItem('unrelated-lyfelabz-key', 'preserve');
  click('reset-report');
  expect(w.confirm).toHaveBeenCalledTimes(1);
  expect(w.confirm).toHaveBeenCalledWith('Start over? This permanently clears the active report and checklists in this browser. Download your work first if you want to keep it.');
  expect(el('step-title').textContent).toBe('Data & Observations');
  w.confirm.mockReturnValue(true); click('reset-report');
  expect(el('step-title').textContent).toBe(titles[0]);
  expect(el('field-investigationQuestion').value).toBe('');
  expect(JSON.parse(w.localStorage.getItem(KEY)).activeSection).toBe('question');
  expect(w.localStorage.getItem('unrelated-lyfelabz-key')).toBe('preserve');
  remount(); expect(el('field-investigationQuestion').value).toBe('');
  expect(el('step-title').textContent).toBe(titles[0]);
});

test('Start over alone has restrained destructive styling across display modes', () => {
  expect(el('reset-report').textContent).toBe('Start over');
  expect(el('reset-report').classList.contains('destructive-action')).toBe(true);
  for (const id of ['toggle-large', 'toggle-contrast', 'toggle-starters', 'read-aloud', 'backup-download', 'backup-open']) {
    expect(el(id).classList.contains('destructive-action')).toBe(false);
  }
  expect(html).toMatch(/#reset-report \{ color: #[0-9a-f]+; border-color: #[0-9a-f]+; background: rgba/);
  expect(html).toContain('#reset-report:hover');
  expect(html).toContain('#reset-report:focus-visible');
  expect(html).toContain('.high-contrast #reset-report');
  click('toggle-contrast'); click('toggle-large');
  expect(w.document.body.classList.contains('high-contrast')).toBe(true);
  expect(w.document.documentElement.classList.contains('large-text')).toBe(true);
  expect(el('reset-report').getAttribute('type')).toBe('button');
});

test('main controls end with Start over, recovery copies sit in a collapsed disclosure in the storage panel above, and no Focus Mode', () => {
  const group = el('reset-report').parentElement;
  expect([...group.querySelectorAll('button')].map(item => item.id)).toEqual(['toggle-large', 'toggle-contrast', 'toggle-starters', 'read-aloud', 'reset-report']);
  expect(group.getAttribute('role')).toBe('group');
  const panel = el('recovery-panel');
  expect(panel.tagName).toBe('DETAILS');
  expect(panel.open).toBe(false);
  const storage = el('storage-panel');
  expect(storage.contains(panel)).toBe(true);
  expect(storage.contains(el('cloud-panel'))).toBe(true);
  expect(storage.firstElementChild).toBe(el('cloud-panel'));
  expect(storage.hidden).toBe(false);
  expect(storage.compareDocumentPosition(group) & w.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(w.document.querySelectorAll('#recovery-panel, #backup-download, #backup-open, #backup-file')).toHaveLength(4);
  const ids = [...w.document.querySelectorAll('[id]')].map(item => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(panel.querySelector('summary').textContent).toBe('Backup & Recovery');
  expect(panel.querySelector('.recovery-note').textContent).toBe('Recovery copies help restore your work in LyfeLabz. They are not for submitting your lab report.');
  expect([...panel.querySelectorAll('button')].map(item => [item.id, item.textContent])).toEqual([['backup-download', 'Save recovery copy'], ['backup-open', 'Restore recovery copy']]);
  expect(panel.contains(el('backup-file'))).toBe(true);
  expect(el('toggle-focus')).toBe(null);
  expect(html).not.toMatch(/Focus Mode|focus-mode|backup-controls/);
  expect(script).not.toContain('focus-mode');
  for (const id of ['backup-download', 'backup-open']) {
    expect(el(id).classList.contains('nav-back')).toBe(true);
    expect(el(id).classList.contains('backup-action')).toBe(true);
    expect(el(id).getAttribute('type')).toBe('button');
  }
  // Account status and its button share a wrapping row; the panel border holds in High Contrast.
  for (const rule of ['.cloud-account { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;', '.cloud-panel p { margin: 0; flex: 1 1 16rem; min-width: 0; overflow-wrap: anywhere; }',
    '.cloud-panel .tool-controls { margin: 0; flex: 0 0 auto; }', '.high-contrast .storage-panel']) expect(html).toContain(rule);
  for (const rule of ['.high-contrast .recovery-panel > summary', '.backup-action {', '.backup-action:hover', '.backup-action:focus-visible', '.high-contrast .backup-action {', '.high-contrast .backup-action:hover']) expect(html).toContain(rule);
});

test('an existing report saved with Focus Mode on restores, edits, and keeps its saved shape', () => {
  dom.window.close();
  const existing = { version: 1, checkSchema: 2, responses: { labTitle: 'Ramp lab', investigationQuestion: 'Does ramp height change speed?', materials: 'Ramp, car' },
    checks: {}, quantitativeTable: { title: 'Trials', cells: [['Height (cm)', 'Time (s)'], ['10', '2.1']] }, activeSection: 'materials',
    settings: { focus: true, large: true, contrast: false, starters: false } };
  mount(JSON.stringify(existing));
  expect(w.document.body.className).not.toContain('focus-mode');
  expect(w.document.documentElement.classList.contains('large-text')).toBe(true);
  expect(el('toggle-large').getAttribute('aria-pressed')).toBe('true');
  expect(el('step-title').textContent).toBe(titles[3]);
  expect(el('field-materials').value).toBe('Ramp, car');
  input('materials', 'Ramp, car, stopwatch');
  const saved = JSON.parse(w.localStorage.getItem(KEY));
  expect(saved.settings).toEqual({ focus: true, large: true, contrast: false, starters: false });
  expect(saved.responses.investigationQuestion).toBe('Does ramp height change speed?');
  expect(saved.responses.materials).toBe('Ramp, car, stopwatch');
  expect(saved.quantitativeTable).toEqual(existing.quantitativeTable);
  jump(7); w.dispatchEvent(new w.Event('beforeprint'));
  expect(el('print-report').querySelector('h1').textContent).toBe('Lab Report Assistant');
  expect(el('print-report').textContent).toContain('Ramp, car, stopwatch');
});

test('Review exposes one PDF action using the existing print workflow', () => {
  jump(7);
  expect([...el('review-tools').querySelectorAll('button')].map(button => button.textContent)).toEqual(['Download as PDF']);
  expect(el('review-tools').textContent.trim()).toBe('Download as PDF');
  expect(el('copy-report')).toBe(null);
  expect(el('download-report')).toBe(null);
  expect(html).not.toContain('For a cleaner PDF');
  expect(html).not.toContain('In the print window, choose Save as PDF.');
  expect(html).not.toContain('Print / Save as PDF');
  expect(script).not.toContain('Report copied.');
  expect(script).not.toContain('Report download requested.');
  click('print-button');
  expect(w.print).toHaveBeenCalledTimes(1);
  expect(el('print-report').querySelector('h1').textContent).toBe('Lab Report Assistant');
  expect(el('print-report').querySelector('.draft-purpose')).toBe(null);
});

test('Discussion has exactly six fields with one combined challenge/improvement and a distinct future experiment', () => {
  jump(6);
  expect([...w.document.querySelectorAll('#step-content > .goal-card > .report-field > label')].map(label => label.textContent)).toEqual(discussionLabels);
  expect(w.document.querySelectorAll('#field-challengesImprovements')).toHaveLength(1);
  expect(el('help-challengesImprovements').textContent).toContain('SAME experiment');
  expect(el('help-futureExperiments').textContent).toContain('NEW experiment');
  expect([...el('field-hypothesisOutcome').options].map(option => option.value)).toEqual(['', 'Supported by the results', 'Not supported by the results', 'Partially supported by the results']);
  expect(el('field-hypothesisOutcome').value).toBe('');
  expect(el('help-hypothesisOutcome').textContent).toBe('Compare your results with your original prediction.');
  expect(el('field-hypothesisOutcomeExplanation').tagName).toBe('TEXTAREA');
  expect(el('help-hypothesisOutcomeExplanation').textContent).toBe('Use your results to explain why your hypothesis was supported, not supported, or partially supported.');
  expect(el('field-hypothesisOutcomeExplanation').closest('#field-hypothesisOutcome')).toBe(null);
  expect(el('field-hypothesisOutcomeExplanation').closest('.report-field').parentElement.querySelector('#field-hypothesisOutcome')).not.toBe(null);
  expect(script).not.toContain('You do not need to repeat your scientific reasoning here.');
  expect(w.document.querySelectorAll('#step-content select')).toHaveLength(1);
  expect(html + script).not.toMatch(/conclusion|possible error|possible improvement|sourceOfError|lab_report_assistant_v4|gemini|react|lucide|tailwind/i);
});

test.each(['Supported by the results', 'Not supported by the results', 'Partially supported by the results'])
  ('hypothesis outcome %s requires and preserves a student explanation', async outcome => {
    jump(6);
    const outcomeCheck = () => w.document.querySelector('[data-check-key="discussion:outcome"]');
    expect(outcomeCheck().parentElement.textContent).toBe('I stated whether my hypothesis was supported and explained how my results show that.');
    expect(outcomeCheck().disabled).toBe(true);
    input('hypothesisOutcomeExplanation', 'The measured result matched my prediction.');
    expect(outcomeCheck().disabled).toBe(true);
    jump(7);
    expect(w.document.querySelector('.review-summary').textContent).toContain('Hypothesis Supported?');
    expect(w.document.querySelector('.review-summary').textContent).not.toContain('Hypothesis outcome explanation');
    jump(6); input('hypothesisOutcome', outcome);
    expect(outcomeCheck().disabled).toBe(false);
    outcomeCheck().click();
    expect(outcomeCheck().checked).toBe(true);
    jump(7);
    const report = w.document.querySelector('.report-output');
    expect(report.textContent).toContain(outcome);
    expect(report.textContent).toContain('Explanation:');
    expect(report.textContent).toContain('The measured result matched my prediction.');
    w.dispatchEvent(new w.Event('beforeprint'));
    expect(el('print-report').textContent).toContain(outcome);
    expect(el('print-report').textContent).toContain('The measured result matched my prediction.');
    jump(6); click('read-aloud');
    const spoken = w.speechSynthesis.speak.mock.calls.at(-1)[0].text;
    expect(spoken.indexOf(outcome)).toBeLessThan(spoken.indexOf('The measured result matched my prediction.'));
    remount();
    expect(el('step-title').textContent).toBe('Discussion');
    expect(el('field-hypothesisOutcome').value).toBe(outcome);
    expect(el('field-hypothesisOutcomeExplanation').value).toBe('The measured result matched my prediction.');
    expect(outcomeCheck().checked).toBe(true);
    input('hypothesisOutcomeExplanation', '  ');
    expect(outcomeCheck().disabled).toBe(true);
    expect(JSON.parse(w.localStorage.getItem(KEY)).checks).not.toHaveProperty('discussion:outcome');
    jump(7);
    expect(w.document.querySelector('.review-summary').textContent).toContain('Hypothesis outcome explanation');
    jump(6); input('hypothesisOutcomeExplanation', 'A new explanation.');
    outcomeCheck().click();
    input('hypothesisOutcome', '');
    expect(outcomeCheck().disabled).toBe(true);
    expect(JSON.parse(w.localStorage.getItem(KEY)).checks).not.toHaveProperty('discussion:outcome');
  });

test('an older outcome-only saved report loads with a blank explanation and an unchecked combined self-check', () => {
  const prior = {version: 1, checkSchema: 2, responses: {hypothesisOutcome: 'Supported by the results', claim: 'A claim'}, checks: {'discussion:outcome': true}, activeSection: 'discussion'};
  dom.window.close(); mount(JSON.stringify(prior));
  expect(el('field-hypothesisOutcome').value).toBe('Supported by the results');
  expect(el('field-hypothesisOutcomeExplanation').value).toBe('');
  expect(w.document.querySelector('[data-check-key="discussion:outcome"]').disabled).toBe(true);
  jump(7);
  expect(w.document.querySelector('.review-summary').textContent).toContain('Hypothesis outcome explanation');
  expect(w.document.querySelector('.review-summary').textContent).not.toContain('Hypothesis Supported?');
  expect(w.document.querySelector('.report-output').textContent).toContain('A claim');
});

test('all responses, metadata, and safe literal text appear in review and print in report order', () => {
  input('labTitle', '<img src=x onerror=alert(1)>');
  input('studentName', 'Test Student');
  const responses = [];
  for (let step = 0; step < 7; step++) {
    jump(step);
    for (const element of w.document.querySelectorAll('#step-content textarea, #step-content select')) {
      if (!element.name) continue;
      const text = element.tagName === 'SELECT' ? 'Partially supported by the results' : `Student response: ${element.name}\nSecond line`;
      input(element.name, text); responses.push(text);
    }
    if (step === 5) {
      createTable(); input('tableTitle', 'Student trial data'); tableInput(0, 0, 'Trial'); tableInput(0, 1, 'Distance (cm)');
      tableInput(1, 0, 'Trial 1'); tableInput(1, 1, '50 cm');
      responses.push('Student trial data', 'Trial', 'Distance (cm)', 'Trial 1', '50 cm');
    }
  }
  expect(el('report-progress').value).toBe(7);
  jump(7);
  const review = w.document.querySelector('#step-content .report-output');
  responses.forEach(text => expect(review.textContent).toContain(text));
  expect(review.querySelector('img')).toBe(null);
  expect([...review.querySelectorAll('h4')].map(item => item.textContent)).toEqual(titles.slice(0, 7).map((title, index) => `${index + 1}. ${title}`));
  discussionLabels.forEach(label => expect(review.textContent).toContain(label));
  expect(review.textContent).not.toMatch(/\bDate:/);
  expect(review.textContent).not.toMatch(/Conclusion|Possible Error|Possible Improvement/);
  // Browser print shortcut must also work while editing another step.
  jump(0); input('investigationQuestion', 'Latest unsent edit');
  w.dispatchEvent(new w.Event('beforeprint'));
  expect(el('print-report').textContent).toContain('Latest unsent edit');
  expect([...el('print-report').querySelector('.report-section').querySelectorAll('h3')].map(item => item.textContent)).toEqual(['Investigation Question', 'Scientific Background']);
  expect([...el('print-report').querySelectorAll('.report-section:last-child h3')].map(item => item.textContent)).toEqual([...discussionLabels.slice(0, 4), 'Explanation:', ...discussionLabels.slice(4)]);
  expect([...el('print-report').querySelectorAll('.report-section h2')].map(item => item.textContent)).toEqual(titles.slice(0, 7).map((title, index) => `${index + 1}. ${title}`));
  expect(el('print-report').textContent).not.toMatch(/\bDate:/);
  jump(7); click('print-button'); expect(w.print).toHaveBeenCalledTimes(1);
  expect(html).toContain('body > :not(#print-report) { display: none !important; }');
});

test('print is a compact lab report with intact responses and protected table and field pagination', () => {
  input('labTitle', 'Basketball bounce lab'); input('studentName', 'A student');
  jump(3); input('materials', 'Basketball, meter stick, masking tape');
  jump(4); input('procedure', '1. Drop the ball from 25 cm.\n2. Measure the bounce.');
  jump(5); createTable(3, 3); input('tableTitle', 'Bounce heights');
  tableInput(0, 0, 'Drop height (cm)'); tableInput(0, 1, 'Bounce height (cm)');
  tableInput(1, 0, '25'); tableInput(1, 1, '17');
  input('qualitativeObservations', 'The ball bounced straight up.');
  jump(6); input('claim', 'Higher drops bounced higher.'); input('evidence', 'The 25 cm drop bounced 17 cm.');
  input('reasoning', 'More starting height gave the ball more energy.');
  input('hypothesisOutcome', 'Supported by the results');
  input('hypothesisOutcomeExplanation', 'The measured bounce followed my prediction.');
  jump(7);
  expect(el('review-tools').textContent.trim()).toBe('Download as PDF');
  expect(el('step-intro').textContent).toBe('Review your lab report, then download it as a PDF.');
  w.dispatchEvent(new w.Event('beforeprint'));
  const printed = el('print-report');
  expect(printed.querySelector('h1').textContent).toBe('Lab Report Assistant');
  expect(printed.querySelector('.draft-purpose')).toBe(null);
  expect(printed.textContent).not.toMatch(/Working Draft|organized draft|help you write your lab report/i);
  expect(printed.textContent).not.toContain('For a cleaner PDF');
  expect(printed.textContent).not.toMatch(/Ready to Submit|Finished Report|final submitted report/i);
  expect(printed.textContent).toContain('Basketball, meter stick, masking tape');
  expect(printed.textContent).toContain('1. Drop the ball from 25 cm.\n2. Measure the bounce.');
  expect(printed.textContent).toContain('The ball bounced straight up.');
  expect(printed.querySelectorAll('.report-section')).toHaveLength(7);
  expect([...printed.querySelectorAll('.report-section:last-child .report-entry h3')].map(item => item.textContent))
    .toEqual([...discussionLabels.slice(0, 4), 'Explanation:', ...discussionLabels.slice(4)]);
  expect(printed.textContent).toContain('The measured bounce followed my prediction.');
  const table = printed.querySelector('.data-table');
  expect(table.querySelector('.data-table-title').textContent).toBe('Bounce heights');
  expect(table.querySelector('.data-table-title').colSpan).toBe(3);
  expect(table.querySelectorAll('thead tr:nth-child(2) th')).toHaveLength(3);
  expect(table.querySelector('tbody').textContent).toContain('17');
  expect(html).toContain('#print-report .report-entry { break-inside: avoid-page; page-break-inside: avoid; }');
  expect(html).toContain('#print-report .data-table thead { display: table-header-group; }');
  expect(html).toContain('#print-report .data-table-wrap { overflow: visible; border: 0; break-inside: avoid-page; page-break-inside: avoid; }');
  expect(html).toContain('.response { white-space: pre-wrap; }');
  expect(html).not.toMatch(/break-before:\s*page|page-break-before:\s*always/);
});

test('review flags exact empty and whitespace-only required fields without blocking draft export', () => {
  input('investigationQuestion', '   '); jump(7);
  const missing = w.document.querySelector('.review-summary');
  expect(missing.textContent).toContain('Lab title, Name, Investigation Question, Scientific Background');
  expect(el('print-button').disabled).toBe(false);
  expect(el('step-content').textContent).toContain('18 items are still missing');
  missing.querySelector('button').click();
  expect(el('step-title').textContent).toBe(titles[0]);
});

test('display options, labelled fields, glossary and starters work without replacing student ideas', () => {
  ['large', 'contrast', 'starters'].forEach(key => { click(`toggle-${key}`); expect(el(`toggle-${key}`).getAttribute('aria-pressed')).toBe('true'); });
  expect(w.document.body.className).toContain('high-contrast');
  expect(w.document.body.className).toContain('hide-starters');
  click('toggle-starters');
  input('investigationQuestion', 'Original idea');
  w.document.querySelector('.sentence-starter button').click();
  expect(el('field-investigationQuestion').value).toBe('Original idea\nHow does ... affect ...?');
  jump(1);
  const cards = w.document.querySelectorAll('.glossary-card');
  cards[0].click(); expect(cards[0].getAttribute('aria-expanded')).toBe('true');
  cards[1].click(); expect(cards[0].getAttribute('aria-expanded')).toBe('false');
  expect(cards[1].getAttribute('aria-expanded')).toBe('true');
  for (const input of w.document.querySelectorAll('#step-content textarea, #step-content select')) {
    expect(w.document.querySelector(`label[for="${input.id}"]`)).not.toBe(null);
    expect(el(input.getAttribute('aria-describedby'))).not.toBe(null);
  }
});

test('all seven sections place guidance and vocabulary before writing, then self-check', () => {
  const vocabularyCounts = [0, 3, 1, 0, 0, 2, 3];
  for (let step = 0; step < 7; step++) {
    jump(step);
    const blocks = [...el('step-content').children];
    const guide = blocks.findIndex(block => block.querySelector('h3')?.textContent === 'Think about');
    const vocabulary = blocks.findIndex(block => block.querySelector('h3')?.textContent === 'Vocabulary');
    const firstInput = blocks.findIndex(block => block.querySelector('.report-field input, .report-field textarea, .report-field select'));
    const check = blocks.findIndex(block => block.querySelector('h3')?.textContent === 'Before you move on…');
    expect(guide).toBe(0);
    expect(blocks.flatMap(block => [...block.querySelectorAll('.glossary-card')])).toHaveLength(vocabularyCounts[step]);
    if (vocabularyCounts[step]) expect(guide).toBeLessThan(vocabulary);
    if (vocabularyCounts[step]) expect(vocabulary).toBeLessThan(firstInput);
    else expect(vocabulary).toBe(-1);
    expect(firstInput).toBeLessThan(check);
  }
  jump(1);
  expect([...el('step-content').children].map(block => block.querySelector('h3')?.textContent || 'Writing fields'))
    .toEqual(['Think about', 'Vocabulary', 'Writing fields', 'Before you move on…']);
  expect([...el('step-content').querySelectorAll('.report-field > label')].map(label => label.textContent))
    .toEqual(['Independent Variable', 'Dependent Variable', 'Control Variables']);
});

test('vocabulary directions follow the shared card count', () => {
  jump(2);
  expect(el('step-content').querySelector('.glossary-grid').parentElement.querySelector('p').textContent)
    .toBe('Choose the card to see what this word means.');
  jump(1);
  expect(el('step-content').querySelector('.glossary-grid').parentElement.querySelector('p').textContent)
    .toBe('Choose a card to see what each word means.');
});

test('Data offers a pointer, touch, keyboard, and select-based table size chooser', () => {
  jump(5);
  expect(el('step-content').textContent).not.toContain('Write your own responses. Each field is needed for review.');
  expect(el('field-quantitativeData')).toBe(null);
  expect(el('field-qualitativeObservations').tagName).toBe('TEXTAREA');
  const grid = w.document.querySelector('.table-size-grid');
  expect(grid.querySelectorAll('button')).toHaveLength(45);
  const selected = grid.querySelector('[data-columns="3"][data-rows="5"]');
  selected.dispatchEvent(new w.Event('pointerenter'));
  expect(w.document.querySelector('.table-size-status').textContent).toContain('3 × 5 total rows (1 heading row + 4 data rows)');
  expect(grid.querySelectorAll('.selected')).toHaveLength(8);
  grid.dispatchEvent(new w.Event('pointerleave'));
  expect(grid.querySelectorAll('.selected')).toHaveLength(1);
  const first = grid.querySelector('[tabindex="0"]');
  first.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(w.document.activeElement).toBe(grid.querySelector('[data-columns="3"][data-rows="2"]'));
  expect(w.document.querySelectorAll('.table-size-controls select')).toHaveLength(2);
  selected.click(); // A normal click also works for touch activation.
  expect(w.document.querySelectorAll('.data-table thead th')).toHaveLength(3);
  expect(w.document.querySelectorAll('.data-table tr')).toHaveLength(5);
  expect(w.document.querySelectorAll('.data-table tbody tr')).toHaveLength(4);
});

test('the student table title spans the current column count after table edits', () => {
  jump(5); createTable(3, 2);
  expect(el('field-tableTitle').value).toBe('');
  input('tableTitle', 'Basketball Bounce Data');
  const control = label => [...w.document.querySelectorAll('.table-edit-controls button')].find(item => item.textContent === label);
  const span = () => { jump(7); const title = w.document.querySelector('.report-output .data-table-title'); jump(5); return title.colSpan; };
  expect(span()).toBe(3);
  control('Add column').click(); expect(span()).toBe(4);
  control('Remove column').click(); expect(span()).toBe(3);
  expect(el('field-tableTitle').value).toBe('Basketball Bounce Data');
  expect(w.confirm).not.toHaveBeenCalled();
});

test('a created table requires a student title, one heading, and one data cell', () => {
  jump(5); createTable(3, 5);
  expect(el('field-tableTitle').value).toBe('');
  const quantitativeCheck = () => w.document.querySelector('[data-check-key="data:results"]');
  expect(quantitativeCheck().parentElement.textContent).toBe('My table has a title, headings, and my quantitative data.');
  expect(quantitativeCheck().disabled).toBe(true);
  jump(7); expect(w.document.querySelector('.review-summary').textContent).toContain('Table Title'); jump(5);
  tableInput(0, 0, 'Drop height (cm)');
  expect(quantitativeCheck().disabled).toBe(true);
  tableInput(1, 0, '50 cm');
  expect(quantitativeCheck().disabled).toBe(true);
  jump(7);
  expect(w.document.querySelector('.review-summary').textContent).toContain('Table Title');
  expect(w.document.querySelector('.review-summary').textContent).not.toContain('Quantitative Data');
  jump(5); input('tableTitle', 'Bounce heights');
  expect(quantitativeCheck().disabled).toBe(false);
  quantitativeCheck().click();
  expect(quantitativeCheck().checked).toBe(true);
  expect(w.document.querySelectorAll('.data-table th textarea')).toHaveLength(3);
  expect(w.document.querySelectorAll('.data-table td input')).toHaveLength(12);
  expect(el('field-qualitativeObservations').tagName).toBe('TEXTAREA');
  jump(7);
  expect(w.document.querySelector('.review-summary').textContent).not.toContain('Quantitative Data');
  expect(w.document.querySelector('.review-summary').textContent).toContain('Qualitative Observations');
  expect(w.document.querySelectorAll('.review-summary')[1].textContent).toContain('6. Data: 1 of 2 confirmed');
  jump(5); tableInput(1, 0, '  ');
  expect(quantitativeCheck().disabled).toBe(true);
  expect(quantitativeCheck().checked).toBe(false);
  jump(7); expect(w.document.querySelector('.review-summary').textContent).toContain('Quantitative Data');
});

test('table shape, cells, self-check, and Data location persist across navigation and reload', () => {
  jump(5); createTable(3, 5);
  input('tableTitle', 'Ramp travel results');
  tableInput(0, 0, 'Trial'); tableInput(0, 1, 'Length (cm)');
  tableInput(1, 0, 'Trial 1'); tableInput(1, 1, '50 cm');
  w.document.querySelector('[data-check-key="data:results"]').click();
  input('qualitativeObservations', 'Foam was white.');
  jump(4); jump(5);
  expect(w.document.querySelector('[data-table-cell="1:1"]').value).toBe('50 cm');
  const saved = JSON.parse(w.localStorage.getItem(KEY));
  expect(saved.quantitativeTable.cells).toHaveLength(5);
  expect(saved.quantitativeTable.cells[0]).toHaveLength(3);
  expect(saved.quantitativeTable.cells[1][1]).toBe('50 cm');
  expect(saved.quantitativeTable.title).toBe('Ramp travel results');
  expect(saved.responses).not.toHaveProperty('quantitativeData');
  expect(saved.activeSection).toBe('data');
  remount();
  expect(el('step-title').textContent).toBe('Data & Observations');
  expect(w.document.querySelector('[data-table-cell="1:1"]').value).toBe('50 cm');
  expect(el('field-tableTitle').value).toBe('Ramp travel results');
  expect(w.document.querySelector('[data-check-key="data:results"]').checked).toBe(true);
  expect(el('field-qualitativeObservations').value).toBe('Foam was white.');
});

test('add and remove controls enforce 2×2 through 6×10 and confirm populated deletion', () => {
  jump(5); createTable();
  const control = label => [...w.document.querySelectorAll('.table-edit-controls button')].find(item => item.textContent === label);
  const shape = () => [w.document.querySelectorAll('.data-table tr').length, w.document.querySelectorAll('.data-table thead th').length];
  expect(control('Remove row').disabled).toBe(true);
  expect(control('Remove column').disabled).toBe(true);
  control('Add row').click(); control('Add column').click();
  expect(shape()).toEqual([3, 3]);
  tableInput(2, 0, 'Third row'); tableInput(0, 2, 'Third heading');
  control('Remove row').click(); expect(w.confirm).toHaveBeenCalledTimes(1); expect(shape()).toEqual([3, 3]);
  w.confirm.mockReturnValue(true); control('Remove row').click(); expect(shape()).toEqual([2, 3]);
  w.confirm.mockReturnValue(false); control('Remove column').click(); expect(shape()).toEqual([2, 3]);
  w.confirm.mockReturnValue(true); control('Remove column').click(); expect(shape()).toEqual([2, 2]);
  control('Add row').click(); control('Remove row').click(); // Empty row removal needs no confirmation.
  expect(shape()).toEqual([2, 2]);
  for (let i = 0; i < 8; i++) control('Add row').click();
  for (let i = 0; i < 4; i++) control('Add column').click();
  expect(shape()).toEqual([10, 6]);
  expect(control('Add row').disabled).toBe(true);
  expect(control('Add column').disabled).toBe(true);
});

test('removing the only populated data row clears the quantitative self-check in saved state', () => {
  jump(5); createTable(2, 3);
  tableInput(0, 0, 'Trial'); tableInput(2, 0, 'Trial 2');
  w.document.querySelector('[data-check-key="data:results"]').click();
  w.confirm.mockReturnValue(true);
  [...w.document.querySelectorAll('.table-edit-controls button')].find(item => item.textContent === 'Remove row').click();
  expect(w.document.querySelector('[data-check-key="data:results"]').disabled).toBe(true);
  expect(JSON.parse(w.localStorage.getItem(KEY)).checks).not.toHaveProperty('data:results');
});

test('obsolete pre-release quantitative prose is ignored and dropped on the next save without losing other work', async () => {
  const obsolete = 'OBSOLETE QUANTITATIVE TEST NOTES';
  const old = {version: 1, checkSchema: 2, responses: {
    quantitativeData: obsolete, investigationQuestion: 'How far?', scientificBackground: 'Force moves objects.',
    independentVariable: 'Ramp height', dependentVariable: 'Travel distance', controlVariables: 'Same ball',
    hypothesis: 'A higher ramp sends it farther.', materials: 'Ball and ramp', procedure: '1. Release ball',
    qualitativeObservations: 'Blue foam', claim: 'It traveled farther.', labTitle: 'Ramp lab', studentName: 'Student'
  }, checks: {'question:question': true, 'data:results': true, 'data:observations': true},
  activeSection: 'data', settings: {large: true}};
  dom.window.close(); mount(JSON.stringify(old));
  expect(el('step-title').textContent).toBe('Data & Observations');
  expect(w.document.querySelector('.table-size-grid')).not.toBe(null);
  expect(w.document.querySelector('.legacy-quantitative')).toBe(null);
  expect(el('step-content').textContent).not.toMatch(/previous quantitative notes|replace these notes|migration/i);
  expect(el('step-content').textContent).not.toContain(obsolete);
  expect(w.document.querySelector('[data-check-key="data:results"]').disabled).toBe(true);
  expect(w.document.querySelector('[data-check-key="data:observations"]').checked).toBe(true);
  expect(el('field-qualitativeObservations').value).toBe('Blue foam');
  expect(w.document.documentElement.classList.contains('large-text')).toBe(true);
  click('read-aloud');
  expect(w.speechSynthesis.speak.mock.calls.at(-1)[0].text).not.toContain(obsolete);
  click('read-aloud');
  jump(7);
  expect(w.document.querySelector('.report-output').textContent).not.toContain(obsolete);
  expect(w.document.querySelector('.review-summary').textContent).toContain('Quantitative Data');
  w.dispatchEvent(new w.Event('beforeprint'));
  expect(el('print-report').textContent).not.toContain(obsolete);
  jump(5); createTable(3, 4); input('tableTitle', 'Trial data');
  expect(w.confirm).not.toHaveBeenCalled();
  tableInput(0, 0, 'Trial'); tableInput(1, 0, '1');
  const saved = JSON.parse(w.localStorage.getItem(KEY));
  expect(saved.responses).not.toHaveProperty('quantitativeData');
  expect(saved.responses.investigationQuestion).toBe('How far?');
  expect(saved.responses.scientificBackground).toBe('Force moves objects.');
  expect(saved.responses.qualitativeObservations).toBe('Blue foam');
  expect(saved.responses.claim).toBe('It traveled farther.');
  expect(saved.responses.labTitle).toBe('Ramp lab');
  expect(saved.checks['question:question']).toBe(true);
  expect(saved.checks['data:observations']).toBe(true);
  expect(saved.quantitativeTable.cells).toHaveLength(4);
  expect(saved.quantitativeTable.cells[0]).toHaveLength(3);
  remount();
  expect(el('step-title').textContent).toBe('Data & Observations');
  expect(w.document.querySelector('[data-table-cell="1:0"]').value).toBe('1');
  expect(w.document.querySelector('[data-check-key="data:results"]').disabled).toBe(false);
  w.confirm.mockReturnValue(true); click('reset-report');
  expect(JSON.parse(w.localStorage.getItem(KEY)).quantitativeTable).toBe(null);
});

test('invalid structured tables preserve the unreadable saved report and pause writes', () => {
  const saved = JSON.stringify({version: 1, checkSchema: 2, responses: {}, quantitativeTable: {cells: [['A'], ['1']]}, activeSection: 'data'});
  dom.window.close(); mount(saved);
  expect(el('save-status').textContent).toContain('Saving is paused');
  jump(5); expect(w.localStorage.getItem(KEY)).toBe(saved);
});

test('Review and print preserve the table shape and values', () => {
  jump(5); createTable(3, 5);
  input('tableTitle', 'Basketball Bounce Heights');
  tableInput(0, 0, 'Drop Height (cm)'); tableInput(0, 1, 'Bounce Height (cm)');
  tableInput(1, 0, '50'); tableInput(1, 1, '31');
  tableInput(2, 0, '100'); tableInput(2, 1, '67');
  input('qualitativeObservations', 'The ball bounced quickly.');
  jump(7);
  const review = w.document.querySelector('.report-output .data-table');
  expect(review.querySelectorAll('thead th')).toHaveLength(4);
  expect(review.querySelector('.data-table-title').textContent).toBe('Basketball Bounce Heights');
  expect(review.querySelector('.data-table-title').colSpan).toBe(3);
  expect(review.querySelectorAll('tbody tr')).toHaveLength(4);
  expect(review.querySelectorAll('input')).toHaveLength(0);
  expect(review.textContent).toContain('Bounce Height (cm)');
  expect(review.textContent).toContain('67');
  expect(w.document.querySelector('.report-output').textContent).toContain('The ball bounced quickly.');
  w.dispatchEvent(new w.Event('beforeprint'));
  const printed = el('print-report').querySelector('.data-table');
  expect(printed.querySelectorAll('thead th')).toHaveLength(4);
  expect(printed.querySelector('.data-table-title').colSpan).toBe(3);
  expect(printed.querySelector('.data-table-title').textContent).toBe('Basketball Bounce Heights');
  expect(printed.querySelectorAll('tbody tr')).toHaveLength(4);
  expect(printed.textContent).toContain('100');
  expect(html).toContain('#print-report .data-table th, #print-report .data-table td');
});

test('Data Read aloud follows headings then rows; reset clears the structured table', () => {
  jump(5); createTable(); input('tableTitle', 'Travel results'); tableInput(0, 0, 'Trial'); tableInput(0, 1, 'Distance'); tableInput(1, 0, '1'); tableInput(1, 1, '50 cm');
  click('read-aloud');
  const spoken = w.speechSynthesis.speak.mock.calls.at(-1)[0].text;
  expect(spoken.indexOf('Table Title: Travel results')).toBeLessThan(spoken.indexOf('Heading row: Trial, Distance'));
  expect(spoken.indexOf('Heading row: Trial, Distance')).toBeLessThan(spoken.indexOf('Row 2: Trial: 1, Distance: 50 cm'));
  expect(spoken).toContain('Qualitative Observations');
  expect(spoken).not.toContain('Add row');
  w.confirm.mockReturnValue(true); click('reset-report');
  expect(el('step-title').textContent).toBe(titles[0]);
  expect(JSON.parse(w.localStorage.getItem(KEY)).quantitativeTable).toBe(null);
  jump(5); expect(w.document.querySelector('.table-size-grid')).not.toBe(null);
});

test('table styles retain visible controls, borders, focus, mobile scrolling, and print rules', () => {
  expect(html).toContain('.data-table-wrap { max-width: 100%; min-width: 0; overflow-x: auto;');
  expect(html).toContain('min-width: calc(var(--table-columns) * 6.5rem);');
  expect(html).toContain('#step-content .data-table input, #step-content .data-table textarea { width: 100%; min-width: 0; padding: .25rem .35rem;');
  expect(html).toContain('*:focus-visible{');
  expect(html).toContain('html.large-text { font-size: 23px; }');
  expect(html).toContain('.high-contrast { --dark: #000;');
  expect(html).toContain('#print-report .data-table { width: 100%; min-width: 0; table-layout: fixed; }');
});

test('read aloud reads current directions/responses and stops on navigation or toggle', () => {
  input('investigationQuestion', 'Read this question'); input('scientificBackground', 'Read this science idea'); click('read-aloud');
  const spoken = w.speechSynthesis.speak.mock.calls[0][0].text;
  expect(spoken).toContain('Read this question');
  expect(spoken).toContain('Read this science idea');
  expect(spoken).toContain('What science do you already know that relates to your investigation?');
  expect(spoken).not.toMatch(/What do you already know\?|How does this connect to your investigation\?/);
  expect(el('read-aloud').getAttribute('aria-pressed')).toBe('true');
  click('read-aloud'); expect(el('read-aloud').getAttribute('aria-pressed')).toBe('false');
  click('read-aloud'); jump(6); expect(w.speechSynthesis.cancel).toHaveBeenCalled();
  expect(el('read-aloud').textContent).toBe('Read aloud');
  click('read-aloud'); w.speechSynthesis.speak.mock.calls.at(-1)[0].onerror({ error: 'network' });
  expect(el('speech-status').textContent).toContain('Reading stopped');
});

test('unsupported read aloud is disabled without breaking the report', () => {
  remount(win => { delete win.speechSynthesis; delete win.SpeechSynthesisUtterance; });
  expect(el('read-aloud').disabled).toBe(true);
  input('investigationQuestion', 'Still usable');
  expect(w.localStorage.getItem(KEY)).toContain('Still usable');
});

test.each(['{broken', JSON.stringify({version: 99, responses: {}}), JSON.stringify({version: 1, responses: {claim: 5}})])('unreadable saved work is preserved until deliberate reset: %s', saved => {
  dom.window.close(); mount(saved);
  input('investigationQuestion', 'New work');
  expect(w.localStorage.getItem(KEY)).toBe(saved);
  expect(el('save-status').textContent).toContain('Saving is paused');
  w.confirm.mockReturnValue(true); click('reset-report'); input('investigationQuestion', 'Fresh start');
  expect(w.localStorage.getItem(KEY)).toContain('Fresh start');
});

test('storage write/removal failures are visible and reset failure retains work', () => {
  jest.spyOn(w.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  input('investigationQuestion', 'Do not lose me');
  expect(el('save-status').textContent).toContain('Not saved');
  jest.spyOn(w.Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  w.confirm.mockReturnValue(true); click('reset-report');
  expect(el('field-investigationQuestion').value).toBe('Do not lose me');
  expect(el('save-status').textContent).toContain('could not be cleared');
});

test('another tab changing the report locks editing here, then reloads the latest saved report on request', () => {
  input('investigationQuestion', 'First version');
  w.localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(w.localStorage.getItem(KEY)), responses: { investigationQuestion: 'Other tab version' } }));
  const otherTab = w.localStorage.getItem(KEY);
  w.dispatchEvent(new w.StorageEvent('storage', {key: KEY}));
  // Editing is visibly paused: the editor is inert and the alert explains why.
  expect(el('step-content').inert).toBe(true);
  expect(w.document.body.dataset.reportLock).toBe('otherTab');
  expect(el('report-alert').hidden).toBe(false);
  expect(el('report-alert').getAttribute('role')).toBe('alert');
  expect(el('report-alert').textContent).toContain('changed in another tab. Editing is paused here');
  expect([...el('report-alert').querySelectorAll('button')].map(item => item.textContent)).toEqual(['Load the latest saved report', 'Download this tab’s work']);
  expect(el('reset-report').disabled).toBe(true);
  // Even a programmatic edit cannot overwrite the other tab's report.
  input('investigationQuestion', 'Paused edit');
  expect(w.localStorage.getItem(KEY)).toBe(otherTab);
  el('report-alert').querySelector('button').click();
  expect(el('step-content').inert).toBe(false);
  expect(el('report-alert').hidden).toBe(true);
  expect(el('field-investigationQuestion').value).toBe('Other tab version');
  input('investigationQuestion', 'Continue here');
  expect(JSON.parse(w.localStorage.getItem(KEY)).responses.investigationQuestion).toBe('Continue here');
});


test('required report details affect progress and review but never gate navigation', () => {
  for (const [key, label] of [['labTitle', 'Lab title'], ['studentName', 'Name']]) {
    expect(w.document.querySelector(`label[for="field-${key}"]`).textContent).toBe(label);
    expect(el(`field-${key}`).required).toBe(true);
  }
  expect(el('field-date')).toBe(null);
  input('investigationQuestion', 'My testable question?');
  expect(el('report-progress').value).toBe(0);
  click('next'); expect(el('step-title').textContent).toBe('Variables');
  click('previous'); jump(7);
  expect(w.document.querySelector('.review-summary').textContent).toContain('Lab title, Name, Scientific Background');
  jump(0); input('labTitle', 'My lab'); input('studentName', 'Student');
  input('scientificBackground', 'A relevant fact relates to the variable.');
  expect(el('report-progress').value).toBe(1);
  jump(7); expect(w.document.querySelector('.review-summary').textContent).not.toContain('Lab title, Name');
});

test('Question + Background has distinct required writing fields and structural self-checks', () => {
  expect(el('step-title').textContent).toBe('Investigation Question + Scientific Background');
  expect([...el('step-content').querySelectorAll('.report-field label')].map(label => label.textContent))
    .toEqual(['Lab title', 'Name', 'Investigation Question', 'Scientific Background']);
  expect(el('step-content').querySelector('.background-heading').textContent).toBe('Scientific Background');
  expect(el('help-scientificBackground').textContent).toBe('What science do you already know that relates to your investigation? Explain how those ideas could help you think about what might happen.');
  expect(el('step-content').querySelectorAll('textarea')).toHaveLength(2);
  expect(el('step-content').querySelectorAll('#field-scientificBackground')).toHaveLength(1);
  expect(el('field-scientificBackground').rows).toBe(5);
  expect(el('field-backgroundKnowledge')).toBe(null);
  expect(el('field-backgroundConnection')).toBe(null);
  const backgroundCheck = () => w.document.querySelector('[data-check-key="question:background"]');
  expect(w.document.querySelectorAll('.self-check input')).toHaveLength(2);
  expect(backgroundCheck().parentElement.textContent).toBe('My scientific background includes information that relates to my investigation.');
  expect(backgroundCheck().disabled).toBe(true);
  input('labTitle', 'Lab'); input('studentName', 'Student'); input('investigationQuestion', 'What changes?');
  expect(el('report-progress').value).toBe(0);
  jump(7);
  expect(w.document.querySelector('.review-summary').textContent).toContain('Scientific Background');
  expect(w.document.querySelectorAll('.review-summary')[1].textContent).toContain('1. Question + Background: 0 of 2 confirmed');
  jump(0); input('scientificBackground', 'A science fact helps me predict a result.');
  expect(el('report-progress').value).toBe(1);
  expect(backgroundCheck().disabled).toBe(false);
  backgroundCheck().click(); remount();
  expect(el('field-scientificBackground').value).toBe('A science fact helps me predict a result.');
  expect(backgroundCheck().checked).toBe(true);
  input('scientificBackground', '   ');
  expect(backgroundCheck().disabled).toBe(true);
  expect(backgroundCheck().checked).toBe(false);
  expect(JSON.parse(w.localStorage.getItem(KEY)).checks).not.toHaveProperty('question:background');
  expect(el('report-progress').value).toBe(0);
  jump(7);
  expect(w.document.querySelector('.review-summary').textContent).toContain('Scientific Background');
  expect(w.document.querySelectorAll('.review-summary')[1].textContent).toContain('1. Question + Background: 0 of 2 confirmed');
  expect(script).not.toContain('Check my work');
  jump(0); expect(el('step-content').textContent).toContain('Before you move on…');
});

test('legacy saved Variables and Hypothesis content and checked states map to stable section keys', () => {
  dom.window.close();
  mount(JSON.stringify({version: 1, responses: {
    labTitle: 'Old lab', studentName: 'Old student', date: '2026-09-01',
    independentVariable: 'Old independent', dependentVariable: 'Old dependent', controlVariables: 'Old controls',
    hypothesis: 'Old hypothesis'
  }, checks: {'section-2-0': true, 'section-1-0': true}, step: 2, settings: {}}));
  expect(el('step-title').textContent).toBe(titles[0]);
  jump(1);
  expect(el('field-independentVariable').value).toBe('Old independent');
  expect(w.document.querySelector('[data-check-key="variables:independent"]').checked).toBe(true);
  jump(2);
  expect(el('field-hypothesis').value).toBe('Old hypothesis');
  expect(w.document.querySelector('[data-check-key="hypothesis:prediction"]').checked).toBe(true);
  jump(0);
  expect(el('field-scientificBackground').value).toBe('');
  expect(el('field-date')).toBe(null);
  input('scientificBackground', 'New work');
  const saved = JSON.parse(w.localStorage.getItem(KEY));
  expect(saved.checkSchema).toBe(2);
  expect(saved.responses).not.toHaveProperty('date');
  expect(saved.responses.independentVariable).toBe('Old independent');
  expect(saved.responses.hypothesis).toBe('Old hypothesis');
  expect(saved.responses.scientificBackground).toBe('New work');
  expect(saved.checks['variables:independent']).toBe(true);
  expect(saved.checks['hypothesis:prediction']).toBe(true);
  jump(7);
  expect(el('step-content').textContent).not.toMatch(/\bDate\b/);
  dom.window.close();
  mount(JSON.stringify({version: 1, responses: {hypothesis: 'A saved hypothesis', independentVariable: 'A saved variable'}, checks: {}, step: 1, settings: {}}));
  expect(el('step-title').textContent).toBe(titles[0]);
  jump(2);
  expect(el('field-hypothesis').value).toBe('A saved hypothesis');
  jump(1);
  expect(el('field-independentVariable').value).toBe('A saved variable');
});

test.each([
  ['Both ideas', 'Connection to the test', 'Both ideas\n\nConnection to the test'],
  ['Only first idea', '', 'Only first idea'],
  ['', 'Only connection', 'Only connection']
])('old background responses migrate into one canonical field: %s / %s', (knowledge, connection, expected) => {
  const prior = {version: 1, checkSchema: 2, responses: {investigationQuestion: 'What changes?', backgroundKnowledge: knowledge, backgroundConnection: connection}, checks: {'question:knowledge': true, 'question:connection': true, 'question:question': true}, activeSection: 'question'};
  dom.window.close(); mount(JSON.stringify(prior));
  expect(el('field-scientificBackground').value).toBe(expected);
  const backgroundCheck = () => w.document.querySelector('[data-check-key="question:background"]');
  expect(backgroundCheck().disabled).toBe(false);
  expect(backgroundCheck().checked).toBe(false);
  expect(w.document.querySelector('[data-check-key="question:question"]').checked).toBe(true);
  jump(7);
  expect(w.document.querySelector('.report-output').textContent).toContain(expected);
  expect(w.document.querySelectorAll('.review-summary')[1].textContent).toContain('1. Question + Background: 1 of 2 confirmed');
  jump(0); input('scientificBackground', expected);
  const canonical = JSON.parse(w.localStorage.getItem(KEY));
  expect(canonical.responses.scientificBackground).toBe(expected);
  expect(canonical.responses).not.toHaveProperty('backgroundKnowledge');
  expect(canonical.responses).not.toHaveProperty('backgroundConnection');
  expect(canonical.checks).not.toHaveProperty('question:knowledge');
  expect(canonical.checks).not.toHaveProperty('question:connection');
  remount();
  expect(el('field-scientificBackground').value).toBe(expected);
  expect(backgroundCheck().checked).toBe(false);
});

test('an already canonical background remains authoritative and old checks never confirm it', () => {
  dom.window.close(); mount(JSON.stringify({version: 1, checkSchema: 2, responses: {
    scientificBackground: 'Current combined response', backgroundKnowledge: 'Retired first field', backgroundConnection: 'Retired second field'
  }, checks: {'question:knowledge': true, 'question:connection': true}, activeSection: 'data'}));
  expect(el('step-title').textContent).toBe('Data & Observations');
  jump(0);
  expect(el('field-scientificBackground').value).toBe('Current combined response');
  expect(w.document.querySelector('[data-check-key="question:background"]').checked).toBe(false);
  input('scientificBackground', 'Current combined response'); remount(); jump(0);
  expect(el('field-scientificBackground').value).toBe('Current combined response');
});

test('self-checks enable only with relevant writing, clear when writing is removed, and persist', () => {
  jump(1);
  const independent = () => w.document.querySelector('[data-check-key="variables:independent"]');
  const dependent = () => w.document.querySelector('[data-check-key="variables:dependent"]');
  expect(independent().disabled).toBe(true);
  expect(dependent().disabled).toBe(true);
  input('independentVariable', 'Surface texture');
  expect(independent().disabled).toBe(false);
  expect(dependent().disabled).toBe(true);
  independent().click();
  expect(independent().checked).toBe(true);
  jump(7);
  expect(w.document.querySelectorAll('.review-summary')[1].textContent).toContain('2. Variables: 1 of 3 confirmed');
  jump(2); input('hypothesis', 'If texture changes, distance may change because friction changes.');
  expect([...w.document.querySelectorAll('.self-check input')].every(item => !item.disabled)).toBe(true);
  remount();
  expect(el('step-title').textContent).toBe('Hypothesis');
  jump(1);
  expect(independent().checked).toBe(true);
  input('independentVariable', '   ');
  expect(independent().disabled).toBe(true);
  expect(independent().checked).toBe(false);
  expect(JSON.parse(w.localStorage.getItem(KEY)).checks).not.toHaveProperty('variables:independent');
  jump(7);
  expect(w.document.querySelectorAll('.review-summary')[1].textContent).toContain('2. Variables: 0 of 3 confirmed');
  remount(); jump(1);
  expect(independent().disabled).toBe(true);
  expect(independent().checked).toBe(false);
  click('next'); expect(el('step-title').textContent).toBe('Hypothesis');
});

test('Review separates objective omissions from student confirmations and links to the new section order', () => {
  jump(7);
  const cards = w.document.querySelectorAll('#step-content .review-summary');
  expect(cards).toHaveLength(2);
  expect(cards[0].querySelector('h3').textContent).toBe('Missing information');
  expect(cards[1].querySelector('h3').textContent).toBe('Student self-check status');
  expect(cards[1].textContent).toContain('Unchecked means you have not confirmed it yet. LyfeLabz has not judged your science.');
  expect(w.document.querySelector('#step-content .self-check')).toBe(null);
  expect(el('step-content').textContent).not.toContain('Final check');
  expect([...cards[0].querySelectorAll('.review-group h4')].map(item => item.textContent).slice(0, 3))
    .toEqual(['1. Question + Background', '2. Variables', '3. Hypothesis']);
  [...['Variables', 'Hypothesis', 'Data', 'Discussion']].forEach((name, index) => {
    jump(7);
    [...w.document.querySelectorAll('.review-summary button')].find(button => button.textContent === `Go to ${name}`).click();
    expect(el('step-title').textContent).toBe(titles[[1, 2, 5, 6][index]]);
  });
  jump(7);
  [...w.document.querySelectorAll('.review-summary button')].find(button => button.textContent === 'Review Variables').click();
  expect(el('step-title').textContent).toBe('Variables');
});

test('Review warning uses singular grammar and never gates draft export or claims scientific quality', () => {
  fillAllExcept(['futureExperiments']); jump(7);
  expect(el('report-progress').value).toBe(6);
  expect(el('step-content').textContent).toContain('1 item is still missing');
  expect(w.document.querySelector('.review-summary').textContent).toContain('Future Experiments');
  expect(el('print-button').disabled).toBe(false);
  expect(w.document.querySelectorAll('#step-content .self-check input')).toHaveLength(0);
  expect(w.document.querySelectorAll('#step-content .review-summary')[1].textContent).toContain('Not confirmed yet');
});

test('intentional cancellation and stale speech errors never claim speech is unavailable', () => {
  expect(el('speech-status').textContent).toBe('');
  click('read-aloud');
  const first = w.speechSynthesis.speak.mock.calls.at(-1)[0];
  const staleError = first.onerror;
  first.onstart(); expect(el('speech-status').textContent).toBe('Reading aloud.');
  click('read-aloud');
  expect(first.onerror).toBe(null);
  expect(el('speech-status').textContent).toBe('');
  click('read-aloud');
  const second = w.speechSynthesis.speak.mock.calls.at(-1)[0];
  second.onstart(); staleError({ error: 'interrupted' });
  expect(el('speech-status').textContent).toBe('Reading aloud.');
  expect(el('read-aloud').getAttribute('aria-pressed')).toBe('true');
  second.onerror({error:'canceled'});
  expect(el('speech-status').textContent).toBe('');
  click('read-aloud');
  w.speechSynthesis.speak.mock.calls.at(-1)[0].onerror({error:'network'});
  expect(el('speech-status').textContent).toContain('Reading stopped');
  click('read-aloud'); w.speechSynthesis.speak.mock.calls.at(-1)[0].onstart();
  expect(el('speech-status').textContent).toBe('Reading aloud.');
  jump(3); expect(el('speech-status').textContent).toBe('');
});

test('sticky region includes progress and all eight controls, excluding accessibility tools', () => {
  const sticky = el('report-navigation');
  expect(sticky.getAttribute('aria-label')).toBe('Report progress and navigation');
  expect(sticky.contains(el('report-progress'))).toBe(true);
  expect(sticky.querySelectorAll('#step-links button')).toHaveLength(8);
  expect(sticky.contains(el('toggle-large'))).toBe(false);
  expect(html).toMatch(/#report-navigation \{ position: sticky; top: var\(--site-nav-height/);
  expect(html).toContain('overflow-x: auto');
  jump(6); expect(el('step-number').textContent).toBe('Step 7 of 8');
  expect(sticky.querySelector('.sticky-progress').textContent).toContain('0 of 7 sections filled in');
});

test('restoring a later section reveals its navigation pill and opens at its heading', () => {
  dom.window.close();
  mount(JSON.stringify({version: 1, responses: {}, checks: {}, activeSection: 'review', step: 0, settings: {}}), win => {
    const original = win.HTMLElement.prototype.getBoundingClientRect;
    win.HTMLElement.prototype.getBoundingClientRect = function() {
      if (this.id === 'step-links') return {left: 0, right: 200, height: 40};
      if (this.parentElement?.id === 'step-links') {
        const left = [...this.parentElement.children].indexOf(this) * 120 - this.parentElement.scrollLeft;
        return {left, right: left + 110, height: 40};
      }
      return original.call(this);
    };
  });
  expect(el('step-title').textContent).toBe('Review & Export');
  expect(el('step-links').scrollLeft).toBeGreaterThan(0);
  expect(w.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  el('step-links').scrollLeft = 0;
  w.dispatchEvent(new w.Event('resize'));
  expect(el('step-links').scrollLeft).toBeGreaterThan(0);
});

test('every view uses accessible in-card headings instead of border-straddling legends', () => {
  for (let step = 0; step < 8; step++) {
    jump(step);
    expect(el('step-content').querySelectorAll('fieldset, legend')).toHaveLength(0);
    for (const group of el('step-content').querySelectorAll('[role="group"]')) {
      if (group.hasAttribute('aria-labelledby')) {
        const heading = el(group.getAttribute('aria-labelledby'));
        expect(heading.tagName).toBe('H3');
        expect(group.contains(heading)).toBe(true);
      } else expect(group.getAttribute('aria-label')).toBeTruthy();
    }
  }
});

test('footer markup and base stylesheet are exactly the canonical lesson footer', () => {
  const canonical = fs.readFileSync(path.join(root, 'lesson_conducting-experiments.html'), 'utf8');
  expect(html.match(/<footer>[\s\S]*?<\/footer>/)[0]).toBe(canonical.match(/<footer>[\s\S]*?<\/footer>/)[0]);
  const footerCSS = text => text.match(/  \/\* ===== FOOTER ===== \*\/[\s\S]*?(?=  \/\* ===== RESPONSIVE NAV)/)[0];
  expect(footerCSS(html)).toBe(footerCSS(canonical));
  expect(html).not.toContain('footer p, footer .footer-tagline { color: var(--text-muted); }');
});
