'use strict';

// A3-6 S6a: D6 freshness checks for the operator tooling. Pure: the tooling clock is
// always an explicit argument. These checks bind operators who use the tooling; a
// Firestore-write principal can bypass them (D1-B), nothing at runtime enforces them
// (D6: no runtime expiry, no lease), and passing them is never authority.
const { MAX_AGE_MS, MAX_PREPARE_AGE_MS } = require('../hosting-release/backend-state.cjs');
const { instant } = require('./provider-observation.cjs');

// D6 fix 1: deployment, activation and disposition approvals within 24 hours at
// registration (the activation approval also at enable); certification has no age
// limit; provider observations at most five minutes old. Same bounds as A1.
const APPROVAL_MAX_AGE_NS = BigInt(MAX_PREPARE_AGE_MS) * 1000000n;
const OBSERVATION_MAX_AGE_NS = BigInt(MAX_AGE_MS) * 1000000n;
const AGE_LIMITED = Object.freeze(['teacher-units-deployment-approval', 'teacher-units-activation-approval',
  'teacher-units-approval-disposition']);
const SIGNED_KINDS = Object.freeze([...AGE_LIMITED, 'teacher-units-release-certification']);
const STAGES = Object.freeze(['registration', 'enable']);

function refuse(message) { throw new Error(`[a3-freshness] REFUSED: ${message}`); }

/** A3 canonical event instant (nine fractional digits) for a tooling clock reading. */
function formatInstant(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) refuse('tooling clock is not a valid Date');
  const iso = date.toISOString();
  if (!/^[0-9]{4}-/.test(iso)) refuse('tooling clock is outside the canonical instant range');
  return `${iso.slice(0, 23)}000000Z`;
}

/** D6 1, 2 and 4 for one signed statement. `now` is the tooling clock (RFC 3339 UTC). */
function assertStatementFresh(kind, statement, now, stage = 'registration') {
  if (!SIGNED_KINDS.includes(kind)) refuse('unknown signed statement kind');
  if (!STAGES.includes(stage)) refuse('unknown freshness stage');
  if (stage === 'enable' && kind !== 'teacher-units-activation-approval') refuse('only the activation approval is checked at enable');
  if (statement === null || typeof statement !== 'object' || statement.kind !== kind) refuse('statement kind mismatch');
  const issued = instant(statement.issuedAt, `${kind} issuedAt`);
  const current = instant(now, 'tooling clock');
  if (issued > current) refuse(`${kind} issuedAt is in the future relative to the tooling clock`);
  const limited = AGE_LIMITED.includes(kind);
  if (limited && current - issued > APPROVAL_MAX_AGE_NS) refuse(`${kind} was issued more than 24 hours before ${stage}`);
  return Object.freeze({ kind, stage, ageNanoseconds: (current - issued).toString(), limit: limited ? '24h' : 'none' });
}

/** D6 3 window check for an S4-shaped observation ({startedAt, observedAt}). */
function assertObservationFresh(observation, now) {
  if (observation === null || typeof observation !== 'object') refuse('observation required');
  const start = instant(observation.startedAt, 'observation start');
  const end = instant(observation.observedAt, 'observation end');
  const current = instant(now, 'tooling clock');
  if (start > end || end > current) refuse('observation window is inconsistent or in the future');
  if (current - start > OBSERVATION_MAX_AGE_NS) refuse('observation is older than five minutes; observe the provider again');
  return Object.freeze({ ageNanoseconds: (current - start).toString(), limit: '5m' });
}

module.exports = { APPROVAL_MAX_AGE_NS, OBSERVATION_MAX_AGE_NS, AGE_LIMITED, SIGNED_KINDS, formatInstant,
  assertStatementFresh, assertObservationFresh };
