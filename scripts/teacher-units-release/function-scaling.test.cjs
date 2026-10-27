'use strict';

// Inspect actual compiled SDK discovery metadata, not source text or mocks.
// Run after npm --prefix platform/functions run build; no cloud calls occur.
const assert = require('node:assert/strict');
const test = require('node:test');
const functions = require('../../platform/functions/lib/index.js');
const endpoints = [
  'teacherUnitsArchive', 'teacherUnitsCapabilities', 'teacherUnitsCreate',
  'teacherUnitsGet', 'teacherUnitsList', 'teacherUnitsReorder',
  'teacherUnitsRestore', 'teacherUnitsSetResources', 'teacherUnitsUpdate',
];

for (const id of endpoints) {
  test(`${id} discovery manifest explicitly preserves maximum 20`, () => {
    // SDK ResetValue serializes to null in Firebase's discovery wire manifest.
    const manifest = JSON.parse(JSON.stringify(functions[id].__endpoint));
    assert.equal(manifest.platform, 'gcfv2');
    assert.equal(manifest.maxInstances, 20, `${id} must not reset the deployment maximum`);
  });
}
