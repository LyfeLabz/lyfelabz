'use strict';
// One reviewed entry, one closed availability implementation, no activation switch.
// Verification independently recompiles; evidence is not trusted on its own.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '../..');
const AVAILABILITY = 'app/src/teacherUnits/releaseAvailability.ts';
const CLOSED_SOURCE = 'export function teacherUnitsAvailable(): boolean { return false; }\nexport function requireTeacherUnitsAvailable(): void { throw new Error("Teacher Units unavailable in this release"); }\n';
const NAMESPACE = 'teacher-units-availability-contract';
const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.json']);
const OPTIONS = Object.freeze({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', target: 'es2022', outfile: 'dist/bundle.js', metafile: true, write: false, preserveSymlinks: true, resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'] });
const ALLOWED_CONSUMERS = new Set(['app/src/index.ts', 'app/src/shell/surfaces/curriculum.ts', 'app/src/shell/surfaces/teacherUnitsPanel.ts']);
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.parse(canonical(v))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
  return JSON.stringify(value);
}
function refuse(message) { throw new Error(`[application-build] REFUSED: ${message}`); }
function intent(value) { if (!['general','teacher-units'].includes(value)) refuse('unknown release intent'); return value; }
// Inventory actual files (including untracked/hidden files), not Git or glob output.
// Dependencies have their own JS/package resolution; this contract covers app/src.
function checkSource(root = ROOT) {
  root = fs.realpathSync(root);
  if (fs.lstatSync(path.join(root, 'app')).isSymbolicLink()) refuse('symlink in application source root');
  const source = path.join(root, 'app/src'); const files = [];
  function walk(directory) {
    if (fs.lstatSync(directory).isSymbolicLink()) refuse('symlink in application source');
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name); const stat = fs.lstatSync(file);
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (stat.isSymbolicLink()) refuse(`symlink in application source: ${rel}`);
      // JSON data is allowed, but these names configure resolver behavior that
      // TypeScript/ESLint/Jest do not share with esbuild. Inspect every source file.
      if (stat.isFile() && /^(?:package\.json|tsconfig.*\.json|jsconfig\.json)$/i.test(name)) refuse(`resolution-controlling JSON configuration in application source: ${rel}`);
      // A directory, case variant, duplicate location or any alternate suffix can
      // never supply the canonical identity. The existing unit test is not a module.
      if (name.split('.')[0].toLowerCase() === 'releaseavailability' &&
          !(stat.isFile() && [AVAILABILITY, 'app/src/teacherUnits/releaseAvailability.test.ts'].includes(rel))) {
        refuse(`ambiguous/shadowing availability module: ${rel}`);
      }
      if (stat.isDirectory()) walk(file);
      else if (!stat.isFile() || !SOURCE_EXTENSIONS.includes(path.extname(name))) refuse(`unreviewed application source extension: ${rel}`);
      else files.push(rel);
    }
  }
  walk(source);
  if (!files.includes(AVAILABILITY)) refuse('missing canonical availability module');
  return { extensions: SOURCE_EXTENSIONS, resolutionConfigs: { prohibitedNames: ['package.json', 'tsconfig*.json', 'jsconfig.json'], caseInsensitive: true }, files: files.sort() };
}
async function compile(root = ROOT, releaseIntent = 'general') {
  intent(releaseIntent);
  root = fs.realpathSync(root);
  const sourceContract = checkSource(root);
  const app = path.join(root, 'app');
  const canonicalModule = path.join(root, AVAILABILITY);
  const resolvedImports = [];
  let entryHtml;
  try { entryHtml=fs.readFileSync(path.join(app,'index.html')); } catch { refuse('missing reviewed application HTML entry point'); }
  const dom=new JSDOM(entryHtml.toString('utf8'));
  const entryScripts=[...dom.window.document.querySelectorAll('script')].map(script=>({
    src:script.getAttribute('src'), type:script.getAttribute('type') || '',
    inline:script.textContent.trim(), attributes:[...script.attributes].map(a=>a.name).sort()
  }));
  const expectedScripts=[{src:'/assets/lyfelabz-firebase-config.js',type:'',inline:'',attributes:['src']},
    {src:'/app/dist/bundle.js',type:'module',inline:'',attributes:['src','type']}];
  const hasBase=dom.window.document.querySelector('base') !== null;
  dom.window.close();
  if (hasBase || canonical(entryScripts) !== canonical(expectedScripts)) refuse('unreviewed executable application HTML entry point');
  const dependencyRoot = fs.existsSync(path.join(app,'node_modules')) ? fs.realpathSync(path.join(app,'node_modules')) : null;
  const relative = absolute => {
    const rel = path.relative(root,absolute).split(path.sep).join('/');
    if (!rel.startsWith('../')) return rel;
    if (dependencyRoot && (absolute === dependencyRoot || absolute.startsWith(dependencyRoot + path.sep))) return 'app/node_modules/' + path.relative(dependencyRoot,absolute).split(path.sep).join('/');
    refuse(`input outside reviewed application/dependency roots: ${absolute}`);
  };
  const inputIdentity = file => {
    if (file === NAMESPACE + ':' + AVAILABILITY) return AVAILABILITY;
    if (file.startsWith(NAMESPACE + ':')) refuse('unknown canonical namespace identity');
    return relative(path.resolve(app, file));
  };
  const result = await esbuild.build({ ...OPTIONS, absWorkingDir: app, plugins: [{ name: 'closed-teacher-units', setup(build) {
    // Resolve before esbuild's extension/directory lookup. No loaded-file suffix
    // match: only this private namespace may supply the closed implementation.
    // esbuild serializes RegExp.source without flags; do case handling here.
    build.onResolve({ filter: /.*/, namespace: 'file' }, args => {
      const basename = path.basename(args.path);
      if (basename.split('.')[0].toLowerCase() !== 'releaseavailability') return;
      const target = path.resolve(args.resolveDir, args.path);
      if (args.namespace !== 'file' || ![canonicalModule, canonicalModule.slice(0, -3)].includes(target)) refuse('noncanonical availability import');
      resolvedImports.push({ importer: relative(args.importer), specifier: args.path, resolved: AVAILABILITY });
      return { path: AVAILABILITY, namespace: NAMESPACE };
    });
    // Aliases/tsconfig paths must not reach the same physical file through the
    // default namespace. A missed import shape refuses instead of loading source.
    build.onLoad({ filter: /.*/, namespace: 'file' }, args => {
      if (path.resolve(args.path).toLowerCase() === canonicalModule.toLowerCase()) refuse('availability import bypassed canonical resolution');
    });
    build.onLoad({ filter: /.*/, namespace: NAMESPACE }, args => {
      if (args.path !== AVAILABILITY) refuse('substituted canonical availability identity');
      return { contents: CLOSED_SOURCE, loader: 'ts' };
    });
  }}] });
  const inputs = { 'app/index.html':hash(entryHtml) }; const graph = {};
  for (const [file, details] of Object.entries(result.metafile.inputs).sort()) {
    const rel = inputIdentity(file);
    const absolute = path.join(root, rel);
    if (rel.startsWith('../') || rel.includes('/__tests__/') || /\.(test|spec)\./.test(rel) || rel.includes('test-setup')) refuse(`unapproved production input: ${rel}`);
    inputs[rel] = hash(fs.readFileSync(absolute));
    graph[rel] = details.imports.filter(i => !i.external).map(i => inputIdentity(i.path)).sort();
    for (const target of graph[rel]) {
      if (target.startsWith('app/src/teacherUnits/') && !rel.startsWith('app/src/teacherUnits/') && !ALLOWED_CONSUMERS.has(rel)) refuse(`unreviewed Teacher Units entry path: ${rel} -> ${target}`);
    }
  }
  if (!resolvedImports.length || !result.metafile.inputs[NAMESPACE + ':' + AVAILABILITY] || !inputs[AVAILABILITY] || !inputs['app/src/teacherUnits/releaseBoundary.ts']) refuse('missing authoritative availability boundary');
  const output = result.outputFiles;
  if (output.length !== 1 || output[0].path !== path.join(app, 'dist/bundle.js')) refuse('unexpected executable output');
  const bundle = Buffer.from(output[0].contents);
  const evidence = { kind: 'lyfelabz.applicationBuild', schemaVersion: 2, policy: 'teacher-units-canonical-closed-v2', releaseIntent,
    availability: 'closed', availabilityEvidence: 'build-contract-assertion', runtimeAvailability: 'not-certified',
    sourceContract, canonicalAvailability: { identity: AVAILABILITY, namespace: NAMESPACE, loader: 'ts',
      sourceHash: inputs[AVAILABILITY], replacementHash: hash(CLOSED_SOURCE),
      resolvedImports: resolvedImports.sort((a,b) => Buffer.compare(Buffer.from(canonical(a)), Buffer.from(canonical(b)))) },
    entryScripts, entryPoint: 'app/src/index.ts', compiler: { name:'esbuild',version:esbuild.version,options:OPTIONS },
    builderHash:hash(fs.readFileSync(__filename)), inputs, graph,
    outputs:{'app/dist/bundle.js':hash(bundle)} };
  return { bundle, evidence:JSON.parse(canonical(evidence)) };
}
async function build(root = ROOT, releaseIntent = 'general') {
  const built = await compile(root, releaseIntent); const directory = path.join(root,'app/dist');
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'bundle.js'),built.bundle);
  fs.writeFileSync(path.join(directory,'application-build.json'),canonical(built.evidence)+'\n');
  return built.evidence;
}
async function verify(root = ROOT, releaseIntent = 'general') {
  intent(releaseIntent); let evidence, bundle;
  try { evidence=JSON.parse(fs.readFileSync(path.join(root,'app/dist/application-build.json'),'utf8')); bundle=fs.readFileSync(path.join(root,'app/dist/bundle.js')); }
  catch { refuse('missing or malformed availability build evidence/bundle'); }
  if (evidence?.schemaVersion !== 2 || evidence.availabilityEvidence !== 'build-contract-assertion' || evidence.runtimeAvailability !== 'not-certified' || evidence.availability !== 'closed' || evidence.releaseIntent !== releaseIntent) refuse('unknown/enabled availability or mismatched release intent');
  const rebuilt = await compile(root,releaseIntent);
  if (canonical(evidence) !== canonical(rebuilt.evidence) || hash(bundle) !== rebuilt.evidence.outputs['app/dist/bundle.js']) refuse('stale/substituted build evidence or modified bundle');
  return rebuilt.evidence;
}
async function main(argv) {
  if (argv.length === 1 && argv[0] === '--check-source') { checkSource(); return; }
  if (argv.length === 0) { await build(); return; }
  if (argv.length !== 3 || !['--verify','--build'].includes(argv[0])) refuse('expected --build|--verify <repository-root> <general|teacher-units>');
  const evidence=await (argv[0] === '--verify' ? verify : build)(path.resolve(argv[1]),intent(argv[2]));
  process.stdout.write(canonical(evidence)+'\n');
}
if (require.main === module) main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports = { compile, build, verify, canonical, hash, CLOSED_SOURCE, checkSource };
