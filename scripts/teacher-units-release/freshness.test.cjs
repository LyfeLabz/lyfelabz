'use strict';
// A3-6 S6a D6 freshness tests. Pure; no I/O.
const assert = require('node:assert/strict');
const test = require('node:test');
const F = require('./freshness.cjs');

const NOW = '2026-10-17T12:00:00.000000000Z';
const HOUR = 60 * 60 * 1000;
const iso = deltaMs => F.formatInstant(new Date(new Date(NOW).getTime() + deltaMs));
const statement = (kind, deltaMs) => ({ kind, issuedAt: iso(deltaMs) });
const refused = (fn, pattern) => assert.throws(fn, error => { assert.match(error.message, /REFUSED/); assert.match(error.message, pattern); return true; });

test('limits are the approved D6 bounds, reused from A1', () => {
  assert.equal(F.APPROVAL_MAX_AGE_NS, 24n * 3600n * 1000000000n);
  assert.equal(F.OBSERVATION_MAX_AGE_NS, 5n * 60n * 1000000000n);
});

test('formatInstant produces A3 canonical nine-digit instants', () => {
  assert.equal(F.formatInstant(new Date('2026-10-17T12:00:00.123Z')), '2026-10-17T12:00:00.123000000Z');
  refused(() => F.formatInstant(new Date('nope')), /valid Date/);
  refused(() => F.formatInstant('2026-10-17'), /valid Date/);
});

for (const kind of F.AGE_LIMITED) {
  test(`${kind}: within 24 hours passes; older or future refuses`, () => {
    assert.equal(F.assertStatementFresh(kind, statement(kind, -23 * HOUR), NOW).limit, '24h');
    assert.equal(F.assertStatementFresh(kind, statement(kind, -24 * HOUR), NOW).ageNanoseconds, (24n * 3600n * 1000000000n).toString());
    refused(() => F.assertStatementFresh(kind, statement(kind, -24 * HOUR - 1), NOW), /more than 24 hours/);
    refused(() => F.assertStatementFresh(kind, statement(kind, 1), NOW), /future/);
    assert.equal(F.assertStatementFresh(kind, statement(kind, 0), NOW).ageNanoseconds, '0');
  });
}

test('certification has no age limit, but a future issuedAt refuses', () => {
  const kind = 'teacher-units-release-certification';
  assert.equal(F.assertStatementFresh(kind, statement(kind, -400 * 24 * HOUR), NOW).limit, 'none');
  refused(() => F.assertStatementFresh(kind, statement(kind, 1), NOW), /future/);
});

test('at enable only the activation approval is checked, with the same 24 hour bound', () => {
  const kind = 'teacher-units-activation-approval';
  assert.equal(F.assertStatementFresh(kind, statement(kind, -HOUR), NOW, 'enable').stage, 'enable');
  refused(() => F.assertStatementFresh(kind, statement(kind, -25 * HOUR), NOW, 'enable'), /24 hours before enable/);
  refused(() => F.assertStatementFresh('teacher-units-deployment-approval', statement('teacher-units-deployment-approval', 0), NOW, 'enable'), /only the activation approval/);
  refused(() => F.assertStatementFresh(kind, statement(kind, 0), NOW, 'later'), /unknown freshness stage/);
});

test('malformed or mismatched statements refuse', () => {
  refused(() => F.assertStatementFresh('teacher-units-activation', { kind: 'teacher-units-activation', issuedAt: NOW }, NOW), /unknown signed statement kind/);
  refused(() => F.assertStatementFresh('teacher-units-activation-approval', statement('teacher-units-deployment-approval', 0), NOW), /kind mismatch/);
  refused(() => F.assertStatementFresh('teacher-units-activation-approval', null, NOW), /kind mismatch/);
  refused(() => F.assertStatementFresh('teacher-units-activation-approval', { kind: 'teacher-units-activation-approval', issuedAt: '2026-02-30T00:00:00.000000000Z' }, NOW), /calendar/);
  refused(() => F.assertStatementFresh('teacher-units-activation-approval', statement('teacher-units-activation-approval', 0), 'yesterday'), /canonical/);
});

test('observations: five minute window from the observation start; inconsistent windows refuse', () => {
  const window = (start, end) => ({ startedAt: iso(start), observedAt: iso(end) });
  assert.equal(F.assertObservationFresh(window(-4 * 60000, -3 * 60000), NOW).limit, '5m');
  assert.ok(F.assertObservationFresh(window(-5 * 60000, -60000), NOW));
  refused(() => F.assertObservationFresh(window(-5 * 60000 - 1, -60000), NOW), /older than five minutes/);
  refused(() => F.assertObservationFresh(window(-60000, -120000), NOW), /inconsistent/);
  refused(() => F.assertObservationFresh(window(-60000, 1), NOW), /inconsistent or in the future/);
  refused(() => F.assertObservationFresh(null, NOW), /observation required/);
  refused(() => F.assertObservationFresh({ startedAt: 'x', observedAt: NOW }, NOW), /canonical/);
});
