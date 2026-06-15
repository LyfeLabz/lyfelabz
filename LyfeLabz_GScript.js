// ═══════════════════════════════════════════════════════════════════════════
// LYFELABZ GOOGLE APPS SCRIPT
// Updated: 2026-06-15
// Changes from previous version:
//   - sendDailySubmissionDigest: now only sends the morning email when at
//     least one student submitted in the window (no submissions = no email)
//   - On silent days the last-sent timestamp is left untouched, so the next
//     digest's window still reaches back to the last email that went out
//   - No changes to TAB_CONFIG, historical data, or submission handling
// ─────────────────────────────────────────────────────────────────────────────
// Previous changes (2026-06-05):
//   - TAB_CONFIG: added 2 new entries (Nature of Waves, Wave Behavior)
//   - Test functions added for both new tabs
//   - Both lessons use standard score/percent payload (no answer transform needed)
//   - All existing tabs, historical data, and digest functions unchanged
// ─────────────────────────────────────────────────────────────────────────────
// Previous changes (2026-06-02):
//   - doGet: added params.activity fallback for Cell Energy + Amplitude pages
//   - TAB_CONFIG: added 6 new entries (Gray Zone, Protein Pathway, Virus
//     Extension, Neuron Explorer, Cell Energy Investigation, Amplitude Challenge)
//   - Test functions added for all 6 new tabs
//   - MISSED QUESTIONS UPDATE (2026-06-02):
//     - New quiz tabs now store "Missed Questions" instead of raw "Answers"
//     - ANSWER_KEYS holds the correct letter for each question per tab
//     - getMissedQuestions() transforms the submitted answers payload into a
//       teacher-friendly list of only the questions the student got wrong
//     - Neuron Explorer uses C/W format (no key needed); other tabs use A/B/C/D
//     - Amplitude Challenge sends a raw JSON array of chosen indices
//     - If a key is missing or parsing fails, the original value is preserved
// ═══════════════════════════════════════════════════════════════════════════

// Paste YOUR Google Sheet ID here before deploying
const SPREADSHEET_ID = '19vgi3c7UkUzO-UNUDRMKRDG9pT-F1Z-8o2PlE8bYHOc';

// Put your email address here
const DAILY_DIGEST_EMAIL = 'brownc@weston.org';

// Daily digest settings
const DAILY_DIGEST_HOUR = 7; // 7 AM
const DAILY_DIGEST_PROPERTY_KEY = 'LYFELABZ_LAST_DIGEST_SENT_AT';

// ── Answer keys for quiz tabs that use A/B/C/D selection ─────────────────
// Each array lists the correct letter for Q1, Q2, Q3, … in order.
// Neuron Explorer is handled separately (C/W format, no key needed).
// Amplitude Challenge stores correct option INDICES (0-based), not letters,
// because its HTML submits a raw JSON array of chosen indices.
const ANSWER_KEYS = {
  'Gray Zone':                 ['B','B','A','C','C','C','B','B'],
  'Protein Pathway':           ['C','B','A','A','A','D','B','B'],
  'Virus Extension':           ['C','C','B','B','A','C','B','C'],
  'Cell Energy Investigation': ['A','C','B','B','C'],
  'Amplitude Challenge':       [2, 3, 1, 1, 2],  // correct option indices, 0-based
  'Nature of Waves':           ['B','B','C','C','C','C','B','C','C','B'],
  'Wave Behavior':             ['A','C','B','B','D','C','D','A','C','A'],
};

// Tabs that need the answers field transformed before writing
const TABS_WITH_ANSWER_TRANSFORM = {
  'Gray Zone':                 true,
  'Protein Pathway':           true,
  'Virus Extension':           true,
  'Neuron Explorer':           true,
  'Cell Energy Investigation': true,
  'Amplitude Challenge':       true,
  'Nature of Waves':           true,
  'Wave Behavior':             true,
};

const TAB_CONFIG = {

  // ── EXISTING TABS — UNCHANGED ────────────────────────────────────────────

  'Beetle Island': {
    headers: [
      'Timestamp','Student Name','Environment','Event','Total Generations','Graph Accuracy',
      'Q1 — Graph Shape & Key Generation','Q2 — Predator Event Effect',
      'Q3 — Prediction (10 More Generations)','Q4 — Why a Line Graph',
    ],
    fields: ['studentName','environment','eventType','totalGens','accuracy','q1','q2','q3','q4'],
    headerColor: '#e8820a', fontColor: '#ffffff',
  },

  'Layers': {
    headers: ['Timestamp','Student Name','Block','Score','Percent'],
    fields: ['studentName','block','score','percent'],
    headerColor: '#7a8fa6', fontColor: '#ffffff',
  },

  'What Is Life': {
    headers: ['Timestamp','Student Name','Teacher','Block','Score','Percent'],
    fields: ['studentName','teacher','block','score','percent'],
    headerColor: '#2ecc71', fontColor: '#0a1f0a',
  },

  'Organelles': {
    headers: ['Timestamp','Student Name','Block','Score','Percent'],
    fields: ['studentName','block','score','percent'],
    headerColor: '#27ae60', fontColor: '#ffffff',
  },

  'Body Systems': {
    headers: ['Timestamp','Student Name','Block','Score','Percent'],
    fields: ['studentName','block','score','percent'],
    headerColor: '#3bc8e8', fontColor: '#0a1f2e',
  },

  'Bio Evolution': {
    headers: ['Timestamp','Student Name','Block','Score','Percent'],
    fields: ['studentName','block','score','percent'],
    headerColor: '#c48a4e', fontColor: '#ffffff',
  },

  'Chernobyl Frogs': {
    headers: [
      'Timestamp','Student Name','Scenario','Event','Total Generations','Graph Accuracy',
      'Q1 — Graph Shape & Key Generation','Q2 — Chernobyl Event Effect',
      'Q3 — Prediction (10 More Generations)','Q4 — Why a Line Graph',
    ],
    fields: ['studentName','environment','eventType','totalGens','accuracy','q1','q2','q3','q4'],
    headerColor: '#3bc8e8', fontColor: '#0a1f2e',
  },

  'ContinentalDrift': {
    headers: ['Timestamp','Student Name','Teacher','Block','Score','Percent'],
    fields: ['studentName','teacher','block','score','percent'],
    headerColor: '#7a8fa6', fontColor: '#ffffff',
  },

  'Layer Detective': {
    headers: ['Timestamp','Student Name','Teacher','Block','Hints Used','Quiz Score'],
    fields: ['studentName','teacher','block','hintsUsed','quizScore'],
    headerColor: '#7a8fa6', fontColor: '#ffffff',
  },

  'Floatlandia Fracture': {
    headers: ['Timestamp','Student Name','Teacher','Block','Quiz Score'],
    fields: ['studentName','teacher','block','quizScore'],
    headerColor: '#3bc8e8', fontColor: '#0a1f2e',
  },

  'Fossil Hunt': {
    headers: [
      'Timestamp','Student Name','Teacher','Block',
      'Difficulty','Groups Matched','Errors','Hints Used','Quiz Score',
    ],
    fields: ['studentName','teacher','block','difficulty','groupsMatched','errors','hintsUsed','quizScore'],
    headerColor: '#f5c842', fontColor: '#040814',
  },

  'Sun-Earth-Moon': {
    headers: ['Timestamp','Student Name','Teacher','Block','Score','Percent'],
    fields: ['studentName','teacher','block','score','percent'],
    headerColor: '#7a8fa6', fontColor: '#ffffff',
  },

  'Moon Phases': {
    headers: ['Timestamp','Student Name','Teacher','Block','Score','Percent'],
    fields: ['studentName','teacher','block','score','percent'],
    headerColor: '#7a8fa6', fontColor: '#ffffff',
  },

  'Gravity Wells': {
    headers: ['Timestamp','Student Name','Teacher','Block','Quiz Score'],
    fields: ['studentName','teacher','block','quizScore'],
    headerColor: '#b47fff', fontColor: '#040814',
  },

  'Eclipses': {
    headers: ['Timestamp','Student Name','Teacher','Block','Score','Percent'],
    fields: ['studentName','teacher','block','score','percent'],
    headerColor: '#7a8fc8', fontColor: '#ffffff',
  },

  'Eclipse Alignment': {
    headers: ['Timestamp','Student Name','Teacher','Block','Score','Percent'],
    fields: ['studentName','teacher','block','score','percent'],
    headerColor: '#7a8fc8', fontColor: '#ffffff',
  },

  // ── NEW TABS ─────────────────────────────────────────────────────────────

  // Standard quiz-based investigations/extensions.
  // All send: tab, studentName, teacher, block, quizScore, answers.
  // "Answers" payload is transformed to "Missed Questions" before writing.

  'Gray Zone': {
    headers: ['Timestamp','Student Name','Teacher','Block','Quiz Score','Missed Questions'],
    fields: ['studentName','teacher','block','quizScore','answers'],
    headerColor: '#3B82F6', fontColor: '#ffffff',
  },

  'Protein Pathway': {
    headers: ['Timestamp','Student Name','Teacher','Block','Quiz Score','Missed Questions'],
    fields: ['studentName','teacher','block','quizScore','answers'],
    headerColor: '#e67e22', fontColor: '#ffffff',
  },

  'Virus Extension': {
    headers: ['Timestamp','Student Name','Teacher','Block','Quiz Score','Missed Questions'],
    fields: ['studentName','teacher','block','quizScore','answers'],
    headerColor: '#27ae60', fontColor: '#ffffff',
  },

  // Neuron Explorer sends C/W per question (options shuffle each render).
  // Missed Questions lists only the question numbers where the student answered W.
  'Neuron Explorer': {
    headers: ['Timestamp','Student Name','Teacher','Block','Quiz Score','Missed Questions'],
    fields: ['studentName','teacher','block','quizScore','answers'],
    headerColor: '#9b59b6', fontColor: '#ffffff',
  },

  // HTML sends 'activity' (not 'tab') — routed via params.activity fallback.
  // HTML also sends 'student' (not 'studentName') and 'score' (not 'quizScore').
  // Field names match the HTML payload exactly.
  'Cell Energy Investigation': {
    headers: ['Timestamp','Student Name','Teacher','Block','Score','Missed Questions'],
    fields: ['student','teacher','block','score','answers'],
    headerColor: '#2ecc71', fontColor: '#0a1f0a',
  },

  // HTML sends 'activity' (not 'tab') — routed via params.activity fallback.
  // quizAnswers is a raw JSON array of chosen option indices (e.g. [0,2,1,3,2]).
  // It is transformed to Missed Questions before writing; other CER fields unchanged.
  'Amplitude Challenge': {
    headers: [
      'Timestamp','Student Name','Teacher','Block',
      'Quiz Score','Missed Questions',
      'Prediction','Trials (JSON)','Target Attempts (JSON)',
      'Model Choice','CER Claim','CER Evidence','CER Reasoning',
      'Submitted At (Client)',
    ],
    fields: [
      'studentName','teacher','block',
      'quizScore','quizAnswers',
      'prediction','trials','targetAttempts',
      'modelChoice','cerClaim','cerEvidence','cerReasoning',
      'submittedAt',
    ],
    headerColor: '#3498db', fontColor: '#ffffff',
  },

  // Standard 10-question lessons. Send: tab, studentName, teacher, block, score, percent.
  // No answer transform needed.

  'Nature of Waves': {
    headers: ['Timestamp','Student Name','Teacher','Block','Score','Percent','Missed Questions'],
    fields: ['studentName','teacher','block','score','percent','answers'],
    headerColor: '#3bc8e8', fontColor: '#0a1f2e',
  },

  'Wave Behavior': {
    headers: ['Timestamp','Student Name','Teacher','Block','Score','Percent','Missed Questions'],
    fields: ['studentName','teacher','block','score','percent','answers'],
    headerColor: '#3498db', fontColor: '#ffffff',
  },

};

// ── Main handler ──────────────────────────────────────────────────────────
function doGet(e) {
  try {
    var params = e.parameter;
    // Standard pages send params.tab.
    // Cell Energy Investigation and Amplitude Challenge send params.activity.
    var tabName = params.tab || params.activity;

    if (!tabName || !TAB_CONFIG[tabName]) {
      return respond('error', 'Unknown tab: ' + tabName);
    }

    var config = TAB_CONFIG[tabName];
    var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet  = getOrCreateSheet(ss, tabName, config);

    var row = [new Date()];
    config.fields.forEach(function(field) {
      var val = params[field] !== undefined ? params[field] : '';
      // Transform the answers field to Missed Questions for new quiz tabs.
      // 'answers' covers Gray Zone, Protein Pathway, Virus Extension,
      // Neuron Explorer, and Cell Energy Investigation.
      // 'quizAnswers' covers Amplitude Challenge (raw JSON array of indices).
      if (TABS_WITH_ANSWER_TRANSFORM[tabName] &&
          (field === 'answers' || field === 'quizAnswers')) {
        val = getMissedQuestions(tabName, val);
      }
      row.push(val);
    });

    sheet.insertRows(2, 1);
    sheet.getRange(2, 1, 1, config.headers.length).setValues([row]).setWrap(true);

    return respond('success', 'Row added to ' + tabName);
  } catch (err) {
    return respond('error', err.toString());
  }
}

// ── Helper: transform raw answers into a Missed Questions string ──────────
// Returns only the questions the student got wrong.
// Returns 'None' when the student answered everything correctly.
// Falls back to the original value if the key is missing or parsing fails.
function getMissedQuestions(tabName, rawAnswers) {
  try {
    // Neuron Explorer: C/W format — e.g. "Q1:C, Q2:W, Q3:C, Q4:W"
    // Output: question numbers only — e.g. "Q2, Q4"
    if (tabName === 'Neuron Explorer') {
      var missed = [];
      rawAnswers.split(',').forEach(function(pair) {
        var parts = pair.trim().split(':');
        if (parts.length === 2 && parts[1].trim().toUpperCase() === 'W') {
          missed.push(parts[0].trim());
        }
      });
      return missed.length === 0 ? 'None' : missed.join(', ');
    }

    // Amplitude Challenge: raw JSON array of chosen option indices
    // e.g. "[0,2,1,3,2]" compared against ANSWER_KEYS['Amplitude Challenge']
    if (tabName === 'Amplitude Challenge') {
      var key     = ANSWER_KEYS['Amplitude Challenge'];
      var chosen  = JSON.parse(rawAnswers);
      var letters = ['A','B','C','D'];
      var missed  = [];
      chosen.forEach(function(idx, i) {
        if (i >= key.length) return;
        if (idx !== key[i]) {
          var letter = (idx !== null && idx >= 0 && idx < letters.length)
                       ? letters[idx] : '?';
          missed.push('Q' + (i + 1) + ':' + letter);
        }
      });
      return missed.length === 0 ? 'None' : missed.join(', ');
    }

    // Standard A/B/C/D format: "Q1:B, Q2:C, Q3:A, …"
    var key = ANSWER_KEYS[tabName];
    if (!key) return rawAnswers; // no key defined — preserve original

    var missed = [];
    rawAnswers.split(',').forEach(function(pair) {
      var parts = pair.trim().split(':');
      if (parts.length !== 2) return;
      var qLabel  = parts[0].trim();                          // e.g. "Q3"
      var chosen  = parts[1].trim().toUpperCase();            // e.g. "A"
      var qIdx    = parseInt(qLabel.replace(/\D/g, ''), 10) - 1; // 0-based index
      if (isNaN(qIdx) || qIdx < 0 || qIdx >= key.length) return;
      if (chosen !== key[qIdx]) {
        missed.push(qLabel + ':' + chosen);
      }
    });
    return missed.length === 0 ? 'None' : missed.join(', ');

  } catch (err) {
    return rawAnswers; // fallback: preserve original on any error
  }
}

// ── Helper: get or create sheet ───────────────────────────────────────────
function getOrCreateSheet(ss, name, config) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.setFrozenRows(1);
  }

  var headerRange = sheet.getRange(1, 1, 1, config.headers.length);
  headerRange.setValues([config.headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground(config.headerColor);
  headerRange.setFontColor(config.fontColor);
  headerRange.setFontSize(11);
  headerRange.setWrap(true);

  for (var i = 1; i <= config.headers.length; i++) {
    sheet.setColumnWidth(i, i === 1 ? 180 : i === 2 ? 160 : 260);
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
// ═══════════════════════════════════════════════════════════════════════════

function setupDailySubmissionDigest() {
  deleteDailySubmissionDigestTriggers();
  ScriptApp.newTrigger('sendDailySubmissionDigest')
    .timeBased()
    .everyDays(1)
    .atHour(DAILY_DIGEST_HOUR)
    .create();
  Logger.log('Daily LyfeLabz submission digest trigger created.');
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
    var teacherCol   = findHeaderIndex(headers, ['Teacher']);
    var blockCol     = findHeaderIndex(headers, ['Block']);

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
          teacher:     teacherCol !== -1 ? row[teacherCol] || '' : '',
          block:       blockCol   !== -1 ? row[blockCol]   || '' : '',
          timestamp:   timestamp,
        });
      }
    }
  });

  submissions.sort(function(a, b) { return a.timestamp - b.timestamp; });

  // Only send a digest when at least one student submitted in the window.
  // No submissions = no email. We also leave the "last sent" timestamp
  // untouched so the next digest's window reaches back to the last time an
  // email actually went out (no submissions get skipped over).
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

  if (submissions.length === 0) {
    lines.push('No new submissions since the last digest.');
    return lines.join('\n');
  }

  lines.push('New submissions: ' + submissions.length);
  lines.push('');

  submissions.forEach(function(item) {
    lines.push('Assignment: ' + item.assignment);
    lines.push('Student: '    + item.studentName);
    lines.push('Teacher: '    + item.teacher);
    lines.push('Block: '      + item.block);
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

  if (submissions.length === 0) {
    html += '<p><strong>No new submissions since the last digest.</strong></p>';
    html += '</div>';
    return html;
  }

  html += '<p><strong>New submissions: ' + submissions.length + '</strong></p>';
  html += '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; font-size: 14px;">';
  html += '<thead>';
  html += '<tr style="background-color: #111827; color: #ffffff;">';
  html += '<th align="left">Assignment</th>';
  html += '<th align="left">Student</th>';
  html += '<th align="left">Teacher</th>';
  html += '<th align="left">Block</th>';
  html += '<th align="left">Submitted</th>';
  html += '</tr>';
  html += '</thead>';
  html += '<tbody>';

  submissions.forEach(function(item) {
    html += '<tr>';
    html += '<td>' + escapeHtml(item.assignment)  + '</td>';
    html += '<td>' + escapeHtml(item.studentName) + '</td>';
    html += '<td>' + escapeHtml(item.teacher)     + '</td>';
    html += '<td>' + escapeHtml(item.block)       + '</td>';
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
// TEST FUNCTIONS — EXISTING (unchanged)
// ═══════════════════════════════════════════════════════════════════════════

function testFossilHunt() {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Fossil Hunt'];
  var sheet  = getOrCreateSheet(ss, 'Fossil Hunt', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(),
    'Test Student',
    'Mr. Brown',
    'B',
    'practice',
    '3/3',
    2,
    1,
    '8/10',
  ]]).setWrap(true);
  Logger.log('Test row written to Fossil Hunt tab.');
}

function testSunEarthMoon() {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Sun-Earth-Moon'];
  var sheet  = getOrCreateSheet(ss, 'Sun-Earth-Moon', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(), 'Test Student', 'Mr. Brown', 'B', '9/10', '90%',
  ]]).setWrap(true);
  Logger.log('Test row written to Sun-Earth-Moon tab.');
}

function testMoonPhases() {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Moon Phases'];
  var sheet  = getOrCreateSheet(ss, 'Moon Phases', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(), 'Test Student', 'Mr. Brown', 'B', '9/10', '90%',
  ]]).setWrap(true);
  Logger.log('Test row written to Moon Phases tab.');
}

function testGravityWells() {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Gravity Wells'];
  var sheet  = getOrCreateSheet(ss, 'Gravity Wells', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(), 'Test Student', 'Mr. Brown', 'B', '4/5',
  ]]).setWrap(true);
  Logger.log('Test row written to Gravity Wells tab.');
}

function testWhatIsLife() {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['What Is Life'];
  var sheet  = getOrCreateSheet(ss, 'What Is Life', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(), 'Test Student', 'Mr. Brown', 'B', '9/10', '90%',
  ]]).setWrap(true);
  Logger.log('Test row written to What Is Life tab.');
}

function testEclipses() {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Eclipses'];
  var sheet  = getOrCreateSheet(ss, 'Eclipses', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(), 'Test Student', 'Mr. Brown', 'B', '8/10', '80%',
  ]]).setWrap(true);
  Logger.log('Test row written to Eclipses tab.');
}

function testEclipseAlignment() {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Eclipse Alignment'];
  var sheet  = getOrCreateSheet(ss, 'Eclipse Alignment', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(), 'Test Student', 'Mr. Brown', 'B', '8/10', '80%',
  ]]).setWrap(true);
  Logger.log('Test row written to Eclipse Alignment tab.');
}

function testDailySubmissionDigest() {
  sendDailySubmissionDigest();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST FUNCTIONS — NEW (six new tabs)
// Column 6 is now "Missed Questions" — test rows write pre-computed values
// directly (test functions bypass doGet and do not run the transform).
// ═══════════════════════════════════════════════════════════════════════════

function testGrayZone() {
  // Key: Q1:B Q2:B Q3:A Q4:C Q5:C Q6:C Q7:B Q8:B
  // Simulated: student missed Q2 (chose A) and Q5 (chose D) — score 6/8
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Gray Zone'];
  var sheet  = getOrCreateSheet(ss, 'Gray Zone', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(),
    'Test Student',
    'Mr. Brown',
    'B',
    '6/8',
    'Q2:A, Q5:D',
  ]]).setWrap(true);
  Logger.log('Test row written to Gray Zone tab.');
}

function testProteinPathway() {
  // Key: Q1:C Q2:B Q3:A Q4:A Q5:A Q6:D Q7:B Q8:B
  // Simulated: student missed Q6 (chose B) — score 7/8
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Protein Pathway'];
  var sheet  = getOrCreateSheet(ss, 'Protein Pathway', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(),
    'Test Student',
    'Mr. Brown',
    'B',
    '7/8',
    'Q6:B',
  ]]).setWrap(true);
  Logger.log('Test row written to Protein Pathway tab.');
}

function testVirusExtension() {
  // Key: Q1:C Q2:C Q3:B Q4:B Q5:A Q6:C Q7:B Q8:C
  // Simulated: student missed Q1 (chose A) and Q8 (chose B) — score 6/8
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Virus Extension'];
  var sheet  = getOrCreateSheet(ss, 'Virus Extension', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(),
    'Test Student',
    'Ms. Gay',
    'C',
    '6/8',
    'Q1:A, Q8:B',
  ]]).setWrap(true);
  Logger.log('Test row written to Virus Extension tab.');
}

function testNeuronExplorer() {
  // C/W format: only wrong question numbers are stored (no letter — options shuffle).
  // Simulated: student missed Q3 and Q8 — score 6/8
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Neuron Explorer'];
  var sheet  = getOrCreateSheet(ss, 'Neuron Explorer', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(),
    'Test Student',
    'Mr. Brown',
    'A',
    '6/8',
    'Q3, Q8',
  ]]).setWrap(true);
  Logger.log('Test row written to Neuron Explorer tab.');
}

function testCellEnergyInvestigation() {
  // Key: Q1:A Q2:C Q3:B Q4:B Q5:C
  // HTML sends 'student' (not 'studentName') and 'score' (not 'quizScore').
  // Simulated: student missed Q2 (chose A) — score 4/5
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Cell Energy Investigation'];
  var sheet  = getOrCreateSheet(ss, 'Cell Energy Investigation', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(),
    'Test Student',
    'Ms. Gay',
    'B',
    '4/5',
    'Q2:A',
  ]]).setWrap(true);
  Logger.log('Test row written to Cell Energy Investigation tab.');
}

function testNatureOfWaves() {
  // Key: Q1:B Q2:B Q3:C Q4:C Q5:C Q6:C Q7:B Q8:C Q9:C Q10:B
  // Simulated: student missed Q5 (chose A) and Q9 (chose A) — score 8/10
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Nature of Waves'];
  var sheet  = getOrCreateSheet(ss, 'Nature of Waves', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(), 'Test Student', 'Mr. Brown', 'B', '8/10', '80%', 'Q5:A, Q9:A',
  ]]).setWrap(true);
  Logger.log('Test row written to Nature of Waves tab.');
}

function testWaveBehavior() {
  // Key: Q1:A Q2:C Q3:B Q4:B Q5:D Q6:C Q7:D Q8:A Q9:C Q10:A
  // Simulated: student missed Q5 (chose B) and Q7 (chose C) — score 8/10
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Wave Behavior'];
  var sheet  = getOrCreateSheet(ss, 'Wave Behavior', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(), 'Test Student', 'Mr. Brown', 'B', '8/10', '80%', 'Q5:B, Q7:C',
  ]]).setWrap(true);
  Logger.log('Test row written to Wave Behavior tab.');
}

function testAmplitudeChallenge() {
  // Key (option indices): Q1:2(C) Q2:3(D) Q3:1(B) Q4:1(B) Q5:2(C)
  // HTML sends 'activity' (not 'tab') — routed via the params.activity fallback.
  // Simulated: student missed Q3 (chose A, index 0) — quiz score 4
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var config = TAB_CONFIG['Amplitude Challenge'];
  var sheet  = getOrCreateSheet(ss, 'Amplitude Challenge', config);
  sheet.insertRows(2, 1);
  sheet.getRange(2, 1, 1, config.headers.length).setValues([[
    new Date(),
    'Test Student',
    'Mr. Brown',
    'B',
    '4',
    'Q3:A',
    'Larger amplitude means more energy.',
    '[[1,50],[2,75],[3,100]]',
    '[[1,2],[2,1]]',
    'linear',
    'Amplitude and energy are directly proportional.',
    'Trial 1: amplitude 1, energy 50. Trial 2: amplitude 2, energy 75.',
    'Doubling amplitude more than doubles energy.',
    new Date().toISOString(),
  ]]).setWrap(true);
  Logger.log('Test row written to Amplitude Challenge tab.');
}
