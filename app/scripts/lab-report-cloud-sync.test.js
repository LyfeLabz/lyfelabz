/** @jest-environment node */
// Lab Report Assistant cloud sync engine (assets/lab-report-cloud-sync.js).
// The fake server below mirrors the labReportsSave contract tested in
// platform/functions/src/labReports/lab-reports.test.ts: revision CAS,
// saveId replay acknowledgement, identical-report coalescing, and the
// blank-overwrite guard. No real student data is used.
const Sync = require('../../assets/lab-report-cloud-sync.js');

const SECRET = 'PRIVATE STUDENT HYPOTHESIS';
const blank = () => ({ version: 1, checkSchema: 2, responses: {}, checks: {}, quantitativeTable: null, activeSection: 'question', settings: {} });
const report = (text, extra = {}) => ({ ...blank(), responses: { hypothesis: text, ...extra } });
const contentKey = r => JSON.stringify(Object.keys(r.responses || {}).sort().filter(k => r.responses[k].trim()).map(k => [k, r.responses[k]]));
const isBlank = r => contentKey(r) === '[]';
const parse = raw => {
  if (raw && raw.version > 1) { const e = new Error('newer'); e.unsupported = true; throw e; }
  if (!raw || raw.version !== 1 || typeof raw.responses !== 'object') throw new Error('invalid');
  return JSON.parse(JSON.stringify({ ...blank(), ...raw }));
};

function memoryStorage() {
  const map = new Map();
  return {
    map,
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); }
  };
}

function fakeServer() {
  const server = {
    doc: null, // { revision, json, lastSaveId, updatedAt }
    down: false,
    failures: [], // queue of error kinds for upcoming calls
    loseResponses: 0, // saves that land but whose response is lost
    calls: [],
    seed(r, revision = 1) { server.doc = { revision, json: JSON.stringify(r), lastSaveId: 'seed', updatedAt: 5000 }; },
    current() { return server.doc && JSON.parse(server.doc.json); },
    async get() {
      server.calls.push({ type: 'get' });
      if (server.down) throw { kind: 'network', code: 'unavailable' };
      if (server.failures.length) throw { kind: server.failures.shift() };
      if (!server.doc) return { exists: false, revision: 0 };
      return { exists: true, revision: server.doc.revision, report: JSON.parse(server.doc.json), updatedAtMillis: server.doc.updatedAt };
    },
    async save(input) {
      server.calls.push({ type: 'save', ...JSON.parse(JSON.stringify(input)) });
      if (server.down) throw { kind: 'network', code: 'unavailable' };
      if (server.failures.length) throw { kind: server.failures.shift() };
      const current = server.doc ? server.doc.revision : 0;
      if (input.expectedRevision !== current) {
        if (server.doc && server.doc.lastSaveId === input.saveId && current === input.expectedRevision + 1) {
          return { revision: current, persisted: false, updatedAtMillis: 6000 };
        }
        throw { kind: 'conflict', code: 'labReports.writeConflict' };
      }
      const json = JSON.stringify(input.report);
      if (server.doc && isBlank(input.report) && !input.allowBlank && !isBlank(JSON.parse(server.doc.json))) {
        throw { kind: 'blankRefused' };
      }
      if (server.doc && server.doc.json === json) return { revision: current, persisted: false, updatedAtMillis: 6000 };
      server.doc = { revision: current + 1, json, lastSaveId: input.saveId, updatedAt: 7000 };
      if (server.loseResponses > 0) { server.loseResponses -= 1; throw { kind: 'network', code: 'deadline-exceeded' }; }
      return { revision: current + 1, persisted: true, updatedAtMillis: 7000 };
    }
  };
  return server;
}

function transportFor(server) {
  const listeners = new Set();
  const transport = {
    user: undefined,
    onAuthChange(cb) { listeners.add(cb); if (transport.user !== undefined) cb(transport.user); return () => listeners.delete(cb); },
    setUser(user) { transport.user = user; listeners.forEach(cb => cb(user)); },
    signIn: jest.fn(async () => {}),
    signOut: jest.fn(async () => { transport.setUser(null); }),
    get: () => server.get(),
    save: input => server.save(input)
  };
  return transport;
}

const STUDENT_A = { uid: 'student-a', label: 'Student A' };
const STUDENT_B = { uid: 'student-b', label: 'Student B' };
const DEVICE_KEY = 'device-report';

function engine({ server = fakeServer(), storage = memoryStorage(), transport = undefined, user = STUDENT_A, tabId = 'tab-1', device = null, autoChoose = null, config = {} } = {}) {
  if (transport === undefined) transport = transportFor(server);
  if (device) storage.setItem(DEVICE_KEY, JSON.stringify(device));
  const ui = {
    statuses: [], renders: [], locks: [], choices: [], notices: [], clears: 0, devices: [], accounts: [],
    pendingChoice: null,
    status: jest.fn(info => ui.statuses.push(info)),
    render: jest.fn(r => ui.renders.push(JSON.parse(JSON.stringify(r)))),
    lock: jest.fn(reason => { ui.locked = reason; ui.locks.push(reason); }),
    unlock: jest.fn(() => { ui.locked = null; }),
    choose: jest.fn(request => {
      ui.choices.push(request);
      if (autoChoose) return Promise.resolve(autoChoose(request));
      return new Promise(resolve => { ui.pendingChoice = resolve; });
    }),
    notice: jest.fn(kind => ui.notices.push(kind)),
    clear: jest.fn(() => { ui.clears += 1; ui.renders.push('CLEARED'); }),
    device: jest.fn(info => ui.devices.push(info.reason)),
    account: jest.fn(info => ui.accounts.push(info))
  };
  let deviceEdited = false;
  const sync = Sync.create({
    transport, storage, tabId, ui, config,
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id), now: () => Date.now() },
    random: Math.random,
    parse, blank, isBlank, contentKey,
    readDeviceReport: () => { try { return parse(JSON.parse(storage.getItem(DEVICE_KEY))); } catch (_) { return null; } },
    deviceEdited: () => deviceEdited
  });
  const h = {
    sync, ui, server, storage, transport,
    status: () => ui.statuses.at(-1),
    lastRender: () => ui.renders.at(-1),
    saves: () => server.calls.filter(c => c.type === 'save'),
    gets: () => server.calls.filter(c => c.type === 'get'),
    setDeviceEdited: v => { deviceEdited = v; },
    async start() { sync.start(); if (user !== undefined && transport.user === undefined) transport.setUser(user); await settle(); return h; },
    async edit(r) { sync.edited(JSON.parse(JSON.stringify(r))); await settle(); },
    async choose(id) { const resolve = ui.pendingChoice; ui.pendingChoice = null; resolve(id); await settle(); }
  };
  return h;
}

async function settle(ms = 0) {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  if (ms) { jest.advanceTimersByTime(ms); for (let i = 0; i < 20; i++) await Promise.resolve(); }
}
async function advance(ms) {
  // Step in small increments so chained timers and promises interleave.
  const step = 250;
  for (let t = 0; t < ms; t += step) await settle(Math.min(step, ms - t));
}

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1_000_000); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('authenticated save and restore', () => {
  test('restores the cloud report on open without writing anything', async () => {
    const server = fakeServer(); server.seed(report('Saved on the cloud'), 4);
    const h = await engine({ server }).start();
    expect(h.lastRender().responses.hypothesis).toBe('Saved on the cloud');
    expect(h.status()).toEqual(expect.objectContaining({ state: 'cloud', text: 'Saved to cloud', mode: 'cloud' }));
    expect(h.ui.locked).toBe(null);
    await advance(30000);
    expect(h.saves()).toHaveLength(0);
  });

  test('saves after a short debounce, never on every keystroke, and confirms only after the server does', async () => {
    const h = await engine().start();
    for (let i = 1; i <= 8; i++) { await h.edit(report('typing'.slice(0, i % 6 + 1) + i)); await settle(300); }
    expect(h.saves()).toHaveLength(0);
    expect(h.status().text).toBe('Saving...');
    await advance(2000);
    expect(h.saves()).toHaveLength(1);
    expect(h.saves()[0]).toEqual(expect.objectContaining({ expectedRevision: 0, allowBlank: false }));
    expect(h.saves()[0].report.responses.hypothesis).toBe('typ8'); // the latest edit only
    expect(h.server.current()).toEqual(h.saves()[0].report);
    expect(h.status().text).toBe('Saved to cloud');
  });

  test('continuous typing still saves at least every 10 seconds', async () => {
    const h = await engine().start();
    for (let i = 0; i < 40; i++) { await h.edit(report(`word ${i}`)); await settle(500); }
    // 20 seconds of typing with 0.5 s gaps: the debounce never fires, the max wait does.
    expect(h.saves().length).toBeGreaterThanOrEqual(2);
    expect(h.saves().length).toBeLessThanOrEqual(3);
  });

  test('cross-device: a report saved on one device opens on another', async () => {
    const server = fakeServer();
    const deviceOne = await engine({ server, tabId: 'chromebook' }).start();
    await deviceOne.edit(report('Started at school'));
    await advance(2500);
    const deviceTwo = await engine({ server, storage: memoryStorage(), tabId: 'home' }).start();
    expect(deviceTwo.lastRender().responses.hypothesis).toBe('Started at school');
    expect(deviceTwo.status().text).toBe('Saved to cloud');
  });

  test('a backup of unsaved work from the last visit is saved when nothing newer exists', async () => {
    const server = fakeServer(); server.seed(report('v1'), 3);
    const storage = memoryStorage();
    storage.setItem(Sync.BACKUP_PREFIX + STUDENT_A.uid, JSON.stringify({ schema: 1, ownerUid: STUDENT_A.uid, baseRevision: 3, dirty: true, tabId: 'old', savedAt: 1, report: report('v1 plus unsaved') }));
    const h = await engine({ server, storage }).start();
    expect(h.lastRender().responses.hypothesis).toBe('v1 plus unsaved');
    await advance(500);
    expect(h.saves()[0]).toEqual(expect.objectContaining({ expectedRevision: 3 }));
    expect(server.current().responses.hypothesis).toBe('v1 plus unsaved');
  });
});

describe('empty initialization protection', () => {
  test('edits during loading are held, and an empty editor never replaces cloud work', async () => {
    const server = fakeServer(); server.seed(report('Do not erase'), 2);
    let release;
    const slow = transportFor(server);
    slow.get = () => new Promise(resolve => { release = () => resolve(server.get()); });
    const h = engine({ server, transport: slow });
    h.sync.start(); slow.setUser(STUDENT_A); await settle();
    expect(h.status().state).toBe('loading');
    expect(h.sync.handles()).toBe(true);
    expect(h.sync.edited(blank())).toBe(true); // held: neither saved nor written to the device report
    release(); await settle();
    await advance(20000);
    expect(h.saves()).toHaveLength(0);
    expect(server.current().responses.hypothesis).toBe('Do not erase');
    expect(h.lastRender().responses.hypothesis).toBe('Do not erase');
  });

  test('clearing every field is a deliberate edit that the server accepts; init never sets allowBlank', async () => {
    const server = fakeServer(); server.seed(report('Something'), 1);
    const h = await engine({ server }).start();
    await h.edit(blank());
    await advance(2500);
    expect(h.saves()[0]).toEqual(expect.objectContaining({ allowBlank: true }));
    expect(server.current().responses).toEqual({});
  });
});

describe('fallbacks and identity', () => {
  test('no transport means browser-only saving', async () => {
    const h = engine({ transport: null });
    h.sync.start();
    expect(h.ui.devices).toEqual(['unavailable']);
    expect(h.sync.handles()).toBe(false);
    expect(h.sync.edited(report('x'))).toBe(false);
  });

  test('signed out shows the browser report path, not any account backup', async () => {
    const storage = memoryStorage();
    storage.setItem(Sync.BACKUP_PREFIX + STUDENT_A.uid, JSON.stringify({ schema: 1, ownerUid: STUDENT_A.uid, baseRevision: 1, dirty: true, report: report(SECRET) }));
    const h = await engine({ storage, user: null }).start();
    expect(h.ui.devices).toEqual(['signedOut']);
    expect(h.ui.renders).toHaveLength(0);
    expect(h.gets()).toHaveLength(0);
    expect(storage.getItem(Sync.BACKUP_PREFIX + STUDENT_A.uid)).toContain(SECRET); // unsaved work kept for its owner
  });

  test.each([['notStudent', 'notStudent'], ['notActive', 'notActive'], ['auth', 'authExpired']])('a %s refusal falls back to browser-only saving', async (kind, reason) => {
    const server = fakeServer(); server.failures.push(kind);
    const h = await engine({ server }).start();
    expect(h.ui.devices).toEqual([reason]);
    expect(h.sync.handles()).toBe(false);
  });

  test('auth that never resolves falls back after a timeout', async () => {
    const transport = transportFor(fakeServer());
    const h = engine({ transport, user: undefined });
    h.sync.start();
    await advance(8000);
    expect(h.ui.devices).toEqual(['authTimeout']);
  });

  test('expired sign-in during editing keeps work in the browser and resumes after signing in again', async () => {
    const server = fakeServer();
    const h = await engine({ server }).start();
    server.failures.push('auth');
    await h.edit(report('Work during expiry'));
    await advance(2500);
    expect(h.status()).toEqual(expect.objectContaining({ state: 'action', text: 'Unable to save - action needed', actions: ['signIn'] }));
    expect(h.status().detail).toContain('sign-in expired');
    const backup = JSON.parse(h.storage.getItem(Sync.BACKUP_PREFIX + STUDENT_A.uid));
    expect(backup).toEqual(expect.objectContaining({ dirty: true }));
    expect(backup.report.responses.hypothesis).toBe('Work during expiry');
    h.transport.setUser(STUDENT_A); await settle();
    expect(server.current().responses.hypothesis).toBe('Work during expiry');
    expect(h.status().text).toBe('Saved to cloud');
  });
});

describe('shared Chromebook account switching and sign-out privacy', () => {
  test('switching accounts clears the page before the next student\'s report and never shows it to them', async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    const h = await engine({ server, storage }).start();
    await h.edit(report(SECRET)); await advance(2500);
    server.seed(report('Student B work'), 1); // B's own cloud copy (one server stands in for B's path)
    h.transport.setUser(STUDENT_B); await settle();
    const cleared = h.ui.renders.indexOf('CLEARED');
    expect(cleared).toBeGreaterThan(0);
    expect(h.ui.renders.slice(cleared + 1).some(r => JSON.stringify(r).includes(SECRET))).toBe(false);
    expect(h.lastRender().responses.hypothesis).toBe('Student B work');
    // A's backup was clean (saved), so nothing of A's remains in this browser.
    expect(storage.getItem(Sync.BACKUP_PREFIX + STUDENT_A.uid)).toBe(null);
  });

  test('unsaved work of the previous student stays only in their own backup and is not shown to the next', async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    const h = await engine({ server, storage }).start();
    server.down = true;
    await h.edit(report(SECRET)); await advance(3000);
    server.down = false;
    h.transport.setUser(STUDENT_B); await settle();
    expect(JSON.stringify(h.ui.renders.slice(h.ui.renders.indexOf('CLEARED') + 1))).not.toContain(SECRET);
    expect(JSON.parse(storage.getItem(Sync.BACKUP_PREFIX + STUDENT_A.uid)).dirty).toBe(true);
    expect(JSON.stringify(h.ui.choices)).not.toContain(SECRET);
  });

  test('sign-out hides the report and removes the saved account backup from this browser', async () => {
    const h = await engine().start();
    await h.edit(report(SECRET)); await advance(2500);
    const signedOut = await h.sync.signOut(() => true);
    await settle();
    expect(signedOut).toBe(true);
    expect(h.ui.renders.at(-1)).toBe('CLEARED');
    expect(h.ui.devices).toEqual(['signedOut']);
    expect([...h.storage.map.keys()].some(k => k.startsWith(Sync.BACKUP_PREFIX))).toBe(false);
  });

  test('sign-out with unsaved work asks first and can be cancelled', async () => {
    const server = fakeServer();
    const h = await engine({ server }).start();
    server.down = true;
    await h.edit(report('Not saved yet'));
    const confirm = jest.fn(() => false);
    const promise = h.sync.signOut(confirm);
    await advance(6000);
    expect(await promise).toBe(false);
    expect(confirm).toHaveBeenCalled();
    expect(h.transport.signOut).not.toHaveBeenCalled();
  });
});

describe('offline and failure handling', () => {
  test('offline start uses the account backup, saves nothing until reconnect, then fast-forwards', async () => {
    const server = fakeServer(); server.seed(report('v2'), 2);
    const storage = memoryStorage();
    storage.setItem(Sync.BACKUP_PREFIX + STUDENT_A.uid, JSON.stringify({ schema: 1, ownerUid: STUDENT_A.uid, baseRevision: 2, dirty: false, report: report('v2') }));
    server.down = true;
    const h = await engine({ server, storage }).start();
    await advance(13000);
    expect(h.lastRender().responses.hypothesis).toBe('v2');
    expect(h.status().text).toBe('Saved on this device only');
    expect(h.status().detail).toContain('could not reach');
    await h.edit(report('v2 offline edit'));
    await advance(3000);
    expect(h.saves()).toHaveLength(0);
    server.down = false;
    h.sync.onOnline(); await advance(3000);
    expect(server.current().responses.hypothesis).toBe('v2 offline edit');
    expect(server.doc.revision).toBe(3);
    expect(h.status().text).toBe('Saved to cloud');
  });

  test('offline edits on a stale base never overwrite newer cloud work; the student chooses', async () => {
    const server = fakeServer(); server.seed(report('newer from another device'), 5);
    const storage = memoryStorage();
    storage.setItem(Sync.BACKUP_PREFIX + STUDENT_A.uid, JSON.stringify({ schema: 1, ownerUid: STUDENT_A.uid, baseRevision: 2, dirty: false, report: report('old') }));
    server.down = true;
    const h = await engine({ server, storage }).start();
    await advance(13000);
    await h.edit(report('old plus offline edit'));
    server.down = false;
    h.sync.onOnline(); await advance(1000);
    expect(h.ui.choices.at(-1).kind).toBe('restore');
    expect(h.ui.choices.at(-1).versions.map(v => v.report.responses.hypothesis)).toEqual(['newer from another device', 'old plus offline edit']);
    expect(server.current().responses.hypothesis).toBe('newer from another device');
    await h.choose('browser'); await advance(500);
    expect(server.current().responses.hypothesis).toBe('old plus offline edit');
    expect(server.doc.revision).toBe(6);
  });

  test('failed saves retry with backoff, stop after the limit, and ask for action', async () => {
    const server = fakeServer();
    const h = await engine({ server }).start();
    server.down = true;
    await h.edit(report('Keep me'));
    await advance(2500);
    expect(h.status().text).toBe('Saved on this device only');
    await advance(5 * 60 * 1000);
    const attempts = h.saves().length;
    expect(attempts).toBe(6);
    expect(h.status()).toEqual(expect.objectContaining({ state: 'action', actions: ['retry'] }));
    await advance(30 * 60 * 1000);
    expect(h.saves()).toHaveLength(attempts); // no uncontrolled retry loop
    server.down = false;
    h.sync.retry(); await settle();
    expect(server.current().responses.hypothesis).toBe('Keep me');
    expect(h.status().text).toBe('Saved to cloud');
  });

  test('a save whose response was lost is resent with the same id and acknowledged, not reported as a conflict', async () => {
    const server = fakeServer();
    const h = await engine({ server }).start();
    server.loseResponses = 1;
    await h.edit(report('Landed but unconfirmed'));
    await advance(2500);
    expect(server.doc.revision).toBe(1);
    expect(h.status().text).toBe('Saved on this device only');
    await advance(3000);
    const [first, second] = h.saves();
    expect(second.saveId).toBe(first.saveId);
    expect(second.expectedRevision).toBe(first.expectedRevision);
    expect(h.ui.choices).toHaveLength(0);
    expect(h.status().text).toBe('Saved to cloud');
    await h.edit(report('Next change')); await advance(2500);
    expect(h.saves().at(-1).expectedRevision).toBe(1);
    expect(server.doc.revision).toBe(2);
  });

  test.each([['tooLarge', 'too long'], ['invalid', 'could not be saved']])('a %s refusal is shown and not retried automatically', async (kind, text) => {
    const server = fakeServer();
    const h = await engine({ server }).start();
    server.failures.push(kind);
    await h.edit(report('x')); await advance(60000);
    expect(h.saves()).toHaveLength(1);
    expect(h.status().state).toBe('action');
    expect(h.status().detail).toContain(text);
  });
});

describe('conflicts across tabs and devices', () => {
  test('a stale tab cannot overwrite a newer revision; both versions are offered until the student chooses', async () => {
    const server = fakeServer();
    const storageOne = memoryStorage();
    const one = await engine({ server, storage: storageOne, tabId: 'device-1' }).start();
    const two = await engine({ server, storage: memoryStorage(), tabId: 'device-2' }).start();
    await one.edit(report('Device one')); await advance(2500);
    await two.edit(report('Device two')); await advance(2500);
    expect(server.current().responses.hypothesis).toBe('Device one');
    const choice = two.ui.choices.at(-1);
    expect(choice.kind).toBe('conflict');
    expect(choice.versions.map(v => [v.source, v.report.responses.hypothesis])).toEqual([['cloud', 'Device one'], ['tab', 'Device two']]);
    expect(two.ui.locked).toBe('choosing');
    expect(two.status().state).toBe('action');
    await two.choose('tab'); await advance(500);
    expect(server.current().responses.hypothesis).toBe('Device two');
    expect(server.doc.revision).toBe(2);
    // Device one's next edit is now stale and is caught the same way.
    await one.edit(report('Device one again')); await advance(2500);
    expect(one.ui.choices.at(-1).kind).toBe('conflict');
    expect(server.current().responses.hypothesis).toBe('Device two');
  });

  test('a conflict whose versions match is resolved silently', async () => {
    const server = fakeServer();
    const one = await engine({ server, tabId: 'a', storage: memoryStorage() }).start();
    const two = await engine({ server, tabId: 'b', storage: memoryStorage() }).start();
    await one.edit(report('Same words')); await advance(2500);
    await two.edit(report('Same words')); await advance(2500);
    expect(two.ui.choices).toHaveLength(0);
    expect(two.status().text).toBe('Saved to cloud');
  });

  test('another tab on this device pauses editing here, pushes this tab\'s unsaved work, and can take over', async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    const one = await engine({ server, storage, tabId: 'tab-1' }).start();
    const two = await engine({ server, storage, tabId: 'tab-2' }).start();
    await one.edit(report('Tab one pending'));
    const key = Sync.BACKUP_PREFIX + STUDENT_A.uid;
    // Tab two starts typing: its backup write reaches tab one as a storage event.
    await two.edit(report('Tab two typing'));
    one.sync.onStorage({ key, newValue: storage.getItem(key) }); await settle();
    expect(one.ui.locked).toBe('otherTab');
    expect(one.status()).toEqual(expect.objectContaining({ state: 'action', actions: ['takeOver'] }));
    expect(one.status().detail).toContain('open in another tab');
    expect(server.current().responses.hypothesis).toBe('Tab one pending'); // pushed, not stranded
    expect(one.sync.edited(report('typed while paused'))).toBe(true);
    await advance(2500);
    // Tab two's save is now stale, so tab two is asked to choose.
    expect(two.ui.choices.at(-1).kind).toBe('conflict');
    await two.choose('tab'); await advance(500);
    expect(server.current().responses.hypothesis).toBe('Tab two typing');
    one.sync.takeOver(); await settle();
    expect(one.ui.locked).toBe(null);
    expect(one.lastRender().responses.hypothesis).toBe('Tab two typing');
  });

  test('a restored stale tab refreshes to the newest saved revision before the student types', async () => {
    const server = fakeServer(); server.seed(report('Old'), 1);
    const h = await engine({ server }).start();
    server.seed(report('Newer from another device'), 4);
    h.sync.refresh(true); await settle();
    expect(h.lastRender().responses.hypothesis).toBe('Newer from another device');
    expect(h.ui.notices).toContain('updated');
    await h.edit(report('Newer from another device, continued')); await advance(2500);
    expect(h.saves().at(-1).expectedRevision).toBe(4);
  });
});

describe('moving a browser report into the account', () => {
  test('an unowned browser report is offered, never uploaded silently, and never deleted', async () => {
    const storage = memoryStorage();
    const device = report('Written before signing in');
    const h = await engine({ storage, device }).start();
    expect(h.ui.choices.at(-1).kind).toBe('migrate-empty');
    expect(h.saves()).toHaveLength(0);
    await h.choose('device'); await advance(500);
    expect(h.server.current().responses.hypothesis).toBe('Written before signing in');
    expect(JSON.parse(storage.getItem(DEVICE_KEY))).toEqual(device);
  });

  test('declining keeps the browser report and does not ask again for the same report', async () => {
    const storage = memoryStorage();
    const server = fakeServer();
    const h = await engine({ storage, server, device: report('Not mine') }).start();
    await h.choose('cloud'); await advance(5000);
    expect(h.saves()).toHaveLength(0);
    const again = await engine({ storage, server, tabId: 'tab-9' }).start();
    expect(again.saves()).toHaveLength(0);
    expect(again.ui.choices).toHaveLength(0);
    expect(JSON.parse(storage.getItem(DEVICE_KEY)).responses.hypothesis).toBe('Not mine');
  });

  test('a different account report is never replaced without a choice, and importing twice does not duplicate', async () => {
    const storage = memoryStorage();
    const server = fakeServer(); server.seed(report('Account work'), 3);
    const h = await engine({ storage, server, device: report('Browser work') }).start();
    const choice = h.ui.choices.at(-1);
    expect(choice.kind).toBe('migrate-both');
    expect(server.current().responses.hypothesis).toBe('Account work');
    await h.choose('device'); await advance(500);
    expect(server.current().responses.hypothesis).toBe('Browser work');
    expect(server.doc.revision).toBe(4);
    const before = server.calls.length;
    const again = await engine({ storage, server, tabId: 'tab-3' }).start();
    await advance(5000);
    expect(again.ui.choices).toHaveLength(0);
    expect(server.calls.slice(before).filter(c => c.type === 'save')).toHaveLength(0);
    expect(server.doc.revision).toBe(4);
  });

  test('a decision for one student does not suppress the offer for another student', async () => {
    const storage = memoryStorage();
    const server = fakeServer();
    const a = await engine({ storage, server, device: report('Shared browser work') }).start();
    await a.choose('cloud');
    const b = await engine({ storage, server: fakeServer(), user: STUDENT_B, tabId: 'b' }).start();
    expect(b.ui.choices.at(-1).kind).toBe('migrate-empty');
  });
});

describe('data integrity', () => {
  test('a corrupt account backup is ignored and left untouched; the cloud copy is used', async () => {
    const server = fakeServer(); server.seed(report('Cloud copy'), 2);
    const storage = memoryStorage();
    storage.setItem(Sync.BACKUP_PREFIX + STUDENT_A.uid, '{corrupt');
    const h = await engine({ server, storage }).start();
    expect(h.lastRender().responses.hypothesis).toBe('Cloud copy');
    expect(storage.getItem(Sync.BACKUP_PREFIX + STUDENT_A.uid)).toBe('{corrupt');
  });

  test('a cloud report from a newer tool version is never overwritten', async () => {
    const server = fakeServer(); server.seed({ ...report('future'), version: 2 }, 9);
    const h = await engine({ server }).start();
    expect(h.status()).toEqual(expect.objectContaining({ state: 'action', actions: ['reload'] }));
    expect(h.ui.locked).toBe('unsupported');
    expect(h.sync.edited(report('x'))).toBe(true);
    await advance(30000);
    expect(h.saves()).toHaveLength(0);
  });

  test('Start over clears the account report deliberately', async () => {
    const server = fakeServer(); server.seed(report('Old report'), 2);
    const h = await engine({ server }).start();
    expect(h.sync.reset(blank())).toBe(true);
    await settle();
    expect(h.saves()[0]).toEqual(expect.objectContaining({ allowBlank: true, expectedRevision: 2 }));
    expect(server.current().responses).toEqual({});
    expect(h.status().text).toBe('Saved to cloud');
  });

  test('importing a backup file over different work asks first', async () => {
    const server = fakeServer(); server.seed(report('Current'), 1);
    const h = await engine({ server }).start();
    const pending = h.sync.importReport(report('From file'));
    await settle();
    expect(h.ui.choices.at(-1).kind).toBe('import');
    await h.choose('file'); await pending; await advance(500);
    expect(server.current().responses.hypothesis).toBe('From file');
  });

  test('student report content never reaches the console', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map(m => jest.spyOn(console, m).mockImplementation(() => {}));
    const server = fakeServer();
    const h = await engine({ server }).start();
    await h.edit(report(SECRET)); await advance(2500);
    server.failures.push('network', 'conflict');
    await h.edit(report(`${SECRET} 2`)); await advance(8000);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
  });
});
