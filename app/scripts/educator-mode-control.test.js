/** @jest-environment node */
/*
 * Homepage-only Educator Mode control (CLAUDE.md, STUDENT LANGUAGE).
 *
 * index.html is the only page that may change Educator Mode
 * (sessionStorage['lyfelabz-ls'] = 'on' / unset). Every other page only
 * consumes that state (body.ls-active) and never renders or wires its own
 * switch: no button, footer toggle, hidden handler, or keyboard shortcut.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const htmlIn = dir => fs.readdirSync(path.join(root, dir))
  .filter(f => f.endsWith('.html'))
  .map(f => (dir === '.' ? f : `${dir}/${f}`));

const CONTROL_SURFACE = 'index.html';

// Pages every served or source content category lives in.
const pages = [
  ...htmlIn('.'),
  ...htmlIn('lesson-sources'),
  ...htmlIn('lesson-sources/variants'),
  ...htmlIn('app/lessons'),
  ...htmlIn('app/lessons/variants'),
  ...htmlIn('app/lessons/assessment-revisions'),
].filter(f => f !== CONTROL_SURFACE);

// Known pending pages. Each entry must still violate the rule; remove it once fixed.
//  - Earth's Layers and Conducting Experiments: the reading-adapted variant
//    invariance gate requires byte-identical scripts, and retained variant
//    revisions are immutable. Removing the hotkey needs new variant revisions
//    (deferred by owner decision, 2026-10-02).
const PENDING = new Set([
  'lesson-sources/lesson_earths-layers.html',
  'lesson-sources/lesson_conducting-experiments.html',
  'lesson-sources/variants/earths-layers.reading-adapted.html',
  'lesson-sources/variants/conducting-experiments.reading-adapted.html',
  'lesson_earths-layers.html',
  'lesson_conducting-experiments.html',
  'app/lessons/lesson_earths-layers.html',
  'app/lessons/lesson_conducting-experiments.html',
  'app/lessons/assessment-revisions/lesson_earths-layers__r1.html',
  'app/lessons/assessment-revisions/lesson_earths-layers__r2.html',
]);
// Retained variant revisions are immutable historical artifacts.
const isRetainedVariant = f => f.startsWith('app/lessons/variants/');

const VIOLATIONS = [
  ['Educator Mode hotkey', /EDUCATOR MODE HOTKEY/],
  ['writes the Educator Mode state', /(?:setItem|removeItem)\(\s*['"]lyfelabz-ls['"]/],
  ['Educator Mode toggle function', /\b(?:toggleEduMode|syncEduToggleUI|toggleLS)\b/],
  ['Educator Mode control markup', /\b(?:id|class)\s*=\s*["'][^"']*\b(?:educator-toggle|edu-toggle[\w-]*|edu-hero[\w-]*|edu-footer[\w-]*|ls-toggle|lyfelabz-ls)\b/],
];
const violationsOf = html => VIOLATIONS.filter(([, re]) => re.test(html)).map(([name]) => name);

describe('Educator Mode is controlled only from the homepage', () => {
  test('content categories are present, so the invariant is not vacuous', () => {
    for (const prefix of ['lesson_', 'extension_', 'simulation_', 'challenge_', 'investigation_', 'game_', 'system_', 'disease_', 'about_']) {
      expect(pages.some(f => path.basename(f).startsWith(prefix))).toBe(true);
    }
    expect(pages.some(f => f.startsWith('lesson-sources/'))).toBe(true);
    expect(pages.some(f => f.startsWith('app/lessons/assessment-revisions/'))).toBe(true);
  });

  test('no content page renders, wires, or shortcuts its own Educator Mode control', () => {
    const offenders = pages
      .filter(f => !PENDING.has(f) && !isRetainedVariant(f))
      .map(f => [f, violationsOf(read(f))])
      .filter(([, v]) => v.length);
    expect(offenders).toEqual([]);
  });

  test('lesson pages carry no "For Educators" label', () => {
    const offenders = pages
      .filter(f => path.basename(f).startsWith('lesson_') && !PENDING.has(f))
      .filter(f => /For Educators/i.test(read(f)));
    expect(offenders).toEqual([]);
  });

  test('every pending exception still exists and still needs fixing', () => {
    for (const f of PENDING) {
      expect(fs.existsSync(path.join(root, f))).toBe(true);
      expect(violationsOf(read(f))).not.toEqual([]);
    }
  });

  // Renders each page's own CSS with the homepage state OFF and ON, applying it
  // through the page's own load-time consumer, and checks computed visibility.
  // A page whose notes have no hiding rule (Plate Tectonics before its repair)
  // renders every note while OFF and fails here.
  test('educator-only notes render hidden while the homepage state is OFF and visible while ON', () => {
    const CONSUMER = /if\s*\(\s*sessionStorage\.getItem\(\s*['"]lyfelabz-ls['"]\s*\)\s*===?\s*['"]on['"]\s*\)\s*document\.body\.classList\.add\(\s*['"]ls-active['"]\s*\)\s*;?/;
    const offenders = [];
    let checked = 0;
    for (const f of pages) {
      const html = read(f);
      if (!/class="edu-note[\s"]/.test(html)) continue;
      const consumer = html.match(CONSUMER);
      if (!consumer) { offenders.push([f, 'does not consume the homepage state']); continue; }
      for (const on of [false, true]) {
        const dom = new JSDOM(html.replace(/<script\b[\s\S]*?<\/script>/g, ''), { url: 'https://lyfelabz.test/', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
        const w = dom.window;
        if (on) w.sessionStorage.setItem('lyfelabz-ls', 'on');
        w.eval(consumer[0]);
        const notes = [...w.document.querySelectorAll('.edu-note')];
        const shown = notes.filter(n => w.getComputedStyle(n).display !== 'none').length;
        if (shown !== (on ? notes.length : 0)) offenders.push([f, `${on ? 'ON' : 'OFF'}: ${shown}/${notes.length} visible`]);
        w.close();
      }
      checked++;
    }
    expect(offenders).toEqual([]);
    expect(checked).toBeGreaterThan(100);
    expect(pages.filter(f => /lesson_plate-tectonics\.html$/.test(f))).toHaveLength(3);
  });
});

describe('homepage Educator Mode control', () => {
  const html = read(CONTROL_SURFACE);
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1])
    .find(s => s.includes('function toggleEduMode'));
  let dom;
  afterEach(() => dom && dom.window.close());

  test('the homepage keeps a keyboard-reachable Educator Mode button', () => {
    dom = new JSDOM(html, { url: 'https://lyfelabz.test/' });
    const btn = dom.window.document.getElementById('edu-toggle-btn');
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('onclick')).toBe('toggleEduMode()');
    expect(dom.window.document.getElementById('edu-toggle-label').textContent).toBe('Enable Educator Mode');
  });

  test('the homepage control turns the global state on and off', () => {
    dom = new JSDOM(html, { url: 'https://lyfelabz.test/', runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(script);
    w.toggleEduMode();
    expect(w.sessionStorage.getItem('lyfelabz-ls')).toBe('on');
    expect(w.document.getElementById('edu-toggle-label').textContent).toBe('Educator Mode: On');
    w.toggleEduMode();
    expect(w.sessionStorage.getItem('lyfelabz-ls')).toBeNull();
    expect(w.document.getElementById('edu-toggle-label').textContent).toBe('Enable Educator Mode');
  });
});
