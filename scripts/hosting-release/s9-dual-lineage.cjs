'use strict';

// This is an exception for one reviewed staging pair. Never broaden these
// constants via an input file, command-line switch or environment variable.
const { execFileSync } = require('node:child_process');
const H = require('./backend-state.cjs');
const PROJECT = 'lyfelabz-staging';
const HOSTING = '15b3ea2bdf60796ebf51e3f113804f3411b80ce1';
const BACKEND = '68298a56887f5d0fe6ba63283458a5ff44897a8b';
const BUILD = 'b610a44aee746373cbc66cef862602af2544a57fc7a11f4cb05b5320684cc49c';
const ROLLBACK_BUILD = '461241fd7c0dd004af6858c9451b267eedf84bd6ef34e83c99838dd6b38bf6cd';
const ROLLBACK_SHA256 = 'a6c6a17967b968b0590b8aaac37a2918487da7fea92965fa2b7793444d939792';
const CONTRACT = 'teacher-units-v3';
const KIND = 'lyfelabz.s9DualLineageOwnerReleaseApproval';
const CURRENT = 'lyfelabz.s9DualLineageStagingRecovery';
const ROOTS = ['app/src/teacherUnits', 'platform/functions/src/teacherUnits', 'platform/functions/src/supportAccess'];
const TOOLING = new Set([
  'scripts/hosting-release/s9-dual-lineage.cjs',
  'scripts/hosting-release/unchanged-backend.cjs',
  'scripts/hosting-release/build-pair.cjs',
  'scripts/hosting-release/prepare.cjs',
  'scripts/teacher-units-release/option-b-observation.cjs',
  'scripts/teacher-units-release/availability-control.cjs',
  'scripts/teacher-units-release/s9-dual-lineage.test.cjs',
  'docs/platform/U2_6_RELEASE_READINESS_RUNBOOK.md',
]);

function refuse(message) { throw new Error(`[S9 dual lineage] REFUSED: ${message}`); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value,key))) refuse('unknown or missing approval fields');
}

function approved({project, hostingSha, observation, policy, backendPin, authorization}) {
  if (project !== PROJECT || hostingSha !== HOSTING || observation?.projectId !== PROJECT ||
      observation?.build?.sourceSha !== BACKEND || observation?.backendBuildId !== BUILD) refuse('unapproved staging source/build pair');
  exact(authorization, ['approval','digest']);
  const {approval,digest} = authorization;
  exact(approval,['kind','schemaVersion','projectId','hostingSha','backendSha','backendBuildId','backendPin',
    'policyInstanceId','policyGeneration','clientContract','sourceFingerprint','toolingSha','decisionRef','principalSubject']);
  if (approval.kind !== KIND || approval.schemaVersion !== 1 || approval.projectId !== project ||
      approval.hostingSha !== hostingSha || approval.backendSha !== BACKEND || approval.backendBuildId !== BUILD ||
      approval.backendPin !== backendPin || approval.policyInstanceId !== policy.policyInstanceId ||
      approval.policyGeneration !== policy.generation || approval.clientContract !== CONTRACT ||
      !/^[a-f0-9]{64}$/.test(approval.sourceFingerprint) || !/^[a-f0-9]{40}$/.test(approval.toolingSha) ||
      ![approval.decisionRef,approval.principalSubject].every(v=>typeof v==='string' && v===v.trim() && /^[^\x00-\x1f\x7f]{1,2048}$/.test(v)) ||
      H.fingerprint(approval) !== digest) refuse('explicit owner release approval does not match the pinned release');
  return approval;
}

function readGit(root,run) {
  return args => run('git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1'},stdio:['ignore','pipe','pipe']});
}
function sourceFingerprint(root, run = execFileSync) {
  const git=readGit(root,run);
  const manifests = [HOSTING,BACKEND].map(sha=>git(['ls-tree','-r','-z',sha,'--',...ROOTS]));
  if (!manifests[0] || manifests[0] !== manifests[1]) refuse('Teacher Units client or backend authorization content differs');
  return H.fingerprint({roots:ROOTS,tree:manifests[0]});
}
function sourceProof(root, approval, run = execFileSync) {
  const git=readGit(root,run);
  const head = git(['rev-parse','HEAD']).trim();
  if (head !== approval.toolingSha || git(['status','--porcelain','--untracked-files=normal']).trim()) refuse('clean, explicitly approved tooling checkout required');
  if (git(['ls-files','-v','-z']).split('\0').some(entry=>/^[a-zS] /.test(entry))) refuse('tracked files hidden from worktree verification');
  if (head === HOSTING) refuse('reviewed tooling commit required');
  try { git(['merge-base','--is-ancestor',HOSTING,head]); } catch { refuse('tooling must descend from the exact Hosting commit'); }
  const changed = git(['diff','--no-renames','--name-only','-z',HOSTING,head,'--']).split('\0').filter(Boolean);
  if (!changed.length || changed.some(name=>!TOOLING.has(name))) refuse('tooling checkout contains changes outside the release tooling');
  if (sourceFingerprint(root,run)!==approval.sourceFingerprint) refuse('source content fingerprint differs from owner decision');
  return {sha:HOSTING,dirty:false};
}

module.exports = {PROJECT,HOSTING,BACKEND,BUILD,ROLLBACK_BUILD,ROLLBACK_SHA256,CONTRACT,KIND,CURRENT,approved,sourceFingerprint,sourceProof};
