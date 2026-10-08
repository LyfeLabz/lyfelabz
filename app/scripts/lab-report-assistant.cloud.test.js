/** @jest-environment node */
// Page-level tests for Lab Report Assistant cloud saving: the real page, the
// real sync engine, and a fake transport that mirrors the labReports
// callables. Fictional report text only.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'tool_lab-report-assistant.html'), 'utf8');
const toolScript = fs.readFileSync(path.join(root, 'assets/lab-report-assistant.js'), 'utf8');
const syncScript = fs.readFileSync(path.join(root, 'assets/lab-report-cloud-sync.js'), 'utf8');
const KEY = 'lyfelabz:lab-report-assistant:v1';
const BACKUP_PREFIX = 'lyfelabz:lab-report-assistant:account-backup:v1:';
const SECRET = 'PRIVATE STUDENT CLAIM TEXT';
const STUDENT_A = { uid: 'student-a', label: 'Student A' };
const STUDENT_B = { uid: 'student-b', label: 'Student B' };

const savedReport = (responses, extra = {}) => ({ version: 1, checkSchema: 2, responses, checks: {}, quantitativeTable: null, activeSection: 'question', settings: {}, ...extra });

function fakeCloud() {
  const docs = {}; // uid -> { revision, report, lastSaveId }
  const cloud = {
    docs, user: undefined, listeners: new Set(), down: false, failures: [], calls: [],
    seed(uid, report, revision = 1) { docs[uid] = { revision, report: JSON.parse(JSON.stringify(report)), lastSaveId: 'seed' }; },
    transport: {
      onAuthChange(cb) { cloud.listeners.add(cb); if (cloud.user !== undefined) cb(cloud.user); return () => cloud.listeners.delete(cb); },
      signIn: jest.fn(async () => {}),
      signOut: jest.fn(async () => cloud.setUser(null)),
      async get() {
        cloud.calls.push('get');
        if (cloud.down) throw { kind: 'network' };
        if (!cloud.user) throw { kind: 'auth' };
        const doc = docs[cloud.user.uid];
        return doc ? { exists: true, revision: doc.revision, report: JSON.parse(JSON.stringify(doc.report)), updatedAtMillis: Date.UTC(2026, 9, 8, 14, 0) } : { exists: false, revision: 0 };
      },
      async save(input) {
        cloud.calls.push({ ...JSON.parse(JSON.stringify(input)) });
        if (cloud.down) throw { kind: 'network' };
        if (cloud.failures.length) throw { kind: cloud.failures.shift() };
        const doc = docs[cloud.user.uid];
        const current = doc ? doc.revision : 0;
        if (input.expectedRevision !== current) {
          if (doc && doc.lastSaveId === input.saveId && current === input.expectedRevision + 1) return { revision: current, persisted: false, updatedAtMillis: Date.now() };
          throw { kind: 'conflict' };
        }
        docs[cloud.user.uid] = { revision: current + 1, report: JSON.parse(JSON.stringify(input.report)), lastSaveId: input.saveId };
        return { revision: current + 1, persisted: true, updatedAtMillis: Date.now() };
      }
    },
    setUser(user) { cloud.user = user; cloud.listeners.forEach(cb => cb(user)); },
    saves() { return cloud.calls.filter(call => typeof call === 'object'); }
  };
  return cloud;
}

let dom, w;
const el = id => w.document.getElementById(id);
async function settle(ms = 0) {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  if (ms) { jest.advanceTimersByTime(ms); for (let i = 0; i < 30; i++) await Promise.resolve(); }
}
async function advance(ms) { for (let t = 0; t < ms; t += 250) await settle(Math.min(250, ms - t)); }
function input(key, text) {
  const element = el(`field-${key}`);
  element.value = text;
  element.dispatchEvent(new w.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function mount({ host = 'localhost', cloud = null, user, storage = {}, setup = () => {} } = {}) {
  dom = new JSDOM(html, { runScripts: 'outside-only', url: `https://${host}/tool_lab-report-assistant.html` });
  w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = jest.fn();
  w.confirm = jest.fn(() => true);
  w.print = jest.fn();
  w.speechSynthesis = { speak: jest.fn(), cancel: jest.fn() };
  w.SpeechSynthesisUtterance = function (text) { this.text = text; };
  w.setTimeout = (fn, ms) => setTimeout(fn, ms);
  w.clearTimeout = id => clearTimeout(id);
  w.Date.now = () => Date.now();
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
  if (cloud) {
    w.lyfelabz = { labReportCloud: cloud.transport };
    if (user !== undefined) cloud.user = user;
  }
  setup(w);
  w.eval(syncScript);
  w.eval(toolScript);
}
const bodyText = () => w.document.body.textContent + [...w.document.querySelectorAll('input, textarea')].map(item => item.value).join(' ');

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(Date.UTC(2026, 9, 8, 15, 0)); });
afterEach(() => { dom.window.close(); jest.useRealTimers(); jest.restoreAllMocks(); });

describe('signed-in student', () => {
  test('the editor stays locked while the report opens, then shows the cloud report and its status', async () => {
    const cloud = fakeCloud();
    cloud.seed('student-a', savedReport({ investigationQuestion: 'Cloud question', labTitle: 'Ramp lab' }));
    mount({ cloud });
    expect(w.document.body.dataset.reportLock).toBe('loading');
    expect(el('step-content').textContent).toBe('Opening your report...');
    cloud.setUser(STUDENT_A);
    await settle();
    expect(w.document.body.dataset.reportLock).toBeUndefined();
    expect(el('field-investigationQuestion').value).toBe('Cloud question');
    expect(el('cloud-status').hidden).toBe(false);
    expect(el('cloud-status').textContent).toBe('Saved to cloud');
    expect(el('cloud-status').dataset.state).toBe('cloud');
    expect(el('report-navigation').contains(el('cloud-status'))).toBe(true);
    expect(el('local-notice').textContent).toContain('saves to your LyfeLabz account');
    expect(el('local-notice').textContent).toContain('not submitted to your teacher');
    expect(el('cloud-panel').textContent).toContain('Saving to the LyfeLabz account for Student A.');
    expect([...el('cloud-panel').querySelectorAll('button')].map(item => item.textContent)).toEqual(['Sign out']);
  });

  test('typing autosaves after a short pause and leaves the browser report untouched', async () => {
    const cloud = fakeCloud();
    mount({ cloud, user: STUDENT_A, storage: { [KEY]: JSON.stringify(savedReport({})) } });
    await settle();
    input('investigationQuestion', 'How does ramp height affect speed?');
    expect(el('cloud-status').textContent).toBe('Saving...');
    expect(cloud.saves()).toHaveLength(0);
    await advance(2500);
    expect(cloud.saves()).toHaveLength(1);
    expect(cloud.docs['student-a'].report.responses.investigationQuestion).toBe('How does ramp height affect speed?');
    expect(el('cloud-status').textContent).toBe('Saved to cloud');
    expect(JSON.parse(w.localStorage.getItem(KEY))).toEqual(savedReport({}));
    expect(JSON.parse(w.localStorage.getItem(BACKUP_PREFIX + 'student-a')).dirty).toBe(false);
  });

  test('repeated failures show an alert with a recovery action, and the work stays in this browser', async () => {
    const cloud = fakeCloud();
    mount({ cloud, user: STUDENT_A });
    await settle();
    cloud.down = true;
    input('investigationQuestion', 'Offline words');
    await advance(2500);
    expect(el('cloud-status').textContent).toBe('Saved on this device only');
    expect(el('cloud-message').textContent).toContain('Trying again');
    await advance(5 * 60 * 1000);
    expect(el('cloud-status').textContent).toBe('Unable to save - action needed');
    expect(el('report-alert').hidden).toBe(false);
    expect(el('report-alert').textContent).toContain('Check your internet connection');
    expect(JSON.parse(w.localStorage.getItem(BACKUP_PREFIX + 'student-a')).report.responses.investigationQuestion).toBe('Offline words');
    const beforeUnload = new w.Event('beforeunload', { cancelable: true });
    w.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    cloud.down = false;
    [...el('report-alert').querySelectorAll('button')].find(item => item.textContent === 'Try again').click();
    await settle();
    expect(el('cloud-status').textContent).toBe('Saved to cloud');
    expect(el('report-alert').hidden).toBe(true);
  });

  test('a conflict shows both versions side by side and saves only the chosen one', async () => {
    const cloud = fakeCloud();
    cloud.seed('student-a', savedReport({ claim: 'Version A' }), 1);
    mount({ cloud, user: STUDENT_A });
    await settle();
    cloud.seed('student-a', savedReport({ claim: 'Saved from another device' }), 2);
    input('investigationQuestion', 'Edited in this tab');
    await advance(2500);
    expect(w.document.body.dataset.reportLock).toBe('choosing');
    expect(el('version-choice').hidden).toBe(false);
    expect(el('version-choice-title').textContent).toBe('Your report was changed somewhere else');
    const cards = [...el('version-choice').querySelectorAll('.version-card')];
    expect(cards.map(card => card.querySelector('h3').textContent)).toEqual(['Saved in your LyfeLabz account', 'Your work in this tab']);
    expect(cards[0].querySelector('.version-preview').textContent).toContain('Saved from another device');
    expect(cards[1].querySelector('.version-preview').textContent).toContain('Edited in this tab');
    expect([...cards[1].querySelectorAll('button')].map(item => item.textContent)).toEqual(['Keep this version', 'Download a copy']);
    expect(el('cloud-status').textContent).toBe('Unable to save - action needed');
    cards[1].querySelector('button').click();
    await advance(500);
    expect(el('version-choice').hidden).toBe(true);
    expect(w.document.body.dataset.reportLock).toBeUndefined();
    expect(cloud.docs['student-a'].revision).toBe(3);
    expect(cloud.docs['student-a'].report.responses.investigationQuestion).toBe('Edited in this tab');
  });

  test('another tab editing pauses this tab with an alert and an Edit here action', async () => {
    const cloud = fakeCloud();
    mount({ cloud, user: STUDENT_A });
    await settle();
    const other = JSON.stringify({ schema: 1, ownerUid: 'student-a', baseRevision: 0, dirty: true, tabId: 'another-tab', savedAt: Date.now(), report: savedReport({ claim: 'other tab' }) });
    w.localStorage.setItem(BACKUP_PREFIX + 'student-a', other);
    w.dispatchEvent(new w.StorageEvent('storage', { key: BACKUP_PREFIX + 'student-a', newValue: other }));
    await settle();
    expect(el('step-content').inert).toBe(true);
    expect(el('report-alert').textContent).toContain('open in another tab');
    const takeOver = [...el('report-alert').querySelectorAll('button')].find(item => item.textContent === 'Edit in this tab instead');
    expect(takeOver).toBeTruthy();
    takeOver.click();
    await settle();
    // The other tab's unsaved work is offered beside the account version.
    expect([...el('version-choice').querySelectorAll('.version-card h3')].map(item => item.textContent))
      .toEqual(['Saved in your LyfeLabz account', 'Unsaved work from your other tab']);
  });
});

describe('shared Chromebooks and privacy', () => {
  test('switching to another student removes the previous report from the page', async () => {
    const cloud = fakeCloud();
    cloud.seed('student-a', savedReport({ claim: SECRET }));
    cloud.seed('student-b', savedReport({ claim: 'Student B claim' }));
    mount({ cloud, user: STUDENT_A });
    await settle();
    w.document.querySelectorAll('#step-links button')[6].click();
    expect(el('field-claim').value).toBe(SECRET);
    cloud.setUser(STUDENT_B);
    await settle();
    expect(bodyText()).not.toContain(SECRET);
    expect(el('print-report').textContent).not.toContain(SECRET);
    expect(el('cloud-panel').textContent).toContain('Student B');
    w.document.querySelectorAll('#step-links button')[6].click();
    expect(el('field-claim').value).toBe('Student B claim');
  });

  test('signing out hides the report, removes the account backup, and offers sign-in', async () => {
    const cloud = fakeCloud();
    cloud.seed('student-a', savedReport({ claim: SECRET }));
    mount({ cloud, user: STUDENT_A });
    await settle();
    el('cloud-panel').querySelector('button').click();
    await settle();
    expect(bodyText()).not.toContain(SECRET);
    expect(w.localStorage.getItem(BACKUP_PREFIX + 'student-a')).toBe(null);
    expect(el('cloud-status').textContent).toBe('Saved on this device only');
    expect(el('cloud-panel').textContent).toContain('Sign in to save your report');
    const signIn = el('cloud-panel').querySelector('button');
    expect(signIn.textContent).toBe('Sign in with Google');
    signIn.click();
    expect(cloud.transport.signIn).toHaveBeenCalledTimes(1);
  });

  test('a signed-out visitor sees only the unowned browser report, never an account backup', async () => {
    const cloud = fakeCloud();
    mount({ cloud, user: null, storage: {
      [KEY]: JSON.stringify(savedReport({ investigationQuestion: 'Browser report' })),
      [BACKUP_PREFIX + 'student-a']: JSON.stringify({ schema: 1, ownerUid: 'student-a', baseRevision: 1, dirty: true, report: savedReport({ claim: SECRET }) })
    } });
    await settle();
    expect(el('field-investigationQuestion').value).toBe('Browser report');
    expect(bodyText()).not.toContain(SECRET);
    input('investigationQuestion', 'Browser report edited');
    expect(JSON.parse(w.localStorage.getItem(KEY)).responses.investigationQuestion).toBe('Browser report edited');
    expect(cloud.saves()).toHaveLength(0);
  });

  test('student report content never reaches the console', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map(method => jest.spyOn(console, method).mockImplementation(() => {}));
    const cloud = fakeCloud();
    mount({ cloud, user: STUDENT_A });
    await settle();
    input('investigationQuestion', SECRET);
    cloud.failures.push('network', 'conflict');
    await advance(10000);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
  });
});

describe('moving reports between browsers and hostnames', () => {
  test('the unowned browser report is offered with a clear yes or no and is kept either way', async () => {
    const cloud = fakeCloud();
    const browserReport = savedReport({ investigationQuestion: 'Written before signing in', labTitle: 'Plant lab' });
    mount({ cloud, user: STUDENT_A, storage: { [KEY]: JSON.stringify(browserReport) } });
    await settle();
    expect(el('version-choice-title').textContent).toBe('Is this your report?');
    const cards = el('version-choice').querySelectorAll('.version-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('Lab title: Plant lab');
    const buttons = [...el('version-choice').querySelectorAll('button')].map(item => item.textContent);
    expect(buttons).toEqual(['Yes, add it to my account', 'Download a copy', 'No, leave it in this browser']);
    expect(cloud.saves()).toHaveLength(0);
    el('version-choice').querySelector('button').click();
    await advance(500);
    expect(cloud.docs['student-a'].report.responses.investigationQuestion).toBe('Written before signing in');
    expect(JSON.parse(w.localStorage.getItem(KEY))).toEqual(browserReport);
  });

  test('a backup file from another hostname opens into the signed-in account', async () => {
    // 1. On the apex site (no cloud): download a backup file.
    let downloaded = null;
    mount({ host: 'lyfelabz.com', storage: { [KEY]: JSON.stringify(savedReport({ investigationQuestion: 'Apex work' })) }, setup: win => {
      win.Blob = function (parts) { downloaded = parts.join(''); };
      win.URL.createObjectURL = () => 'blob:backup';
      win.URL.revokeObjectURL = () => {};
    } });
    expect(el('cloud-status').hidden).toBe(true);
    el('backup-download').click();
    expect(JSON.parse(downloaded)).toEqual(expect.objectContaining({ lyfelabzLabReportBackup: 1 }));
    expect(JSON.parse(downloaded).report.responses.investigationQuestion).toBe('Apex work');
    dom.window.close();
    // 2. On the app host, signed in: open the file.
    const cloud = fakeCloud();
    mount({ cloud, user: STUDENT_A });
    await settle();
    Object.defineProperty(el('backup-file'), 'files', { configurable: true, value: [{ size: downloaded.length, text: async () => downloaded }] });
    el('backup-file').dispatchEvent(new w.Event('change'));
    await advance(2500);
    expect(el('field-investigationQuestion').value).toBe('Apex work');
    expect(cloud.docs['student-a'].report.responses.investigationQuestion).toBe('Apex work');
  });

  test('a file that is not a backup is refused without changing the report', async () => {
    mount({ host: 'lyfelabz.invalid' });
    input('investigationQuestion', 'Keep me');
    Object.defineProperty(el('backup-file'), 'files', { configurable: true, value: [{ size: 10, text: async () => '{"hello":1}' }] });
    el('backup-file').dispatchEvent(new w.Event('change'));
    await settle();
    expect(el('cloud-note').textContent).toBe('This file is not a Lab Report Assistant backup file.');
    expect(el('field-investigationQuestion').value).toBe('Keep me');
  });

  test('opening a backup over different browser work asks first', async () => {
    mount({ host: 'lyfelabz.invalid' });
    input('investigationQuestion', 'Current work');
    const file = JSON.stringify({ lyfelabzLabReportBackup: 1, report: savedReport({ investigationQuestion: 'File work' }) });
    Object.defineProperty(el('backup-file'), 'files', { configurable: true, value: [{ size: file.length, text: async () => file }] });
    el('backup-file').dispatchEvent(new w.Event('change'));
    await settle();
    expect(el('version-choice-title').textContent).toBe('Use the backup file?');
    expect(JSON.parse(w.localStorage.getItem(KEY)).responses.investigationQuestion).toBe('Current work');
    [...el('version-choice').querySelectorAll('.version-card')][1].querySelector('button').click();
    await settle();
    expect(JSON.parse(w.localStorage.getItem(KEY)).responses.investigationQuestion).toBe('File work');
  });
});

describe('host gating', () => {
  test('the production app host is a cloud host and loads the shared Firebase config before the cloud bundle', () => {
    mount({ host: 'app.lyfelabz.com', storage: { [KEY]: JSON.stringify(savedReport({ investigationQuestion: 'Existing browser work' })) } });
    expect(toolScript).toContain('const CLOUD_PRODUCTION_ENABLED = true;');
    expect([...w.document.head.querySelectorAll('script[src]')].map(item => item.getAttribute('src'))).toEqual(['assets/lab-report-cloud-sync.js', 'assets/lab-report-assistant.js', 'assets/lyfelabz-firebase-config.js']);
    w.document.head.querySelector('script[src="assets/lyfelabz-firebase-config.js"]').onload();
    expect(w.document.head.querySelector('script[src="assets/lyfelabz-lab-report-cloud.js"]')).not.toBe(null);
    expect(w.document.body.dataset.reportLock).toBe('loading');
    expect(el('origin-notice').hidden).toBe(true);
    expect(JSON.parse(w.localStorage.getItem(KEY)).responses.investigationQuestion).toBe('Existing browser work');
  });

  test('the production app host opens a signed-in student report from the cloud', async () => {
    const cloud = fakeCloud();
    cloud.seed('student-a', savedReport({ investigationQuestion: 'Production cloud question' }));
    mount({ host: 'app.lyfelabz.com', cloud, user: STUDENT_A });
    await settle();
    expect(el('field-investigationQuestion').value).toBe('Production cloud question');
    expect(el('cloud-status').textContent).toBe('Saved to cloud');
  });

  test.each(['lyfelabz.com', 'www.lyfelabz.com'])('%s stays browser-only and points to the production app host without a redirect', host => {
    mount({ host, storage: { [KEY]: JSON.stringify(savedReport({ claim: SECRET })) } });
    const link = el('origin-notice').querySelector('a');
    expect(el('origin-notice').hidden).toBe(false);
    expect(link.href).toBe('https://app.lyfelabz.com/tool_lab-report-assistant.html');
    expect(link.href).not.toContain('?');
    expect(link.href).not.toContain('#');
    expect(w.location.hostname).toBe(host);
    expect(el('cloud-status').hidden).toBe(true);
    expect(w.document.querySelectorAll('script[src*="firebase-config"], script[src*="lab-report-cloud.js"]')).toHaveLength(0);
    expect(w.localStorage.getItem(KEY)).toContain(SECRET);
  });

  test('a host that cannot sign in points to the app host without putting the report in the link', () => {
    mount({ host: 'lyfelabz-staging-marketing.web.app', storage: { [KEY]: JSON.stringify(savedReport({ claim: SECRET })) } });
    const link = el('origin-notice').querySelector('a');
    expect(el('origin-notice').hidden).toBe(false);
    expect(link.href).toBe('https://lyfelabz-staging.web.app/tool_lab-report-assistant.html');
    expect(link.href).not.toContain('?');
    expect(link.href).not.toContain('#');
    expect(el('origin-notice').textContent).toContain('Download backup file');
    expect(el('field-claim')).toBe(null); // still on step 1; the stored report remains in this browser
    expect(w.localStorage.getItem(KEY)).toContain(SECRET);
  });

  test('a cloud host loads the shared Firebase config before the cloud bundle, and falls back if it never arrives', async () => {
    mount({ host: 'lyfelabz-staging.web.app', storage: { [KEY]: JSON.stringify(savedReport({ investigationQuestion: 'Still here' })) } });
    expect([...w.document.head.querySelectorAll('script[src]')].map(item => item.getAttribute('src'))).toEqual(['assets/lab-report-cloud-sync.js', 'assets/lab-report-assistant.js', 'assets/lyfelabz-firebase-config.js']);
    w.document.head.querySelector('script[src="assets/lyfelabz-firebase-config.js"]').onload();
    expect(w.document.head.querySelector('script[src="assets/lyfelabz-lab-report-cloud.js"]')).not.toBe(null);
    await advance(16000);
    expect(el('cloud-panel').textContent).toContain('Cloud saving could not start');
    expect(el('field-investigationQuestion').value).toBe('Still here');
    expect(w.document.body.dataset.reportLock).toBeUndefined();
  });
});
