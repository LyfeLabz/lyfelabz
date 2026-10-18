'use strict';

// SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED (A3-6 S6f).
// A synthetic staging exchange for discovery: the S4 provider surfaces and the S5
// IAM policies as raw HTTP status and bytes, with the source archive in the
// documented staging Functions source bucket. Shapes follow the documented
// messages as understood without a live observation; values are invented.
// Nothing here was recorded from a real project, and no discovery built from it
// is provider evidence.
const O = require('../provider-observation.cjs');
const { buildProvider } = require('./synthetic-provider.cjs');
const { defaultPolicies } = require('./synthetic-access.cjs');
const { Http, http } = require('./synthetic-capture.cjs');
const SD = require('../staging-discovery.cjs');

const SYNTHETIC = 'synthetic, not provider-verified';
const START = '2026-10-16T12:10:00.000Z';

/**
 * Returns a staging exchange and clock. `mutate(state)` edits the provider state;
 * `onExchange(url, n)` may return an Http, Buffer, object, `{ status, raw: Buffer }`
 * (exact bytes with any status), or `{ throws: Error }`
 * for the nth exchange of that URL. `step` is the clock step in milliseconds and
 * `jumps(tick)` may add extra milliseconds at a given clock reading.
 */
function buildDiscovery({ mutate = () => {}, onExchange = null, step = 1, jumps = () => 0 } = {}) {
  const f = buildProvider({ project: SD.PROJECT, mutate: state => {
    for (const id of O.ENDPOINTS) {
      const b = state.endpoints[id].fn.buildConfig;
      b.source.storageSource.bucket = SD.SOURCE_BUCKET;
      b.sourceProvenance.resolvedStorageSource.bucket = SD.SOURCE_BUCKET;
    }
    mutate(state);
  } });
  const access = { policies: Object.fromEntries(O.ENDPOINTS.map(id => [id, defaultPolicies()])) };
  const fixture = { onExchange, calls: [], limits: [] };
  const route = async url => {
    const u = new URL(url);
    if (u.pathname.endsWith(':getIamPolicy')) {
      if (u.host === 'cloudfunctions.googleapis.com') return access.policies[u.pathname.split('/').pop().replace(':getIamPolicy', '')].function;
      return access.policies[O.ENDPOINTS.find(e => u.pathname.endsWith(`/services/${e.toLowerCase()}:getIamPolicy`))].service;
    }
    if (u.host === 'cloudfunctions.googleapis.com' && !u.pathname.endsWith('/functions')) {
      const id = u.pathname.split('/').pop();
      if (!f.state.endpoints[id]) return http(404, { error: { code: 404, status: 'NOT_FOUND', message: 'synthetic function not found' } });
    }
    return f.get(url, u.host === 'storage.googleapis.com');
  };
  const counts = new Map();
  const exchange = async (url, limit) => {
    fixture.calls.push(url); fixture.limits.push(limit);
    const n = (counts.get(url) || 0) + 1; counts.set(url, n);
    let value = fixture.onExchange ? fixture.onExchange(url, n) : undefined;
    if (value === undefined) value = await route(url);
    if (value && value.throws) throw value.throws;
    if (value && Buffer.isBuffer(value.raw)) return { status: value.status, bytes: Buffer.from(value.raw) };
    if (value instanceof Http) return { status: value.status, bytes: Buffer.from(JSON.stringify(value.body)) };
    if (Buffer.isBuffer(value)) return { status: 200, bytes: Buffer.from(value) };
    return { status: 200, bytes: Buffer.from(JSON.stringify(value)) };
  };
  let tick = 0, extra = 0;
  const base = Date.parse(START);
  const clock = () => { extra += jumps(tick); return new Date(base + step * tick++ + extra).toISOString(); };
  return { exchange, clock, state: f.state, access, fixture, cleanup: f.cleanup };
}

module.exports = { SYNTHETIC, START, Http, http, buildDiscovery };
