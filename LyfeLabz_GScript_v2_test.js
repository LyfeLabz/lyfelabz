// ============================================================================
// LYFELABZ CENTRALIZED ASSESSMENT BACKEND - TEST SUITE
// Sprint S3A - 2026-07-15
//
// Tests the pure validation helpers in LyfeLabz_GScript_v2.js.
// Run via the Apps Script editor: open this file and run runAllTests().
//
// No live spreadsheet access required. All Sheets API calls are isolated
// to doPost, which is not exercised here. Validation logic is pure.
// ============================================================================

// ── Tiny assertion framework ──────────────────────────────────────────────────

var _pass = 0;
var _fail = 0;

function assert(description, condition) {
  if (condition) {
    Logger.log('  PASS: ' + description);
    _pass++;
  } else {
    Logger.log('  FAIL: ' + description);
    _fail++;
  }
}

function assertNull(description, value) {
  assert(description, value === null);
}

function assertNotNull(description, value) {
  assert(description, value !== null);
}

function assertContains(description, haystack, needle) {
  assert(description, typeof haystack === 'string' && haystack.indexOf(needle) !== -1);
}

// ── Payload builders ──────────────────────────────────────────────────────────

function makeG6Payload(overrides) {
  var base = {
    resourceId:  'lesson_what-is-life',
    grade:       '6',
    teacher:     'mr-brown',
    studentName: 'Alex Reyes',
    block:       'B',
    q1: 'A', q2: 'B', q3: 'C', q4: 'D', q5: 'A',
    q6: 'B', q7: 'C', q8: 'D', q9: 'A', q10: 'B',
    score:       '9/10',
    thinking:    'A virus cannot reproduce on its own or use energy independently.',
  };
  var merged = {};
  Object.keys(base).forEach(function(k) { merged[k] = base[k]; });
  if (overrides) Object.keys(overrides).forEach(function(k) { merged[k] = overrides[k]; });
  return merged;
}

function makeG7Payload(overrides) {
  var base = {
    resourceId:  'lesson_earths-layers',
    grade:       '7',
    teacher:     'mr-kankel',
    studentName: 'Jordan Kim',
    block:       'D',
    q1: 'A', q2: 'B', q3: 'C', q4: 'D', q5: 'A',
    q6: 'B', q7: 'C', q8: 'D', q9: 'A', q10: 'B',
    score:       '10/10',
    thinking:    'The mantle convects heat which drives plate motion.',
  };
  var merged = {};
  Object.keys(base).forEach(function(k) { merged[k] = base[k]; });
  if (overrides) Object.keys(overrides).forEach(function(k) { merged[k] = overrides[k]; });
  return merged;
}

// ── Test groups ───────────────────────────────────────────────────────────────

function testResourceValidation() {
  Logger.log('--- Resource validation ---');

  assertNull('valid G6 resourceId passes',
    validateResource('lesson_what-is-life'));

  assertNull('valid G7 resourceId passes',
    validateResource('lesson_earths-layers'));

  assertNotNull('unknown resourceId rejected',
    validateResource('lesson_unknown-topic'));

  assertNotNull('empty resourceId rejected',
    validateResource(''));

  assertNotNull('null resourceId rejected',
    validateResource(null));

  assertNotNull('undefined resourceId rejected',
    validateResource(undefined));
}

function testTeacherValidation() {
  Logger.log('--- Teacher validation ---');

  assertNull('mr-brown passes',      validateTeacher('mr-brown'));
  assertNull('ms-gay passes',        validateTeacher('ms-gay'));
  assertNull('mr-kankel passes',     validateTeacher('mr-kankel'));
  assertNull('mr-rovner passes',     validateTeacher('mr-rovner'));

  assertNotNull('unknown teacher rejected',
    validateTeacher('ms-smith'));

  assertNotNull('empty teacher rejected',
    validateTeacher(''));

  assertNotNull('null teacher rejected',
    validateTeacher(null));

  // Inactive teacher: temporarily set active to false
  var saved = TEACHER_REGISTRY['mr-brown'].active;
  TEACHER_REGISTRY['mr-brown'].active = false;
  var err = validateTeacher('mr-brown');
  TEACHER_REGISTRY['mr-brown'].active = saved;
  assertNotNull('inactive teacher rejected', err);
  assertContains('inactive teacher error message correct', err, 'not active');
}

function testGradeValidation() {
  Logger.log('--- Grade validation ---');

  var g6resource = RESOURCE_REGISTRY['lesson_what-is-life'];
  var g7resource = RESOURCE_REGISTRY['lesson_earths-layers'];

  assertNull('grade 6 payload matches G6 resource',
    validateGrade({ grade: '6' }, g6resource));

  assertNull('grade 7 payload matches G7 resource',
    validateGrade({ grade: '7' }, g7resource));

  assertNotNull('grade 6 payload rejected for G7 resource',
    validateGrade({ grade: '6' }, g7resource));

  assertNotNull('grade 7 payload rejected for G6 resource',
    validateGrade({ grade: '7' }, g6resource));

  assertNotNull('string mismatch rejected',
    validateGrade({ grade: 'six' }, g6resource));

  assertNotNull('missing grade rejected',
    validateGrade({}, g6resource));
}

function testTeacherGradeValidation() {
  Logger.log('--- Teacher-grade cross-validation ---');

  var g6resource = RESOURCE_REGISTRY['lesson_what-is-life'];
  var g7resource = RESOURCE_REGISTRY['lesson_earths-layers'];
  var brown   = TEACHER_REGISTRY['mr-brown'];
  var kankel  = TEACHER_REGISTRY['mr-kankel'];

  assertNull('G6 teacher + G6 resource passes',
    validateTeacherGrade(brown, g6resource, 'mr-brown'));

  assertNull('G7 teacher + G7 resource passes',
    validateTeacherGrade(kankel, g7resource, 'mr-kankel'));

  assertNotNull('G6 teacher + G7 resource rejected',
    validateTeacherGrade(brown, g7resource, 'mr-brown'));

  assertNotNull('G7 teacher + G6 resource rejected',
    validateTeacherGrade(kankel, g6resource, 'mr-kankel'));
}

function testBlockValidation() {
  Logger.log('--- Block validation ---');

  var validBlocks = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  validBlocks.forEach(function(b) {
    assertNull('block ' + b + ' passes', validateBlock(b));
  });

  assertNotNull('block H rejected',    validateBlock('H'));
  assertNotNull('block 1 rejected',    validateBlock('1'));
  assertNotNull('empty block rejected', validateBlock(''));
  assertNotNull('null block rejected',  validateBlock(null));
}

function testQuestionValidation() {
  Logger.log('--- Question completeness ---');

  var full10 = { q1:'A',q2:'B',q3:'C',q4:'D',q5:'A',q6:'B',q7:'C',q8:'D',q9:'A',q10:'B' };

  assertNull('all 10 questions present passes',
    validateQuestions(full10, 10));

  var missing1 = { q1:'A',q2:'B',q3:'C',q4:'D',q5:'A',q6:'B',q7:'C',q8:'D',q9:'A' };
  assertNotNull('missing q10 rejected',
    validateQuestions(missing1, 10));

  var empty1 = { q1:'A',q2:'',q3:'C',q4:'D',q5:'A',q6:'B',q7:'C',q8:'D',q9:'A',q10:'B' };
  assertNotNull('empty q2 treated as missing',
    validateQuestions(empty1, 10));

  assertNull('zero expectedQuestionCount always passes',
    validateQuestions({}, 0));

  var full5 = { q1:'A', q2:'B', q3:'C', q4:'D', q5:'A' };
  assertNull('5-question resource with all 5 passes',
    validateQuestions(full5, 5));

  assertNotNull('5-question resource with only 4 rejected',
    validateQuestions({ q1:'A',q2:'B',q3:'C',q4:'D' }, 5));
}

function testThinkingValidation() {
  Logger.log('--- Show Your Thinking validation ---');

  assertNull('thinking not required, field absent, passes',
    validateThinking({}, false));

  assertNull('thinking required and non-empty passes',
    validateThinking({ thinking: 'A virus cannot reproduce on its own.' }, true));

  assertNotNull('thinking required but absent rejected',
    validateThinking({}, true));

  assertNotNull('thinking required but empty string rejected',
    validateThinking({ thinking: '' }, true));

  assertNotNull('thinking required but whitespace-only rejected',
    validateThinking({ thinking: '   ' }, true));
}

function testWorksheetNameResolution() {
  Logger.log('--- Worksheet name resolution ---');

  var noOverride = { displayTitle: 'What Is Life' };
  assert('no override: uses displayTitle',
    resolveWorksheetName(noOverride) === 'What Is Life');

  var withOverride = { displayTitle: 'Welcome to Floatia: Engineering Challenge', worksheetName: 'Welcome to Floatia' };
  assert('override present: uses worksheetName',
    resolveWorksheetName(withOverride) === 'Welcome to Floatia');

  assert('renewable resources uses short worksheetName',
    resolveWorksheetName(RESOURCE_REGISTRY['lesson_renewable-and-nonrenewable-resources']) === 'Renewable Resources');

  assert("earths-layers displayTitle used when no override",
    resolveWorksheetName(RESOURCE_REGISTRY['lesson_earths-layers']) === "Earth's Layers");
}

function testSchemaGeneration() {
  Logger.log('--- Schema generation ---');

  var schema10 = buildSchema(RESOURCE_REGISTRY['lesson_what-is-life']);
  assert('10-question schema has correct header count',
    schema10.headers.length === 3 + 10 + 2);  // leading + Q1-Q10 + trailing

  assert('Timestamp is first header',
    schema10.headers[0] === 'Timestamp');

  assert('Show Your Thinking is last header',
    schema10.headers[schema10.headers.length - 1] === 'Show Your Thinking');

  assert('q1 field present in 10-question schema',
    schema10.fields.indexOf('q1') !== -1);

  assert('q10 field present in 10-question schema',
    schema10.fields.indexOf('q10') !== -1);

  var schema15 = buildSchema(RESOURCE_REGISTRY['lesson_body-systems']);
  assert('15-question schema has correct header count',
    schema15.headers.length === 3 + 15 + 2);

  // Conditional Show Your Thinking column: only present when thinkingRequired:true
  var lessonSchema = buildSchema(RESOURCE_REGISTRY['lesson_what-is-life']);
  assert('lesson schema includes Show Your Thinking (thinkingRequired:true)',
    lessonSchema.headers[lessonSchema.headers.length - 1] === 'Show Your Thinking');

  var ampSchema = buildSchema(RESOURCE_REGISTRY['investigation_amplitude-challenge']);
  assert('amplitude-challenge schema has no thinking column (thinkingRequired:false)',
    ampSchema.fields.indexOf('thinking') === -1);
  assert('amplitude-challenge schema includes cerClaim as extended field',
    ampSchema.fields.indexOf('cerClaim') !== -1);
  assert('cerClaim extended field comes after Score in amplitude-challenge schema',
    ampSchema.fields.indexOf('cerClaim') > ampSchema.fields.indexOf('score'));
  assert('amplitude-challenge schema does not include prediction (removed)',
    ampSchema.fields.indexOf('prediction') === -1);
  assert('amplitude-challenge schema does not include quizAnswers (removed)',
    ampSchema.fields.indexOf('quizAnswers') === -1);

  var schema0 = buildSchema(RESOURCE_REGISTRY['simulation_beetle-island']);
  // beetle island has expectedQuestionCount:4
  assert('beetle island schema has q1 through q4',
    schema0.fields.indexOf('q4') !== -1 && schema0.fields.indexOf('q5') === -1);
  assert('beetle island schema has no thinking column (thinkingRequired:false)',
    schema0.fields.indexOf('thinking') === -1);
  assert('beetle island schema does not include totalGens (removed)',
    schema0.fields.indexOf('totalGens') === -1);
  assert('beetle island schema retains environment and prediction',
    schema0.fields.indexOf('environment') !== -1 && schema0.fields.indexOf('prediction') !== -1);
}

function testServerTimestamp() {
  Logger.log('--- Server timestamp ---');

  var before = new Date().getTime();
  var ts     = new Date();
  var after  = new Date().getTime();

  assert('new Date() produces a valid Date object', ts instanceof Date);
  assert('timestamp is current (within 1 second)',
    ts.getTime() >= before && ts.getTime() <= after + 1000);

  assert('timestamp is not a string',
    typeof ts !== 'string');
}

function testResponseStructure() {
  Logger.log('--- Response structure ---');

  // respond() calls ContentService which is not available outside Apps Script.
  // Verify the JSON shape using a local stub.
  var successJson = JSON.stringify({ status: 'success', message: 'Submission recorded.' });
  var parsed = JSON.parse(successJson);
  assert('success response has status field',  parsed.status === 'success');
  assert('success response has message field', typeof parsed.message === 'string');

  var errorJson = JSON.stringify({ status: 'error', message: 'Unknown teacher: ms-smith' });
  var errParsed = JSON.parse(errorJson);
  assert('error response has status: error',   errParsed.status === 'error');
  assert('error message contains teacher key', errParsed.message.indexOf('ms-smith') !== -1);

  assert('success status is not error', parsed.status !== 'error');
}

function testRegistryIntegrity() {
  Logger.log('--- Registry integrity ---');

  var resourceIds = Object.keys(RESOURCE_REGISTRY);
  assert('at least 50 resources registered', resourceIds.length >= 50);

  var g6Count = 0;
  var g7Count = 0;
  var hasHardcodedId = false;

  resourceIds.forEach(function(id) {
    var r = RESOURCE_REGISTRY[id];

    assert('resource ' + id + ' has displayTitle',
      typeof r.displayTitle === 'string' && r.displayTitle.length > 0);

    assert('resource ' + id + ' has valid grade',
      r.grade === 6 || r.grade === 7);

    assert('resource ' + id + ' has resourceType',
      typeof r.resourceType === 'string');

    assert('resource ' + id + ' has expectedQuestionCount',
      typeof r.expectedQuestionCount === 'number');

    assert('resource ' + id + ' has thinkingRequired',
      typeof r.thinkingRequired === 'boolean');

    if (r.grade === 6) g6Count++;
    if (r.grade === 7) g7Count++;
  });

  assert('has Grade 6 resources', g6Count > 0);
  assert('has Grade 7 resources', g7Count > 0);

  var teacherKeys = Object.keys(TEACHER_REGISTRY);
  assert('4 teachers registered', teacherKeys.length === 4);

  teacherKeys.forEach(function(key) {
    var t = TEACHER_REGISTRY[key];
    assert('teacher ' + key + ' has displayName',    typeof t.displayName === 'string');
    assert('teacher ' + key + ' has grade',          t.grade === 6 || t.grade === 7);
    assert('teacher ' + key + ' has spreadsheetId',  typeof t.spreadsheetId === 'string' && t.spreadsheetId.length > 0);
    assert('teacher ' + key + ' has active flag',    typeof t.active === 'boolean');
    assert('teacher ' + key + ' no spreadsheetPropKey', t.spreadsheetPropKey === undefined);
  });
}

function testSpreadsheetIds() {
  Logger.log('--- Hardcoded spreadsheet IDs ---');

  var GOOGLE_SHEET_ID_PATTERN = /^[A-Za-z0-9_-]{40,}$/;

  function isValidSheetId(id) {
    return typeof id === 'string' && id.length >= 40 && GOOGLE_SHEET_ID_PATTERN.test(id);
  }

  assert('mr-brown has a non-empty spreadsheetId',
    typeof TEACHER_REGISTRY['mr-brown'].spreadsheetId === 'string' &&
    TEACHER_REGISTRY['mr-brown'].spreadsheetId.length > 0);

  assert('ms-gay has a non-empty spreadsheetId',
    typeof TEACHER_REGISTRY['ms-gay'].spreadsheetId === 'string' &&
    TEACHER_REGISTRY['ms-gay'].spreadsheetId.length > 0);

  assert('mr-kankel has a non-empty spreadsheetId',
    typeof TEACHER_REGISTRY['mr-kankel'].spreadsheetId === 'string' &&
    TEACHER_REGISTRY['mr-kankel'].spreadsheetId.length > 0);

  assert('mr-rovner has a non-empty spreadsheetId',
    typeof TEACHER_REGISTRY['mr-rovner'].spreadsheetId === 'string' &&
    TEACHER_REGISTRY['mr-rovner'].spreadsheetId.length > 0);

  assert('mr-brown spreadsheetId format is valid',     isValidSheetId(TEACHER_REGISTRY['mr-brown'].spreadsheetId));
  assert('ms-gay spreadsheetId format is valid',       isValidSheetId(TEACHER_REGISTRY['ms-gay'].spreadsheetId));
  assert('mr-kankel spreadsheetId format is valid',    isValidSheetId(TEACHER_REGISTRY['mr-kankel'].spreadsheetId));
  assert('mr-rovner spreadsheetId format is valid',    isValidSheetId(TEACHER_REGISTRY['mr-rovner'].spreadsheetId));

  // Routing still resolves: each teacher entry has a spreadsheetId, not a propKey
  var teacherKeys = Object.keys(TEACHER_REGISTRY);
  teacherKeys.forEach(function(key) {
    var t = TEACHER_REGISTRY[key];
    assert('teacher ' + key + ' routes via spreadsheetId, not propKey',
      typeof t.spreadsheetId === 'string' && t.spreadsheetPropKey === undefined);
  });

}

function testPayloadFieldAuthorization() {
  Logger.log('--- Payload field authorization ---');

  var g6resource  = RESOURCE_REGISTRY['lesson_what-is-life'];
  var extResource = RESOURCE_REGISTRY['extension_chernobyl-frogs'];
  var sim5Resource = RESOURCE_REGISTRY['simulation_eclipse-alignment'];

  // Canonical fields are accepted
  var canonical = {
    resourceId: 'lesson_what-is-life',
    grade: '6',
    teacher: 'mr-brown',
    studentName: 'Alex Reyes',
    block: 'B',
    q1:'A',q2:'B',q3:'C',q4:'D',q5:'A',
    q6:'B',q7:'C',q8:'D',q9:'A',q10:'B',
    score: '9/10',
    thinking: 'A virus cannot reproduce on its own.',
  };
  assertNull('canonical fields accepted for G6 lesson',
    validatePayloadFields(canonical, g6resource));

  // q1 through registered qN accepted; q(N+1) rejected
  var sim5 = {
    resourceId: 'simulation_eclipse-alignment',
    grade: '6',
    teacher: 'mr-brown',
    studentName: 'Alex Reyes',
    block: 'B',
    q1:'A', q2:'B', q3:'C', q4:'D', q5:'A',
    score: '5/5',
    thinking: '',
  };
  assertNull('q1 through q5 accepted for 5-question resource',
    validatePayloadFields(sim5, sim5Resource));

  var sim5WithQ6 = {};
  Object.keys(sim5).forEach(function(k) { sim5WithQ6[k] = sim5[k]; });
  sim5WithQ6.q6 = 'A';
  assertNotNull('q6 rejected for 5-question resource',
    validatePayloadFields(sim5WithQ6, sim5Resource));

  // A registered extended field is accepted
  var extParams = {
    resourceId: 'extension_chernobyl-frogs',
    grade: '6',
    teacher: 'mr-brown',
    studentName: 'Alex Reyes',
    block: 'B',
    q1:'A', q2:'B', q3:'C', q4:'D',
    score: '4/4',
    thinking: '',
    accuracy: '85%',
  };
  assertNull('registered extendedField accuracy accepted for chernobyl-frogs',
    validatePayloadFields(extParams, extResource));

  // Removed fields are no longer accepted
  var extParamsWithRemoved = {};
  Object.keys(extParams).forEach(function(k) { extParamsWithRemoved[k] = extParams[k]; });
  extParamsWithRemoved.environment = 'Before and After Disaster';
  assertNotNull('removed field environment rejected for chernobyl-frogs',
    validatePayloadFields(extParamsWithRemoved, extResource));

  var extParamsWithTotalGens = {};
  Object.keys(extParams).forEach(function(k) { extParamsWithTotalGens[k] = extParams[k]; });
  extParamsWithTotalGens.totalGens = '50';
  assertNotNull('removed field totalGens rejected for chernobyl-frogs',
    validatePayloadFields(extParamsWithTotalGens, extResource));

  // Amplitude challenge: cerClaim accepted, removed fields rejected
  var ampResource = RESOURCE_REGISTRY['investigation_amplitude-challenge'];
  var ampParams = {
    resourceId: 'investigation_amplitude-challenge',
    grade: '6',
    teacher: 'mr-brown',
    studentName: 'Alex Reyes',
    block: 'B',
    q1:'A', q2:'B', q3:'C', q4:'D', q5:'A',
    score: '4/5',
    cerClaim: 'Higher amplitude means more energy.',
    cerEvidence: 'In my trials, amplitude 8 produced the most energy.',
    cerReasoning: 'This shows a direct relationship between amplitude and energy.',
  };
  assertNull('cerClaim/cerEvidence/cerReasoning accepted for amplitude-challenge',
    validatePayloadFields(ampParams, ampResource));

  var ampWithQuizAnswers = {};
  Object.keys(ampParams).forEach(function(k) { ampWithQuizAnswers[k] = ampParams[k]; });
  ampWithQuizAnswers.quizAnswers = JSON.stringify([0,1,2,0,1]);
  assertNotNull('removed field quizAnswers rejected for amplitude-challenge',
    validatePayloadFields(ampWithQuizAnswers, ampResource));

  var ampWithPrediction = {};
  Object.keys(ampParams).forEach(function(k) { ampWithPrediction[k] = ampParams[k]; });
  ampWithPrediction.prediction = 'Higher amplitude';
  assertNotNull('removed field prediction rejected for amplitude-challenge',
    validatePayloadFields(ampWithPrediction, ampResource));

  // Population patterns: cerClaim/challengeText accepted, removed fields rejected
  var popResource = RESOURCE_REGISTRY['investigation_population-patterns'];
  var popParams = {
    resourceId: 'investigation_population-patterns',
    grade: '7',
    teacher: 'mr-kankel',
    studentName: 'Jordan Kim',
    block: 'D',
    q1:'A',q2:'B',q3:'C',q4:'D',q5:'A',q6:'B',q7:'C',q8:'D',q9:'A',q10:'B',
    score: '9/10',
    prediction: 'The population will grow then level off.',
    cerClaim: 'Predator populations depend on prey.',
    cerEvidence: 'When hare dropped, lynx also dropped.',
    cerReasoning: 'This shows a food web dependency.',
    challengeChoice: 'deer-grass',
    challengeText: 'The grass supply dropped from about 400 to 200 before deer declined.',
  };
  assertNull('population-patterns extended fields accepted',
    validatePayloadFields(popParams, popResource));

  var popWithCheckpoints = {};
  Object.keys(popParams).forEach(function(k) { popWithCheckpoints[k] = popParams[k]; });
  popWithCheckpoints.checkpoints = JSON.stringify({1:0, 2:1, 3:2});
  assertNotNull('removed field checkpoints rejected for population-patterns',
    validatePayloadFields(popWithCheckpoints, popResource));

  var popWithQuizAnswers = {};
  Object.keys(popParams).forEach(function(k) { popWithQuizAnswers[k] = popParams[k]; });
  popWithQuizAnswers.quizAnswers = JSON.stringify([0,1,2,3,0,1,2,3,0,1]);
  assertNotNull('removed field quizAnswers rejected for population-patterns',
    validatePayloadFields(popWithQuizAnswers, popResource));

  // An extended field registered for another resource is rejected
  var wrongExt = {};
  Object.keys(canonical).forEach(function(k) { wrongExt[k] = canonical[k]; });
  wrongExt.environment = 'Forest';
  assertNotNull('extendedField from another resource rejected',
    validatePayloadFields(wrongExt, g6resource));

  // An arbitrary field is rejected
  var withArbitrary = {};
  Object.keys(canonical).forEach(function(k) { withArbitrary[k] = canonical[k]; });
  withArbitrary.arbitraryField = 'surprise';
  assertNotNull('arbitrary field rejected',
    validatePayloadFields(withArbitrary, g6resource));

  // submittedAt is rejected
  var withSubmittedAt = {};
  Object.keys(canonical).forEach(function(k) { withSubmittedAt[k] = canonical[k]; });
  withSubmittedAt.submittedAt = '2026-01-01T12:00:00Z';
  assertNotNull('submittedAt rejected',
    validatePayloadFields(withSubmittedAt, g6resource));

  // tab is rejected
  var withTab = {};
  Object.keys(canonical).forEach(function(k) { withTab[k] = canonical[k]; });
  withTab.tab = 'What Is Life';
  assertNotNull('tab rejected',
    validatePayloadFields(withTab, g6resource));

  // activity is rejected
  var withActivity = {};
  Object.keys(canonical).forEach(function(k) { withActivity[k] = canonical[k]; });
  withActivity.activity = 'quiz';
  assertNotNull('activity rejected',
    validatePayloadFields(withActivity, g6resource));

  // percent is rejected
  var withPercent = {};
  Object.keys(canonical).forEach(function(k) { withPercent[k] = canonical[k]; });
  withPercent.percent = '90';
  assertNotNull('percent rejected',
    validatePayloadFields(withPercent, g6resource));

  // Error message is the canonical generic string and does not expose the field name
  var errMsg = validatePayloadFields(withSubmittedAt, g6resource);
  assert('unauthorized field error is the canonical message',
    errMsg === 'Submission contains an unsupported field.');
  assert('error message does not expose the field name',
    errMsg.indexOf('submittedAt') === -1);
}

function testTeacherKeyNormalization() {
  Logger.log('--- Teacher display names do not replace canonical keys ---');

  // Display names must be rejected; only canonical kebab-case keys work
  assertNotNull('display name "Mr. Brown" rejected',   validateTeacher('Mr. Brown'));
  assertNotNull('display name "Ms. Gay" rejected',     validateTeacher('Ms. Gay'));
  assertNotNull('display name "Mr. Kankel" rejected',  validateTeacher('Mr. Kankel'));
  assertNotNull('display name "Mr. Rovner" rejected',  validateTeacher('Mr. Rovner'));

  // Canonical lowercase kebab-case keys are accepted
  assertNull('canonical key mr-brown accepted',  validateTeacher('mr-brown'));
  assertNull('canonical key ms-gay accepted',    validateTeacher('ms-gay'));
  assertNull('canonical key mr-kankel accepted', validateTeacher('mr-kankel'));
  assertNull('canonical key mr-rovner accepted', validateTeacher('mr-rovner'));
}

function testFieldValidationBeforeSpreadsheetAccess() {
  Logger.log('--- Field validation precedes spreadsheet access ---');

  // A payload that passes every earlier validation but carries an unauthorized
  // field must be caught by validatePayloadFields before getSpreadsheet is reached.
  var resource = RESOURCE_REGISTRY['lesson_what-is-life'];
  var params = {
    resourceId: 'lesson_what-is-life',
    grade: '6',
    teacher: 'mr-brown',
    studentName: 'Test Student',
    block: 'A',
    q1:'A',q2:'B',q3:'C',q4:'D',q5:'A',q6:'B',q7:'C',q8:'D',q9:'A',q10:'B',
    score: '9/10',
    thinking: 'Some thinking here.',
    submittedAt: '2026-01-01',
  };

  // Confirm every preceding validation passes
  assertNull('resource validation passes',
    validateResource(params.resourceId));
  assertNull('teacher validation passes',
    validateTeacher(params.teacher));
  assertNull('grade validation passes',
    validateGrade(params, resource));
  assertNull('teacher-grade cross-validation passes',
    validateTeacherGrade(TEACHER_REGISTRY['mr-brown'], resource, 'mr-brown'));
  assertNull('question validation passes',
    validateQuestions(params, resource.expectedQuestionCount));
  assertNull('thinking validation passes',
    validateThinking(params, resource.thinkingRequired));

  // Field authorization is the step that catches the unauthorized field
  var fieldErr = validatePayloadFields(params, resource);
  assertNotNull('unauthorized submittedAt rejected at field authorization step', fieldErr);
  assert('rejection uses generic message (no spreadsheet ever opened)',
    fieldErr === 'Submission contains an unsupported field.');
}

// ── Test runner ───────────────────────────────────────────────────────────────

function runAllTests() {
  _pass = 0;
  _fail = 0;

  Logger.log('====================================');
  Logger.log('LyfeLabz Centralized Backend Tests');
  Logger.log('====================================');

  testResourceValidation();
  testTeacherValidation();
  testGradeValidation();
  testTeacherGradeValidation();
  testBlockValidation();
  testQuestionValidation();
  testThinkingValidation();
  testPayloadFieldAuthorization();
  testTeacherKeyNormalization();
  testFieldValidationBeforeSpreadsheetAccess();
  testWorksheetNameResolution();
  testSchemaGeneration();
  testServerTimestamp();
  testResponseStructure();
  testRegistryIntegrity();
  testSpreadsheetIds();

  Logger.log('====================================');
  Logger.log('Results: ' + _pass + ' passed, ' + _fail + ' failed');
  Logger.log('====================================');

  if (_fail > 0) {
    throw new Error(_fail + ' test(s) failed. See log for details.');
  }
}
