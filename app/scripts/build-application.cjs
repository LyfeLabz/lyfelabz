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
const OPTIONS = Object.freeze({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', target: 'es2022', outfile: 'dist/bundle.js', metafile: true, write: false, preserveSymlinks: true });
const ALLOWED_CONSUMERS = new Set(['app/src/index.ts', 'app/src/shell/surfaces/curriculum.ts', 'app/src/shell/surfaces/teacherUnitsPanel.ts']);
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.parse(canonical(v))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
  return JSON.stringify(value);
}
function refuse(message) { throw new Error(`[application-build] REFUSED: ${message}`); }
function intent(value) { if (!['general','teacher-units'].includes(value)) refuse('unknown release intent'); return value; }
async function compile(root = ROOT, releaseIntent = 'general') {
  intent(releaseIntent);
  root = fs.realpathSync(root);
  const app = path.join(root, 'app');
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
  const result = await esbuild.build({ ...OPTIONS, absWorkingDir: app, plugins: [{ name: 'closed-teacher-units', setup(build) {
    build.onLoad({ filter: /[\\/]teacherUnits[\\/]releaseAvailability\.ts$/ }, args => {
      if (path.resolve(args.path) !== path.join(root, AVAILABILITY)) refuse('substituted availability module');
      return { contents: CLOSED_SOURCE, loader: 'ts' };
    });
  }}] });
  const inputs = { 'app/index.html':hash(entryHtml) }; const graph = {};
  for (const [file, details] of Object.entries(result.metafile.inputs).sort()) {
    const absolute = path.resolve(app, file); const rel = relative(absolute);
    if (rel.startsWith('../') || rel.includes('/__tests__/') || /\.(test|spec)\./.test(rel) || rel.includes('test-setup')) refuse(`unapproved production input: ${rel}`);
    inputs[rel] = hash(fs.readFileSync(absolute));
    graph[rel] = details.imports.filter(i => !i.external).map(i => relative(path.resolve(app, i.path))).sort();
    for (const target of graph[rel]) {
      if (target.startsWith('app/src/teacherUnits/') && !rel.startsWith('app/src/teacherUnits/') && !ALLOWED_CONSUMERS.has(rel)) refuse(`unreviewed Teacher Units entry path: ${rel} -> ${target}`);
    }
  }
  if (!inputs[AVAILABILITY] || !inputs['app/src/teacherUnits/releaseBoundary.ts']) refuse('missing authoritative availability boundary');
  const output = result.outputFiles;
  if (output.length !== 1 || output[0].path !== path.join(app, 'dist/bundle.js')) refuse('unexpected executable output');
  const bundle = Buffer.from(output[0].contents);
  const evidence = { kind: 'lyfelabz.applicationBuild', schemaVersion: 1, policy: 'teacher-units-closed-v1', releaseIntent,
    availability: 'closed', entryScripts, entryPoint: 'app/src/index.ts', compiler: { name:'esbuild',version:esbuild.version,options:OPTIONS },
    builderHash:hash(fs.readFileSync(__filename)), availabilityImplementationHash:hash(CLOSED_SOURCE), inputs, graph,
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
  if (evidence?.availability !== 'closed' || evidence.releaseIntent !== releaseIntent) refuse('unknown/enabled availability or mismatched release intent');
  const rebuilt = await compile(root,releaseIntent);
  if (canonical(evidence) !== canonical(rebuilt.evidence) || hash(bundle) !== rebuilt.evidence.outputs['app/dist/bundle.js']) refuse('stale/substituted build evidence or modified bundle');
  return rebuilt.evidence;
}
async function main(argv) {
  if (argv.length === 0) { await build(); return; }
  if (argv.length !== 3 || !['--verify','--build'].includes(argv[0])) refuse('expected --build|--verify <repository-root> <general|teacher-units>');
  const evidence=await (argv[0] === '--verify' ? verify : build)(path.resolve(argv[1]),intent(argv[2]));
  process.stdout.write(canonical(evidence)+'\n');
}
if (require.main === module) main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports = { compile, build, verify, canonical, hash, CLOSED_SOURCE };
