// ============================================================================
// LYFELABZ CENTRALIZED ASSESSMENT BACKEND
// Sprint S3A - 2026-07-15
//
// Implementation of docs/V1_CENTRALIZED_ASSESSMENT_SUBMISSION_ARCHITECTURE.md
//
// One doPost handler routes every registered resource to the appropriate
// teacher spreadsheet. Spreadsheet IDs are stored in Script Properties, not
// in this source file.
//
// Setup: In Apps Script Project Settings > Script Properties, add:
//   SPREADSHEET_MR_BROWN   <Google Sheet ID>
//   SPREADSHEET_MS_GAY     <Google Sheet ID>
//   SPREADSHEET_MR_KANKEL  <Google Sheet ID>
//   SPREADSHEET_MR_ROVNER  <Google Sheet ID>
//   DIGEST_EMAIL           <recipient email address>
// ============================================================================

// ── Digest settings ──────────────────────────────────────────────────────────
var DAILY_DIGEST_HOUR         = 7;
var DAILY_DIGEST_PROPERTY_KEY = 'LYFELABZ_CENTRALIZED_LAST_DIGEST_SENT_AT';

// ── Header styling defaults ───────────────────────────────────────────────────
var DEFAULT_HEADER_COLOR = '#2ecc71';
var DEFAULT_FONT_COLOR   = '#0a1f0a';

// ── Teacher Registry ──────────────────────────────────────────────────────────
// spreadsheetPropKey: the Script Property key that holds the actual spreadsheet ID.
var TEACHER_REGISTRY = {
  'mr-brown': {
    displayName:       'Mr. Brown',
    grade:             6,
    spreadsheetPropKey: 'SPREADSHEET_MR_BROWN',
    active:            true,
  },
  'ms-gay': {
    displayName:       'Ms. Gay',
    grade:             6,
    spreadsheetPropKey: 'SPREADSHEET_MS_GAY',
    active:            true,
  },
  'mr-kankel': {
    displayName:       'Mr. Kankel',
    grade:             7,
    spreadsheetPropKey: 'SPREADSHEET_MR_KANKEL',
    active:            true,
  },
  'mr-rovner': {
    displayName:       'Mr. Rovner',
    grade:             7,
    spreadsheetPropKey: 'SPREADSHEET_MR_ROVNER',
    active:            true,
  },
};

// ── Resource Registry ─────────────────────────────────────────────────────────
// Every resource that submits to this backend is registered here. The registry
// is the server allowlist: any resourceId not in this object is rejected.
//
// Fields:
//   displayTitle          Student-facing name; also the worksheet tab label by default.
//   grade                 6 or 7.
//   resourceType          'lesson' | 'investigation' | 'simulation' | 'extension' |
//                         'challenge' | 'game'
//   expectedQuestionCount Number of q1..qN fields the server requires in the payload.
//                         0 means no per-question validation.
//   thinkingRequired      If true, 'thinking' must be non-empty.
//   worksheetName         Optional. Override only when displayTitle exceeds 31 chars
//                         or contains characters that cause Sheets API errors.
//   extendedFields        Optional array of approved additional field names beyond
//                         the canonical payload. Any submitted field not in the
//                         canonical set or this list is rejected before spreadsheet
//                         access. The unauthorized field name is logged server-side;
//                         the response does not expose it.
//   headerColor / fontColor  Optional header row styling. Defaults to script constants.
//
// Migration note: resources marked with pendingMigration:true currently send
// a legacy GET payload to per-teacher endpoints. Their q1..qN and canonical
// field names will be wired up in Sprint S3B (client migration). The registry
// entries here represent the canonical goal state so the server is ready
// to accept them the moment the client is updated.

var RESOURCE_REGISTRY = {

  // ── Grade 6 Lessons ────────────────────────────────────────────────────────

  'lesson_what-is-life': {
    displayTitle:          'What Is Life',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_nature-of-waves': {
    displayTitle:          'Nature of Waves',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_wave-behavior': {
    displayTitle:          'Wave Behavior',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_digital-signals': {
    displayTitle:          'Digital Signals',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_cell-types': {
    displayTitle:          'Cell Types',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_body-systems': {
    displayTitle:          'Body Systems',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 15,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_organelles': {
    displayTitle:          'Organelles',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_biological-evolution': {
    displayTitle:          'Biological Evolution',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_chemical-reactions': {
    displayTitle:          'Chemical Reactions',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_choosing-materials': {
    displayTitle:          'Choosing Materials',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_conducting-experiments': {
    displayTitle:          'How to Conduct Experiments',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_continental-drift': {
    displayTitle:          'Continental Drift',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_designing-to-scale': {
    displayTitle:          'Designing to Scale',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_eclipses': {
    displayTitle:          'Eclipses',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_engineering-design': {
    displayTitle:          'Engineering Design',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_gravity': {
    displayTitle:          'Gravity',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_layers-of-time': {
    displayTitle:          'Layers of Time',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_measuring-matter': {
    displayTitle:          'Measuring Matter',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_phases-of-the-moon': {
    displayTitle:          'Phases of the Moon',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_physical-properties': {
    displayTitle:          'Physical Properties',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_pure-substances-and-mixtures': {
    displayTitle:          'Pure Substances and Mixtures',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_ragebaiting': {
    displayTitle:          "Don't Take the Bait",
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_sun-earth-moon': {
    displayTitle:          'Sun-Earth-Moon System',
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },
  'lesson_earths-place-in-the-universe': {
    displayTitle:          "Earth's Place in the Universe",
    grade:                 6,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#2ecc71',
    fontColor:             '#0a1f0a',
  },

  // ── Grade 7 Lessons ────────────────────────────────────────────────────────

  'lesson_earths-layers': {
    displayTitle:          "Earth's Layers",
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_carbon-cycle': {
    displayTitle:          'Carbon Cycle',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_communication-systems': {
    displayTitle:          'Communication Systems',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_design-tradeoffs': {
    displayTitle:          'Design Tradeoffs',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_earthquakes': {
    displayTitle:          'Earthquakes',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_ecosystem-stability': {
    displayTitle:          'Ecosystem Stability',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_energy-flow': {
    displayTitle:          'Energy Flow',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_energy-transfer': {
    displayTitle:          'Energy Transfer',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_engineering-systems': {
    displayTitle:          'Engineering Systems',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_forms-of-energy': {
    displayTitle:          'Forms of Energy',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_heat-transfer': {
    displayTitle:          'Heat Transfer',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_hotspot-volcanoes': {
    displayTitle:          'Hotspot Volcanoes',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_human-impacts': {
    displayTitle:          'Human Impacts',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_innovation-and-sustainability': {
    displayTitle:          'Innovation and Sustainability',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_introduction-to-electricity': {
    displayTitle:          'Introduction to Electricity',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_parts-of-an-ecosystem': {
    displayTitle:          'Parts of an Ecosystem',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_photosynthesis': {
    displayTitle:          'Photosynthesis',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_plate-tectonics': {
    displayTitle:          'Plate Tectonics',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_renewable-and-nonrenewable-resources': {
    displayTitle:          'Renewable and Nonrenewable Resources',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    worksheetName:         'Renewable Resources',
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_reproductive-success': {
    displayTitle:          'Reproductive Success',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_structural-systems': {
    displayTitle:          'Structural Systems',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_technology-and-society': {
    displayTitle:          'Technology and Society',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_transportation-systems': {
    displayTitle:          'Transportation Systems',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_types-of-volcanoes': {
    displayTitle:          'Types of Volcanoes',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_water-cycle': {
    displayTitle:          'Water Cycle',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },
  'lesson_weathering-and-erosion': {
    displayTitle:          'Weathering and Erosion',
    grade:                 7,
    resourceType:          'lesson',
    expectedQuestionCount: 10,
    thinkingRequired:      true,
    headerColor:           '#7a8fa6',
    fontColor:             '#ffffff',
  },

  // ── Grade 6 Engineering Challenges ────────────────────────────────────────

  'challenge_welcome-to-floatia': {
    displayTitle:          'Welcome to Floatia: Engineering Challenge',
    grade:                 6,
    resourceType:          'challenge',
    expectedQuestionCount: 10,
    thinkingRequired:      false,
    worksheetName:         'Welcome to Floatia',
    headerColor:           '#ff5470',
    fontColor:             '#ffffff',
  },

  // ── Grade 6 Extensions ────────────────────────────────────────────────────
  // pendingMigration: these currently use legacy GET payloads with compact
  // quizScore/answers fields. Client migration happens in Sprint S3B.
  // expectedQuestionCount reflects the actual quiz size; individual q1..qN
  // fields will be wired up when the client is updated.

  'extension_chernobyl-frogs': {
    displayTitle:          'Chernobyl Tree Frogs',
    grade:                 6,
    resourceType:          'extension',
    expectedQuestionCount: 4,
    thinkingRequired:      false,
    extendedFields:        ['environment', 'eventType', 'totalGens', 'accuracy'],
    headerColor:           '#3498db',
    fontColor:             '#ffffff',
  },
  'extension_fossil-hunt': {
    displayTitle:          'Fossil Hunt',
    grade:                 6,
    resourceType:          'extension',
    expectedQuestionCount: 10,
    thinkingRequired:      false,
    extendedFields:        ['difficulty', 'groupsMatched', 'errors', 'hintsUsed', 'quizAnswers'],
    headerColor:           '#3498db',
    fontColor:             '#ffffff',
  },
  'extension_hidden-world-of-matter': {
    displayTitle:          'The Hidden World of Matter',
    grade:                 6,
    resourceType:          'extension',
    expectedQuestionCount: 10,
    thinkingRequired:      false,
    extendedFields:        ['answers'],
    headerColor:           '#3498db',
    fontColor:             '#ffffff',
  },
  'extension_neuron-explorer': {
    displayTitle:          'Neuron Explorer',
    grade:                 6,
    resourceType:          'extension',
    expectedQuestionCount: 8,
    thinkingRequired:      false,
    extendedFields:        ['answers'],
    headerColor:           '#3498db',
    fontColor:             '#ffffff',
  },
  'extension_virus': {
    displayTitle:          'Are Viruses Alive?',
    grade:                 6,
    resourceType:          'extension',
    expectedQuestionCount: 8,
    thinkingRequired:      false,
    worksheetName:         'Are Viruses Alive',
    extendedFields:        ['answers'],
    headerColor:           '#3498db',
    fontColor:             '#ffffff',
  },

  // ── Grade 6 Games ─────────────────────────────────────────────────────────

  'game_layer-detective': {
    displayTitle:          'Layer Detective',
    grade:                 6,
    resourceType:          'game',
    expectedQuestionCount: 5,
    thinkingRequired:      false,
    extendedFields:        ['hintsUsed', 'quizAnswers'],
    headerColor:           '#f39c12',
    fontColor:             '#000000',
  },

  // ── Grade 6 Simulations ───────────────────────────────────────────────────

  'simulation_beetle-island': {
    displayTitle:          'Beetle Island',
    grade:                 6,
    resourceType:          'simulation',
    expectedQuestionCount: 4,
    thinkingRequired:      false,
    extendedFields:        ['environment', 'eventType', 'totalGens', 'accuracy', 'prediction'],
    headerColor:           '#9b59b6',
    fontColor:             '#ffffff',
  },
  'simulation_eclipse-alignment': {
    displayTitle:          'Eclipse Alignment',
    grade:                 6,
    resourceType:          'simulation',
    expectedQuestionCount: 5,
    thinkingRequired:      false,
    headerColor:           '#9b59b6',
    fontColor:             '#ffffff',
  },
  'simulation_floatlandia-fracture': {
    displayTitle:          'Floatlandia Fracture',
    grade:                 6,
    resourceType:          'simulation',
    expectedQuestionCount: 5,
    thinkingRequired:      false,
    headerColor:           '#9b59b6',
    fontColor:             '#ffffff',
  },
  'simulation_gravity-wells': {
    displayTitle:          'Gravity Wells',
    grade:                 6,
    resourceType:          'simulation',
    expectedQuestionCount: 5,
    thinkingRequired:      false,
    headerColor:           '#9b59b6',
    fontColor:             '#ffffff',
  },

  // ── Grade 6 Investigations ────────────────────────────────────────────────

  'investigation_amplitude-challenge': {
    displayTitle:          'Amplitude Challenge',
    grade:                 6,
    resourceType:          'investigation',
    expectedQuestionCount: 5,
    thinkingRequired:      false,
    extendedFields:        [
      'prediction', 'trials', 'targetAttempts', 'modelChoice',
      'cerClaim', 'cerEvidence', 'cerReasoning', 'quizAnswers',
    ],
    headerColor:           '#e67e22',
    fontColor:             '#ffffff',
  },
  'investigation_cell-energy': {
    displayTitle:          'Cell Energy Investigation',
    grade:                 6,
    resourceType:          'investigation',
    expectedQuestionCount: 5,
    thinkingRequired:      false,
    extendedFields:        ['answers'],
    headerColor:           '#e67e22',
    fontColor:             '#ffffff',
  },
  'investigation_gray-zone': {
    displayTitle:          'The Gray Zone Investigation',
    grade:                 6,
    resourceType:          'investigation',
    expectedQuestionCount: 8,
    thinkingRequired:      false,
    extendedFields:        ['answers'],
    headerColor:           '#e67e22',
    fontColor:             '#ffffff',
  },
  'investigation_protein-pathway': {
    displayTitle:          'The Protein Pathway',
    grade:                 6,
    resourceType:          'investigation',
    expectedQuestionCount: 8,
    thinkingRequired:      false,
    extendedFields:        ['answers'],
    headerColor:           '#e67e22',
    fontColor:             '#ffffff',
  },

  // ── Grade 7 Investigations ────────────────────────────────────────────────

  'investigation_population-patterns': {
    displayTitle:          'Population Patterns',
    grade:                 7,
    resourceType:          'investigation',
    expectedQuestionCount: 10,
    thinkingRequired:      false,
    extendedFields:        [
      'prediction', 'checkpoints', 'cerClaim', 'cerEvidence', 'cerReasoning',
      'challengeChoice', 'challengeText', 'quizAnswers',
    ],
    headerColor:           '#e67e22',
    fontColor:             '#ffffff',
  },

};

// ── Canonical worksheet name resolution ──────────────────────────────────────
function resolveWorksheetName(resource) {
  return resource.worksheetName || resource.displayTitle;
}

// ── Schema builder ────────────────────────────────────────────────────────────
// Returns { headers, fields } for a resource entry. The question columns sit
// between the fixed leading and trailing columns.
var LEADING_HEADERS  = ['Timestamp', 'Student Name', 'Block'];
var TRAILING_HEADERS = ['Score', 'Show Your Thinking'];
var LEADING_FIELDS   = ['studentName', 'block'];
var TRAILING_FIELDS  = ['score', 'thinking'];

function buildSchema(resource) {
  var qHeaders = [];
  var qFields  = [];
  for (var i = 1; i <= resource.expectedQuestionCount; i++) {
    qHeaders.push('Q' + i);
    qFields.push('q' + i);
  }
  var extFields   = resource.extendedFields || [];
  var extHeaders  = extFields.map(function(f) { return toHeaderLabel(f); });
  return {
    headers: LEADING_HEADERS.concat(qHeaders, TRAILING_HEADERS, extHeaders),
    fields:  LEADING_FIELDS.concat(qFields, TRAILING_FIELDS, extFields),
  };
}

function toHeaderLabel(fieldName) {
  var map = {
    cerClaim:        'CER: Claim',
    cerEvidence:     'CER: Evidence',
    cerReasoning:    'CER: Reasoning',
    challengeChoice: 'Challenge Choice',
    challengeText:   'Challenge Response',
    modelChoice:     'Model Choice',
    quizAnswers:     'Quiz Answers (JSON)',
    targetAttempts:  'Target Attempts (JSON)',
    hintsUsed:       'Hints Used',
    groupsMatched:   'Groups Matched',
    totalGens:       'Total Generations',
    accuracy:        'Graph Accuracy',
    eventType:       'Event Type',
    environment:     'Environment',
    prediction:      'Prediction',
    difficulty:      'Difficulty',
    errors:          'Errors',
    trials:          'Trials (JSON)',
    checkpoints:     'Checkpoints (JSON)',
    answers:         'Answers (compact)',
  };
  return map[fieldName] || fieldName;
}

// ── Spreadsheet access ────────────────────────────────────────────────────────
function getSpreadsheet(teacher) {
  var id = PropertiesService.getScriptProperties()
             .getProperty(teacher.spreadsheetPropKey);
  if (!id) {
    throw new Error('Script Property not set: ' + teacher.spreadsheetPropKey);
  }
  return SpreadsheetApp.openById(id);
}

// ── Worksheet get-or-create ───────────────────────────────────────────────────
function getOrCreateSheet(ss, sheetName, resource, schema) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.setFrozenRows(1);
  }

  var headerColor = resource.headerColor || DEFAULT_HEADER_COLOR;
  var fontColor   = resource.fontColor   || DEFAULT_FONT_COLOR;

  var headerRange = sheet.getRange(1, 1, 1, schema.headers.length);
  headerRange.setValues([schema.headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground(headerColor);
  headerRange.setFontColor(fontColor);
  headerRange.setFontSize(11);
  headerRange.setWrap(true);

  applyColumnWidths(sheet, schema.headers.length);
  return sheet;
}

function applyColumnWidths(sheet, colCount) {
  for (var i = 1; i <= colCount; i++) {
    var header = sheet.getRange(1, i).getValue();
    var width;
    if (header === 'Timestamp')            width = 180;
    else if (header === 'Student Name')    width = 160;
    else if (header === 'Block')           width = 70;
    else if (header === 'Score')           width = 80;
    else if (header === 'Show Your Thinking') width = 360;
    else if (String(header).indexOf('JSON') !== -1) width = 220;
    else if (String(header).indexOf('CER') !== -1)  width = 200;
    else if (String(header).startsWith('Q'))         width = 55;
    else                                  width = 160;
    sheet.setColumnWidth(i, width);
  }
}

// ── JSON response helper ──────────────────────────────────────────────────────
function respond(status, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// doPost: the single submission handler
// Validation order per architecture section 7.2 + S3A field authorization:
//   1. resource   2. teacher   3. grade   4. teacher-grade   5. questions
//   6. thinking   7. field authorization   8. spreadsheet   9. worksheet   10. row write
// ============================================================================
function doPost(e) {
  try {
    var params = e.parameter;

    // 1. Resource validation
    var resourceId = params.resourceId;
    if (!resourceId || !RESOURCE_REGISTRY[resourceId]) {
      return respond('error', 'Unknown resource: ' + (resourceId || '(none)'));
    }
    var resource = RESOURCE_REGISTRY[resourceId];

    // 2. Teacher validation
    var teacherKey = params.teacher;
    if (!teacherKey || !TEACHER_REGISTRY[teacherKey]) {
      return respond('error', 'Unknown teacher: ' + (teacherKey || '(none)'));
    }
    var teacher = TEACHER_REGISTRY[teacherKey];
    if (!teacher.active) {
      return respond('error', 'Teacher is not active: ' + teacherKey);
    }

    // 3. Grade validation (payload grade vs resource grade)
    var payloadGrade = parseInt(params.grade, 10);
    if (isNaN(payloadGrade) || payloadGrade !== resource.grade) {
      return respond('error',
        'Grade mismatch: payload says ' + params.grade +
        ', resource is grade ' + resource.grade);
    }

    // 4. Teacher-grade cross-validation
    if (teacher.grade !== resource.grade) {
      return respond('error',
        'Teacher ' + teacherKey + ' is grade ' + teacher.grade +
        ', resource is grade ' + resource.grade);
    }

    // 5. Required field validation
    if (!params.studentName || !params.studentName.trim()) {
      return respond('error', 'Student name is required.');
    }

    var validBlocks = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    if (!params.block || validBlocks.indexOf(params.block.toUpperCase()) === -1) {
      return respond('error', 'Block must be A through G.');
    }

    if (!params.score || !params.score.trim()) {
      return respond('error', 'Score is required.');
    }

    // 6. Question completeness
    var n = resource.expectedQuestionCount;
    if (n > 0) {
      var found = 0;
      for (var i = 1; i <= n; i++) {
        if (params['q' + i] !== undefined && params['q' + i] !== '') found++;
      }
      if (found < n) {
        return respond('error',
          'Missing questions: expected ' + n + ', found ' + found);
      }
    }

    // 7. Show Your Thinking validation
    if (resource.thinkingRequired) {
      var thinking = params.thinking;
      if (!thinking || !thinking.trim()) {
        return respond('error',
          'Show Your Thinking response is required for this resource.');
      }
    }

    // 7b. Payload field authorization (must precede any spreadsheet access)
    var fieldAuthError = validatePayloadFields(params, resource);
    if (fieldAuthError) {
      return respond('error', fieldAuthError);
    }

    // 8. Spreadsheet access
    var ss;
    try {
      ss = getSpreadsheet(teacher);
    } catch (propErr) {
      Logger.log('Spreadsheet property error for teacher ' + teacherKey +
                 ': ' + propErr.message);
      return respond('error', 'Could not access teacher spreadsheet.');
    }

    // 9. Worksheet resolution and get-or-create
    var sheetName = resolveWorksheetName(resource);
    var schema    = buildSchema(resource);
    var sheet;
    try {
      sheet = getOrCreateSheet(ss, sheetName, resource, schema);
    } catch (sheetErr) {
      Logger.log('Worksheet error for ' + sheetName + ': ' + sheetErr.message);
      return respond('error', 'Could not access worksheet.');
    }

    // 10. Build row and insert at row 2
    var timestamp = new Date();
    var row = [timestamp];
    for (var fi = 0; fi < schema.fields.length; fi++) {
      var fieldName = schema.fields[fi];
      row.push(params[fieldName] !== undefined ? params[fieldName] : '');
    }

    sheet.insertRows(2, 1);
    sheet.getRange(2, 1, 1, schema.headers.length)
         .setValues([row])
         .setWrap(true);

    return respond('success', 'Submission recorded.');

  } catch (err) {
    Logger.log('doPost unexpected error: ' + err.message + '\n' + err.stack);
    return respond('error', 'An unexpected error occurred. Please try again.');
  }
}

// ============================================================================
// VALIDATION HELPERS
// Pure functions used by doPost and by the test suite.
// ============================================================================

function validateResource(resourceId) {
  if (!resourceId) return 'Unknown resource: (none)';
  if (!RESOURCE_REGISTRY[resourceId]) return 'Unknown resource: ' + resourceId;
  return null;
}

function validateTeacher(teacherKey) {
  if (!teacherKey) return 'Unknown teacher: (none)';
  if (!TEACHER_REGISTRY[teacherKey]) return 'Unknown teacher: ' + teacherKey;
  if (!TEACHER_REGISTRY[teacherKey].active) return 'Teacher is not active: ' + teacherKey;
  return null;
}

function validateGrade(params, resource) {
  var payloadGrade = parseInt(params.grade, 10);
  if (isNaN(payloadGrade) || payloadGrade !== resource.grade) {
    return 'Grade mismatch: payload says ' + params.grade +
           ', resource is grade ' + resource.grade;
  }
  return null;
}

function validateTeacherGrade(teacher, resource, teacherKey) {
  if (teacher.grade !== resource.grade) {
    return 'Teacher ' + teacherKey + ' is grade ' + teacher.grade +
           ', resource is grade ' + resource.grade;
  }
  return null;
}

function validateBlock(block) {
  var valid = ['A','B','C','D','E','F','G'];
  if (!block || valid.indexOf(block.toUpperCase()) === -1) {
    return 'Block must be A through G.';
  }
  return null;
}

function validateQuestions(params, expectedCount) {
  if (expectedCount === 0) return null;
  var found = 0;
  for (var i = 1; i <= expectedCount; i++) {
    if (params['q' + i] !== undefined && params['q' + i] !== '') found++;
  }
  if (found < expectedCount) {
    return 'Missing questions: expected ' + expectedCount + ', found ' + found;
  }
  return null;
}

function validateThinking(params, required) {
  if (!required) return null;
  if (!params.thinking || !params.thinking.trim()) {
    return 'Show Your Thinking response is required for this resource.';
  }
  return null;
}

// Returns null if every key in params is authorized for this resource.
// Returns a generic error string if any unauthorized field is present.
// The actual unauthorized field name is logged server-side only.
function validatePayloadFields(params, resource) {
  var allowed = {
    resourceId:  true,
    grade:       true,
    teacher:     true,
    studentName: true,
    block:       true,
    score:       true,
    thinking:    true,
  };
  for (var i = 1; i <= resource.expectedQuestionCount; i++) {
    allowed['q' + i] = true;
  }
  var extFields = resource.extendedFields || [];
  for (var j = 0; j < extFields.length; j++) {
    allowed[extFields[j]] = true;
  }
  var keys = Object.keys(params);
  for (var k = 0; k < keys.length; k++) {
    if (!allowed[keys[k]]) {
      Logger.log('Unauthorized payload field rejected: ' + keys[k] +
                 ' (resourceId: ' + params.resourceId + ')');
      return 'Submission contains an unsupported field.';
    }
  }
  return null;
}

// ============================================================================
// DAILY EMAIL DIGEST
// Iterates the Teacher Registry instead of a single spreadsheet ID.
// Recipient is read from Script Properties (DIGEST_EMAIL). If the property
// is not set, the digest logs a warning and skips sending rather than
// throwing, so digest failures never affect the submission pipeline.
// ============================================================================

function setupDailySubmissionDigest() {
  deleteDailySubmissionDigestTriggers();
  ScriptApp.newTrigger('sendDailySubmissionDigest')
    .timeBased()
    .everyDays(1)
    .atHour(DAILY_DIGEST_HOUR)
    .create();
  Logger.log('Daily LyfeLabz digest trigger created.');
}

function deleteDailySubmissionDigestTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'sendDailySubmissionDigest') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function sendDailySubmissionDigest() {
  var recipientEmail = PropertiesService.getScriptProperties()
                         .getProperty('DIGEST_EMAIL');
  if (!recipientEmail) {
    Logger.log('DIGEST_EMAIL Script Property not set. Digest skipped.');
    return;
  }

  var now   = new Date();
  var props = PropertiesService.getScriptProperties();

  var lastSentString = props.getProperty(DAILY_DIGEST_PROPERTY_KEY);
  var lastSent = lastSentString
    ? new Date(lastSentString)
    : new Date(now.getTime() - 24 * 60 * 60 * 1000);

  var submissions = [];
  var teacherKeys = Object.keys(TEACHER_REGISTRY);

  for (var ti = 0; ti < teacherKeys.length; ti++) {
    var key     = teacherKeys[ti];
    var teacher = TEACHER_REGISTRY[key];
    if (!teacher.active) continue;

    var spreadsheetId = PropertiesService.getScriptProperties()
                          .getProperty(teacher.spreadsheetPropKey);
    if (!spreadsheetId) {
      Logger.log('Digest: ' + teacher.spreadsheetPropKey + ' not configured, skipping.');
      continue;
    }

    var ss;
    try {
      ss = SpreadsheetApp.openById(spreadsheetId);
    } catch (openErr) {
      Logger.log('Digest: could not open spreadsheet for ' + teacher.displayName +
                 ': ' + openErr.message);
      continue;
    }

    var resourceIds = Object.keys(RESOURCE_REGISTRY);
    for (var ri = 0; ri < resourceIds.length; ri++) {
      var res = RESOURCE_REGISTRY[resourceIds[ri]];
      if (res.grade !== teacher.grade) continue;

      var sheetName = resolveWorksheetName(res);
      var sheet     = ss.getSheetByName(sheetName);
      if (!sheet) continue;

      var values = sheet.getDataRange().getValues();
      if (values.length < 2) continue;

      var headers      = values[0].map(function(h) { return String(h).trim(); });
      var timestampCol = findHeaderIndex(headers, ['Timestamp']);
      var nameCol      = findHeaderIndex(headers, ['Student Name']);
      var blockCol     = findHeaderIndex(headers, ['Block']);
      var scoreCol     = findHeaderIndex(headers, ['Score']);

      if (timestampCol === -1 || nameCol === -1) continue;

      for (var r = 1; r < values.length; r++) {
        var row       = values[r];
        var timestamp = row[timestampCol];
        if (!(timestamp instanceof Date)) timestamp = new Date(timestamp);
        if (isNaN(timestamp.getTime())) continue;
        if (timestamp > lastSent && timestamp <= now) {
          submissions.push({
            assignment:  res.displayTitle,
            teacherName: teacher.displayName,
            studentName: row[nameCol] || '',
            block:       blockCol !== -1 ? row[blockCol] || '' : '',
            score:       scoreCol !== -1 ? row[scoreCol] || '' : '',
            timestamp:   timestamp,
          });
        }
      }
    }
  }

  submissions.sort(function(a, b) { return a.timestamp - b.timestamp; });

  if (submissions.length === 0) {
    Logger.log('No new submissions since last digest. Email skipped.');
    return;
  }

  MailApp.sendEmail({
    to:       recipientEmail,
    subject:  'LyfeLabz Daily Submissions',
    body:     buildDailyDigestPlainText(submissions, lastSent, now),
    htmlBody: buildDailyDigestHtml(submissions, lastSent, now),
  });

  props.setProperty(DAILY_DIGEST_PROPERTY_KEY, now.toISOString());
  Logger.log('Daily digest sent. Submissions: ' + submissions.length);
}

function findHeaderIndex(headers, possibleNames) {
  for (var i = 0; i < headers.length; i++) {
    var norm = String(headers[i]).trim().toLowerCase().replace(/\s+/g, ' ');
    for (var j = 0; j < possibleNames.length; j++) {
      if (norm === possibleNames[j].toLowerCase()) return i;
    }
  }
  return -1;
}

function buildDailyDigestPlainText(submissions, lastSent, now) {
  var tz    = Session.getScriptTimeZone();
  var lines = [
    'LyfeLabz Daily Submissions',
    '',
    'Window: ' + formatDateForEmail(lastSent, tz) + ' to ' + formatDateForEmail(now, tz),
    '',
    'New submissions: ' + submissions.length,
    '',
  ];
  submissions.forEach(function(item) {
    lines.push('Teacher: '    + item.teacherName);
    lines.push('Assignment: ' + item.assignment);
    lines.push('Student: '    + item.studentName);
    lines.push('Block: '      + item.block);
    lines.push('Score: '      + item.score);
    lines.push('Submitted: '  + formatDateForEmail(item.timestamp, tz));
    lines.push('');
  });
  return lines.join('\n');
}

function buildDailyDigestHtml(submissions, lastSent, now) {
  var tz   = Session.getScriptTimeZone();
  var html = '<div style="font-family: Arial, sans-serif; color: #111827;">';
  html += '<h2 style="margin-bottom: 4px;">LyfeLabz Daily Submissions</h2>';
  html += '<p style="margin-top: 0; color: #4b5563;">Window: ' +
          escapeHtml(formatDateForEmail(lastSent, tz)) + ' to ' +
          escapeHtml(formatDateForEmail(now, tz)) + '</p>';
  html += '<p><strong>New submissions: ' + submissions.length + '</strong></p>';
  html += '<table border="1" cellpadding="8" cellspacing="0" ' +
          'style="border-collapse: collapse; width: 100%; font-size: 14px;">';
  html += '<thead><tr style="background-color: #111827; color: #ffffff;">';
  html += '<th align="left">Teacher</th><th align="left">Assignment</th>' +
          '<th align="left">Student</th><th align="left">Block</th>' +
          '<th align="left">Score</th><th align="left">Submitted</th>';
  html += '</tr></thead><tbody>';
  submissions.forEach(function(item) {
    html += '<tr>';
    html += '<td>' + escapeHtml(item.teacherName)  + '</td>';
    html += '<td>' + escapeHtml(item.assignment)   + '</td>';
    html += '<td>' + escapeHtml(item.studentName)  + '</td>';
    html += '<td>' + escapeHtml(item.block)        + '</td>';
    html += '<td>' + escapeHtml(item.score)        + '</td>';
    html += '<td>' + escapeHtml(formatDateForEmail(item.timestamp, tz)) + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
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
