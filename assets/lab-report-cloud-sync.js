/* LyfeLabz Lab Report Assistant cloud sync engine.
 *
 * Owns cloud autosave for a signed-in student: which version to load, the
 * debounced revision-checked save loop, bounded retries, conflicts between
 * tabs and devices, the per-account browser backup, and moving a report that
 * was saved in this browser without an account. It has no DOM or Firebase
 * code: the page supplies `ui` callbacks and the transport
 * (`window.lyfelabz.labReportCloud`, assets/lyfelabz-lab-report-cloud.js).
 *
 * Invariants:
 * - Nothing is written to the cloud until the student's cloud report has
 *   been read (or the save is revision-checked against what was read), so an
 *   empty editor can never replace saved work.
 * - The server revision decides staleness, never a client clock.
 * - Divergent versions are shown side by side until the student chooses.
 * - A report is never shown under a different account than the one that
 *   owns it, and is hidden as soon as the account changes or signs out.
 */
(function (root) {
  'use strict';
  var BACKUP_PREFIX = 'lyfelabz:lab-report-assistant:account-backup:v1:';
  var DECISIONS_KEY = 'lyfelabz:lab-report-assistant:device-report-decisions:v1';
  var STATUS = {
    loading: 'Opening your report...',
    saving: 'Saving...',
    cloud: 'Saved to cloud',
    device: 'Saved on this device only',
    action: 'Unable to save - action needed'
  };
  var DEFAULTS = {
    debounceMs: 2000,
    maxWaitMs: 10000,
    authTimeoutMs: 8000,
    loadTimeoutMs: 12000,
    retryBaseMs: 2000,
    retryMaxMs: 60000,
    maxAutoRetries: 6,
    refreshAfterMs: 60000,
    signOutWaitMs: 5000
  };
  var MESSAGES = {
    offline: 'We could not reach your LyfeLabz account. Your work is saved in this browser and will be saved to your account when you reconnect.',
    retrying: 'Your newest changes have not reached your account yet. Your work is saved in this browser. Trying again...',
    retryLimit: 'Your newest changes could not be saved to your account. Your work is saved in this browser. Check your internet connection, then choose Try again.',
    auth: 'Your sign-in expired. Sign in again to keep saving to your account. Your work is saved in this browser.',
    account: 'Your LyfeLabz account cannot save reports right now. Your work is saved in this browser. Ask your teacher for help, then choose Try again.',
    tooLarge: 'Your report is too long to save to your account. Shorten a section, or download a backup file so you do not lose it.',
    invalid: 'Your report could not be saved to your account. Download a backup file, then reload the page.',
    unsupported: 'Your saved report was made with a newer version of this tool. Reload the page to open it. Editing is paused so nothing is overwritten.',
    conflict: 'Your report was changed in another tab or on another device. Checking which version is newest...',
    conflictLoad: 'Your report was changed in another tab or on another device, and we could not load the newest version. Editing is paused so nothing is overwritten. Choose Try again.',
    otherTab: 'This report is open in another tab. Editing is paused here so your work is not overwritten.',
    choosing: 'Choose which version of your report to keep.',
    storage: 'This browser could not keep a backup copy. Stay online so your work saves to your account.'
  };

  // FNV-1a, hex. Used only to remember a decision about a browser report
  // without storing a second copy of its text.
  function hash(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function create(o) {
    var cfg = {};
    var key;
    for (key in DEFAULTS) cfg[key] = DEFAULTS[key];
    if (o.config) for (key in o.config) cfg[key] = o.config[key];
    var timers = o.timers;
    var ui = o.ui;
    var transport = o.transport;
    var ser = function (report) { return JSON.stringify(report); };
    var same = function (a, b) { return o.contentKey(a) === o.contentKey(b); };

    var mode = 'starting'; // starting | device | cloud
    var deviceReason = '';
    var user = null;
    var generation = 0;
    var authResolved = false;
    var authTimer = null;
    var unsubscribeAuth = null;
    // Cloud session state.
    var current = null;
    var ack = 0;            // revision the current lineage derives from
    var ackedSer = null;    // serialized report last confirmed by the server
    var cloudConfirmed = false;
    var dirty = false;
    var halt = null;        // loading | choosing | conflict | conflictLoad | otherTab | auth | account | tooLarge | invalid | unsupported | retryLimit | offline
    var inFlight = false;
    var inDoubt = null;     // a save whose outcome is unknown; resent verbatim
    var failures = 0;
    var debounceTimer = null;
    var retryTimer = null;
    var firstDirtyAt = null;
    var lastAttemptAt = 0;
    var lastCheck = 0;
    var userCleared = false;
    var migrationDone = false;
    var lastSavedAt = null;
    var storageProblem = false;

    var store = {
      get: function (k) { try { return o.storage.getItem(k); } catch (_) { return null; } },
      set: function (k, v) { try { o.storage.setItem(k, v); return true; } catch (_) { return false; } },
      remove: function (k) { try { o.storage.removeItem(k); } catch (_) { /* Keep going. */ } },
      keys: function () {
        var out = [];
        try { for (var i = 0; i < o.storage.length; i++) out.push(o.storage.key(i)); } catch (_) { /* None. */ }
        return out;
      }
    };

    function now() { return timers.now(); }
    function clear(timer) { if (timer !== null) timers.clearTimeout(timer); return null; }
    function clearTimers() {
      debounceTimer = clear(debounceTimer);
      retryTimer = clear(retryTimer);
    }
    function backupKey(uid) { return BACKUP_PREFIX + uid; }
    function newSaveId() {
      var out = 's';
      var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      for (var i = 0; i < 20; i++) out += chars.charAt(Math.floor(o.random() * chars.length));
      return out;
    }

    function state() {
      if (mode === 'starting') return 'loading';
      if (mode === 'device') return 'device';
      if (halt === 'loading') return 'loading';
      if (halt === 'offline') return dirty && failures >= cfg.maxAutoRetries ? 'action' : 'device';
      if (halt) return 'action';
      if (inFlight) return 'saving';
      if (dirty) return failures > 0 ? 'device' : 'saving';
      return cloudConfirmed ? 'cloud' : 'device';
    }
    function detail() {
      if (mode !== 'cloud') return '';
      if (halt === 'offline') return dirty && failures >= cfg.maxAutoRetries ? MESSAGES.retryLimit : MESSAGES.offline;
      if (halt && MESSAGES[halt]) return MESSAGES[halt];
      if (dirty && failures > 0) return MESSAGES.retrying;
      if (storageProblem) return MESSAGES.storage;
      return '';
    }
    function actions() {
      if (mode !== 'cloud') return [];
      if (halt === 'auth') return ['signIn'];
      if (halt === 'retryLimit' || halt === 'account' || halt === 'conflictLoad') return ['retry'];
      if (halt === 'offline' && failures >= cfg.maxAutoRetries) return ['retry'];
      if (halt === 'otherTab') return ['takeOver'];
      if (halt === 'unsupported') return ['reload'];
      return [];
    }
    function emit() {
      var s = state();
      ui.status({ state: s, text: STATUS[s], detail: detail(), actions: actions(), savedAt: lastSavedAt, mode: mode });
    }
    function editable() {
      return mode === 'cloud' && (halt === null || halt === 'offline' || halt === 'auth' || halt === 'account' ||
        halt === 'tooLarge' || halt === 'invalid' || halt === 'retryLimit');
    }
    function syncLock() {
      if (mode !== 'cloud') return;
      if (editable()) ui.unlock();
      else ui.lock(halt);
    }

    // ---------- Per-account browser backup ----------
    function writeBackup() {
      // A paused tab never writes: the active tab owns the shared backup.
      if (mode !== 'cloud' || !user || current === null || halt === 'otherTab') return;
      var ok = store.set(backupKey(user.uid), JSON.stringify({
        schema: 1, ownerUid: user.uid, baseRevision: ack, dirty: dirty,
        tabId: o.tabId, savedAt: now(), report: current
      }));
      storageProblem = !ok;
    }
    function readBackup(uid) {
      var raw = store.get(backupKey(uid));
      if (raw === null) return null;
      try {
        var parsed = JSON.parse(raw);
        if (!parsed || parsed.schema !== 1 || parsed.ownerUid !== uid) return null;
        return {
          baseRevision: typeof parsed.baseRevision === 'number' ? parsed.baseRevision : 0,
          dirty: parsed.dirty === true,
          tabId: parsed.tabId,
          savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : null,
          report: o.parse(parsed.report)
        };
      } catch (_) {
        // Unreadable backups are left in place, never deleted or overwritten
        // here; the cloud copy is used instead.
        return null;
      }
    }
    // Clean backups duplicate what is already in the student's account, so
    // they are removed whenever their owner is not the signed-in student.
    // Backups holding unsaved work are kept for their owner.
    function removeCleanBackups(exceptUid) {
      store.keys().forEach(function (k) {
        if (!k || k.indexOf(BACKUP_PREFIX) !== 0) return;
        if (exceptUid && k === backupKey(exceptUid)) return;
        try {
          var parsed = JSON.parse(store.get(k));
          if (parsed && parsed.dirty === false) store.remove(k);
        } catch (_) { /* Leave unknown data alone. */ }
      });
    }
    function readDecisions() {
      try {
        var parsed = JSON.parse(store.get(DECISIONS_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (_) { return {}; }
    }
    function recordDecision(fingerprint) {
      var decisions = readDecisions();
      decisions[user.uid] = fingerprint;
      store.set(DECISIONS_KEY, JSON.stringify(decisions));
    }

    // ---------- Transport helpers ----------
    function withTimeout(promise) {
      return new Promise(function (resolve, reject) {
        var timer = timers.setTimeout(function () { reject({ kind: 'network', code: 'timeout' }); }, cfg.loadTimeoutMs);
        promise.then(function (value) { timers.clearTimeout(timer); resolve(value); },
          function (err) { timers.clearTimeout(timer); reject(err); });
      });
    }
    function errorKind(err) {
      return err && typeof err.kind === 'string' ? err.kind : 'network';
    }
    function loadCloud() {
      return withTimeout(Promise.resolve().then(function () { return transport.get(); }))
        .then(function (data) {
          if (!data || typeof data.exists !== 'boolean') throw { kind: 'invalid' };
          if (!data.exists) return { exists: false, revision: 0, report: null, updatedAt: null };
          if (typeof data.revision !== 'number') throw { kind: 'invalid' };
          var report;
          try { report = o.parse(data.report); }
          catch (_) { throw { kind: 'unsupported' }; }
          return { exists: true, revision: data.revision, report: report, updatedAt: data.updatedAtMillis || null };
        });
    }

    // ---------- Applying a version ----------
    // Any version adopted here was chosen against a fresh cloud read, so an
    // earlier in-doubt save is resolved (it either landed in that read or it
    // did not) and is never resent against the new base.
    function adopt(report, base, baseSer, render) {
      current = report;
      ack = base;
      ackedSer = baseSer;
      dirty = ser(report) !== baseSer;
      inDoubt = null;
      failures = 0;
      retryTimer = clear(retryTimer);
      if (render !== false) ui.render(report);
    }
    // `claim` writes this tab's backup, which also tells other tabs that this
    // tab is now the one editing. Loading a report does not claim; a student
    // action (typing, choosing a version) does.
    function settle(claim) {
      if (claim) writeBackup();
      syncLock();
      if (dirty) schedule(0);
      emit();
    }
    function choose(kind, versions, base, baseSer) {
      var gen = generation;
      halt = 'choosing';
      clearTimers();
      syncLock();
      emit();
      return Promise.resolve(ui.choose({ kind: kind, versions: versions })).then(function (id) {
        if (gen !== generation) return null;
        var chosen = versions.filter(function (v) { return v.id === id; })[0] || versions[0];
        halt = null;
        adopt(chosen.report, base, baseSer);
        userCleared = dirty && o.isBlank(chosen.report);
        settle(true);
        return chosen.id;
      });
    }

    // ---------- Device mode ----------
    function enterDevice(reason) {
      mode = 'device';
      deviceReason = reason;
      halt = null;
      clearTimers();
      ui.device({ reason: reason, user: user });
      emit();
    }

    // ---------- Cloud mode ----------
    function resetSession() {
      current = null; ack = 0; ackedSer = null; cloudConfirmed = false; dirty = false;
      halt = null; inFlight = false; inDoubt = null; failures = 0; firstDirtyAt = null;
      userCleared = false; migrationDone = false; lastSavedAt = null; storageProblem = false;
      clearTimers();
    }
    function enterCloud(nextUser) {
      mode = 'cloud';
      user = nextUser;
      resetSession();
      halt = 'loading';
      ui.account({ signedIn: true, user: nextUser });
      ui.lock('loading');
      emit();
      var gen = generation;
      var backup = readBackup(nextUser.uid);
      loadCloud().then(function (cloud) {
        if (gen !== generation) return;
        startFromCloud(cloud, backup);
      }, function (err) {
        if (gen !== generation) return;
        startWithoutCloud(errorKind(err), backup);
      });
    }
    function startFromCloud(cloud, backup) {
      halt = null;
      cloudConfirmed = true;
      lastCheck = now();
      lastSavedAt = cloud.updatedAt;
      var cloudSer = cloud.exists ? ser(cloud.report) : null;
      if (backup && backup.dirty) {
        if (backup.baseRevision === cloud.revision) {
          // Unsaved work from the last visit that started from this exact
          // revision: nothing newer exists, so it is saved as is.
          adopt(backup.report, cloud.revision, cloudSer);
          settle();
          migrationCheck();
          return;
        }
        if (cloud.exists && same(backup.report, cloud.report)) {
          adopt(cloud.report, cloud.revision, cloudSer);
          settle();
          migrationCheck();
          return;
        }
        choose('restore', [
          { id: 'cloud', source: 'cloud', report: cloud.exists ? cloud.report : o.blank(), updatedAt: cloud.updatedAt },
          { id: 'browser', source: 'browser', report: backup.report, updatedAt: backup.savedAt }
        ], cloud.revision, cloudSer).then(function (id) { if (id !== null) migrationCheck(); });
        return;
      }
      adopt(cloud.exists ? cloud.report : o.blank(), cloud.revision, cloud.exists ? cloudSer : ser(o.blank()));
      if (!cloud.exists) { ackedSer = null; dirty = false; }
      settle();
      migrationCheck();
    }
    function startWithoutCloud(kind, backup) {
      if (kind === 'notStudent' || kind === 'notActive') { enterDevice(kind); return; }
      if (kind === 'auth') { enterDevice('authExpired'); return; }
      if (kind === 'unsupported') {
        halt = 'unsupported';
        current = o.blank();
        ui.render(current);
        syncLock();
        emit();
        return;
      }
      // Offline or unavailable: keep working from this account's browser
      // backup (or an empty report). The next save is checked against the
      // revision this work started from, so nothing newer can be replaced.
      halt = 'offline';
      if (backup) {
        current = backup.report;
        ack = backup.baseRevision;
        ackedSer = backup.dirty ? null : ser(backup.report);
        dirty = backup.dirty;
      } else {
        current = o.blank();
        ack = 0;
        ackedSer = null;
        dirty = false;
      }
      ui.render(current);
      syncLock();
      emit();
      scheduleConfirm();
    }
    function scheduleConfirm() {
      if (mode !== 'cloud' || halt !== 'offline' || retryTimer !== null) return;
      if (failures >= cfg.maxAutoRetries) return;
      var delay = Math.min(cfg.retryMaxMs, cfg.retryBaseMs * Math.pow(2, failures));
      failures += 1;
      retryTimer = timers.setTimeout(function () { retryTimer = null; confirmCloud(); }, delay);
    }
    // Reconnect after an offline start: read the cloud report once and
    // continue from it.
    function confirmCloud() {
      if (mode !== 'cloud' || halt !== 'offline') return;
      var gen = generation;
      loadCloud().then(function (cloud) {
        if (gen !== generation || halt !== 'offline') return;
        halt = null;
        failures = 0;
        cloudConfirmed = true;
        lastCheck = now();
        lastSavedAt = cloud.updatedAt;
        var cloudSer = cloud.exists ? ser(cloud.report) : null;
        if (!dirty) {
          if (cloud.exists) {
            if (!same(cloud.report, current)) ui.notice('updated');
            adopt(cloud.report, cloud.revision, cloudSer, cloudSer !== ser(current));
          } else {
            ack = 0;
            ackedSer = null;
          }
          settle();
          migrationCheck();
          return;
        }
        if (cloud.revision === ack || (cloud.exists && same(cloud.report, current))) {
          if (cloud.revision !== ack) { ack = cloud.revision; ackedSer = cloudSer; dirty = ser(current) !== cloudSer; }
          settle();
          migrationCheck();
          return;
        }
        choose('restore', [
          { id: 'cloud', source: 'cloud', report: cloud.exists ? cloud.report : o.blank(), updatedAt: cloud.updatedAt },
          { id: 'browser', source: 'browser', report: current, updatedAt: null }
        ], cloud.revision, cloudSer).then(function (id) { if (id !== null) migrationCheck(); });
      }, function (err) {
        if (gen !== generation) return;
        var kind = errorKind(err);
        if (kind === 'auth' || kind === 'notStudent' || kind === 'notActive') {
          halt = kind === 'auth' ? 'auth' : 'account';
          emit();
          return;
        }
        emit();
        scheduleConfirm();
      });
    }

    // A report saved in this browser before signing in (the unowned device
    // report) is offered once per account and per report content. It is
    // never uploaded without the student's choice and never deleted.
    function migrationCheck() {
      if (migrationDone || mode !== 'cloud' || halt !== null) return;
      migrationDone = true;
      var device = o.readDeviceReport();
      if (!device || o.isBlank(device)) return;
      var fingerprint = hash(o.contentKey(device));
      if (readDecisions()[user.uid] === fingerprint) return;
      if (same(device, current)) { recordDecision(fingerprint); return; }
      var kind = o.isBlank(current) ? 'migrate-empty' : 'migrate-both';
      var gen = generation;
      halt = 'choosing';
      clearTimers();
      syncLock();
      emit();
      Promise.resolve(ui.choose({ kind: kind, versions: [
        { id: 'cloud', source: 'cloud', report: current, updatedAt: lastSavedAt },
        { id: 'device', source: 'device', report: device, updatedAt: null }
      ] })).then(function (id) {
        if (gen !== generation) return;
        recordDecision(fingerprint);
        halt = null;
        if (id === 'device') {
          current = device;
          ui.render(device);
          dirty = ser(device) !== ackedSer;
          userCleared = false;
          settle(true);
          return;
        }
        syncLock();
        if (dirty) schedule(0);
        emit();
      });
    }

    // ---------- Save loop ----------
    function schedule(delay) {
      if (mode !== 'cloud' || !dirty || halt || retryTimer !== null) return;
      if (firstDirtyAt === null) firstDirtyAt = now();
      var wait = Math.max(0, Math.min(delay, cfg.maxWaitMs - (now() - firstDirtyAt)));
      debounceTimer = clear(debounceTimer);
      debounceTimer = timers.setTimeout(function () { debounceTimer = null; flush(false); }, wait);
    }
    function flush(force) {
      debounceTimer = clear(debounceTimer);
      if (mode !== 'cloud' || inFlight || !current) return;
      if (!dirty && !inDoubt) return;
      if (halt === 'offline') { confirmCloud(); return; }
      if (halt && !(force && (halt === 'retryLimit' || halt === 'otherTab' || halt === 'auth' || halt === 'account'))) return;
      var gen = generation;
      var attempt = inDoubt || {
        saveId: newSaveId(),
        expectedRevision: ack,
        report: current,
        serialized: ser(current),
        allowBlank: userCleared && o.isBlank(current)
      };
      inFlight = true;
      firstDirtyAt = null;
      lastAttemptAt = now();
      emit();
      Promise.resolve().then(function () {
        return transport.save({
          expectedRevision: attempt.expectedRevision,
          saveId: attempt.saveId,
          report: attempt.report,
          allowBlank: attempt.allowBlank
        });
      }).then(function (result) {
        if (gen !== generation) return;
        inFlight = false;
        inDoubt = null;
        failures = 0;
        retryTimer = clear(retryTimer);
        if (halt === 'retryLimit' || halt === 'auth' || halt === 'account') halt = null;
        ack = result.revision;
        ackedSer = attempt.serialized;
        cloudConfirmed = true;
        lastSavedAt = result.updatedAtMillis || now();
        dirty = ser(current) !== ackedSer;
        if (!dirty) userCleared = false;
        writeBackup();
        syncLock();
        if (dirty) schedule(cfg.debounceMs);
        emit();
      }, function (err) {
        if (gen !== generation) return;
        inFlight = false;
        onSaveError(errorKind(err), attempt);
      });
    }
    function onSaveError(kind, attempt) {
      if (kind === 'conflict' || kind === 'blankRefused') { resolveConflict(); return; }
      if (kind === 'auth') { inDoubt = attempt; halt = 'auth'; }
      else if (kind === 'notStudent' || kind === 'notActive') { inDoubt = attempt; halt = 'account'; }
      else if (kind === 'tooLarge') { inDoubt = null; halt = 'tooLarge'; }
      else if (kind === 'invalid') { inDoubt = null; halt = 'invalid'; }
      else if (kind === 'unsupported') { inDoubt = null; halt = 'unsupported'; }
      else {
        // Network, timeout, or server unavailable. The save may or may not
        // have landed, so the same request (same saveId) is resent; the
        // server acknowledges a replay instead of reporting a conflict.
        inDoubt = attempt;
        failures += 1;
        if (failures >= cfg.maxAutoRetries) {
          if (halt !== 'otherTab') halt = 'retryLimit';
        } else {
          var delay = Math.min(cfg.retryMaxMs, cfg.retryBaseMs * Math.pow(2, failures - 1));
          retryTimer = clear(retryTimer);
          retryTimer = timers.setTimeout(function () { retryTimer = null; flush(false); }, delay);
        }
      }
      syncLock();
      emit();
    }
    function resolveConflict() {
      var gen = generation;
      halt = 'conflict';
      inDoubt = null;
      clearTimers();
      syncLock();
      emit();
      loadCloud().then(function (cloud) {
        if (gen !== generation) return;
        var cloudReport = cloud.exists ? cloud.report : o.blank();
        var cloudSer = cloud.exists ? ser(cloud.report) : null;
        lastSavedAt = cloud.updatedAt;
        if (same(cloudReport, current)) {
          halt = null;
          ack = cloud.revision;
          ackedSer = cloudSer;
          dirty = ser(current) !== cloudSer;
          settle();
          return;
        }
        choose('conflict', [
          { id: 'cloud', source: 'cloud', report: cloudReport, updatedAt: cloud.updatedAt },
          { id: 'tab', source: 'tab', report: current, updatedAt: null }
        ], cloud.revision, cloudSer);
      }, function (err) {
        if (gen !== generation) return;
        if (errorKind(err) === 'unsupported') halt = 'unsupported';
        else halt = 'conflictLoad';
        syncLock();
        emit();
      });
    }

    // ---------- Other tabs on this device ----------
    function onStorage(event) {
      if (mode !== 'cloud' || !user || event.key !== backupKey(user.uid) || !event.newValue) return;
      var other;
      try { other = JSON.parse(event.newValue); } catch (_) { return; }
      if (!other || other.tabId === o.tabId) return;
      if (halt === 'choosing' || halt === 'conflict' || halt === 'conflictLoad' || halt === 'otherTab' ||
        halt === 'loading' || halt === 'unsupported') return;
      halt = 'otherTab';
      debounceTimer = clear(debounceTimer);
      syncLock();
      emit();
      // Push this tab's unsaved work so it is not stranded; a conflict here
      // opens the version choice instead of the pause.
      if (dirty || inDoubt) flush(true);
    }
    function takeOver() {
      if (mode !== 'cloud' || halt !== 'otherTab' || inFlight) return;
      var gen = generation;
      halt = 'loading';
      syncLock();
      emit();
      loadCloud().then(function (cloud) {
        if (gen !== generation) return;
        var cloudReport = cloud.exists ? cloud.report : o.blank();
        var cloudSer = cloud.exists ? ser(cloud.report) : null;
        lastSavedAt = cloud.updatedAt;
        var versions = [{ id: 'cloud', source: 'cloud', report: cloudReport, updatedAt: cloud.updatedAt }];
        var other = readBackup(user.uid);
        if (other && other.dirty && other.tabId !== o.tabId && !same(other.report, cloudReport)) {
          versions.push({ id: 'otherTab', source: 'otherTab', report: other.report, updatedAt: other.savedAt });
        }
        if (dirty && versions.every(function (v) { return !same(v.report, current); })) {
          versions.push({ id: 'tab', source: 'tab', report: current, updatedAt: null });
        }
        halt = null;
        if (versions.length === 1) {
          if (!same(cloudReport, current)) ui.notice('updated');
          adopt(cloudReport, cloud.revision, cloudSer);
          if (!cloud.exists) { ackedSer = null; dirty = false; }
          settle(true);
          return;
        }
        choose('takeover', versions, cloud.revision, cloudSer);
      }, function () {
        if (gen !== generation) return;
        halt = 'otherTab';
        syncLock();
        emit();
        ui.notice('takeOverFailed');
      });
    }

    // ---------- Freshness on return ----------
    function refresh(force) {
      if (mode !== 'cloud') return;
      if (halt === 'offline') { failures = 0; retryTimer = clear(retryTimer); confirmCloud(); return; }
      if (halt === 'retryLimit') { flush(true); return; }
      if (halt || inFlight) return;
      if (dirty || inDoubt) { flush(false); return; }
      if (!force && now() - lastCheck < cfg.refreshAfterMs) return;
      lastCheck = now();
      var gen = generation;
      loadCloud().then(function (cloud) {
        if (gen !== generation || dirty || halt || inFlight || !cloud.exists) return;
        lastSavedAt = cloud.updatedAt;
        if (cloud.revision === ack) return;
        var cloudSer = ser(cloud.report);
        if (!same(cloud.report, current)) ui.notice('updated');
        adopt(cloud.report, cloud.revision, cloudSer, cloudSer !== ser(current));
        settle();
      }, function () { /* A failed freshness check changes nothing. */ });
    }

    // ---------- Auth ----------
    function onAuth(nextUser) {
      var uid = nextUser && nextUser.uid ? nextUser.uid : null;
      var first = !authResolved;
      authResolved = true;
      authTimer = clear(authTimer);
      if (mode === 'cloud' && user && uid === user.uid) {
        user = nextUser;
        ui.account({ signedIn: true, user: nextUser });
        if (halt === 'auth' || halt === 'account') { halt = null; failures = 0; syncLock(); flush(true); emit(); }
        return;
      }
      if (!first && mode === 'device' && !uid && !user) return;
      if (!first && mode === 'device' && uid && user && uid === user.uid) return;
      if (!first && mode === 'device' && deviceReason === 'authTimeout' && o.deviceEdited()) {
        ui.notice('signedInReload');
        return;
      }
      var leaving = mode === 'cloud' ? user : null;
      generation += 1;
      clearTimers();
      if (leaving) {
        // Hide the previous student's report before anything else renders.
        if (!dirty && !inDoubt) store.remove(backupKey(leaving.uid));
        ui.clear();
      }
      resetSession();
      removeCleanBackups(uid);
      user = uid ? nextUser : null;
      if (!uid) {
        ui.account({ signedIn: false, user: null });
        enterDevice('signedOut');
        return;
      }
      enterCloud(nextUser);
    }

    // ---------- Public API ----------
    var api = {
      STATUS: STATUS,
      start: function () {
        if (!transport) { enterDevice('unavailable'); return; }
        emit();
        authTimer = timers.setTimeout(function () {
          authTimer = null;
          if (!authResolved) { authResolved = true; enterDevice('authTimeout'); }
        }, cfg.authTimeoutMs);
        try {
          unsubscribeAuth = transport.onAuthChange(onAuth);
        } catch (_) {
          authTimer = clear(authTimer);
          authResolved = true;
          enterDevice('unavailable');
        }
      },
      // True when the engine owns persistence (the page must not write the
      // unowned browser report). While starting or loading, edits are held.
      handles: function () { return mode !== 'device'; },
      mode: function () { return mode; },
      isEditable: function () { return mode === 'device' || editable(); },
      edited: function (report) {
        if (mode === 'device') return false;
        if (mode !== 'cloud' || !editable() || current === null) return true;
        current = report;
        dirty = ser(report) !== ackedSer;
        userCleared = dirty && o.isBlank(report);
        if (halt === 'tooLarge' || halt === 'invalid') halt = null;
        writeBackup();
        if (halt === 'retryLimit' || halt === 'auth' || halt === 'account') {
          if (halt === 'retryLimit' && now() - lastAttemptAt >= cfg.retryMaxMs) flush(true);
        } else if (dirty) {
          schedule(cfg.debounceMs);
        }
        emit();
        return true;
      },
      reset: function (report) {
        if (mode !== 'cloud' || !editable()) return false;
        current = report;
        dirty = ser(report) !== ackedSer;
        userCleared = true;
        if (halt === 'tooLarge' || halt === 'invalid') halt = null;
        writeBackup();
        flush(true);
        emit();
        return true;
      },
      importReport: function (report) {
        if (mode !== 'cloud' || !editable()) return Promise.resolve(null);
        if (same(report, current)) { ui.notice('importSame'); return Promise.resolve('same'); }
        if (o.isBlank(current)) {
          current = report;
          ui.render(report);
          dirty = ser(report) !== ackedSer;
          userCleared = false;
          settle(true);
          return Promise.resolve('file');
        }
        return choose('import', [
          { id: 'tab', source: 'tab', report: current, updatedAt: null },
          { id: 'file', source: 'file', report: report, updatedAt: null }
        ], ack, ackedSer);
      },
      retry: function () {
        if (mode !== 'cloud') return;
        if (halt === 'conflictLoad') { resolveConflict(); return; }
        if (halt === 'account' || halt === 'auth') { flush(true); return; }
        failures = 0;
        retryTimer = clear(retryTimer);
        if (halt === 'offline') { confirmCloud(); return; }
        flush(true);
      },
      takeOver: takeOver,
      refresh: refresh,
      flushNow: function () { if (mode === 'cloud' && (dirty || inDoubt) && !inFlight) flush(halt === 'retryLimit'); },
      hasUnsavedWork: function () { return mode === 'cloud' && (dirty || inFlight || inDoubt !== null); },
      onStorage: onStorage,
      onOnline: function () { failures = 0; refresh(true); },
      signIn: function () { return transport ? transport.signIn() : Promise.resolve(); },
      // Waits briefly for unsaved work to reach the account, then asks the
      // page to confirm before signing out with work still unsaved.
      signOut: function (confirmLoss) {
        if (!transport) return Promise.resolve(false);
        var started = now();
        if (mode === 'cloud' && (dirty || inDoubt) && !inFlight) flush(true);
        return new Promise(function (resolve) {
          (function wait() {
            if (mode === 'cloud' && inFlight && now() - started < cfg.signOutWaitMs) {
              timers.setTimeout(wait, 200);
              return;
            }
            resolve();
          })();
        }).then(function () {
          if (mode === 'cloud' && (dirty || inFlight || inDoubt) && !confirmLoss()) return false;
          return Promise.resolve(transport.signOut()).then(function () { return true; });
        });
      },
      stop: function () {
        generation += 1;
        clearTimers();
        authTimer = clear(authTimer);
        if (unsubscribeAuth) try { unsubscribeAuth(); } catch (_) { /* Ignore. */ }
      }
    };
    return api;
  }

  var exported = { create: create, STATUS: STATUS, MESSAGES: MESSAGES, BACKUP_PREFIX: BACKUP_PREFIX, DECISIONS_KEY: DECISIONS_KEY, hash: hash };
  root.LyfeLabzLabReportSync = exported;
  if (typeof module === 'object' && module && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
