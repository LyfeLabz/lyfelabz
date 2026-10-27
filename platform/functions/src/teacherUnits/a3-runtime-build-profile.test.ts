/** D12: build-time profile selection in scripts/write-a3-runtime-build.cjs, against temporary local Git repositories. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJSON, parseStrictJSON } from "./a3-canonical";
import { inventoryRuntimeArtifact } from "./a3-runtime-artifact";
import { inspectAvailabilityRuntimeArtifact as inspectRuntimeArtifact, RUNTIME_BUILD_PATH, validateAvailabilityRuntimeBuild as validateRuntimeBuild, deriveBackendBuildId } from "./availability-runtime-build";
import type { AvailabilityRuntimeBuild as RuntimeBuildRecord } from "./availability-runtime-build";

type Writer = {
  writeRuntimeBuild(options: { root: string; env: Record<string, string | undefined>;
    inventoryRuntimeArtifact: typeof inventoryRuntimeArtifact; canonicalJSON: typeof canonicalJSON; deriveBackendBuildId: typeof deriveBackendBuildId }): RuntimeBuildRecord;
  RECORD: string;
};
const writer = createRequire(__filename)(join(__dirname, "../../scripts/write-a3-runtime-build.cjs")) as Writer;
let root: string, scratch: string[] = [];
const put = (path: string, value: string) => writeFileSync(join(root, path), value);
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args],
  { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const run = (env: Record<string, string | undefined> = {}) => writer.writeRuntimeBuild({ root, env, inventoryRuntimeArtifact, canonicalJSON, deriveBackendBuildId });
const recordPath = () => join(root, RUNTIME_BUILD_PATH);
const head = () => git("rev-parse", "HEAD");
const controlled = () => ({ A3_BUILD_PROFILE: "policy-controlled", A3_EXPECTED_SOURCE_SHA: head() });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "a3-build-profile-")); scratch = [root];
  git("init", "-q");
  put(".gitignore", "lib/\nnode_modules/\n"); put("package.json", "{}"); put("package-lock.json", "{}"); put("source.ts", "export {};\n");
  git("add", "-A"); git("commit", "-q", "-m", "fixture");
  mkdirSync(join(root, "lib/teacherUnits"), { recursive: true });
  put("lib/index.js", "compiled"); put("lib/teacherUnits/unit-placeable-resources.json", '{"resourceIds":["one","two"]}');
});
afterEach(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

test("record path matches the canonical runtime build path", () => {
  expect(writer.RECORD).toBe(RUNTIME_BUILD_PATH);
});

test("default and empty profile write closed-only from the clean HEAD", () => {
  for (const env of [{}, { A3_BUILD_PROFILE: "" }, { A3_BUILD_PROFILE: undefined }]) {
    const record = run(env);
    expect(record).toMatchObject({ deploymentMode: "closed-only", sourceSha: head(), sourceTree: git("rev-parse", "HEAD^{tree}"), sourceDirty: false });
    expect(inspectRuntimeArtifact(root).build.deploymentMode).toBe("closed-only");
  }
});

test("closed-only keeps existing behavior: dirty trees are recorded, not refused, and SHA input is ignored", () => {
  put("source.ts", "changed\n"); put("untracked.ts", "new\n");
  expect(run({ A3_EXPECTED_SOURCE_SHA: "f".repeat(40) })).toMatchObject({ deploymentMode: "closed-only", sourceDirty: true });
});

test("explicit policy-controlled builds bind the exact SHA and tree and pass schema validation", () => {
  const record = run(controlled());
  expect(record).toMatchObject({ deploymentMode: "policy-controlled", sourceSha: head(), sourceTree: git("rev-parse", "HEAD^{tree}"), sourceDirty: false });
  const parsed = validateRuntimeBuild(parseStrictJSON(readFileSync(recordPath(), "utf8")));
  expect(parsed.ok).toBe(true);
  expect(readFileSync(recordPath(), "utf8")).toBe(canonicalJSON(record) + "\n");
  expect(inspectRuntimeArtifact(root).build).toEqual(record);
});

test("profile changes artifact identity but not runtime payload identity", () => {
  run(); const closed = inspectRuntimeArtifact(root);
  run(controlled()); const policy = inspectRuntimeArtifact(root);
  expect(policy.runtimePayloadFingerprint).toBe(closed.runtimePayloadFingerprint);
  expect(policy.placementFingerprint).toBe(closed.placementFingerprint);
  expect(policy.functionsArtifactFingerprint).not.toBe(closed.functionsArtifactFingerprint);
});

test("execution is idempotent for each profile", () => {
  for (const env of [{}, controlled()]) {
    run(env); const first = readFileSync(recordPath(), "utf8"), firstArtifact = inspectRuntimeArtifact(root).functionsArtifactFingerprint;
    run(env);
    expect(readFileSync(recordPath(), "utf8")).toBe(first);
    expect(inspectRuntimeArtifact(root).functionsArtifactFingerprint).toBe(firstArtifact);
  }
});

const refusals: Array<[string, () => Record<string, string | undefined>, RegExp]> = [
  ["unknown profile", () => ({ A3_BUILD_PROFILE: "enabled" }), /Unknown A3_BUILD_PROFILE/],
  ["profile with surrounding whitespace", () => ({ A3_BUILD_PROFILE: " policy-controlled" }), /Unknown A3_BUILD_PROFILE/],
  ["profile with different case", () => ({ A3_BUILD_PROFILE: "Policy-Controlled" }), /Unknown A3_BUILD_PROFILE/],
  ["missing SHA", () => ({ A3_BUILD_PROFILE: "policy-controlled" }), /A3_EXPECTED_SOURCE_SHA must be/],
  ["empty SHA", () => ({ A3_BUILD_PROFILE: "policy-controlled", A3_EXPECTED_SOURCE_SHA: "" }), /A3_EXPECTED_SOURCE_SHA must be/],
  ["short SHA", () => ({ A3_BUILD_PROFILE: "policy-controlled", A3_EXPECTED_SOURCE_SHA: head().slice(0, 39) }), /A3_EXPECTED_SOURCE_SHA must be/],
  ["non-hex SHA", () => ({ A3_BUILD_PROFILE: "policy-controlled", A3_EXPECTED_SOURCE_SHA: "g".repeat(40) }), /A3_EXPECTED_SOURCE_SHA must be/],
  ["uppercase SHA", () => ({ A3_BUILD_PROFILE: "policy-controlled", A3_EXPECTED_SOURCE_SHA: head().toUpperCase() }), /A3_EXPECTED_SOURCE_SHA must be/],
  ["SHA with trailing newline", () => ({ A3_BUILD_PROFILE: "policy-controlled", A3_EXPECTED_SOURCE_SHA: `${head()}\n` }), /A3_EXPECTED_SOURCE_SHA must be/],
  ["wrong SHA", () => ({ A3_BUILD_PROFILE: "policy-controlled", A3_EXPECTED_SOURCE_SHA: head().replace(/^./, c => (c === "0" ? "1" : "0")) }), /does not match/],
];
test.each(refusals)("refuses %s and writes no record", (_name, env, message) => {
  expect(() => run(env())).toThrow(message);
  expect(existsSync(recordPath())).toBe(false);
});

test("refuses dirty tracked files for policy-controlled builds", () => {
  put("source.ts", "changed\n");
  expect(() => run(controlled())).toThrow(/clean working tree/);
  expect(existsSync(recordPath())).toBe(false);
});

test("refuses staged changes for policy-controlled builds", () => {
  put("source.ts", "staged\n"); git("add", "source.ts");
  expect(() => run(controlled())).toThrow(/clean working tree/);
});

test("refuses untracked files for policy-controlled builds", () => {
  put("untracked.ts", "new\n");
  expect(() => run(controlled())).toThrow(/clean working tree/);
  expect(existsSync(recordPath())).toBe(false);
});

test("refuses a previous commit's SHA after HEAD moves", () => {
  const previous = head(); put("source.ts", "next\n"); git("commit", "-q", "-am", "next");
  expect(() => run({ A3_BUILD_PROFILE: "policy-controlled", A3_EXPECTED_SOURCE_SHA: previous })).toThrow(/does not match/);
});

test("symlinked node_modules is refused even under the repository's 'node_modules/' ignore pattern", () => {
  // Git's directory-only pattern does not ignore a symlink, so the clean-tree check refuses first.
  const target = mkdtempSync(join(tmpdir(), "a3-build-modules-")); scratch.push(target);
  symlinkSync(target, join(root, "node_modules"));
  expect(() => run(controlled())).toThrow(/clean working tree/);
  expect(existsSync(recordPath())).toBe(false);
});

test("refuses symlinked node_modules for policy-controlled builds only, even when Git ignores it", () => {
  put(".gitignore", "lib/\nnode_modules\n"); git("commit", "-q", "-am", "ignore symlinks too");
  const target = mkdtempSync(join(tmpdir(), "a3-build-modules-")); scratch.push(target);
  symlinkSync(target, join(root, "node_modules"));
  expect(() => run(controlled())).toThrow(/symlinked node_modules/);
  expect(existsSync(recordPath())).toBe(false);
  expect(run().deploymentMode).toBe("closed-only");
});

test("accepts a real node_modules directory", () => {
  mkdirSync(join(root, "node_modules"));
  expect(run(controlled()).deploymentMode).toBe("policy-controlled");
});

test("refuses a directory that is not a Git checkout, for every profile", () => {
  rmSync(join(root, ".git"), { recursive: true, force: true });
  const outside = mkdtempSync(join(tmpdir(), "a3-build-nogit-")); scratch.push(outside);
  for (const env of [{}, { A3_BUILD_PROFILE: "policy-controlled", A3_EXPECTED_SOURCE_SHA: "a".repeat(40) }])
    expect(() => writer.writeRuntimeBuild({ root: outside, env, inventoryRuntimeArtifact, canonicalJSON, deriveBackendBuildId })).toThrow();
});

test("refuses a repository with no commit (unresolvable HEAD)", () => {
  rmSync(join(root, ".git"), { recursive: true, force: true }); git("init", "-q");
  expect(() => run()).toThrow();
  expect(existsSync(recordPath())).toBe(false);
});

test("a stale valid record is removed when a later policy-controlled build is refused", () => {
  run(controlled());
  expect(inspectRuntimeArtifact(root).build.deploymentMode).toBe("policy-controlled");
  put("source.ts", "changed after the good build\n");
  expect(() => run(controlled())).toThrow(/clean working tree/);
  expect(existsSync(recordPath())).toBe(false);
  expect(() => inspectRuntimeArtifact(root)).toThrow();
});

test("a stale closed-only record is removed when an unknown profile is refused", () => {
  run();
  expect(() => run({ A3_BUILD_PROFILE: "policy" })).toThrow(/Unknown/);
  expect(existsSync(recordPath())).toBe(false);
});

test("ordinary builds overwrite a stale policy-controlled record with closed-only", () => {
  run(controlled());
  expect(run().deploymentMode).toBe("closed-only");
  expect(inspectRuntimeArtifact(root).build.deploymentMode).toBe("closed-only");
});

test("the writer leaves no temporary files beside the record", () => {
  run(controlled());
  expect(execFileSync("ls", [join(root, "lib/teacherUnits")], { encoding: "utf8" }).trim().split("\n").sort())
    .toEqual(["a3-runtime-build.json", "unit-placeable-resources.json"]);
});
