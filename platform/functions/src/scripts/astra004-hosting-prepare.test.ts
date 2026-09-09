import { promises as fsp, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "fs";
import cp from "child_process";
import * as os from "os";
import * as path from "path";
import { gunzipSync, gzipSync } from "zlib";
import * as ts from "typescript";
import {
  APPROVED_MANIFEST_SHA256, APPROVED_OVERLAY_SHA256, BASELINE_SHIM_SHA256,
  SHIM_PATH, STAGING_ORIGIN, STAGING_PROJECT_ID, MAX_FILE_BYTES,
  assertApprovedManifest, assertBaselineLock, assertBaselineIdentity, approvedBaselineHash,
  assertOnlyShimChanged, assertSafeArtifactPath, assertSafeDownloadResult, assertSafeEnvironment,
  assertSafeHostingConfig, assertSecretSafe, assertContentContract, buildDownloadUrl,
  loadApprovedManifest, makeHostingConfig, parseArgs, prepareArtifact, sha256,
  validateManifestPaths, verifyArtifact, nativeDownloader, main, type Downloader,
} from "./astra004-hosting-prepare";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SOURCE = path.join(__dirname, "astra004-hosting-prepare.ts");
const FIXED_ORIGIN = "https://lyfelabz-staging.web.app";
const tempRoots: string[] = [];
const realMkdtemp = fsp.mkdtemp.bind(fsp);
const realWrite = fsp.writeFile.bind(fsp);
let manifest: string[];
let fixtures: Map<string, Buffer>;
let overlay: Buffer;
let processRoot: string;
let treePaths: string;
let processEntry: string;
let preloadPath: string;

function mime(file: string): string {
  return ({ ".js": "application/javascript", ".html": "text/html", ".css": "text/css",
    ".ico": "image/x-icon", ".png": "image/png", ".xml": "application/xml" } as Record<string, string>)[path.extname(file)] ?? "text/plain";
}
function fixture(file: string): Buffer {
  const bytes = fixtures.get(file);
  if (!bytes) throw new Error(`missing offline fixture '${file}'`);
  return Buffer.from(bytes);
}
const download: Downloader = (url) => {
  const parsed = new URL(url);
  if (parsed.origin !== FIXED_ORIGIN) throw new Error("test blocked a non-staging request");
  const file = parsed.pathname.slice(1);
  return Promise.resolve({ status: 200, redirected: false, body: fixture(file), contentType: mime(file) });
};
async function prepare(downloader: Downloader = download, repoRoot = REPO_ROOT) {
  return prepareArtifact({ repoRoot, manifest, downloader });
}
async function writeFile(root: string, file: string, bytes: Buffer | string = "safe"): Promise<void> {
  await fsp.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fsp.writeFile(path.join(root, file), bytes);
}
async function directory(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "astra004-test-"));
}

// The child runs the actual transpiled Node entrypoint. These are test-only
// boundary stubs: no production test switches, SDKs, or live network access.
const PRELOAD = String.raw`
const fs = require('fs'), path = require('path'), zlib = require('zlib'), cp = require('child_process');
const trace = [];
const root = process.env.ASTRA_HOSTING_TEST_ROOT;
const bodies = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'bodies.json.gz'))));
const realExec = cp.execFileSync;
const blocked = (kind) => (...args) => { trace.push({kind:'BLOCKED', operation:kind}); throw new Error('test blocked external action'); };
for (const name of ['exec','execSync','execFile','spawn','spawnSync','fork']) cp[name] = blocked(name);
cp.execFileSync = (file,args,options) => {
  if (file === 'git' && JSON.stringify(args.slice(2)) === JSON.stringify(['ls-tree','-r','--name-only','cb73aff','--'])) {
    trace.push({kind:'git'}); return fs.readFileSync(path.join(root,'tree.txt'),'utf8');
  }
  if (file === process.execPath && JSON.stringify(args) === JSON.stringify(['--check']) && Buffer.isBuffer(options.input)) {
    trace.push({kind:'syntax'}); return realExec(file,args,options);
  }
  return blocked('execFileSync')();
};
for (const moduleName of ['http','https']) {
  const api = require(moduleName); api.request = blocked(moduleName); api.get = blocked(moduleName);
}
require('net').connect = blocked('net'); require('tls').connect = blocked('tls');
const Module = require('module'), load = Module._load;
Module._load = function(name,...args) {
  if (/^(firebase|@google-cloud)/.test(name)) return blocked('SDK import')();
  return load.call(this,name,...args);
};
global.fetch = async (url,options) => {
  const parsed = new URL(url);
  trace.push({kind:'fetch',origin:parsed.origin,method:options.method,redirect:options.redirect});
  if (parsed.origin !== 'https://lyfelabz-staging.web.app' || options.method !== 'GET' || options.redirect !== 'manual') throw new Error('test transport guard failed');
  const bytes = Buffer.from(bodies[parsed.pathname.slice(1)],'base64');
  return new Response(bytes,{status:200});
};
process.on('exit',()=>fs.writeFileSync(process.env.ASTRA_HOSTING_TEST_TRACE,JSON.stringify(trace)));
`;

beforeAll(() => {
  manifest = loadApprovedManifest(REPO_ROOT);
  treePaths = cp.execFileSync("git", ["-C", REPO_ROOT, "ls-tree", "-r", "--name-only", "cb73aff", "--"], { encoding: "utf8" });
  const dist = JSON.parse(gunzipSync(readFileSync(path.join(__dirname, "__fixtures__/astra004-hosting-dist.json.gz"))).toString()) as Record<string, string>;
  fixtures = new Map(manifest.map((file) => [file, file in dist ? Buffer.from(dist[file]) :
    cp.execFileSync("git", ["-C", REPO_ROOT, "show", `cb73aff:${file}`], { maxBuffer: 8 * 1024 * 1024 })]));
  for (const [file, bytes] of fixtures) assertBaselineIdentity(file, bytes);
  overlay = readFileSync(path.join(REPO_ROOT, SHIM_PATH));
  expect(sha256(overlay)).toBe(APPROVED_OVERLAY_SHA256);
  processRoot = mkdtempSync(path.join(os.tmpdir(), "astra004-cli-test-"));
  processEntry = path.join(processRoot, "repo/platform/functions/lib/scripts/astra004-hosting-prepare.js");
  mkdirSync(path.dirname(processEntry), { recursive: true });
  mkdirSync(path.join(processRoot, "repo/assets"), { recursive: true });
  writeFileSync(path.join(processRoot, "repo", SHIM_PATH), overlay);
  writeFileSync(processEntry, ts.transpileModule(readFileSync(SOURCE, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText);
  writeFileSync(path.join(path.dirname(processEntry), "astra004-hosting-baseline.json"), readFileSync(path.join(__dirname, "astra004-hosting-baseline.json")));
  writeFileSync(path.join(processRoot, "bodies.json.gz"), gzipSync(JSON.stringify(Object.fromEntries([...fixtures].map(([f, b]) => [f, b.toString("base64")])))));
  writeFileSync(path.join(processRoot, "tree.txt"), treePaths);
  preloadPath = path.join(processRoot, "preload.cjs");
  writeFileSync(preloadPath, PRELOAD);
});

beforeEach(() => {
  jest.spyOn(fsp, "mkdtemp").mockImplementation(async (prefix, options) => {
    const root = await realMkdtemp(prefix, options);
    tempRoots.push(String(root));
    return root;
  });
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("live network disabled in focused tests"));
  jest.spyOn(process.stdout, "write").mockReturnValue(true);
  jest.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});
afterAll(() => { if (processRoot) rmSync(processRoot, { recursive: true, force: true }); });

function executeCli(argv: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const tracePath = path.join(processRoot, "trace.json");
  rmSync(tracePath, { force: true });
  const result = cp.spawnSync(process.execPath, ["--require", preloadPath, processEntry, ...argv], {
    encoding: "utf8", timeout: 30_000,
    env: { PATH: process.env.PATH, TMPDIR: processRoot, ASTRA_HOSTING_TEST_ROOT: processRoot,
      ASTRA_HOSTING_TEST_TRACE: tracePath, ...extraEnv },
  });
  const trace = JSON.parse(readFileSync(tracePath, "utf8")) as Array<Record<string, string>>;
  return { ...result, trace };
}

describe("real project and entrypoint guards", () => {
  test.each([[], ["--project"], ["--project="], ["--project= lyfelabz-staging"],
    ["--project=lyfelabz-staging", "--project=lyfelabz-staging"],
    ["--project=lyfelabz-staging", "--origin=https://example.invalid"]].map((argv) => ({ argv })))("rejects malformed CLI flags %#", ({ argv }) => {
    expect(parseArgs(argv).ok).toBe(false);
  });
  test.each(["lyfelabz-prod", "staging", "default", "another-project", "lyfelabz-staging\0"])("main rejects unauthorized project %s before any work", async (project) => {
    const downloader = jest.fn(download);
    const exec = jest.spyOn(cp, "execFileSync");
    expect(await main([`--project=${project}`], {}, downloader)).toBe(2);
    expect(downloader).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(fsp.mkdtemp).not.toHaveBeenCalled();
  });
  test.each(["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_EMULATOR_HOST",
    "FIREBASE_DATABASE_EMULATOR_HOST", "FIREBASE_EMULATOR_HUB", "FIRESTORE_EMULATOR_HOST",
    "FUNCTIONS_EMULATOR", "STORAGE_EMULATOR_HOST"])("main rejects conflicting environment %s", async (key) => {
    const downloader = jest.fn(download);
    expect(await main(["--project=lyfelabz-staging"], { [key]: "conflicting" }, downloader)).toBe(2);
    expect(downloader).not.toHaveBeenCalled();
    expect(fsp.mkdtemp).not.toHaveBeenCalled();
  });
  test("permits only literal staging including agreeing ambient project", () => {
    expect(STAGING_PROJECT_ID).toBe("lyfelabz-staging");
    expect(assertSafeEnvironment({ project: STAGING_PROJECT_ID }, { GOOGLE_CLOUD_PROJECT: STAGING_PROJECT_ID })).toBeNull();
  });
  test.each([
    { argv: ["--project=lyfelabz-prod"], env: {} },
    { argv: ["--project=lyfelabz-staging"], env: { GCLOUD_PROJECT: "lyfelabz-prod" } },
    { argv: [], env: {} },
  ])("real Node entrypoint refuses before subprocesses or GETs %#", ({ argv, env }) => {
    const result = executeCli(argv, env);
    expect(result.status).toBe(2);
    expect(result.trace).toEqual([]);
    expect(result.stdout).not.toContain("READY");
  });
  test("real Node entrypoint completes using only fixed GETs and the two allowed subprocesses", () => {
    const result = executeCli(["--project=lyfelabz-staging"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("actual file count: 178");
    expect(result.stdout).toContain("approved unchanged baseline hashes: 177/177");
    expect(result.trace.filter((e) => e.kind === "git")).toHaveLength(1);
    expect(result.trace.filter((e) => e.kind === "syntax")).toHaveLength(1);
    expect(result.trace.filter((e) => e.kind === "fetch")).toEqual(Array.from({ length: 178 }, () => ({
      kind: "fetch", origin: FIXED_ORIGIN, method: "GET", redirect: "manual",
    })));
    expect(result.trace).toHaveLength(180);
  });
});

describe("approved manifest and baseline locks", () => {
  test("matches independent literal path count and digest", () => {
    expect(manifest).toHaveLength(178);
    expect(sha256(`${manifest.join("\n")}\n`)).toBe("defa040e9fea3e0d857efbc40c70c43cd77b484d183f7b13d7458b0cc06b0ba2");
    expect(APPROVED_MANIFEST_SHA256).toBe("defa040e9fea3e0d857efbc40c70c43cd77b484d183f7b13d7458b0cc06b0ba2");
    expect(() => assertBaselineLock()).not.toThrow();
  });
  test("real Git loader refuses an eligible unapproved path", () => {
    jest.spyOn(cp, "execFileSync").mockReturnValue(`${treePaths}unexpected.html\n`);
    expect(() => loadApprovedManifest(REPO_ROOT)).toThrow("manifest");
  });
  test("real Git loader ignores unrelated source entries", () => {
    jest.spyOn(cp, "execFileSync").mockReturnValue(`${treePaths}app/src/unrelated.ts\n`);
    expect(loadApprovedManifest(REPO_ROOT)).toEqual(manifest);
  });
  test("preparation enforces the approval before any download", async () => {
    const downloader = jest.fn(download);
    await expect(prepareArtifact({ repoRoot: REPO_ROOT, manifest: [SHIM_PATH], downloader })).rejects.toThrow("manifest");
    expect(downloader).not.toHaveBeenCalled();
  });
  test("rejects a same-count path substitution", () => {
    expect(() => assertApprovedManifest(manifest.map((f) => f === "index.html" ? "index-other.html" : f).sort())).toThrow("digest");
  });
  test.each(["../secret", "app/../../secret", "/absolute", "app/../index.html", "assets\\x.js", "assets/a\0.js", "app//index.html"])("rejects noncanonical path %s", (file) => {
    expect(() => validateManifestPaths([file])).toThrow();
  });
  test("rejects normalized duplicates", () => {
    expect(() => validateManifestPaths(["assets/file.js", "assets//file.js"])).toThrow("duplicate normalized");
  });
  test.each([".git/config", ".github/workflows/deploy.yml", ".claude/settings.json", ".firebase/cache", ".DS_Store", "app/src/index.ts", "app/scripts/build.cjs", "platform/functions/index.js", "docs/plan.html", "app/dist/bundle.js.map", "app/example.test.ts", "package.json", ".env", "assets/credentials.zip"])("rejects excluded path %s", (file) => {
    expect(() => assertSafeArtifactPath(file)).toThrow();
  });
  test("refuses changed baseline bytes with the path but no body", async () => {
    await expect(prepare(async (url, timeout) => {
      const result = await download(url, timeout);
      return new URL(url).pathname === "/index.html" ? { ...result, body: Buffer.concat([result.body, Buffer.from("<!-- changed -->")]) } : result;
    })).rejects.toThrow("approved staging baseline hash mismatch for 'index.html'");
  });
  test("pins the reviewed overlay and old staging shim", () => {
    expect(sha256(overlay)).toBe("d07473b36f0a103adccbb6ab3802aab1c1b9aefc875e6d641dc1e2b04e703b2f");
    expect(sha256(fixture(SHIM_PATH))).toBe(BASELINE_SHIM_SHA256);
    expect(approvedBaselineHash(SHIM_PATH)).not.toBe(APPROVED_OVERLAY_SHA256);
  });
});

describe("real native downloader and content contracts", () => {
  test("uses the literal HTTPS staging origin, GET and manual redirects", async () => {
    expect(STAGING_ORIGIN).toBe(FIXED_ORIGIN);
    expect(buildDownloadUrl("index.html")).toBe(`${FIXED_ORIGIN}/index.html`);
    jest.mocked(fetch).mockResolvedValue(new Response(fixture("index.html"), { headers: { "content-type": "text/html" } }));
    const result = await nativeDownloader(`${FIXED_ORIGIN}/index.html`, 1000);
    expect(fetch).toHaveBeenCalledWith(`${FIXED_ORIGIN}/index.html`, expect.objectContaining({ method: "GET", redirect: "manual", signal: expect.any(AbortSignal) }));
    expect(result.contentType).toBe("text/html");
  });
  test.each(["https://example.invalid/index.html", "http://lyfelabz-staging.web.app/index.html", "https://lyfelabz-staging.web.app.example.invalid/index.html"])("rejects foreign origin before fetch %s", async (url) => {
    await expect(nativeDownloader(url, 1000)).rejects.toThrow("fixed staging");
    expect(fetch).not.toHaveBeenCalled();
  });
  test("actual fetch redirect response is rejected without a second request", async () => {
    jest.mocked(fetch).mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://example.invalid" } }));
    const result = await nativeDownloader(`${FIXED_ORIGIN}/index.html`, 1000);
    expect(() => assertSafeDownloadResult("index.html", result)).toThrow("redirect");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test("native transport aborts a timed-out request", async () => {
    jest.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("test abort")));
    }));
    await expect(nativeDownloader(`${FIXED_ORIGIN}/index.html`, 10)).rejects.toThrow("test abort");
  });
  test.each([404, 500])("rejects HTTP %s", (status) => {
    expect(() => assertSafeDownloadResult("index.html", { status, redirected: false, body: Buffer.from("x") })).toThrow(`HTTP ${status}`);
  });
  test("rejects over-limit bodies", () => {
    expect(() => assertSafeDownloadResult("index.html", { status: 200, redirected: false, body: Buffer.alloc(MAX_FILE_BYTES + 1) })).toThrow("size limit");
  });
  test("network retries are bounded and redacted", async () => {
    const downloader = jest.fn(() => Promise.reject(new Error("synthetic network detail")));
    await expect(prepare(downloader)).rejects.toThrow("timeout or network failure");
    expect(downloader).toHaveBeenCalledTimes(3);
  });
  test.each([
    ["app/dist/bundle.js", "JavaScript/non-HTML"],
    ["app/lessons/lesson_biological-evolution.html", "canonical lesson identity"],
  ])("full 178-file preparation rejects SPA-shell substitution at %s", async (target, contract) => {
    await expect(prepare(async (url, timeout) => {
      const result = await download(url, timeout);
      return new URL(url).pathname === `/${target}` ? { ...result, body: fixture("app/index.html") } : result;
    })).rejects.toThrow(`${contract} content contract failed`);
  });
  test("full 178-file preparation rejects an empty HTTP 200", async () => {
    await expect(prepare(async (url, timeout) => {
      const result = await download(url, timeout);
      return url.endsWith("/app/dist/bundle.js") ? { ...result, body: Buffer.alloc(0) } : result;
    })).rejects.toThrow("empty baseline file rejected");
  });
  test.each(["<!DOCTYPE html><html></html>", "<!-- comment --><html></html>", "\uFEFF <body>fallback</body>", "<script>fallback</script>"])("JS body rejects common document signatures %#", (body) => {
    expect(() => assertContentContract("app/dist/bundle.js", Buffer.from(body), "application/javascript")).toThrow("JavaScript/non-HTML");
  });
  test("Content-Type is an additional constraint even with real bytes", () => {
    expect(() => assertContentContract("app/dist/bundle.js", fixture("app/dist/bundle.js"), "text/html")).toThrow("MIME type");
  });
  test("canonical lesson needs its own slug and runtime include", () => {
    expect(() => assertContentContract("app/lessons/lesson_body-systems.html", fixture("app/lessons/lesson_biological-evolution.html"))).toThrow("canonical lesson identity");
    const body = fixture("app/lessons/lesson_biological-evolution.html").toString().replace(`/${SHIM_PATH}`, "/wrong.js");
    expect(() => assertContentContract("app/lessons/lesson_biological-evolution.html", Buffer.from(body))).toThrow("canonical lesson identity");
  });
  test("both retained variants reject shell, unrelated and swapped HTML", () => {
    const variants = manifest.filter((f) => f.startsWith("app/lessons/variants/"));
    for (const [index, file] of variants.entries()) {
      expect(() => assertContentContract(file, fixture("app/index.html"))).toThrow("variant identity");
      expect(() => assertContentContract(file, fixture(variants[1 - index]))).toThrow("variant identity");
    }
  });
  test("app shell requires its canonical mounts and actual bundle reference", () => {
    expect(() => assertContentContract("app/index.html", fixture("app/dist/index.html"))).toThrow("app shell identity");
  });
  test.each([["favicon.ico", "ICO signature"], ["image.png", "PNG signature"], ["site.css", "CSS structure"], ["sitemap.xml", "sitemap structure"], ["robots.txt", "plain text"]])("static contract refuses HTML at %s", (file, contract) => {
    expect(() => assertContentContract(file, fixture("app/index.html"))).toThrow(contract);
  });
});

describe("full artifact and overlay invariants", () => {
  test("never writes the historical staging shim into public", async () => {
    const shimWrites: string[] = [];
    jest.spyOn(fsp, "writeFile").mockImplementation(async (file, bytes, options) => {
      if (typeof file === "string" && file.endsWith(`/${SHIM_PATH}`)) {
        if (!Buffer.isBuffer(bytes)) throw new Error("expected Buffer test fixture");
        shimWrites.push(sha256(bytes));
      }
      await realWrite(file, bytes, options);
    });
    await prepare();
    expect(shimWrites).toEqual([APPROVED_OVERLAY_SHA256]);
  });
  test("prepares exactly 178 approved files and independently verifies all hashes", async () => {
    const report = await prepare();
    expect(report.actualFileCount).toBe(178);
    expect(await verifyArtifact(report.publicPath, manifest)).toEqual(manifest);
    for (const file of manifest) expect(sha256(await fsp.readFile(path.join(report.publicPath, file)))).toBe(file === SHIM_PATH ? APPROVED_OVERLAY_SHA256 : approvedBaselineHash(file));
    expect(Object.keys(JSON.parse(await fsp.readFile(report.firebaseConfigPath, "utf8")))).toEqual(["hosting"]);
    expect(await fsp.readdir(report.workspacePath)).toEqual(expect.arrayContaining(["preparation-evidence.json", "expected-paths.txt", "firebase.json", "public"]));
  });
  test.each(["index.html", SHIM_PATH])("final verification rejects post-overlay tampering of %s", async (target) => {
    jest.spyOn(fsp, "writeFile").mockImplementation(async (file, bytes, options) => {
      await realWrite(file, bytes, options);
      if (typeof file === "string" && file.endsWith(`/${SHIM_PATH}`) && typeof options === "object" && options?.flag === "w") {
        const root = file.slice(0, -SHIM_PATH.length);
        await realWrite(path.join(root, target), Buffer.concat([target === SHIM_PATH ? overlay : fixture(target), Buffer.from(" ")]));
      }
    });
    await expect(prepare()).rejects.toThrow(target === SHIM_PATH ? "overlay hash changed" : "only the ASTRA-004 shim");
  });
  test("exact path equality rejects a second extra public file", async () => {
    jest.spyOn(fsp, "writeFile").mockImplementation(async (file, bytes, options) => {
      await realWrite(file, bytes, options);
      if (typeof file === "string" && file.endsWith(`/${SHIM_PATH}`) && typeof options === "object" && options?.flag === "w") {
        await realWrite(path.join(file.slice(0, -SHIM_PATH.length), "extra.html"), "safe");
      }
    });
    await expect(prepare()).rejects.toThrow("artifact manifest mismatch");
  });
  test("artifact scanner rejects a symlink", async () => {
    const root = await directory();
    await fsp.symlink("missing", path.join(root, "index.html"));
    await expect(verifyArtifact(root, ["index.html"])).rejects.toThrow("symlink");
  });
  test("local overlay symlink is refused before GETs", async () => {
    const root = await directory();
    await fsp.mkdir(path.join(root, "assets"));
    await fsp.symlink(path.join(REPO_ROOT, SHIM_PATH), path.join(root, SHIM_PATH));
    await expect(prepare(download, root)).rejects.toThrow("non-symlink");
  });
  test("artifact scanner rejects hidden paths", async () => {
    const root = await directory();
    await writeFile(root, ".hidden/file.html");
    await expect(verifyArtifact(root, ["index.html"])).rejects.toThrow("hidden path");
  });
  test("non-reviewed local shim is rejected even when valid JavaScript", async () => {
    const root = await directory();
    await writeFile(root, SHIM_PATH, Buffer.concat([overlay, Buffer.from("\n// unreviewed change\n")]));
    await expect(prepare(download, root)).rejects.toThrow("reviewed overlay hash");
  });
  test("already overlaid staging shim cannot become a new baseline", async () => {
    await expect(prepare(async (url, timeout) => {
      const result = await download(url, timeout);
      return url.endsWith(`/${SHIM_PATH}`) ? { ...result, body: overlay } : result;
    })).rejects.toThrow(`baseline hash mismatch for '${SHIM_PATH}'`);
  });
  test("baseline comparator refuses a missing hash", async () => {
    const root = await directory(); await writeFile(root, "index.html");
    await expect(assertOnlyShimChanged(root, ["index.html"], new Map(), APPROVED_OVERLAY_SHA256)).rejects.toThrow("no staging baseline");
  });
});

describe("credential detection and redacted failure paths", () => {
  const canary = "SYNTHETIC_" + "q".repeat(32);
  const googleApiKeyCanary = `AIza${"Z".repeat(35)}`;
  const representations = [
    ...["client_secret", "clientSecret", "refresh_token", "refreshToken", "access_token", "accessToken", "private_key", "privateKey"].flatMap((key) => [
      JSON.stringify({ nested: { [key]: canary } }),
      `const nested = { ${key}: '${canary}' };`,
      `const nested = { "${key}" :\n "${canary}" };`,
      `config.${key}\n = \n'${canary}';`,
    ]),
    `const account = {type: 'service_account'};`,
    `const account = {"type": "service_account"};`,
    ...["", "RSA ", "EC ", "DSA ", "OPENSSH ", "ENCRYPTED "].map((kind) => `const key = '-----BEGIN ${kind}PRIVATE KEY-----';`),
    `const embedded = \`CLIENT_SECRET=${canary}\nREFRESH_TOKEN=${canary}\`;`,
    `CLIENT_SECRET=${canary}`, `export ACCESS_TOKEN='${canary}'`,
  ];
  test.each(representations.map((body, i) => ({ body, i })))("rejects synthetic credential representation $i without echoing values", ({ body }) => {
    let message = "";
    try { assertSecretSafe(SHIM_PATH, Buffer.from(body)); } catch (error) { message = (error as Error).message; }
    expect(message.includes("secret-safety gate")).toBe(true);
    expect(message.includes(canary)).toBe(false);
  });
  test.each([
    { syntax: "double-quoted bracket property", body: `obj["clientSecret"] = "${canary}";` },
    { syntax: "single-quoted bracket property", body: `obj['accessToken'] = '${canary}';` },
    { syntax: "comment before literal", body: `clientSecret = /* synthetic comment */ "${canary}";` },
    { syntax: "parenthesized literal", body: `clientSecret = (\n  "${canary}"\n);` },
    { syntax: "multiline bracket assignment", body: `config[\n "refresh_token"\n ]\n =\n ( '${canary}' );` },
    { syntax: "lowercase environment assignment", body: `secret=${canary}` },
    { syntax: "mixed-case environment assignment", body: `SeCrEt=${canary}` },
    { syntax: "nested unquoted property", body: `const value = { nested: { privateKey: '${canary}' } };` },
    { syntax: "nested quoted property", body: `const value = { nested: { "access_token": "${canary}" } };` },
    { syntax: "dot property assignment", body: `config.refreshToken = '${canary}';` },
  ])("rejects $syntax and redacts its value", ({ body }) => {
    let message = "";
    try { assertSecretSafe(SHIM_PATH, Buffer.from(body)); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("suspected credential literal");
    expect(message).not.toContain(canary);
  });
  test.each([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from([0x1f, 0x8b, 8]), Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])])("rejects archive bytes disguised as JS %#", (body) => {
    expect(() => assertSecretSafe(SHIM_PATH, body)).toThrow("archive content");
  });
  test("permits exactly the reviewed public Firebase web configuration", () => {
    const file = "assets/lyfelabz-firebase-config.js";
    expect(() => assertSecretSafe(file, fixture(file))).not.toThrow();
    expect(() => assertSecretSafe(file, Buffer.concat([fixture(file), Buffer.from(" ")]))).toThrow("baseline hash mismatch");
  });
  test("rejects the approved Firebase config bytes at every other path", () => {
    expect(() => assertSecretSafe("assets/copied-public-config.js", fixture("assets/lyfelabz-firebase-config.js"))).toThrow("Google/Firebase API key");
  });
  test.each([
    SHIM_PATH,
    "app/lessons/lesson_biological-evolution.html",
    "app/dist/bundle.js",
    "app/index.html",
    "app/lessons/variants/copied.html",
    "assets/other.js",
  ])("rejects Google/Firebase API-key-shaped material at %s", (file) => {
    let message = "";
    try { assertSecretSafe(file, Buffer.from(`const value = "${googleApiKeyCanary}";`)); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("Google/Firebase API key");
    expect(message).not.toContain(googleApiKeyCanary);
  });
  test("modified approved Firebase config cannot use the public-key exemption", () => {
    const modified = fixture("assets/lyfelabz-firebase-config.js").toString().replace(
      /\bAIza[0-9A-Za-z_-]{35}\b/,
      googleApiKeyCanary,
    );
    expect(() => assertSecretSafe("assets/lyfelabz-firebase-config.js", Buffer.from(modified))).toThrow("baseline hash mismatch");
  });
  test("real preparation scans downloaded credentials before hash validation", async () => {
    await expect(prepare(async (url, timeout) => {
      const result = await download(url, timeout);
      return url.endsWith("/app/dist/bundle.js") ? { ...result, body: Buffer.from(`const client_secret = '${canary}';`) } : result;
    })).rejects.toThrow("secret-safety gate");
  });
  test.each([
    { syntax: "bracket assignment", body: `obj["clientSecret"] = "${canary}";` },
    { syntax: "commented parenthesized assignment", body: `clientSecret = /* comment */ (\n"${canary}"\n);` },
    { syntax: "Google/Firebase API key", body: `const value = "${googleApiKeyCanary}";` },
  ])("real preparation rejects $syntax before readiness", async ({ body }) => {
    await expect(prepare(async (url, timeout) => {
      const result = await download(url, timeout);
      return url.endsWith("/app/dist/bundle.js") ? { ...result, body: Buffer.from(body) } : result;
    })).rejects.toThrow("secret-safety gate");
    expect(process.stdout.write).not.toHaveBeenCalledWith(expect.stringContaining("READY FOR HUMAN REVIEW"));
  });
  test("real preparation scans local credentials before syntax diagnostics", async () => {
    const root = await directory();
    await writeFile(root, SHIM_PATH, `const access_token = '${canary}' INVALID;`);
    const exec = jest.spyOn(cp, "execFileSync");
    await expect(prepare(download, root)).rejects.toThrow("secret-safety gate");
    expect(exec).not.toHaveBeenCalled();
  });
  test("syntax failure never propagates source or child-process diagnostics", async () => {
    const root = await directory();
    await writeFile(root, SHIM_PATH, `const innocuous = '${canary}' INVALID;`);
    let message = "";
    try { await prepare(download, root); } catch (error) { message = (error as Error).message; }
    expect(message).toBe("local ASTRA-004 shim syntax validation failed; diagnostics redacted");
    expect(message.includes(canary)).toBe(false);
  });
});

describe("Hosting configuration and process capability", () => {
  test("generates the independently specified Hosting-only configuration", () => {
    expect(makeHostingConfig()).toEqual({ hosting: {
      site: "lyfelabz-staging", public: "public", ignore: ["**/.*"],
      redirects: [
        { source: "/privacy", destination: "https://lyfelabz.com/privacy", type: 301 },
        { source: "/terms", destination: "https://lyfelabz.com/terms", type: 301 },
      ], rewrites: [{ source: "/app/**", destination: "/app/index.html" }],
    } });
  });
  test.each(["functions", "firestore", "storage", "database", "auth", "remoteconfig"])("rejects generated resource %s", (resource) => {
    expect(() => assertSafeHostingConfig({ ...makeHostingConfig(), [resource]: {} })).toThrow("only Hosting");
  });
  test.each([
    { rewrites: [{ source: "/app/**", function: "handler" }] },
    { rewrites: [{ source: "/app/**", run: { serviceId: "handler" } }] },
    { predeploy: ["unsafe"] }, { postdeploy: ["unsafe"] }, { public: "." },
    { site: "lyfelabz-prod" }, { redirects: [] }, { ignore: [] },
  ])("rejects inherited or altered Hosting behavior %#", (patch) => {
    const config = makeHostingConfig(); Object.assign(config.hosting as object, patch);
    expect(() => assertSafeHostingConfig(config)).toThrow();
  });
  test("production imports and subprocess sites have an exact static allowlist", () => {
    const source = ts.createSourceFile(SOURCE, readFileSync(SOURCE, "utf8"), ts.ScriptTarget.ES2022, true);
    const imports: string[] = [], executions: string[] = [];
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.getText(source) === "execFileSync") executions.push(node.arguments[0].getText(source));
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(imports.sort()).toEqual(["./astra004-hosting-baseline.json", "child_process", "crypto", "fs", "os", "path"]);
    expect(executions.sort()).toEqual(['"git"', "process.execPath"]);
  });
});
