// ===========================================================================
// PHOTON RUNNER LEADERBOARD - GOOGLE APPS SCRIPT
// Single-purpose backend for the Photon Runner game leaderboard.
// ===========================================================================

const SPREADSHEET_ID = '1p0Ni_Uvga7llu-xYBbEbLbJ6-gqLZepjtECQ7ZYUhJw';

const SHEET_NAME = 'Photon Runner';

const MAX_ROWS = 100;

const HEADERS = [
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
];

const FIELDS = [
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
];

const NUMERIC_FIELDS = {
  score: true,
  solarEfficiency: true,
  highestCombo: true,
  foremanTime: true,
  certScore: true
};

// -------------------------------------------------------------------------
// Main HTTP entrypoint
// -------------------------------------------------------------------------
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = String(params.action || '').trim();

    Logger.log('doGet action=' + action);

    if (action === 'ping') {
      return handlePing();
    }
    if (action === 'debug') {
      return handleDebug();
    }
    if (action === 'submitScore') {
      return handleSubmitScore(params);
    }
    if (action === 'getScores') {
      return handleGetScores();
    }

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
// ping
// -------------------------------------------------------------------------
function handlePing() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var allSheets = ss.getSheets();
    var tabs = [];
    for (var i = 0; i < allSheets.length; i++) {
      tabs.push(allSheets[i].getName());
    }
    Logger.log('ping ok tabs=' + tabs.join(','));
    return jsonResponse({
      success: true,
      message: 'Photon Runner leaderboard script is running',
      spreadsheetId: SPREADSHEET_ID,
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
// debug
// -------------------------------------------------------------------------
function handleDebug() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    var info = {
      success: true,
      sheetFound: !!sheet,
      headers: [],
      rowCount: 0,
      spreadsheetId: SPREADSHEET_ID
    };
    if (sheet) {
      var lastCol = Math.max(1, sheet.getLastColumn());
      info.headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      info.rowCount = Math.max(0, sheet.getLastRow() - 1);
    }
    Logger.log('debug sheetFound=' + info.sheetFound + ' rows=' + info.rowCount);
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
// submitScore
// -------------------------------------------------------------------------
function handleSubmitScore(params) {
  try {
    var sheet = getOrCreatePhotonRunnerSheet();

    var row = [new Date()];
    for (var i = 0; i < FIELDS.length; i++) {
      var field = FIELDS[i];
      var raw = (params[field] !== undefined && params[field] !== null)
                ? params[field] : '';
      if (raw === '' || raw === 'null' || raw === 'undefined') {
        row.push('');
      } else if (NUMERIC_FIELDS[field]) {
        var num = Number(raw);
        row.push(isFinite(num) ? num : raw);
      } else {
        row.push(String(raw));
      }
    }

    sheet.insertRows(2, 1);
    sheet.getRange(2, 1, 1, HEADERS.length).setValues([row]).setWrap(true);

    Logger.log('submitScore rowCount=' + Math.max(0, sheet.getLastRow() - 1));
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
// getScores
// -------------------------------------------------------------------------
function handleGetScores() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      getOrCreatePhotonRunnerSheet();
      return jsonResponse({ scores: [] });
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return jsonResponse({ scores: [] });
    }

    var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    var scores = [];

    for (var r = 0; r < values.length && scores.length < MAX_ROWS; r++) {
      var row = values[r];
      if (isBlankRow(row)) continue;

      var obj = {};
      for (var k = 0; k < FIELDS.length; k++) {
        var v = row[k + 1];
        obj[FIELDS[k]] = (v === null || v === undefined) ? '' : v;
      }
      if (!obj.name) continue;
      scores.push(obj);
    }

    Logger.log('getScores rowCount=' + scores.length);
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
function getOrCreatePhotonRunnerSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.setFrozenRows(1);
    Logger.log('Created Photon Runner sheet');
  }

  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#0ea5b8');
  headerRange.setFontColor('#04121a');
  headerRange.setFontSize(11);
  headerRange.setWrap(true);

  for (var i = 1; i <= HEADERS.length; i++) {
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
// TEST FUNCTIONS (run from the Apps Script editor function dropdown)
// ===========================================================================

function TEST_WRITE_PHOTON_RUNNER_ROW() {
  var sheet = getOrCreatePhotonRunnerSheet();

  var row = [
    new Date(),
    'TEST ROW FROM APPS SCRIPT',
    'Mr. Brown',
    'Test Block',
    12345,
    88,
    12,
    45.6,
    5,
    'Photon Master',
    new Date().toISOString()
  ];

  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, HEADERS.length).setValues([row]);

  Logger.log('TEST ROW WRITTEN TO PHOTON RUNNER TAB');
  Logger.log(JSON.stringify({
    success: true,
    sheet: sheet.getName(),
    row: 2,
    name: row[1],
    score: row[4]
  }));
}

function TEST_PING() {
  Logger.log(handlePing().getContent());
}

function TEST_DEBUG() {
  Logger.log(handleDebug().getContent());
}

function TEST_SUBMIT_SCORE_THROUGH_DOGET() {
  var e = {
    parameter: {
      action: 'submitScore',
      game: 'photon-runner',
      name: 'TEST DOGET ROW',
      teacher: 'Mr. Brown',
      block: 'Test Block',
      score: '54321',
      solarEfficiency: '91',
      highestCombo: '15',
      foremanTime: '39.8',
      certScore: '5',
      certRank: 'Photon Master',
      updatedAt: new Date().toISOString()
    }
  };

  Logger.log(doGet(e).getContent());
}

function TEST_GET_SCORES_THROUGH_DOGET() {
  var e = {
    parameter: {
      action: 'getScores',
      game: 'photon-runner'
    }
  };

  Logger.log(doGet(e).getContent());
}
