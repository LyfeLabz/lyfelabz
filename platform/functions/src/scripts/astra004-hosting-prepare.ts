/*
 * ASTRA-004 staging Hosting artifact preparer.
 *
 * This command is deliberately incapable of deploying. It performs public,
 * unauthenticated GETs against the one fixed staging origin, builds an isolated
 * allowlisted Hosting tree, overlays the already-reviewed ASTRA-004 shim, and
 * prints the deploy command for a later separately-authorized operation.
 */

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { promises as fsp } from "fs";
import * as os from "os";
import * as path from "path";
import baselineLock from "./astra004-hosting-baseline.json";

export const STAGING_PROJECT_ID = "lyfelabz-staging";
export const STAGING_ORIGIN = "https://lyfelabz-staging.web.app";
export const APPROVED_BASE_COMMIT = "cb73aff";
export const EXPECTED_FILE_COUNT = 178;
export const APPROVED_MANIFEST_SHA256 =
  "defa040e9fea3e0d857efbc40c70c43cd77b484d183f7b13d7458b0cc06b0ba2";
export const SHIM_PATH = "assets/lyfelabz-assessment-runtime.js";
// Reviewed ASTRA-004 bytes and the public staging bytes independently compared
// on 2026-09-07. Preparation never learns or updates these approvals from GETs.
export const APPROVED_OVERLAY_SHA256 = "d07473b36f0a103adccbb6ab3802aab1c1b9aefc875e6d641dc1e2b04e703b2f";
export const BASELINE_SHIM_SHA256 = "947dae85f3cfaf3dcb31cecaf49c00175e0ced21bfed1c922a405fc59f4d28e0";
export const BASELINE_LOCK_SHA256 = "f9c5157624ca2b28b450e5926570d82cb163b656410ae2d3d7be2fc33506a454";
export const DOWNLOAD_TIMEOUT_MS = 15_000;
export const DOWNLOAD_ATTEMPTS = 3;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const DIST_PATHS = [
  "app/dist/assets/index-Cn8_kigJ.js",
  "app/dist/bundle.js",
  "app/dist/index.html",
] as const;

const ASSET_PATHS = new Set([
  "assets/lyfelabz-assessment-runtime-active.js",
  SHIM_PATH,
  "assets/lyfelabz-firebase-config.js",
  "assets/present-mode-return.js",
]);

const VARIANT_PATHS = new Set([
  "app/lessons/variants/lesson_staging-cert-fixture__pr784872aad5bd6a7b0c0a47b3bdfbc09fc2750ad0fc9e8bb050f76a00fa9aed46.html",
  "app/lessons/variants/lesson_staging-cert-fixture__prd35502243cd3caf026f4436183d92fac31e669483bf01d40954b8e24f2cd8657.html",
]);

const CATEGORY_COUNTS = {
  root: 112,
  ball: 6,
  assets: 4,
  appEntries: 2,
  lessons: 49,
  variants: 2,
  dist: 3,
} as const;

const EMULATOR_ENV_KEYS = [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_DATABASE_EMULATOR_HOST",
  "FIREBASE_EMULATOR_HUB",
  "FIRESTORE_EMULATOR_HOST",
  "FUNCTIONS_EMULATOR",
  "STORAGE_EMULATOR_HOST",
] as const;

export type CliArgs = { readonly project: string };
export type ParseResult =
  | { readonly ok: true; readonly args: CliArgs }
  | { readonly ok: false; readonly message: string };

export type DownloadResult = {
  readonly status: number;
  readonly redirected: boolean;
  readonly body: Buffer;
  readonly contentType?: string | null;
};

export type Downloader = (url: string, timeoutMs: number) => Promise<DownloadResult>;

export type PreparationReport = {
  readonly project: string;
  readonly origin: string;
  readonly workspacePath: string;
  readonly publicPath: string;
  readonly firebaseConfigPath: string;
  readonly expectedFileCount: number;
  readonly actualFileCount: number;
  readonly baselineShimHash: string;
  readonly overlayShimHash: string;
};

export type PrepareOptions = {
  readonly repoRoot: string;
  readonly manifest: readonly string[];
  readonly downloader: Downloader;
  readonly tempRoot?: string;
};

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseArgs(argv: readonly string[]): ParseResult {
  let project: string | undefined;
  for (const raw of argv) {
    if (!raw.startsWith("--project=")) {
      return { ok: false, message: `unknown or malformed argument '${raw}'` };
    }
    if (project !== undefined) {
      return { ok: false, message: "duplicate --project flag" };
    }
    const value = raw.slice("--project=".length);
    if (value.length === 0 || value.trim() !== value || /\s/.test(value)) {
      return { ok: false, message: "malformed --project flag" };
    }
    project = value;
  }
  if (project === undefined) {
    return {
      ok: false,
      message: `--project=${STAGING_PROJECT_ID} is required; aliases and defaults are forbidden`,
    };
  }
  return { ok: true, args: { project } };
}

export function assertSafeEnvironment(args: CliArgs, env: NodeJS.ProcessEnv): string | null {
  if (args.project !== STAGING_PROJECT_ID) {
    return `refusing project '${args.project}': only literal project '${STAGING_PROJECT_ID}' is authorized`;
  }
  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0 && value !== STAGING_PROJECT_ID) {
      return `refusing preparation: ${key} conflicts with '${STAGING_PROJECT_ID}'`;
    }
  }
  for (const key of EMULATOR_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      return `refusing preparation while emulator override ${key} is set`;
    }
  }
  return null;
}

function isApprovedTrackedPath(candidate: string): boolean {
  if (candidate === "CNAME") return true;
  if (/^[^/]+\.(?:html|css|png|ico|txt|xml)$/.test(candidate)) return true;
  if (/^ball[0-5]?\/index\.html$/.test(candidate)) return true;
  if (ASSET_PATHS.has(candidate)) return true;
  if (candidate === "app/index.html" || candidate === "app/lms-callback.html") return true;
  if (/^app\/lessons\/lesson_[a-z0-9-]+\.html$/.test(candidate)) return true;
  return VARIANT_PATHS.has(candidate);
}

export function deriveApprovedManifest(treePaths: readonly string[]): string[] {
  const selected = treePaths.filter(isApprovedTrackedPath);
  selected.push(...DIST_PATHS);
  const manifest = [...new Set(selected)].sort();
  assertApprovedManifest(manifest);
  return manifest;
}

export function loadApprovedManifest(repoRoot: string): string[] {
  const output = execFileSync(
    "git",
    ["-C", repoRoot, "ls-tree", "-r", "--name-only", APPROVED_BASE_COMMIT, "--"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return deriveApprovedManifest(output.split("\n").filter((item) => item.length > 0));
}

export function normalizeManifestPath(raw: string): string {
  if (raw.length === 0 || raw.includes("\0") || raw.includes("\\") || path.posix.isAbsolute(raw)) {
    throw new Error(`unsafe artifact path '${raw}'`);
  }
  const normalized = path.posix.normalize(raw);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`path traversal rejected for '${raw}'`);
  }
  return normalized;
}

export function assertSafeArtifactPath(raw: string): void {
  const normalized = normalizeManifestPath(raw);
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.startsWith("."))) {
    throw new Error(`hidden artifact path rejected: '${normalized}'`);
  }
  const lower = normalized.toLowerCase();
  const filename = segments[segments.length - 1] ?? "";
  if (
    lower.startsWith("app/src/") ||
    lower.startsWith("app/scripts/") ||
    lower.startsWith("platform/") ||
    lower.startsWith("docs/") ||
    lower.startsWith(".git/") ||
    lower.startsWith(".github/") ||
    lower.startsWith(".claude/") ||
    lower.startsWith(".firebase/")
  ) {
    throw new Error(`source or repository path rejected: '${normalized}'`);
  }
  if (
    filename === ".DS_Store" ||
    /^\.env(?:\.|$)/i.test(filename) ||
    /(?:firebase|firestore)-debug(?:\..+)?\.log$/i.test(filename) ||
    /(?:^|\/)(__tests__|tests?)(?:\/|$)/i.test(normalized) ||
    /\.(?:test|spec)\.[a-z0-9]+$/i.test(filename) ||
    /\.map$/i.test(filename) ||
    /^(?:package(?:-lock)?\.json|tsconfig(?:\..+)?\.json|jest\.config\.[a-z0-9]+)$/i.test(filename)
  ) {
    throw new Error(`excluded artifact path rejected: '${normalized}'`);
  }
  if (
    /(?:credential|service[-_]?account)/i.test(filename) ||
    /\.(?:pem|key|p12|pfx|jks|keystore|zip|tar|tgz|gz|7z)$/i.test(filename)
  ) {
    throw new Error(`credential-like artifact path rejected: '${normalized}'`);
  }
}

export function validateManifestPaths(paths: readonly string[]): string[] {
  const normalizedPaths: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const normalized = normalizeManifestPath(raw);
    if (seen.has(normalized)) {
      throw new Error(`duplicate normalized artifact path '${normalized}'`);
    }
    seen.add(normalized);
    if (normalized !== raw) {
      throw new Error(`non-canonical artifact path '${raw}'`);
    }
    assertSafeArtifactPath(normalized);
    normalizedPaths.push(normalized);
  }
  return normalizedPaths;
}

export function assertApprovedManifest(manifest: readonly string[]): void {
  const validated = validateManifestPaths(manifest);
  const sorted = [...validated].sort();
  if (validated.some((entry, index) => entry !== sorted[index])) {
    throw new Error("approved manifest must be sorted");
  }
  if (validated.length !== EXPECTED_FILE_COUNT) {
    throw new Error(`approved manifest count mismatch: expected ${EXPECTED_FILE_COUNT}, got ${validated.length}`);
  }
  const counts = {
    root: validated.filter((entry) => !entry.includes("/")).length,
    ball: validated.filter((entry) => /^ball[0-5]?\//.test(entry)).length,
    assets: validated.filter((entry) => entry.startsWith("assets/")).length,
    appEntries: validated.filter((entry) => /^app\/(?:index|lms-callback)\.html$/.test(entry)).length,
    lessons: validated.filter((entry) => /^app\/lessons\/lesson_/.test(entry)).length,
    variants: validated.filter((entry) => entry.startsWith("app/lessons/variants/")).length,
    dist: validated.filter((entry) => entry.startsWith("app/dist/")).length,
  };
  for (const key of Object.keys(CATEGORY_COUNTS) as Array<keyof typeof CATEGORY_COUNTS>) {
    if (counts[key] !== CATEGORY_COUNTS[key]) {
      throw new Error(`approved manifest category '${key}' mismatch`);
    }
  }
  const digest = sha256(`${validated.join("\n")}\n`);
  if (digest !== APPROVED_MANIFEST_SHA256) {
    throw new Error("approved manifest digest mismatch");
  }
}

export function assertBaselineLock(): void {
  const entries = Object.entries(baselineLock.unchangedFiles);
  assertApprovedManifest([...entries.map(([file]) => file), SHIM_PATH].sort());
  if (entries.length !== 177 || entries.some(([, hash]) => !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("approved baseline hash lock is malformed");
  }
  const canonical = entries.map(([file, hash]) => `${file}\t${hash}\n`).join("");
  if (sha256(canonical) !== BASELINE_LOCK_SHA256) {
    throw new Error("approved baseline hash lock digest mismatch");
  }
}

export function approvedBaselineHash(relativePath: string): string {
  const hash = relativePath === SHIM_PATH ? BASELINE_SHIM_SHA256 :
    (baselineLock.unchangedFiles as Readonly<Record<string, string>>)[relativePath];
  if (hash === undefined) throw new Error(`no approved baseline for '${relativePath}'`);
  return hash;
}

export function assertBaselineIdentity(relativePath: string, bytes: Buffer): void {
  if (sha256(bytes) !== approvedBaselineHash(relativePath)) {
    throw new Error(`approved staging baseline hash mismatch for '${relativePath}'`);
  }
}

export function buildDownloadUrl(relativePath: string): string {
  const normalized = normalizeManifestPath(relativePath);
  const url = new URL(normalized, `${STAGING_ORIGIN}/`);
  if (url.protocol !== "https:" || url.origin !== STAGING_ORIGIN) {
    throw new Error(`download origin safety check failed for '${normalized}'`);
  }
  return url.toString();
}

export const nativeDownloader: Downloader = async (url, timeoutMs) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.origin !== STAGING_ORIGIN) {
    throw new Error("download refused: origin is not the fixed staging Hosting origin");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > MAX_FILE_BYTES) {
      throw new Error("download refused: response exceeds the per-file size limit");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES) {
      throw new Error("download refused: response exceeds the per-file size limit");
    }
    return {
      status: response.status,
      redirected: response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400),
      body: bytes,
      contentType: response.headers.get("content-type"),
    };
  } finally {
    clearTimeout(timer);
  }
};

export function assertSafeDownloadResult(relativePath: string, result: DownloadResult): void {
  if (result.redirected || (result.status >= 300 && result.status < 400)) {
    throw new Error(`download rejected redirect for '${relativePath}'`);
  }
  if (result.status !== 200) {
    throw new Error(`download failed for '${relativePath}': HTTP ${result.status}`);
  }
  if (result.body.length > MAX_FILE_BYTES) {
    throw new Error(`download failed for '${relativePath}': file exceeds size limit`);
  }
  if (result.body.length === 0) {
    throw new Error(`empty baseline file rejected for '${relativePath}'`);
  }
  assertContentContract(relativePath, result.body, result.contentType);
}

// Contracts are structural checks in addition to the independently approved
// byte hashes. In particular a 200 rewrite response is not a static file.
export function assertContentContract(relativePath: string, bytes: Buffer, contentType?: string | null): void {
  const text = bytes.toString("utf8");
  const mime = contentType?.split(";")[0].trim().toLowerCase();
  const extension = path.posix.extname(relativePath);
  const fail = (kind: string): never => { throw new Error(`${kind} content contract failed for '${relativePath}'`); };
  const looksHtml = /^\s*(?:\uFEFF)?\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html\b|<\/?(?:html|head|body|script|title|meta|div)\b)/i.test(text);
  const documentHtml = /<!doctype\s+html\b/i.test(text) && /<html\b/i.test(text) && /<\/html\s*>/i.test(text);
  const script = (src: string): boolean => new RegExp(`<script\\b[^>]*\\bsrc=["']${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(text);
  const id = (value: string): boolean => new RegExp(`\\bid=["']${value}["']`).test(text);
  const expectedMimes: Readonly<Record<string, readonly string[]>> = {
    ".js": ["text/javascript", "application/javascript", "application/x-javascript"],
    ".html": ["text/html"], ".css": ["text/css"], ".png": ["image/png"],
    ".ico": ["image/x-icon", "image/vnd.microsoft.icon"], ".txt": ["text/plain"],
    ".xml": ["application/xml", "text/xml"],
  };
  if (mime && expectedMimes[extension] && !expectedMimes[extension].includes(mime)) fail("MIME type");
  if (extension === ".js") {
    if (looksHtml || /<!doctype\s+html\b|<html\b|<\/html\s*>/i.test(text.slice(0, 4096))) fail("JavaScript/non-HTML");
    if (!/\S/.test(text) || !/[;{}()=]/.test(text)) fail("JavaScript structure");
  } else if (extension === ".html") {
    if (!documentHtml) fail("HTML document");
    const lesson = /^app\/lessons\/(lesson_[a-z0-9-]+)\.html$/.exec(relativePath);
    if (lesson && (
      !text.includes(`Canonical source: lesson-sources/${lesson[1]}.html`) ||
      !text.includes("Build target: v2") || !script(`/${SHIM_PATH}`) || id("app-root")
    )) fail("canonical lesson identity");
    if (VARIANT_PATHS.has(relativePath)) {
      // These two immutable certification fixtures have no embedded slug/id.
      // Their approved per-path hashes are the strongest existing identity.
      if (id("app-root") || !/<body\b[^>]*>\s*<h1\b/i.test(text) ||
        sha256(bytes) !== approvedBaselineHash(relativePath)) fail("retained variant identity");
    }
    if (relativePath === "app/index.html" && (
      !id("app-root") || !id("shell-canonical") || !id("auth-canonical") ||
      !script("/app/dist/bundle.js") || !script("/assets/lyfelabz-firebase-config.js")
    )) fail("app shell identity");
  } else if (extension === ".png") {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail("PNG signature");
  } else if (extension === ".ico") {
    if (bytes.length < 6 || bytes.readUInt32LE(0) !== 0x00010000 || bytes.readUInt16LE(4) === 0) fail("ICO signature");
  } else if (extension === ".css") {
    if (looksHtml || !/[^{}]+\{[^{}]*\}/.test(text)) fail("CSS structure");
  } else if (extension === ".xml") {
    if (!/<(?:urlset|sitemapindex)\b[^>]*xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/i.test(text)) fail("sitemap structure");
  } else if (extension === ".txt" || relativePath === "CNAME") {
    if (looksHtml || !/\S/.test(text) || text.includes("\0")) fail("plain text");
  } else {
    fail("unsupported static file");
  }
}

function assertContained(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("artifact write escaped the isolated public directory");
  }
}

export function assertSecretSafe(relativePath: string, bytes: Buffer): void {
  const publicFirebaseConfigPath = "assets/lyfelabz-firebase-config.js";
  const filename = path.posix.basename(relativePath);
  if (
    /^\.env(?:\.|$)/i.test(filename) ||
    /(?:credential|service[-_]?account)/i.test(filename) ||
    /\.(?:pem|key|p12|pfx|jks|keystore|zip|tar|tgz|gz|7z)$/i.test(filename)
  ) {
    throw new Error(`secret-safety gate rejected credential-like file '${relativePath}'`);
  }
  const approvedPublicFirebaseConfig =
    relativePath === publicFirebaseConfigPath &&
    sha256(bytes) === approvedBaselineHash(publicFirebaseConfigPath);
  if (relativePath === publicFirebaseConfigPath && !approvedPublicFirebaseConfig) {
    assertBaselineIdentity(relativePath, bytes);
  }
  if (bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ||
    bytes.subarray(0, 2).toString("ascii") === "PK" ||
    bytes.subarray(0, 3).toString("ascii") === "BZh" ||
    bytes.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) ||
    bytes.subarray(257, 262).toString("ascii") === "ustar") {
    throw new Error(`secret-safety gate rejected archive content in '${relativePath}'; value redacted`);
  }
  const text = bytes.toString("utf8");
  const credentialSyntax = text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\r\n]*/g, " ");
  const credentialName = "(?:CLIENT_?SECRET|REFRESH_?TOKEN|ACCESS_?TOKEN|SECRET|PRIVATE_?KEY|PRIVATE_?KEY_?ID)";
  const credentialFlags = "im";
  const credentialValue = String.raw`(?:\(\s*)*["'\x60][^"'\x60\r\n]{8,}["'\x60](?:\s*\))*`;
  const bracketPropertyCredential = new RegExp(
    String.raw`\[\s*["']${credentialName}["']\s*\]\s*[:=]\s*${credentialValue}`,
    credentialFlags,
  ).test(credentialSyntax);
  const namedCredential = new RegExp(
    String.raw`(?:^|[^A-Za-z0-9_$])(?:${credentialName}|["']${credentialName}["'])\s*[:=]\s*${credentialValue}`,
    credentialFlags,
  ).test(credentialSyntax);
  const environmentCredential = new RegExp(
    String.raw`^\s*(?:export\s+)?${credentialName}\s*=\s*(?:${credentialValue}|[A-Za-z0-9_./+=-]{8,})\s*$`,
    credentialFlags,
  ).test(credentialSyntax);
  if (bracketPropertyCredential || namedCredential || environmentCredential) {
    throw new Error(`secret-safety gate rejected '${relativePath}': suspected credential literal; value redacted`);
  }
  const hasGoogleFirebaseApiKey = /\bAIza[0-9A-Za-z_-]{35}\b/.test(text);
  if (hasGoogleFirebaseApiKey && !approvedPublicFirebaseConfig) {
    throw new Error(`secret-safety gate rejected '${relativePath}': suspected Google/Firebase API key; value redacted`);
  }
  const checks: ReadonlyArray<readonly [string, RegExp]> = [
    ["private key", /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/i],
    ["service-account material", /\btype["']?\s*[:=]\s*["'`]service_account["'`]/i],
    ["embedded credential environment", /(?:^|[\r\n`"'])[ \t]*(?:export[ \t]+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|GOOGLE_APPLICATION_CREDENTIALS)[A-Z0-9_]*[ \t]*=[ \t]*(?:["'][^"'\r\n]{8,}["']|[A-Za-z0-9_./+=-]{8,})[ \t]*(?=$|[\r\n`"'])/m],
    ["Google OAuth access token", /\bya29\.[A-Za-z0-9._-]{20,}\b/],
    ["Google OAuth refresh token", /\b1\/\/[A-Za-z0-9._-]{20,}\b/],
    ["OAuth client secret", /\bGOCSPX-[A-Za-z0-9_-]{12,}\b/],
    ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
    ["GitHub token", /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/],
    ["private API key", /\bsk-(?:live-)?[A-Za-z0-9_-]{20,}\b/],
  ];
  for (const [kind, pattern] of checks) {
    if (pattern.test(text)) {
      throw new Error(`secret-safety gate rejected '${relativePath}': suspected ${kind}; value redacted`);
    }
  }
}

export function makeHostingConfig(): Record<string, unknown> {
  return {
    hosting: {
      site: STAGING_PROJECT_ID,
      public: "public",
      ignore: ["**/.*"],
      redirects: [
        { source: "/privacy", destination: "https://lyfelabz.com/privacy", type: 301 },
        { source: "/terms", destination: "https://lyfelabz.com/terms", type: 301 },
      ],
      rewrites: [{ source: "/app/**", destination: "/app/index.html" }],
    },
  };
}

export function assertSafeHostingConfig(config: Record<string, unknown>): void {
  if (Object.keys(config).length !== 1 || !("hosting" in config)) {
    throw new Error("temporary Firebase config must contain only Hosting");
  }
  const serialized = JSON.stringify(config);
  if (serialized.includes("lyfelabz-prod")) {
    throw new Error("temporary Firebase config contains a production project/site identifier");
  }
  const hosting = config.hosting;
  if (typeof hosting !== "object" || hosting === null || Array.isArray(hosting)) {
    throw new Error("temporary Firebase Hosting config is malformed");
  }
  const entry = hosting as Record<string, unknown>;
  const allowedKeys = ["ignore", "public", "redirects", "rewrites", "site"].sort();
  if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(allowedKeys)) {
    throw new Error("temporary Firebase Hosting config contains unexpected keys");
  }
  if (entry.site !== STAGING_PROJECT_ID || entry.public !== "public") {
    throw new Error("temporary Firebase Hosting config does not target the exact staging site/public directory");
  }
  const rewrites = entry.rewrites;
  if (!Array.isArray(rewrites) || rewrites.length !== 1) {
    throw new Error("temporary Firebase Hosting rewrites are malformed");
  }
  const rewrite = rewrites[0] as Record<string, unknown>;
  if (
    rewrite.source !== "/app/**" ||
    rewrite.destination !== "/app/index.html" ||
    "function" in rewrite ||
    "run" in rewrite
  ) {
    throw new Error("temporary Firebase config contains an unsafe rewrite");
  }
  const expectedRedirects = [
    { source: "/privacy", destination: "https://lyfelabz.com/privacy", type: 301 },
    { source: "/terms", destination: "https://lyfelabz.com/terms", type: 301 },
  ];
  if (JSON.stringify(entry.redirects) !== JSON.stringify(expectedRedirects) ||
    JSON.stringify(entry.ignore) !== JSON.stringify(["**/.*"]) ||
    JSON.stringify(rewrite) !== JSON.stringify({ source: "/app/**", destination: "/app/index.html" })) {
    throw new Error("temporary Firebase Hosting behavior differs from the approved configuration");
  }
}

async function listArtifactEntries(root: string, current = ""): Promise<string[]> {
  const absolute = current.length === 0 ? root : path.join(root, current);
  const entries = await fsp.readdir(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = current.length === 0 ? entry.name : `${current}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`symlink rejected in artifact: '${relative}'`);
    }
    if (entry.name.startsWith(".")) {
      throw new Error(`hidden path rejected in artifact: '${relative}'`);
    }
    if (entry.isDirectory()) {
      files.push(...await listArtifactEntries(root, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`non-regular artifact entry rejected: '${relative}'`);
    }
  }
  return files.sort();
}

export async function verifyArtifact(publicPath: string, manifest: readonly string[]): Promise<string[]> {
  const expected = validateManifestPaths(manifest).sort();
  const actual = await listArtifactEntries(publicPath);
  for (const relativePath of actual) assertSafeArtifactPath(relativePath);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`artifact manifest mismatch: expected ${expected.length} files, found ${actual.length}`);
  }
  for (const relativePath of actual) {
    const bytes = await fsp.readFile(path.join(publicPath, relativePath));
    assertSecretSafe(relativePath, bytes);
  }
  return actual;
}

export async function assertOnlyShimChanged(
  publicPath: string,
  artifactPaths: readonly string[],
  baselineHashes: ReadonlyMap<string, string>,
  overlayShimHash: string,
): Promise<void> {
  for (const relativePath of artifactPaths) {
    const currentHash = sha256(await fsp.readFile(path.join(publicPath, relativePath)));
    const baselineHash = baselineHashes.get(relativePath);
    if (baselineHash === undefined) {
      throw new Error(`artifact file '${relativePath}' has no staging baseline`);
    }
    if (relativePath === SHIM_PATH) {
      if (currentHash !== overlayShimHash) {
        throw new Error("ASTRA-004 shim overlay hash changed during preparation");
      }
    } else if (currentHash !== baselineHash) {
      throw new Error(`only the ASTRA-004 shim may differ from staging baseline; '${relativePath}' changed`);
    }
  }
}

function defaultSyntaxCheck(shim: Buffer): void {
  try {
    // Validate the exact scanned bytes. Never propagate Node diagnostics,
    // which include source lines and may expose an accidentally pasted secret.
    execFileSync(process.execPath, ["--check"], {
      input: shim, stdio: ["pipe", "pipe", "pipe"], timeout: 15_000,
    });
  } catch {
    throw new Error("local ASTRA-004 shim syntax validation failed; diagnostics redacted");
  }
}

export async function prepareArtifact(options: PrepareOptions): Promise<PreparationReport> {
  assertApprovedManifest(options.manifest);
  assertBaselineLock();
  const manifest = [...options.manifest];
  const localShimPath = path.join(options.repoRoot, ...SHIM_PATH.split("/"));
  const localShimStat = await fsp.lstat(localShimPath);
  if (!localShimStat.isFile() || localShimStat.isSymbolicLink()) {
    throw new Error("local ASTRA-004 shim must be a regular non-symlink file");
  }
  const localShim = await fsp.readFile(localShimPath);
  assertSecretSafe(SHIM_PATH, localShim);
  defaultSyntaxCheck(localShim);
  const overlayShimHash = sha256(localShim);
  if (overlayShimHash !== APPROVED_OVERLAY_SHA256) {
    throw new Error("local ASTRA-004 shim does not match the independently reviewed overlay hash");
  }
  const workspacePath = await fsp.mkdtemp(path.join(options.tempRoot ?? os.tmpdir(), "astra004-hosting-"));
  const publicPath = path.join(workspacePath, "public");
  await fsp.mkdir(publicPath, { recursive: false });
  const baselineHashes = new Map<string, string>();
  let totalBytes = 0;

  try {
    for (const relativePath of manifest) {
      const url = buildDownloadUrl(relativePath);
      let result: DownloadResult | undefined;
      for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
        try {
          result = await options.downloader(url, DOWNLOAD_TIMEOUT_MS);
          break;
        } catch {
          if (attempt === DOWNLOAD_ATTEMPTS) {
            throw new Error(`download failed for '${relativePath}': timeout or network failure`);
          }
        }
      }
      if (result === undefined) {
        throw new Error(`download failed for '${relativePath}': no response`);
      }
      assertSafeDownloadResult(relativePath, result);
      totalBytes += result.body.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("download refused: artifact exceeds the total size limit");
      }
      baselineHashes.set(relativePath, sha256(result.body));
      if (relativePath === SHIM_PATH) {
        // The locked historical staging shim is comparison input only. Do not
        // place it in public: the reviewed, secret-scanned overlay is the only
        // shim that may ever enter the prepared artifact.
        assertBaselineIdentity(relativePath, result.body);
        continue;
      }
      assertSecretSafe(relativePath, result.body);
      assertBaselineIdentity(relativePath, result.body);
      const destination = path.join(publicPath, ...relativePath.split("/"));
      assertContained(publicPath, destination);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.writeFile(destination, result.body, { flag: "wx" });
    }

    const baselineShimHash = baselineHashes.get(SHIM_PATH);
    if (baselineShimHash === undefined) {
      throw new Error("approved manifest does not contain the ASTRA-004 shim");
    }
    if (overlayShimHash === baselineShimHash) {
      throw new Error("local ASTRA-004 shim must differ from the staging baseline");
    }
    const artifactShimPath = path.join(publicPath, ...SHIM_PATH.split("/"));
    await fsp.writeFile(artifactShimPath, localShim, { flag: "w" });

    const actual = await verifyArtifact(publicPath, manifest);
    await assertOnlyShimChanged(publicPath, actual, baselineHashes, overlayShimHash);

    const config = makeHostingConfig();
    assertSafeHostingConfig(config);
    const firebaseConfigPath = path.join(workspacePath, "firebase.json");
    await fsp.writeFile(firebaseConfigPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
    await fsp.writeFile(path.join(workspacePath, "expected-paths.txt"), `${manifest.join("\n")}\n`, { flag: "wx" });
    await fsp.writeFile(path.join(workspacePath, "preparation-evidence.json"), `${JSON.stringify({
      project: STAGING_PROJECT_ID, origin: STAGING_ORIGIN, manifestSha256: APPROVED_MANIFEST_SHA256,
      baselineLockSha256: BASELINE_LOCK_SHA256, baselineHashes: Object.fromEntries(baselineHashes),
      overlayShimHash, configSha256: sha256(`${JSON.stringify(config, null, 2)}\n`),
    }, null, 2)}\n`, { flag: "wx" });

    return {
      project: STAGING_PROJECT_ID,
      origin: STAGING_ORIGIN,
      workspacePath,
      publicPath,
      firebaseConfigPath,
      expectedFileCount: manifest.length,
      actualFileCount: actual.length,
      baselineShimHash,
      overlayShimHash,
    };
  } catch (error) {
    await fsp.rm(workspacePath, { recursive: true, force: true });
    throw error;
  }
}

export function formatReport(report: PreparationReport): string {
  return [
    "ASTRA-004 isolated Hosting artifact READY FOR HUMAN REVIEW",
    `project: ${report.project}`,
    `staging origin: ${report.origin}`,
    `temporary workspace: ${report.workspacePath}`,
    `artifact public path: ${report.publicPath}`,
    `generated firebase.json: ${report.firebaseConfigPath}`,
    `expected file count: ${report.expectedFileCount}`,
    `actual file count: ${report.actualFileCount}`,
    `baseline shim sha256: ${report.baselineShimHash}`,
    `approved overlay shim sha256: ${report.overlayShimHash}`,
    `approved unchanged baseline hashes: 177/177 (lock ${BASELINE_LOCK_SHA256})`,
    "baseline content contracts: passed",
    "only changed baseline file: assets/lyfelabz-assessment-runtime.js (confirmed)",
    "exclusion gates: passed",
    "secret-safety gate: passed",
    "Firebase deployment occurred: NO",
    "",
    "Future deployment command (NOT EXECUTED):",
    `firebase deploy ${"\\"}`,
    `  --config "${report.workspacePath}/firebase.json" ${"\\"}`,
    `  --only hosting:lyfelabz-staging ${"\\"}`,
    `  --project lyfelabz-staging ${"\\"}`,
    "  --non-interactive",
  ].join("\n");
}

function repoRootFromCompiled(): string {
  return path.resolve(__dirname, "../../../..");
}

export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  downloader: Downloader = nativeDownloader,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`[astra004-hosting] REFUSED: ${parsed.message}\n`);
    return 2;
  }
  const guardError = assertSafeEnvironment(parsed.args, env);
  if (guardError !== null) {
    process.stderr.write(`[astra004-hosting] REFUSED: ${guardError}\n`);
    return 2;
  }
  try {
    const repoRoot = repoRootFromCompiled();
    const manifest = loadApprovedManifest(repoRoot);
    const report = await prepareArtifact({ repoRoot, manifest, downloader });
    process.stdout.write(`${formatReport(report)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown preparation failure";
    process.stderr.write(`[astra004-hosting] FAILED: ${message}\n`);
    return 1;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
