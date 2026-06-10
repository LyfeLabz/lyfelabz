// ===========================================================================
// LYFELABZ LEADERBOARD GOOGLE APPS SCRIPT
// Deployed separately from LyfeLabz_GScript.js (different deployment URL).
// Backs cloud leaderboards for the game pages:
//   - game_evolution-clicker.html  (game = "evolution-clicker")
//   - game_photon-runner.html      (game = "photon-runner")
// Updated: 2026-06-10
// Micropass 62 changes:
//   - Added Photon Runner support (new sheet, new columns, new routing).
//   - Evolution Clicker behavior preserved exactly (default game when the
//     game param is missing, original headers and payload fields untouched).
//   - submitScore + getScores both accept ?game=evolution-clicker or
//     ?game=photon-runner. Missing game param defaults to evolution-clicker
//     to keep the existing Evolution Clicker frontend working unchanged.
// ===========================================================================

// Paste YOUR leaderboard Google Sheet ID here before deploying.
// This can be the same spreadsheet as LyfeLabz_GScript.js or a different one.
const LB_SPREADSHEET_ID = '19vgi3c7UkUzO-UNUDRMKRDG9pT-F1Z-8o2PlE8bYHOc';

// Max rows returned by getScores per game.
const LB_MAX_ROWS = 100;

// -------------------------------------------------------------------------
// Per-game sheet config.
// Evolution Clicker columns and fields match the pre-existing deployment.
// Photon Runner columns are new (Micropass 62 spec).
// -------------------------------------------------------------------------
const LB_GAMES = {

  'evolution-clicker': {
    sheet: 'Evolution Clicker',
    headers: [
      'Timestamp',
      'Student Name',
      'Teacher',
      'Block',
      'Score',
      'Clicks',
      'Prestige',
      'Top Evo',
      'Questions Correct',
      'Updated At'
    ],
    // Order matches headers (after Timestamp).
    // These are the keys read from the request query string.
    fields: [
      'name',
      'teacher',
      'block',
      'score',
      'clicks',
      'prestige',
      'topEvo',
      'questionsCorrect',
      'updatedAt'
    ],
    // Numeric coercion list (kept loose; blank stays blank).
    numericFields: { score: true, clicks: true, prestige: true, questionsCorrect: true },
    // Keys returned by getScores for each row.
    outputKeys: [
      'name',
      'teacher',
      'block',
      'score',
      'clicks',
      'prestige',
      'topEvo',
      'questionsCorrect',
      'updatedAt'
    ],
    headerColor: '#1f8a4c',
    fontColor:   '#ffffff'
  },

  'photon-runner': {
    sheet: 'Photon Runner',
    headers: [
      'Timestamp',
      'Student Name',
      'Teacher',
      'Block',
      'Score',
      'Solar Efficiency',
      'Highest Combo',
      'Foreman Time',
      'Cert Score',
      'Cert Rank',
      'Updated At'
    ],
    fields: [
      'name',
      'teacher',
      'block',
      'score',
      'solarEfficiency',
      'highestCombo',
      'foremanTime',
      'certScore',
      'certRank',
      'updatedAt'
    ],
    numericFields: {
      score: true,
      solarEfficiency: true,
      highestCombo: true,
      foremanTime: true,
      certScore: true
    },
    outputKeys: [
      'name',
      'teacher',
      'block',
      'score',
      'solarEfficiency',
      'highestCombo',
      'foremanTime',
      'certScore',
      'certRank',
      'updatedAt'
    ],
    headerColor: '#0ea5b8',
    fontColor:   '#04121a'
  }

};

// -------------------------------------------------------------------------
// Main HTTP entrypoint.
// Routes by ?action= (submitScore | getScores) and ?game= (defaulting to
// evolution-clicker so the existing Evolution Clicker frontend, which does
// not send a game param, keeps working).
// -------------------------------------------------------------------------
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = String(params.action || '').trim();
    var game   = String(params.game || 'evolution-clicker').trim().toLowerCase();

    Logger.log('doGet action=' + action + ' game=' + game);

    if (action === 'ping') {
      return handlePing();
    }
    if (action === 'debug') {
      return handleDebug(game, params);
    }

    if (!LB_GAMES[game]) {
      Logger.log('Unknown game: ' + game);
      return jsonResponse({ success: false, error: 'Unknown game: ' + game });
    }

    if (action === 'submitScore') {
      return handleSubmitScore(game, params);
    }
    if (action === 'getScores') {
      return handleGetScores(game);
    }

    Logger.log('Unknown action: ' + action);
    return jsonResponse({ success: false, error: 'Unknown action: ' + action });

  } catch (err) {
    Logger.log('doGet exception: ' + err + '\n' + (err && err.stack ? err.stack : ''));
    return jsonResponse({
      success: false,
      error: String(err),
      stack: (err && err.stack) ? String(err.stack) : ''
    });
  }
}

// -------------------------------------------------------------------------
// ping: confirm deployment is live, spreadsheet opens, tabs are visible.
// Never writes.
// -------------------------------------------------------------------------
function handlePing() {
  try {
    var ss = SpreadsheetApp.openById(LB_SPREADSHEET_ID);
    var allSheets = ss.getSheets();
    var tabs = [];
    for (var i = 0; i < allSheets.length; i++) {
      tabs.push(allSheets[i].getName());
    }
    Logger.log('ping ok tabs=' + tabs.join(','));
    return jsonResponse({
      success: true,
      message: 'Leaderboard script is running',
      spreadsheetId: LB_SPREADSHEET_ID,
      tabs: tabs,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    Logger.log('ping exception: ' + err + '\n' + (err && err.stack ? err.stack : ''));
    return jsonResponse({
      success: false,
      error: String(err),
      stack: (err && err.stack) ? String(err.stack) : ''
    });
  }
}

// -------------------------------------------------------------------------
// debug: report what doGet sees for a given game. Never writes.
// -------------------------------------------------------------------------
function handleDebug(game, params) {
  try {
    var cfg = LB_GAMES[game];
    var info = {
      success: true,
      game: game,
      params: params,
      sheetFound: false,
      headers: [],
      rowCount: 0
    };
    if (!cfg) {
      info.success = false;
      info.error = 'Unknown game: ' + game;
      Logger.log('debug unknown game=' + game);
      return jsonResponse(info);
    }
    var ss = SpreadsheetApp.openById(LB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(cfg.sheet);
    if (sheet) {
      info.sheetFound = true;
      var lastCol = Math.max(1, sheet.getLastColumn());
      info.headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      info.rowCount = Math.max(0, sheet.getLastRow() - 1);
    }
    Logger.log('debug game=' + game + ' sheet=' + cfg.sheet +
               ' found=' + info.sheetFound + ' rows=' + info.rowCount);
    return jsonResponse(info);
  } catch (err) {
    Logger.log('debug exception: ' + err + '\n' + (err && err.stack ? err.stack : ''));
    return jsonResponse({
      success: false,
      error: String(err),
      stack: (err && err.stack) ? String(err.stack) : ''
    });
  }
}

// -------------------------------------------------------------------------
// submitScore: append one row to the target game's sheet.
// -------------------------------------------------------------------------
function handleSubmitScore(game, params) {
  try {
    var cfg   = LB_GAMES[game];
    var ss    = SpreadsheetApp.openById(LB_SPREADSHEET_ID);
    var preExisting = !!ss.getSheetByName(cfg.sheet);
    var sheet = getOrCreateLbSheet(ss, cfg);
    if (!preExisting) {
      Logger.log('Created ' + cfg.sheet + ' sheet');
    }

    var row = [new Date()];
    for (var i = 0; i < cfg.fields.length; i++) {
      var field = cfg.fields[i];
      var raw   = (params[field] !== undefined && params[field] !== null)
                  ? params[field] : '';
      if (raw === '' || raw === 'null' || raw === 'undefined') {
        row.push('');
      } else if (cfg.numericFields[field]) {
        var num = Number(raw);
        row.push(isFinite(num) ? num : raw);
      } else {
        row.push(String(raw));
      }
    }

    sheet.insertRows(2, 1);
    sheet.getRange(2, 1, 1, cfg.headers.length).setValues([row]).setWrap(true);

    Logger.log('submitScore game=' + game + ' sheet=' + cfg.sheet +
               ' rowCount=' + Math.max(0, sheet.getLastRow() - 1));

    return jsonResponse({ success: true });
  } catch (err) {
    Logger.log('submitScore exception: ' + err + '\n' + (err && err.stack ? err.stack : ''));
    return jsonResponse({
      success: false,
      error: String(err),
      stack: (err && err.stack) ? String(err.stack) : ''
    });
  }
}

// -------------------------------------------------------------------------
// getScores: read rows from the target game's sheet, skip blanks, return
// up to LB_MAX_ROWS as { scores: [...] }. No sorting (frontend handles it).
// -------------------------------------------------------------------------
function handleGetScores(game) {
 try {
  var cfg   = LB_GAMES[game];
  var ss    = SpreadsheetApp.openById(LB_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(cfg.sheet);

  if (!sheet) {
    // Nothing yet; create the sheet (with headers) so future submits land cleanly.
    getOrCreateLbSheet(ss, cfg);
    Logger.log('Created ' + cfg.sheet + ' sheet');
    return jsonResponse({ scores: [] });
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('getScores game=' + game + ' sheet=' + cfg.sheet + ' rowCount=0');
    return jsonResponse({ scores: [] });
  }

  var width = cfg.headers.length;
  var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  var scores = [];

  for (var r = 0; r < values.length && scores.length < LB_MAX_ROWS; r++) {
    var row = values[r];
    if (isBlankRow(row)) continue;

    var obj = {};
    // row[0] is Timestamp; row[1..] map to cfg.outputKeys in order.
    for (var k = 0; k < cfg.outputKeys.length; k++) {
      var v = row[k + 1];
      obj[cfg.outputKeys[k]] = (v === null || v === undefined) ? '' : v;
    }
    // Surface a usable name field even if the student name cell is empty.
    if (!obj.name) {
      // Skip rows with no name; they are not displayable on a leaderboard.
      continue;
    }
    scores.push(obj);
  }

  Logger.log('getScores game=' + game + ' sheet=' + cfg.sheet +
             ' rowCount=' + scores.length);
  return jsonResponse({ scores: scores });
 } catch (err) {
  Logger.log('getScores exception: ' + err + '\n' + (err && err.stack ? err.stack : ''));
  return jsonResponse({
    success: false,
    error: String(err),
    stack: (err && err.stack) ? String(err.stack) : ''
  });
 }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
function getOrCreateLbSheet(ss, cfg) {
  var sheet = ss.getSheetByName(cfg.sheet);
  if (!sheet) {
    sheet = ss.insertSheet(cfg.sheet);
    sheet.setFrozenRows(1);
  }

  var headerRange = sheet.getRange(1, 1, 1, cfg.headers.length);
  headerRange.setValues([cfg.headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground(cfg.headerColor);
  headerRange.setFontColor(cfg.fontColor);
  headerRange.setFontSize(11);
  headerRange.setWrap(true);

  for (var i = 1; i <= cfg.headers.length; i++) {
    sheet.setColumnWidth(i, i === 1 ? 180 : 160);
  }
  return sheet;
}

function isBlankRow(row) {
  for (var i = 0; i < row.length; i++) {
    var v = row[i];
    if (v !== '' && v !== null && v !== undefined) return false;
  }
  return true;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===========================================================================
// TEST HARNESSES (run from the Apps Script editor; bypasses doGet routing)
// ===========================================================================

function testSubmitEvolutionClicker() {
  var fakeEvent = { parameter: {
    action:           'submitScore',
    // no game param on purpose; should default to evolution-clicker
    name:             'Test EC Student',
    teacher:          'Mr. Brown',
    block:            'B',
    score:            123456,
    clicks:           7890,
    prestige:         3,
    topEvo:           'Mammal',
    questionsCorrect: 12
  }};
  Logger.log(doGet(fakeEvent).getContent());
}

function testSubmitPhotonRunner() {
  var fakeEvent = { parameter: {
    action:          'submitScore',
    game:            'photon-runner',
    name:            'Test PR Student',
    teacher:         'Mr. Brown',
    block:           'B',
    score:           54200,
    solarEfficiency: 87,
    highestCombo:    14,
    foremanTime:     42.3,
    certScore:       5,
    certRank:        'Photon Master',
    updatedAt:       new Date().toISOString()
  }};
  Logger.log(doGet(fakeEvent).getContent());
}

function testGetEvolutionClickerScores() {
  Logger.log(doGet({ parameter: { action: 'getScores' } }).getContent());
}

function testGetPhotonRunnerScores() {
  Logger.log(doGet({ parameter: { action: 'getScores', game: 'photon-runner' } }).getContent());
}
