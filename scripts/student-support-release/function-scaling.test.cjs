'use strict';

// Inspect actual compiled SDK discovery metadata, not source text or mocks.
// Run after npm --prefix platform/functions run build; no cloud calls occur.
const assert = require('node:assert/strict');
const test = require('node:test');
const functions = require('../../platform/functions/lib/index.js');
const endpoints = [
  // Existing production maximum of 20; omitting it would reset the cap on deploy.
  'assessmentAttemptGetForTeacher', 'assessmentStudentAssignmentsForClass',
  // Student Support V2 callables, aligned with the teacher-facing convention.
  'assessmentAttemptsListForStudent',
  'supportAccessGrant', 'supportAccessGrantMany',
  'supportAccessRevoke', 'supportAccessRevokeMany',
  'supportAccessListForClass', 'supportAccessListMine',
  'supportAccessMutationGeneration', 'supportAccessReconcileMine',
  'supportAccessV21GrantMany', 'supportAccessV21RemoveRecipient',
  'supportAccessV21RevokeAuthorization',
  // Preserve the existing grade improvement and LMS connection caps.
  'gradeImprovementsAcknowledge', 'gradeImprovementsListForAssignment',
  'gradeImprovementsListForStudent', 'gradeImprovementsReverse',
  'lmsConnectionsBegin', 'lmsConnectionsComplete', 'lmsConnectionsDescribe',
  // Student autosave restore changes this callable; production reports 20.
  'assessmentSessionsBegin',
  // Staging reports maximum 20 for these teaching callables; source must declare it
  // explicitly or a deploy would reset the cap.
  'accommodationsGet', 'accommodationsListStudents', 'accommodationsSet',
  'assignmentsArchive', 'assignmentsClose', 'assignmentsCreateDraft',
  'assignmentsCurrentRecipientsReconcile', 'assignmentsCurrentSet', 'assignmentsLifecycleState',
  'assignmentsListForStudent', 'assignmentsPublish', 'assignmentsRecipientAdd',
  'assignmentsRecipientCandidatesList', 'assignmentsRecipientList', 'assignmentsRecipientsReconcile',
  'assignmentsReopen', 'assignmentsTeacherList', 'assignmentsUpdateDraft',
  'classesActivate', 'classesArchive', 'classesCreate',
  'classesLmsCreate', 'classesUpdateMetadata', 'enrollmentsJoinByCode',
  'enrollmentsListForClass', 'enrollmentsSetStatus', 'enrollmentsTeacherAdd',
  'lmsAssignmentsPublish', 'lmsClassesDiscover', 'lmsClassesImport',
  'lmsClassesListTopics', 'lmsClassesRefresh', 'lmsClassesRefreshRoster',
  'lmsClassesSyncRoster', 'lmsConnectionsDisconnect', 'lmsCourseworkInspect',
  'lmsDeepLinkResolve', 'lmsGradePassbacksApply', 'lmsGradePassbacksPreview',
  'lmsGradePassbacksRetry', 'lmsProvidersList', 'teacherClassColorUpdate',
  'teacherClassOrderUpdate', 'teacherPreferencesUpdate',
];

test('scaling guard covers each endpoint exactly once', () => {
  assert.equal(new Set(endpoints).size, endpoints.length);
  assert.equal(endpoints.length, 66);
});

for (const id of endpoints) {
  test(`${id} discovery manifest explicitly preserves maximum 20`, () => {
    // SDK ResetValue serializes to null in Firebase's discovery wire manifest.
    const manifest = JSON.parse(JSON.stringify(functions[id].__endpoint));
    assert.equal(manifest.platform, 'gcfv2');
    assert.ok(manifest.callableTrigger, `${id} must remain a callable`);
    assert.equal(manifest.maxInstances, 20, `${id} must not reset the deployment maximum`);
  });
}

test('supportAccessDrainRemovals discovery manifest preserves maximum 1', () => {
  const manifest = JSON.parse(JSON.stringify(functions.supportAccessDrainRemovals.__endpoint));
  assert.equal(manifest.platform, 'gcfv2');
  assert.ok(manifest.scheduleTrigger);
  assert.equal(manifest.maxInstances, 1);
});
