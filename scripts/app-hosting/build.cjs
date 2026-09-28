'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  readManifest: readMarketingManifest,
  repositoryRoot,
  stripLeadingFrontMatter
} = require('../marketing-hosting/build.cjs');

const distributionRoot = path.join(repositoryRoot, 'dist');
const defaultOutputDirectory = path.join(distributionRoot, 'app-hosting');
const manifestPath = path.join(__dirname, 'public-files.json');
const variantManifestRelativePath = 'app/lessons/variants/manifest.json';
// F5.3 Slice 9B: the generated revision-to-path table. It is public (revision
// ids and paths only, PDR-031f) and is the ONLY way an assessment-revision
// rendition enters the artifact.
const revisionPathTableRelativePath = 'app/lessons/assessment-revisions/revision-paths.json';
const expectedComposedManifest = 'scripts/marketing-hosting/public-files.json';
const virtualHostingPaths = new Set(['privacy', 'terms']);

function fail(message) {
  throw new Error(`[app-hosting] ${message}`);
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validateRelativePath(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  if (value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) fail(`unsafe ${label}: ${value}`);
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '.' || normalized.startsWith('../')) fail(`unsafe ${label}: ${value}`);
  if (value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`unsafe ${label}: ${value}`);
  }
  return value;
}

function validateOutputDirectory(outputDirectory) {
  const resolved = path.resolve(outputDirectory);
  if (!isInside(distributionRoot, resolved)) fail(`output must be a child of ${distributionRoot}`);
  return resolved;
}

function assertRegularSource(repoRoot, relativePath) {
  validateRelativePath(relativePath, 'source path');
  let current = repoRoot;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fail(`missing input: ${relativePath}`);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail(`symlink input is forbidden: ${relativePath}`);
  }
  if (!fs.lstatSync(current).isFile()) fail(`input must be a regular file: ${relativePath}`);
  return current;
}

function validateCopyEntry(entry, label = 'copy') {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`${label} must be an object`);
  return {
    source: validateRelativePath(entry.source, `${label} source`),
    destination: validateRelativePath(entry.destination, `${label} destination`),
    transform: entry.transform === undefined ? null : entry.transform
  };
}

function validateDestinationPolicy(relativePath) {
  const forbidden = [
    /(^|\/)\.[^/]+(?:\/|$)/,
    /^(?:app\/(?:src|scripts)|platform|docs|lesson-sources|scripts)(?:\/|$)/,
    /(^|\/)package(?:-lock)?\.json$/,
    /(^|\/)(?:firebase\.json|firebase\.marketing\.json|firestore-debug\.log)$/,
    /(^|\/)(?:tsconfig(?:\.[^/]+)?\.json|jest\.config\.js|\.eslintrc(?:\.[^/]+)?)$/,
    /(?:\.ts|\.map|\.cjs|\.sh|\.md|\.log|\.pack|\.idx|\.rev)$/,
    /(^|\/)(?:ChallengeSeries|Leaderboard|LyfeLabz_GScript[^/]*)\.js$/
  ];
  if (forbidden.some((pattern) => pattern.test(relativePath))) fail(`forbidden artifact destination: ${relativePath}`);
  if (relativePath.startsWith('app/dist/') && relativePath !== 'app/dist/bundle.js') {
    fail(`stale application dist artifact is forbidden: ${relativePath}`);
  }
  if (relativePath === variantManifestRelativePath) fail('private variant manifest must never enter the artifact');
  return relativePath;
}

function readApplicationManifest() {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!parsed || !Array.isArray(parsed.composedManifests) || !Array.isArray(parsed.files) || !Array.isArray(parsed.copies)) {
    fail('public-files.json must contain composedManifests, files, and copies arrays');
  }
  if (
    parsed.composedManifests.length !== 1 ||
    parsed.composedManifests[0] !== expectedComposedManifest
  ) {
    fail(`public-files.json must compose exactly ${expectedComposedManifest}`);
  }
  const files = parsed.files.map((entry) => validateRelativePath(entry, 'approved file'));
  const copies = parsed.copies.map((entry, index) => validateCopyEntry(entry, `copy[${index}]`));
  if (files.join('\n') !== [...files].sort().join('\n')) fail('approved files must be sorted');
  const destinations = copies.map((entry) => entry.destination);
  if (destinations.join('\n') !== [...destinations].sort().join('\n')) fail('copy destinations must be sorted');
  return { files, copies };
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readRetainedVariantCopies(repoRoot = repositoryRoot) {
  const absoluteManifest = path.join(repoRoot, variantManifestRelativePath);
  if (!fs.existsSync(absoluteManifest)) return [];
  const parsed = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8'));
  if (!Array.isArray(parsed)) fail('private variant manifest must be a JSON array');

  const seenPaths = new Set();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`variant[${index}] must be an object`);
    const relativePath = validateRelativePath(entry.path, `variant[${index}] path`);
    if (!/^app\/lessons\/variants\/lesson_[a-z0-9][a-z0-9-]*__pr[0-9a-f]{64}\.html$/.test(relativePath)) {
      fail(`unexpected retained variant path: ${relativePath}`);
    }
    if (seenPaths.has(relativePath)) fail(`duplicate retained variant path: ${relativePath}`);
    seenPaths.add(relativePath);
    if (typeof entry.lessonSlug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.lessonSlug)) {
      fail(`invalid retained variant lessonSlug: ${relativePath}`);
    }
    if (typeof entry.variantKey !== 'string' || entry.variantKey.length === 0) {
      fail(`invalid retained variant variantKey: ${relativePath}`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      fail(`invalid retained variant sha256: ${relativePath}`);
    }
    if (entry.presentationRevisionId !== `pr${entry.sha256}`) {
      fail(`retained variant revision does not match sha256: ${relativePath}`);
    }
    const expectedPath = `app/lessons/variants/lesson_${entry.lessonSlug}__${entry.presentationRevisionId}.html`;
    if (relativePath !== expectedPath) fail(`retained variant path does not match identity: ${relativePath}`);
    const sourcePath = assertRegularSource(repoRoot, relativePath);
    if (sha256(fs.readFileSync(sourcePath)) !== entry.sha256) fail(`retained variant content hash mismatch: ${relativePath}`);
    return { source: relativePath, destination: relativePath, transform: null };
  });
}

// The revision-to-path table and exactly the renditions it names. Every entry
// must be a (lesson, revision) of the strict grammar mapped either to that
// lesson's unversioned v2 page or to that revision's rendition path; nothing
// else in app/lessons/assessment-revisions/ is ever copied.
function readAssessmentRevisionCopies(repoRoot = repositoryRoot) {
  const absoluteTable = path.join(repoRoot, revisionPathTableRelativePath);
  if (!fs.existsSync(absoluteTable)) return { copies: [], pageTargets: [] };
  assertRegularSource(repoRoot, revisionPathTableRelativePath);
  const parsed = JSON.parse(fs.readFileSync(absoluteTable, 'utf8'));
  if (
    !parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    Object.keys(parsed).sort().join('|') !== 'kind|lessons|schemaVersion' ||
    parsed.kind !== 'lyfelabz.assessmentRevisionPaths' || parsed.schemaVersion !== 1 ||
    !parsed.lessons || typeof parsed.lessons !== 'object' || Array.isArray(parsed.lessons)
  ) {
    fail('revision path table must be { schemaVersion: 1, kind: "lyfelabz.assessmentRevisionPaths", lessons }');
  }
  const copies = [{ source: revisionPathTableRelativePath, destination: revisionPathTableRelativePath, transform: null }];
  const pageTargets = [];
  for (const [slug, revisions] of Object.entries(parsed.lessons)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(`invalid revision path table lesson: ${slug}`);
    if (!revisions || typeof revisions !== 'object' || Array.isArray(revisions) || Object.keys(revisions).length === 0) {
      fail(`revision path table lesson ${slug} must map at least one revision`);
    }
    for (const [revisionId, urlPath] of Object.entries(revisions)) {
      const match = new RegExp(`^assessment_${slug}__r([1-9][0-9]*)$`).exec(revisionId);
      if (!match) fail(`invalid revision path table revision for ${slug}: ${revisionId}`);
      const rendition = `app/lessons/assessment-revisions/lesson_${slug}__r${match[1]}.html`;
      const unversioned = `app/lessons/lesson_${slug}.html`;
      if (urlPath === `/${rendition}`) {
        copies.push({ source: rendition, destination: rendition, transform: null });
      } else if (urlPath === `/${unversioned}`) {
        pageTargets.push(unversioned);
      } else {
        fail(`revision path table maps ${revisionId} to an unexpected path: ${urlPath}`);
      }
    }
  }
  return { copies, pageTargets };
}

// The approved copy list as declared by the manifests, before any
// source-file existence check. Build outputs such as app/dist/bundle.js
// appear here even when they have not been built yet; collectApprovedCopies
// adds that validation and is what every real artifact build uses.
function listApprovedCopies(repoRoot = repositoryRoot) {
  const { files, copies } = readApplicationManifest();
  const approved = [];

  for (const relativePath of readMarketingManifest()) {
    approved.push({
      source: relativePath,
      destination: relativePath,
      transform: relativePath === 'privacy.html' || relativePath === 'terms.html' ? 'strip-front-matter' : null
    });
  }
  for (const relativePath of files) approved.push({ source: relativePath, destination: relativePath, transform: null });
  approved.push(...copies);
  approved.push(...readRetainedVariantCopies(repoRoot));
  approved.push(...readAssessmentRevisionCopies(repoRoot).copies);
  return approved;
}

function collectApprovedCopies(repoRoot = repositoryRoot) {
  const approved = listApprovedCopies(repoRoot);
  const seenDestinations = validateApprovedCopies(approved, repoRoot);
  if (seenDestinations.has(variantManifestRelativePath)) fail('private variant manifest must never enter the artifact');
  // The table may only name pages the artifact actually publishes.
  for (const target of readAssessmentRevisionCopies(repoRoot).pageTargets) {
    if (!seenDestinations.has(target)) fail(`revision path table names an unpublished page: ${target}`);
  }
  return approved;
}

function validateApprovedCopies(approved, repoRoot = repositoryRoot) {
  if (!Array.isArray(approved)) fail('approved copies must be an array');
  const seenDestinations = new Set();
  for (const rawEntry of approved) {
    const entry = validateCopyEntry(rawEntry);
    validateDestinationPolicy(entry.destination);
    if (seenDestinations.has(entry.destination)) fail(`duplicate artifact destination: ${entry.destination}`);
    seenDestinations.add(entry.destination);
    assertRegularSource(repoRoot, entry.source);
  }
  return seenDestinations;
}

function artifactFiles(root) {
  const results = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`artifact contains symlink: ${toPosix(path.relative(root, absolutePath))}`);
      if (entry.isDirectory()) visit(absolutePath);
      else results.push(toPosix(path.relative(root, absolutePath)));
    }
  }
  if (fs.existsSync(root)) visit(root);
  return results.sort();
}

function isExternalReference(reference) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|%23)/i.test(reference);
}

function resolveArtifactReference(htmlRelativePath, rawReference) {
  const reference = rawReference.trim();
  if (!reference || isExternalReference(reference)) return null;
  const withoutFragment = reference.split('#', 1)[0].split('?', 1)[0];
  if (!withoutFragment) return null;
  let resolved = withoutFragment.startsWith('/')
    ? withoutFragment.slice(1)
    : path.posix.join(path.posix.dirname(htmlRelativePath), withoutFragment);
  resolved = path.posix.normalize(resolved);
  if (resolved.endsWith('/')) resolved += 'index.html';
  validateRelativePath(resolved, `HTML reference from ${htmlRelativePath}`);
  return resolved;
}

function validateHtmlDependencies(outputDirectory) {
  const inventory = artifactFiles(outputDirectory);
  const available = new Set(inventory);
  const missing = [];
  const attributePattern = /(?:src|href)=["']([^"']+)["']/gi;
  const cssUrlPattern = /url\(\s*["']?([^)'"\s]+)["']?\s*\)/g;

  for (const relativePath of inventory.filter((entry) => entry.endsWith('.html'))) {
    const contents = fs.readFileSync(path.join(outputDirectory, relativePath), 'utf8');
    for (const pattern of [attributePattern, cssUrlPattern]) {
      pattern.lastIndex = 0;
      for (const match of contents.matchAll(pattern)) {
        const resolved = resolveArtifactReference(relativePath, match[1]);
        if (resolved !== null && !available.has(resolved) && !virtualHostingPaths.has(resolved)) {
          missing.push(`${relativePath} -> ${match[1]} (${resolved})`);
        }
      }
    }
  }
  if (missing.length > 0) fail(`missing same-origin HTML dependencies:\n${[...new Set(missing)].sort().join('\n')}`);
  return { htmlFiles: inventory.filter((entry) => entry.endsWith('.html')).length, referencesValid: true };
}

function writeApprovedFile(repoRoot, outputDirectory, entry) {
  const sourcePath = assertRegularSource(repoRoot, entry.source);
  const destinationPath = path.join(outputDirectory, entry.destination);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  if (entry.transform === 'strip-front-matter') {
    const contents = fs.readFileSync(sourcePath, 'utf8');
    fs.writeFileSync(destinationPath, stripLeadingFrontMatter(contents, entry.source), 'utf8');
  } else if (entry.transform === null) {
    fs.copyFileSync(sourcePath, destinationPath);
  } else {
    fail(`unknown transform for ${entry.destination}: ${entry.transform}`);
  }
}

// esbuild outputs that ship publicly. esbuild writes module-path comments and
// module keys relative to the build's working directory; when a dependency
// resolves outside it (for example a symlinked node_modules in an isolated
// release checkout) those strings become the developer's real filesystem path.
const bundledOutputs = ['app/dist/bundle.js', 'assets/lyfelabz-assessment-runtime-active.js'];

// A leaked development path must be anchored like a filesystem path: a
// leading "/" or a run of "../", then a home or temp root; or a Windows drive
// followed by Users. URL paths (preceded by a host character) and ordinary
// relative strings such as "../index.html" do not match.
const leakedPathPatterns = [
  /(?:^|[^A-Za-z0-9._~%-])(?:(?:\.\.\/)+|\/)(?:Users|home|private\/var\/folders|private\/tmp|var\/folders)\/[A-Za-z0-9._-]+\//m,
  /(?:^|[^A-Za-z0-9])[A-Za-z]:(?:\\\\|\\|\/)(?:Users|Documents and Settings)(?:\\\\|\\|\/)/m,
];

function findLeakedDevelopmentPath(text) {
  for (const pattern of leakedPathPatterns) {
    const match = pattern.exec(text);
    if (match) return match[0].replace(/^[^A-Za-z0-9./\\]/, '');
  }
  return null;
}

function validateBundleHygiene(outputDirectory) {
  const problems = [];
  for (const relativePath of bundledOutputs) {
    const absolutePath = path.join(outputDirectory, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const leaked = findLeakedDevelopmentPath(fs.readFileSync(absolutePath, 'utf8'));
    if (leaked !== null) problems.push(`${relativePath} contains ${JSON.stringify(leaked)}`);
  }
  if (problems.length > 0) {
    fail(
      `public bundle embeds a local development path (rebuild from a checkout with real installed dependencies, ` +
        `never a symlinked node_modules):\n${problems.join('\n')}`,
    );
  }
  return { bundlesChecked: bundledOutputs.length, clean: true };
}

function buildApplicationArtifact(options = {}) {
  const repoRoot = options.repositoryRoot || repositoryRoot;
  const outputDirectory = validateOutputDirectory(options.outputDirectory || defaultOutputDirectory);
  const approved = collectApprovedCopies(repoRoot);

  if (fs.existsSync(outputDirectory) && fs.lstatSync(outputDirectory).isSymbolicLink()) {
    fail(`output directory must not be a symlink: ${outputDirectory}`);
  }
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const entry of approved) writeApprovedFile(repoRoot, outputDirectory, entry);

  const expected = approved.map((entry) => entry.destination).sort();
  const actual = artifactFiles(outputDirectory);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('built artifact does not exactly match approved inventory');
  const dependencyValidation = validateHtmlDependencies(outputDirectory);
  const bundleHygiene = validateBundleHygiene(outputDirectory);
  return {
    files: actual,
    outputDirectory,
    retainedVariants: approved.filter((entry) => entry.destination.startsWith('app/lessons/variants/')).length,
    assessmentRevisionRenditions: approved.filter((entry) => /^app\/lessons\/assessment-revisions\/.*\.html$/.test(entry.destination)).length,
    dependencyValidation,
    bundleHygiene
  };
}

if (require.main === module) {
  const result = buildApplicationArtifact();
  console.log(
    `Built ${result.files.length} allowlisted application files in ${result.outputDirectory} ` +
    `(${result.retainedVariants} retained variants; HTML dependencies verified)`,
  );
}

module.exports = {
  artifactFiles,
  assertRegularSource,
  buildApplicationArtifact,
  collectApprovedCopies,
  defaultOutputDirectory,
  findLeakedDevelopmentPath,
  listApprovedCopies,
  readApplicationManifest,
  readAssessmentRevisionCopies,
  readRetainedVariantCopies,
  resolveArtifactReference,
  validateCopyEntry,
  validateDestinationPolicy,
  validateApprovedCopies,
  validateBundleHygiene,
  validateHtmlDependencies,
  validateOutputDirectory,
  validateRelativePath
};
