// ═══════════════════════════════════════════════════════════════════════════
// LYFELABZ ASSESSMENT v2
// Created: 2026-07-01
//
// A clean-break rewrite of the LyfeLabz submission pipeline for the HQIM
// workflow. This script writes to a BRAND NEW Google Sheet and is not backward
// compatible with the v1 script (LyfeLabz_GScript.js), which continues to serve
// the older lessons on the old sheet during the transition.
//
// What is new in v2:
//   - Every lesson tab shares ONE simple schema. The tab name identifies the
//     lesson, so there is no Lesson column.
//   - Each response row stores the ten individual quiz answers (Q1-Q10), the
//     Score, and the 🧠 Show Your Thinking response as the final column.
//   - No Teacher column, no Percent column, no Missed Questions transform, and
//     no per-lesson header/field lists. Teachers wanted the sheet kept simple.
//   - Show Your Thinking is submitted together with the quiz data (field:
//     `thinking`) and written into the final column of the correct lesson tab.
//
// Practice Mode vs Classroom Mode is unchanged: practice mode never calls this
// endpoint, and classroom mode submits exactly as before. The script does not
// need to distinguish them.
// ─────────────────────────────────────────────────────────────────────────────

// Paste the NEW v2 Google Sheet ID here before deploying.
const SPREADSHEET_ID = 'PASTE_NEW_ASSESSMENT_V2_SHEET_ID_HERE';

// Put your email address here.
const DAILY_DIGEST_EMAIL = 'brownc@weston.org';

// Daily digest settings.
const DAILY_DIGEST_HOUR = 7; // 7 AM
const DAILY_DIGEST_PROPERTY_KEY = 'LYFELABZ_V2_LAST_DIGEST_SENT_AT';

// ── The one shared schema for every lesson tab ────────────────────────────
// Column order is fixed. The tab name identifies the lesson, so no Lesson
// column exists. 🧠 Show Your Thinking is always the final column.
const STANDARD_HEADERS = [
  'Timestamp', 'Student Name', 'Block',
  'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10',
  'Score', '🧠 Show Your Thinking',
];

// The URL-parameter names each lesson posts, in the same order as the headers
// above (Timestamp is added by the server and is not a submitted field).
const STANDARD_FIELDS = [
  'studentName', 'block',
  'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10',
  'score', 'thinking',
];

// Default header styling. A lesson may override the color in TAB_CONFIG below.
const DEFAULT_HEADER_COLOR = '#2ecc71';
const DEFAULT_FONT_COLOR   = '#0a1f0a';

// ── Registered lesson tabs ────────────────────────────────────────────────
// Every lesson or extension gets its own tab. Registering a new lesson is one
// line: the tab name, and optionally a header color. The schema is always
// STANDARD_HEADERS, so there is nothing else to configure.
//
// The registry is also the allowlist: doGet rejects any tab that is not listed
// here, so a typo in a lesson never creates a stray tab.
const TAB_CONFIG = {
  'What Is Life': { headerColor: '#2ecc71', fontColor: '#0a1f0a' },
  // Add future HQIM lessons here, one line each, e.g.:
  // 'Nature of Waves': { headerColor: '#3bc8e8', fontColor: '#0a1f2e' },
};

// ── Main handler ──────────────────────────────────────────────────────────
function doGet(e) {
  try {
    var params  = e.parameter;
    var tabName  = params.tab;

    if (!tabName || !TAB_CONFIG[tabName]) {
      return respond('error', 'Unknown tab: ' + tabName);
    }

    var config = TAB_CONFIG[tabName];
    var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet  = getOrCreateSheet(ss, tabName, config);

    var row = [new Date()];
    STANDARD_FIELDS.forEach(function(field) {
      row.push(params[field] !== undefined ? params[field] : '');
    });

    sheet.insertRows(2, 1);
    sheet.getRange(2, 1, 1, STANDARD_HEADERS.length).setValues([row]).setWrap(true);

    return respond('success', 'Row added to ' + tabName);
  } catch (err) {
    return respond('error', err.toString());
  }
}

// ── Helper: get or create sheet ───────────────────────────────────────────
function getOrCreateSheet(ss, name, config) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.setFrozenRows(1);
  }

  var headerRange = sheet.getRange(1, 1, 1, STANDARD_HEADERS.length);
  headerRange.setValues([STANDARD_HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground(config.headerColor || DEFAULT_HEADER_COLOR);
  headerRange.setFontColor(config.fontColor || DEFAULT_FONT_COLOR);
  headerRange.setFontSize(11);
  headerRange.setWrap(true);

  // Timestamp and Student Name get wider columns; the ten answer columns stay
  // narrow; Score narrow; Show Your Thinking (last) is the widest.
  var lastCol = STANDARD_HEADERS.length;
  for (var i = 1; i <= lastCol; i++) {
    var width;
    if (i === 1)            width = 180; // Timestamp
    else if (i === 2)       width = 160; // Student Name
    else if (i === 3)       width = 70;  // Block
    else if (i === lastCol) width = 360; // 🧠 Show Your Thinking
    else if (i === lastCol - 1) width = 80; // Score
    else                    width = 55;  // Q1-Q10
    sheet.setColumnWidth(i, width);
  }
  return sheet;
}

// ── Helper: JSON response ─────────────────────────────────────────────────
function respond(status, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY EMAIL DIGEST
// A morning summary of every submission since the last email. On silent days no
// email is sent and the last-sent timestamp is left untouched, so the next
// digest's window still reaches back to the last email that went out.
// ═══════════════════════════════════════════════════════════════════════════

function setupDailySubmissionDigest() {
  deleteDailySubmissionDigestTriggers();
  ScriptApp.newTrigger('sendDailySubmissionDigest')
    .timeBased()
    .everyDays(1)
    .atHour(DAILY_DIGEST_HOUR)
    .create();
  Logger.log('Daily LyfeLabz v2 submission digest trigger created.');
}

function deleteDailySubmissionDigestTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'sendDailySubmissionDigest') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  Logger.log('Existing daily digest triggers removed.');
}

function sendDailySubmissionDigest() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var now   = new Date();
  var props = PropertiesService.getScriptProperties();

  var lastSentString = props.getProperty(DAILY_DIGEST_PROPERTY_KEY);
  var lastSent = lastSentString
    ? new Date(lastSentString)
    : new Date(now.getTime() - 24 * 60 * 60 * 1000);

  var submissions = [];

  Object.keys(TAB_CONFIG).forEach(function(tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return;

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return;

    var headers = values[0].map(function(header) {
      return String(header).trim();
    });

    var timestampCol = findHeaderIndex(headers, ['Timestamp']);
    var nameCol      = findHeaderIndex(headers, ['Student Name', 'Name']);
    var blockCol     = findHeaderIndex(headers, ['Block']);
    var scoreCol     = findHeaderIndex(headers, ['Score']);

    if (timestampCol === -1 || nameCol === -1) return;

    for (var r = 1; r < values.length; r++) {
      var row       = values[r];
      var timestamp = row[timestampCol];

      if (!(timestamp instanceof Date)) {
        timestamp = new Date(timestamp);
      }
      if (isNaN(timestamp.getTime())) continue;

      if (timestamp > lastSent && timestamp <= now) {
        submissions.push({
          assignment:  tabName,
          studentName: row[nameCol] || '',
          block:       blockCol !== -1 ? row[blockCol] || '' : '',
          score:       scoreCol !== -1 ? row[scoreCol] || '' : '',
          timestamp:   timestamp,
        });
      }
    }
  });

  submissions.sort(function(a, b) { return a.timestamp - b.timestamp; });

  // Only send a digest when at least one student submitted in the window.
  if (submissions.length === 0) {
    Logger.log('No new submissions since the last digest. Email skipped.');
    return;
  }

  var subject  = 'LyfeLabz Daily Submissions';
  var body     = buildDailyDigestPlainText(submissions, lastSent, now);
  var htmlBody = buildDailyDigestHtml(submissions, lastSent, now);

  MailApp.sendEmail({
    to:       DAILY_DIGEST_EMAIL,
    subject:  subject,
    body:     body,
    htmlBody: htmlBody,
  });

  props.setProperty(DAILY_DIGEST_PROPERTY_KEY, now.toISOString());
  Logger.log('Daily digest sent. Submission count: ' + submissions.length);
}

function findHeaderIndex(headers, possibleNames) {
  for (var i = 0; i < headers.length; i++) {
    var normalizedHeader = normalizeHeader(headers[i]);
    for (var j = 0; j < possibleNames.length; j++) {
      if (normalizedHeader === normalizeHeader(possibleNames[j])) {
        return i;
      }
    }
  }
  return -1;
}

function normalizeHeader(header) {
  return String(header).trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildDailyDigestPlainText(submissions, lastSent, now) {
  var timezone = Session.getScriptTimeZone();
  var lines    = [];
  lines.push('LyfeLabz Daily Submissions');
  lines.push('');
  lines.push('Window: ' + formatDateForEmail(lastSent, timezone) + ' to ' + formatDateForEmail(now, timezone));
  lines.push('');
  lines.push('New submissions: ' + submissions.length);
  lines.push('');

  submissions.forEach(function(item) {
    lines.push('Assignment: ' + item.assignment);
    lines.push('Student: '    + item.studentName);
    lines.push('Block: '      + item.block);
    lines.push('Score: '      + item.score);
    lines.push('Submitted: '  + formatDateForEmail(item.timestamp, timezone));
    lines.push('');
  });

  return lines.join('\n');
}

function buildDailyDigestHtml(submissions, lastSent, now) {
  var timezone = Session.getScriptTimeZone();
  var html     = '';

  html += '<div style="font-family: Arial, sans-serif; color: #111827;">';
  html += '<h2 style="margin-bottom: 4px;">LyfeLabz Daily Submissions</h2>';
  html += '<p style="margin-top: 0; color: #4b5563;">';
  html += 'Window: ' + escapeHtml(formatDateForEmail(lastSent, timezone)) +
          ' to ' + escapeHtml(formatDateForEmail(now, timezone));
  html += '</p>';

  html += '<p><strong>New submissions: ' + submissions.length + '</strong></p>';
  html += '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; font-size: 14px;">';
  html += '<thead>';
  html += '<tr style="background-color: #111827; color: #ffffff;">';
  html += '<th align="left">Assignment</th>';
  html += '<th align="left">Student</th>';
  html += '<th align="left">Block</th>';
  html += '<th align="left">Score</th>';
  html += '<th align="left">Submitted</th>';
  html += '</tr>';
  html += '</thead>';
  html += '<tbody>';

  submissions.forEach(function(item) {
    html += '<tr>';
    html += '<td>' + escapeHtml(item.assignment)  + '</td>';
    html += '<td>' + escapeHtml(item.studentName) + '</td>';
    html += '<td>' + escapeHtml(item.block)       + '</td>';
    html += '<td>' + escapeHtml(item.score)       + '</td>';
    html += '<td>' + escapeHtml(formatDateForEmail(item.timestamp, timezone)) + '</td>';
    html += '</tr>';
  });

  html += '</tbody>';
  html += '</table>';
  html += '</div>';
  return html;
}

function formatDateForEmail(date, timezone) {
  return Utilities.formatDate(date, timezone, 'MM/dd/yyyy h:mm a');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST FUNCTION
// Writes one sample row using the shared schema. Run this after pasting the new
// SPREADSHEET_ID to confirm the tab, headers, and 🧠 Show Your Thinking column
// all render correctly.
// ═══════════════════════════════════════════════════════════════════════════

function testWhatIsLife() {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['What Is Life'];
  var sheet  = getOrCreateSheet(ss, 'What Is Life', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, STANDARD_HEADERS.length).setValues([[
    new Date(),
    'Test Student',
    'B',
    'B', 'C', 'A', 'D', 'B', 'C', 'A', 'B', 'C', 'D', // Q1-Q10
    '9/10',
    'A virus is missing the ability to use energy and reproduce on its own, so it is not truly alive.',
  ]]).setWrap(true);
  Logger.log('Test row written to What Is Life tab (v2 schema).');
}

function testDailySubmissionDigest() {
  sendDailySubmissionDigest();
}
