'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const distributionRoot = path.join(repositoryRoot, 'dist');
const defaultOutputDirectory = path.join(distributionRoot, 'marketing');
const manifestPath = path.join(__dirname, 'public-files.json');
const frontMatterFiles = new Set(['privacy.html', 'terms.html']);

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function validateManifestEntry(entry) {
  if (typeof entry !== 'string' || entry.length === 0) {
    throw new Error('Every marketing manifest entry must be a non-empty string.');
  }

  if (entry.includes('\\') || path.posix.isAbsolute(entry)) {
    throw new Error(`Unsafe marketing manifest path: ${entry}`);
  }

  const normalized = path.posix.normalize(entry);
  if (normalized !== entry || normalized === '.' || normalized.startsWith('../')) {
    throw new Error(`Unsafe marketing manifest path: ${entry}`);
  }

  return entry;
}

function validateOutputDirectory(outputDirectory) {
  const resolved = path.resolve(outputDirectory);
  if (!isInside(distributionRoot, resolved)) {
    throw new Error(`Marketing output must be a child of ${distributionRoot}`);
  }
  return resolved;
}

function readManifest() {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!parsed || !Array.isArray(parsed.files)) {
    throw new Error('Marketing manifest must contain a files array.');
  }

  const files = parsed.files.map(validateManifestEntry);
  if (new Set(files).size !== files.length) {
    throw new Error('Marketing manifest contains duplicate paths.');
  }
  if (files.join('\n') !== [...files].sort().join('\n')) {
    throw new Error('Marketing manifest paths must be sorted.');
  }
  return files;
}

function stripLeadingFrontMatter(contents, relativePath) {
  if (!frontMatterFiles.has(relativePath)) return contents;

  const match = contents.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!match) {
    throw new Error(`Expected leading YAML front matter in marketing legal page: ${relativePath}`);
  }

  return contents.slice(match[0].length);
}

function buildMarketingArtifact(options = {}) {
  const outputDirectory = validateOutputDirectory(options.outputDirectory || defaultOutputDirectory);
  const files = readManifest();

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });

  for (const relativePath of files) {
    const sourcePath = path.join(repositoryRoot, relativePath);
    const sourceStat = fs.lstatSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Marketing source must be a regular file: ${relativePath}`);
    }

    const destinationPath = path.join(outputDirectory, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (frontMatterFiles.has(relativePath)) {
      const sourceContents = fs.readFileSync(sourcePath, 'utf8');
      fs.writeFileSync(destinationPath, stripLeadingFrontMatter(sourceContents, relativePath), 'utf8');
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }

  return { files, outputDirectory };
}

if (require.main === module) {
  const result = buildMarketingArtifact();
  console.log(`Built ${result.files.length} allowlisted marketing files in ${result.outputDirectory}`);
}

module.exports = {
  buildMarketingArtifact,
  defaultOutputDirectory,
  readManifest,
  repositoryRoot,
  stripLeadingFrontMatter,
  validateManifestEntry,
  validateOutputDirectory
};
