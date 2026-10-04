'use strict';

// Read-only release gate: use the public catalog's actual links, not invented
// direct app URLs. Run against a freshly certified app Hosting artifact.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../../app/node_modules/jsdom');

const requiredLessons = ['lesson_carbon-cycle.html', 'lesson_renewable-and-nonrenewable-resources.html'];
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function readUrl(url) {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `${url}: HTTP ${response.status}`);
  assert.match(response.headers.get('content-type') || '', /text\/html/, `${url}: expected HTML`);
  return { url: response.url, bytes: Buffer.from(await response.arrayBuffer()) };
}

function lessonLinks(html, entryUrl) {
  const dom = new JSDOM(html, { url: entryUrl });
  try {
    return [...dom.window.document.querySelectorAll('a[href]')]
      .map((anchor) => new URL(anchor.href))
      .filter((url) => /^\/lesson_[a-z0-9-]+\.html$/.test(url.pathname));
  } finally {
    dom.window.close();
  }
}

async function certifyPublicEntry({ entry, canonical, artifact, read = readUrl }) {
  const canonicalOrigin = new URL(canonical).origin;
  const homepage = await read(entry);
  const links = lessonLinks(homepage.bytes.toString('utf8'), homepage.url);
  const expected = fs.readdirSync(artifact).filter((name) => /^lesson_[a-z0-9-]+\.html$/.test(name)).sort();
  assert(expected.length > 0, 'No lesson files in expected artifact');
  for (const name of requiredLessons) assert(expected.includes(name), `Artifact must include ${name}`);
  const discovered = [...new Set(links.map((url) => url.pathname.slice(1)))].sort();
  assert.deepEqual(discovered, expected, `${entry}: public catalog must expose every expected lesson`);
  const results = [];
  const failures = [];
  async function check(start) {
    try {
      const response = await read(start.href);
      const final = new URL(response.url);
      assert.equal(final.origin, canonicalOrigin, `${start}: wrong final origin`);
      assert.equal(final.pathname, start.pathname, `${start}: lesson path changed`);
      assert.equal(final.search, start.search, `${start}: query lost or changed`);
      const expectedBytes = fs.readFileSync(path.join(artifact, start.pathname.slice(1)));
      assert.equal(digest(response.bytes), digest(expectedBytes), `${start}: stale or incorrect lesson bytes`);
      results.push({ start: start.href, final: final.href, sha256: digest(response.bytes) });
    } catch (error) {
      failures.push(error.message);
    }
  }
  // Sequential requests keep this diagnostic gentle on public Hosting.
  for (const link of links) await check(link);
  // Legacy shared links must work even if future catalogs use absolute app URLs.
  for (const name of requiredLessons) {
    await check(new URL(`/${name}?delivery-cert=public&mode=educator`, entry));
  }
  assert.equal(failures.length, 0, failures.join('\n'));
  return { entry, canonical: canonicalOrigin, lessonCount: discovered.length, checked: results.length, results };
}

async function main() {
  const args = process.argv.slice(2);
  const entries = [];
  let canonical = 'https://app.lyfelabz.com';
  let artifact = path.resolve(__dirname, '../../dist/app-hosting');
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    assert(value, `Missing value for ${args[i]}`);
    if (args[i] === '--entry') entries.push(value);
    else if (args[i] === '--canonical') canonical = value;
    else if (args[i] === '--artifact') artifact = path.resolve(value);
    else throw new Error(`Unknown argument ${args[i]}`);
  }
  if (!entries.length) entries.push('https://lyfelabz.com/', 'https://www.lyfelabz.com/');
  for (const entry of entries) console.log(JSON.stringify(await certifyPublicEntry({ entry, canonical, artifact }), null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { certifyPublicEntry, lessonLinks };
