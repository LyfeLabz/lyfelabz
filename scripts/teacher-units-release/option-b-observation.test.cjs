'use strict';
// Synthetic controlled-build fixtures plus a labeled sanitized Operation 1J capture.
// No test result establishes current provider state or owner authorization.
const test=require('node:test'), assert=require('node:assert/strict');
const path=require('node:path');
const Active=require('./option-b-observation.cjs');
const O={...Active,...Active.historical};
const H=require('../hosting-release/backend-state.cjs');
const {environmentForProject,readTargetSites}=require('../hosting-release/contract.cjs');
const K=require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const B=require('../../platform/functions/lib/teacherUnits/availability-runtime-build.js');
const {buildFixture}=require('./fixtures/synthetic-option-b.cjs');
const {buildProvider,templateOf}=require('./fixtures/synthetic-provider.cjs');
const RF=require('./option-b-rules-evidence.test.cjs');
const NOW='2026-10-26T12:00:00.000Z';
const clone=v=>JSON.parse(JSON.stringify(v));
async function fixture(options={}) {
  const O=options.scoped ? Active : {...Active,...Active.historical};
  const NOW=options.now??module.exports.NOW;
  const project=options.project??'lyfelabz-staging';
  const built=buildFixture({build:B,canonical:K,mode:'policy-controlled'});
  const provider=buildProvider({project,files:built.files,clock:()=>NOW,mutate:state=>{
    for (const id of O.ENDPOINTS) {
      const e=state.endpoints[id];
      e.service.buildConfig={name:e.fn.buildConfig.build,functionTarget:id,sourceLocation:'gs://gcf-v2-sources-synthetic-us-central1/source.zip#1760000000000001',baseImage:'nodejs22',enableAutomaticUpdates:true,environmentVariables:{}};
      if(options.scoped) e.service.scaling={maxInstanceCount:options.maxInstances??10};
    }
    options.mutate?.(state);
  }});
  const configurations=O.ENDPOINTS.map(id=>{const e=provider.state.endpoints[id];return {endpointName:id,fn:e.fn,service:e.service.template===undefined?{...e.service,template:templateOf(e.revision)}:e.service,revision:e.revision};});
  const configurationApproval={kind:O.CONFIGURATION_KIND,schemaVersion:1,projectId:project,backendBuildId:built.record.backendBuildId,configDigest:H.fingerprint({database:provider.state.database,endpoints:configurations}),automaticUpdatesAccepted:true,principalSubject:'synthetic-owner',decisionRef:'synthetic-config-review',reviewedAt:NOW};
  if(options.scoped) {
    const sc=provider.state.endpoints.teacherUnitsCreate.fn.serviceConfig;
    Object.assign(configurationApproval,{schemaVersion:2,sourceSha:built.record.sourceSha,settings:{runtimeServiceAccount:sc.serviceAccountEmail,timeoutSeconds:60,maxInstanceRequestConcurrency:80,availableMemory:'256Mi',availableCpu:'1',minInstanceCount:0,maxInstanceCount:options.maxInstances??10,ingressSettings:'ALLOW_ALL',environmentVariables:{}}});
    delete configurationApproval.configDigest;
  }
  let evidence;
  try { evidence=await O.inspectOptionB({project,get:provider.get,now:()=>NOW,plan:configurationApproval}); } catch(error) { provider.cleanup(); throw error; }
  const rules=RF.fixture('exact'), hostingFiles=options.hostingFiles??{app:{'app/dist/bundle.js':'c'.repeat(64),'app/index.html':'d'.repeat(64)},marketing:{'index.html':'e'.repeat(64)}};
  const candidate={kind:'lyfelabz.teacherUnitsOptionBCandidate',schemaVersion:1,projectId:project,projectNumber:H.PROJECT_NUMBERS[project],environment:environmentForProject(project).name,databaseId:'(default)',protocolVersion:'teacher-units-v3',source:{sha:built.record.sourceSha,dirty:false},backendBuildId:evidence.backendBuildId,hostingArtifactFingerprint:H.fingerprint(hostingFiles),placementFingerprint:evidence.placementFingerprint,rulesSourceHash:evidence.rules.sourceHash,functionsArtifactFingerprint:evidence.functionsArtifactFingerprint,runtimeFiles:evidence.runtimeFiles,indexes:evidence.indexes,applicationBuildFingerprint:'f'.repeat(64),releaseIntent:'teacher-units',teacherUnitsAvailability:'server-policy-required',availabilityEvidence:'build-contract-assertion'};
  const approval=rules.approval;
  Object.assign(approval,{projectId:project,projectNumber:candidate.projectNumber,releaseSourceSha:candidate.source.sha,backendBuildId:candidate.backendBuildId,hostingArtifactFingerprint:candidate.hostingArtifactFingerprint,placementFingerprint:candidate.placementFingerprint,localRulesSourceHash:candidate.rulesSourceHash,approvedRulesetResource:evidence.rules.rulesetResource,approvedDeployedSourceHash:evidence.rules.sourceHash});
  approval.review.reviewedAt=NOW;
  rules.reportObject.localSource={bytesBase64:Buffer.from(provider.state.ruleset.source.files[0].content).toString('base64'),sha256:evidence.rules.sourceHash};
  rules.reportObject.deployedSource=clone(rules.reportObject.localSource);
  approval.testEvidence.testedLocalSourceHash=evidence.rules.sourceHash;approval.testEvidence.testedDeployedSourceHash=evidence.rules.sourceHash;
  const rulesReport=Buffer.from(K.canonicalJSON(rules.reportObject));approval.testEvidence.reportSha256=K.sha256Bytes(rulesReport);
  if(options.scoped) {
    approval.schemaVersion=2;
    for(const key of ['releaseSourceSha','backendBuildId','hostingArtifactFingerprint','placementFingerprint']) delete approval[key];
  }
  const approvalDigest=require('./option-b-rules-evidence.cjs').digestApproval(approval);
  return {candidate,evidence,rulesApproval:approval,rulesReport,approvalDigest,configurationApproval,now:NOW,provider,hostingFiles,built,cleanup:provider.cleanup};
}
async function currentReleaseFixture(options={}) {
  const NOW=options.now??module.exports.NOW;
  const f=await fixture(options), c=f.candidate, env=environmentForProject(c.projectId), sites=readTargetSites(c.projectId);
  const target={projectId:c.projectId,projectNumber:c.projectNumber,environment:c.environment,region:'us-central1',databaseId:'(default)'};
  const {Timestamp}=require(require.resolve('firebase-admin/firestore',{paths:[path.resolve(__dirname,'../../platform/functions')]}));
  const stamp=Timestamp.fromMillis(Date.parse(NOW));
  const policy={...target,schemaVersion:2,enforcementVersion:'teacher-units-option-b-v1',policyInstanceId:'123e4567-e89b-4abc-8def-1234567890ab',generation:4,mode:'closed',approvedBackendBuildId:c.backendBuildId,acceptedClientContractVersions:[],placementFingerprint:c.placementFingerprint,createdAt:stamp,updatedAt:stamp,updatedBy:{principalSubject:'synthetic-owner',credentialSubject:'synthetic-owner',delegationSubject:null},transitionId:'123e4567-e89b-4abc-8def-1234567890ac',reason:'Synthetic prepared release',approvalRef:'synthetic-owner-approval',lastEnabledAt:null,lastClosedAt:stamp};
  const hosting={projectId:c.projectId,observedAt:NOW,app:{site:sites.app,origin:env.origins.app,files:f.hostingFiles.app},marketing:{site:sites.marketing,origin:env.origins.marketing,files:f.hostingFiles.marketing}};
  const receiptHosting=Object.fromEntries(['app','marketing'].map(key=>[key,{site:sites[key],version:'ccc123',previous:'aaa123',releaseTime:NOW,bytes:{matched:1,redirected:0}}]));
  const certifiedReceipt=H.optionBReceipt({phase:'certified',project:c.projectId,intent:'teacher-units',candidate:c,evidence:f.evidence,hosting:receiptHosting,rulesApproval:f.rulesApproval,rulesReport:f.rulesReport,approvalDigest:f.approvalDigest,configurationApproval:f.configurationApproval,recordedAt:NOW});
  const bundle={kind:O.CURRENT_RELEASE_KIND,schemaVersion:1,projectId:c.projectId,policyInstanceId:policy.policyInstanceId,policyGeneration:policy.generation,backendBuildId:c.backendBuildId,placementFingerprint:c.placementFingerprint,approvalRef:policy.approvalRef,preparedAt:NOW,observedAt:NOW,candidate:c,observation:f.evidence,configurationApproval:f.configurationApproval,rulesApproval:f.rulesApproval,rulesReport:f.rulesReport.toString('utf8'),approvalDigest:f.approvalDigest,certifiedReceipt,hosting,review:{principalSubject:'synthetic-reviewer',decisionRef:policy.approvalRef,reviewedAt:NOW,iamScopeAccepted:true,routingAccepted:true,automaticUpdatesAccepted:true},provenance:'synthetic, not provider-verified'};
  let rollbackBytes;
  if(options.scoped) {
    bundle.schemaVersion=2;
    // Injected modeled provider responses only; this is never live authority.
    bundle.provenance='provider-observed';
    for(const key of ['app','marketing']) bundle.hosting[key].version=bundle.certifiedReceipt.hosting[key].version;
    bundle.review.purpose=target.environment==='staging'?'staging-validation':'production-activation';
    const closedBuild=buildFixture({build:B,canonical:K,mode:'closed-only'});
    const closedProvider=buildProvider({project:c.projectId,files:closedBuild.files,clock:()=>NOW});
    rollbackBytes=closedProvider.state.archive;
    const cleanup=f.cleanup;f.cleanup=()=>{cleanup();closedProvider.cleanup();};
    bundle.rollback={projectId:c.projectId,backendBuildId:closedBuild.record.backendBuildId,sourceSha:c.source.sha,deploymentMode:'closed-only',artifactRef:'/synthetic/closed-functions.zip',artifactSha256:K.sha256Bytes(rollbackBytes),verifiedClosed:true,hosting:{app:'aaa123',marketing:'aaa123'}};
    bundle.stagingAcceptance=target.environment==='staging'?null:{projectId:'lyfelabz-staging',sourceSha:c.source.sha,decisionRef:'synthetic-staging-acceptance',acceptedAt:NOW,teacherWorkflowsPassed:true,securityTestsPassed:true,shutdownRehearsed:true};
  }
  return {...f,target,policy,bundle,rollbackBytes,options:{target,policy,now:NOW,approvalRef:policy.approvalRef}};
}
// Runs the real certification producer with local files and injected transports.
// No Firebase CLI or network request executes.
async function certifiedPathFixture() {
  const fs=require('node:fs'), os=require('node:os');
  const contract=require('../hosting-release/contract.cjs'), release=require('../hosting-release/release.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'b3-certification-'));
  let f;
  try {
    const now=new Date().toISOString(), directories={}, files={};
    for(const key of ['app','marketing']) {
      directories[key]=path.join(root,key); fs.mkdirSync(directories[key]);
      fs.writeFileSync(path.join(directories[key],'index.html'),'local certification homepage');
      files[key]={'index.html':contract.sha256('local certification homepage')};
    }
    f=await currentReleaseFixture({now,hostingFiles:files,scoped:true});
    const project=f.target.projectId, env=contract.environmentForProject(project), sites=contract.readTargetSites(project);
    const attachments={rulesApproval:f.rulesApproval,rulesReport:f.rulesReport.toString('utf8'),approvalDigest:f.approvalDigest,configurationApproval:f.configurationApproval};
    const surfaces=Object.fromEntries(['app','marketing'].map(key=>[key,{site:sites[key],baseline:{version:'aaa123',releaseTime:now}}]));
    const pair={kind:'lyfelabz.hostingPairBuild',schemaVersion:3,releaseIntent:'teacher-units',source:f.candidate.source,files,candidate:f.candidate};
    const prepared={kind:'lyfelabz.hostingPreparedRelease',schemaVersion:3,releaseIntent:'teacher-units',project,environment:env.name,source:pair.source,candidate:f.candidate,preparedAt:now,surfaces,
      evidenceReceipt:H.optionBReceipt({phase:'prepared',project,intent:'teacher-units',candidate:f.candidate,evidence:f.evidence,hosting:surfaces,...attachments,recordedAt:now})};
    const routing=contract.readHostingTargets(contract.readConfigFile(env.config)), samples=contract.loadContract(), routes=new Map();
    for(const sample of samples.redirectSamples) routes.set(`${env.origins[sample.target]}${new URL(sample.path,env.origins[sample.target]).pathname}`,{status:sample.status,location:sample.location.replace('{app}',env.origins.app).replace('{marketing}',env.origins.marketing)});
    for(const sample of samples.routeSamples) routes.set(`${env.origins[sample.target]}${new URL(sample.path,env.origins[sample.target]).pathname}`,{status:sample.status});
    for(const origin of [env.origins.app,env.origins.marketing,...env.entryAliases]) routes.set(`${origin}/`,{status:200});
    const {record}=await require('../hosting-release/certify.cjs').certify({project,intent:'teacher-units',candidateFor:()=>f.candidate,directories,optionB:attachments,
      readJson:name=>name.endsWith('pair-build.json')?pair:prepared,
      run:(cmd,args)=>{
        assert.equal(cmd,'firebase');
        if(args[0]==='hosting:sites:list') return JSON.stringify({status:'success',result:{sites:Object.values(sites).map(site=>({name:`projects/${project}/sites/${site}`}))}});
        assert.equal(args[0],'hosting:channel:list');
        const site=args[args.indexOf('--site')+1], key=site===sites.app?'app':'marketing';
        return JSON.stringify({status:'success',result:{channels:[{name:`sites/${site}/channels/live`,release:{message:release.releaseMessage(pair.source.sha,false),releaseTime:now,version:{name:`sites/${site}/versions/ccc123`,config:contract.toApiRouting(routing[key])}}}]}});
      },
      fetchImpl:async url=>{const u=new URL(url), r=routes.get(`${u.origin}${u.pathname}`);assert.ok(r,`unexpected local fetch ${url}`);return new Response('local certification homepage',{status:r.status,headers:r.location?{location:r.location}:{}});},
      backendVerify:async()=>({candidate:f.candidate,evidence:f.evidence}),certifyEntry:async()=>({checked:1}),log:()=>{},write:()=>'/local-only-unused'});
    f.bundle.certifiedReceipt=record.evidenceReceipt;
    const observedAt=new Date().toISOString();
    f.bundle.observedAt=observedAt; f.bundle.observation.observedAt=observedAt; f.bundle.hosting.observedAt=observedAt;
    f.options.now=observedAt;
    const cleanup=f.cleanup; f.cleanup=()=>{cleanup();fs.rmSync(root,{recursive:true,force:true});};
    return {...f,certificationRecord:record};
  } catch(error) {f?.cleanup();fs.rmSync(root,{recursive:true,force:true});throw error;}
}
// Operation 1J: first HTTP-200 teacherUnitsCreate Function/Run responses.
// discovery/discovery-transcript.json; all 101 retained manifest entries match.
// Transcript SHA-256: 458220b676dec9f150f3e69b0f17b1cc9f74fbb387e8bbee637bb6a431bf6ad0.
// Only public OAuth client/API-key values are redacted consistently in all envs.
// Historical conflicting/missing config is retained. This is not an Option B build.
const captured1J={
  "fn": {
    "name": "projects/lyfelabz-staging/locations/us-central1/functions/teacherUnitsCreate",
    "buildConfig": {
      "build": "projects/293337283840/locations/us-central1/builds/70e0652b-84d0-4dac-8135-cd5e6d22c5c1",
      "runtime": "nodejs22",
      "entryPoint": "teacherUnitsCreate",
      "source": {
        "storageSource": {
          "bucket": "gcf-v2-sources-293337283840-us-central1",
          "object": "teacherUnitsCreate/function-source.zip",
          "generation": "1792859542037037"
        }
      },
      "environmentVariables": {
        "GOOGLE_NODE_RUN_SCRIPTS": ""
      },
      "dockerRepository": "projects/lyfelabz-staging/locations/us-central1/repositories/gcf-artifacts",
      "sourceProvenance": {
        "resolvedStorageSource": {
          "bucket": "gcf-v2-sources-293337283840-us-central1",
          "object": "teacherUnitsCreate/function-source.zip",
          "generation": "1792859542037037"
        }
      },
      "dockerRegistry": "ARTIFACT_REGISTRY",
      "serviceAccount": "projects/lyfelabz-staging/serviceAccounts/293337283840-compute@developer.gserviceaccount.com",
      "automaticUpdatePolicy": {}
    },
    "serviceConfig": {
      "service": "projects/lyfelabz-staging/locations/us-central1/services/teacherunitscreate",
      "timeoutSeconds": 60,
      "environmentVariables": {
        "GOOGLE_CLASSROOM_REDIRECT_URI": "https://lyfelabz-staging.web.app/app/lms-callback.html",
        "GOOGLE_CLASSROOM_CLIENT_ID": "REDACTED_PUBLIC_CLIENT_VALUE",
        "STAGING_WEB_API_KEY": "REDACTED_PUBLIC_CLIENT_VALUE",
        "FIREBASE_CONFIG": "{\"projectId\":\"lyfelabz-staging\",\"storageBucket\":\"lyfelabz-staging.firebasestorage.app\"}",
        "GCLOUD_PROJECT": "lyfelabz-staging",
        "EVENTARC_CLOUD_EVENT_SOURCE": "projects/lyfelabz-staging/locations/us-central1/services/teacherUnitsCreate",
        "FUNCTION_TARGET": "teacherUnitsCreate",
        "LOG_EXECUTION_ID": "true",
        "FUNCTION_SIGNATURE_TYPE": "http"
      },
      "maxInstanceCount": 20,
      "ingressSettings": "ALLOW_ALL",
      "uri": "https://teacherunitscreate-36vxufx5ra-uc.a.run.app",
      "serviceAccountEmail": "293337283840-compute@developer.gserviceaccount.com",
      "availableMemory": "256Mi",
      "allTrafficOnLatestRevision": true,
      "revision": "teacherunitscreate-00002-zay",
      "maxInstanceRequestConcurrency": 80,
      "availableCpu": "1"
    },
    "state": "ACTIVE",
    "updateTime": "2026-10-24T16:32:37.589311552Z",
    "labels": {
      "deployment-callable": "true",
      "firebase-functions-hash": "2f117109d1caea54f9f414cb4786c017a4bc1122",
      "deployment-tool": "cli-firebase"
    },
    "environment": "GEN_2",
    "url": "https://us-central1-lyfelabz-staging.cloudfunctions.net/teacherUnitsCreate",
    "createTime": "2026-10-18T17:45:04.507424139Z",
    "satisfiesPzi": true
  },
  "service": {
    "name": "projects/lyfelabz-staging/locations/us-central1/services/teacherunitscreate",
    "uid": "cdb5940e-d74e-446d-8c8f-e5bb32291b18",
    "generation": "2",
    "labels": {
      "goog-drz-cloudfunctions-location": "us-central1",
      "firebase-functions-hash": "2f117109d1caea54f9f414cb4786c017a4bc1122",
      "goog-managed-by": "cloudfunctions",
      "goog-cloudfunctions-runtime": "nodejs22",
      "goog-drz-cloudfunctions-id": "teacherunitscreate",
      "deployment-callable": "true"
    },
    "annotations": {
      "cloudfunctions.googleapis.com/function-id": "teacherUnitsCreate"
    },
    "createTime": "2026-10-18T17:45:05.007769Z",
    "updateTime": "2026-10-24T16:32:22.663261Z",
    "creator": "service-293337283840@gcf-admin-robot.iam.gserviceaccount.com",
    "lastModifier": "service-293337283840@gcf-admin-robot.iam.gserviceaccount.com",
    "client": "cli-firebase",
    "ingress": "INGRESS_TRAFFIC_ALL",
    "launchStage": "GA",
    "template": {
      "revision": "teacherunitscreate-00002-zay",
      "labels": {
        "goog-drz-cloudfunctions-location": "us-central1",
        "firebase-functions-hash": "2f117109d1caea54f9f414cb4786c017a4bc1122",
        "goog-drz-cloudfunctions-id": "teacherunitscreate",
        "deployment-callable": "true"
      },
      "annotations": {
        "cloudfunctions.googleapis.com/trigger-type": "HTTP_TRIGGER"
      },
      "scaling": {
        "maxInstanceCount": 20
      },
      "timeout": "60s",
      "serviceAccount": "293337283840-compute@developer.gserviceaccount.com",
      "containers": [
        {
          "name": "worker",
          "image": "us-central1-docker.pkg.dev/lyfelabz-staging/gcf-artifacts/lyfelabz--staging__us--central1__assessment_lesson_summary:version_1",
          "env": [
            {
              "name": "GOOGLE_CLASSROOM_REDIRECT_URI",
              "value": "https://lyfelabz-staging.web.app/app/lms-callback.html"
            },
            {
              "name": "GOOGLE_CLASSROOM_CLIENT_ID",
              "value": "REDACTED_PUBLIC_CLIENT_VALUE"
            },
            {
              "name": "STAGING_WEB_API_KEY",
              "value": "REDACTED_PUBLIC_CLIENT_VALUE"
            },
            {
              "name": "FIREBASE_CONFIG",
              "value": "{\"projectId\":\"lyfelabz-staging\",\"storageBucket\":\"lyfelabz-staging.firebasestorage.app\"}"
            },
            {
              "name": "GCLOUD_PROJECT",
              "value": "lyfelabz-staging"
            },
            {
              "name": "EVENTARC_CLOUD_EVENT_SOURCE",
              "value": "projects/lyfelabz-staging/locations/us-central1/services/teacherUnitsCreate"
            },
            {
              "name": "FUNCTION_TARGET",
              "value": "teacherUnitsCreate"
            },
            {
              "name": "LOG_EXECUTION_ID",
              "value": "true"
            },
            {
              "name": "FUNCTION_SIGNATURE_TYPE",
              "value": "http"
            }
          ],
          "resources": {
            "limits": {
              "cpu": "1",
              "memory": "256Mi"
            },
            "cpuIdle": true,
            "startupCpuBoost": true
          },
          "ports": [
            {
              "name": "http1",
              "containerPort": 8080
            }
          ],
          "startupProbe": {
            "timeoutSeconds": 240,
            "periodSeconds": 240,
            "failureThreshold": 1,
            "tcpSocket": {
              "port": 8080
            }
          },
          "baseImageUri": "us-central1-docker.pkg.dev/serverless-runtimes/google-22-full/runtimes/nodejs22"
        }
      ],
      "maxInstanceRequestConcurrency": 80,
      "client": "cli-firebase"
    },
    "traffic": [
      {
        "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",
        "percent": 100
      }
    ],
    "scaling": {
      "maxInstanceCount": 20
    },
    "urls": [
      "https://teacherunitscreate-293337283840.us-central1.run.app",
      "https://us-central1-lyfelabz-staging.cloudfunctions.net/teacherUnitsCreate",
      "https://teacherunitscreate-36vxufx5ra-uc.a.run.app"
    ],
    "sshEnabled": false,
    "observedGeneration": "2",
    "terminalCondition": {
      "type": "Ready",
      "state": "CONDITION_SUCCEEDED",
      "lastTransitionTime": "2026-10-24T16:32:37.298375Z"
    },
    "conditions": [
      {
        "type": "RoutesReady",
        "state": "CONDITION_SUCCEEDED",
        "lastTransitionTime": "2026-10-24T16:32:37.252488Z"
      },
      {
        "type": "ConfigurationsReady",
        "state": "CONDITION_SUCCEEDED",
        "lastTransitionTime": "2026-10-24T16:32:23.689255Z"
      }
    ],
    "latestReadyRevision": "projects/lyfelabz-staging/locations/us-central1/services/teacherunitscreate/revisions/teacherunitscreate-00002-zay",
    "latestCreatedRevision": "projects/lyfelabz-staging/locations/us-central1/services/teacherunitscreate/revisions/teacherunitscreate-00002-zay",
    "trafficStatuses": [
      {
        "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",
        "revision": "teacherunitscreate-00002-zay",
        "percent": 100
      }
    ],
    "uri": "https://teacherunitscreate-36vxufx5ra-uc.a.run.app",
    "customAudiences": [
      "https://us-central1-lyfelabz-staging.cloudfunctions.net/teacherUnitsCreate"
    ],
    "buildConfig": {
      "name": "projects/293337283840/locations/us-central1/builds/70e0652b-84d0-4dac-8135-cd5e6d22c5c1",
      "sourceLocation": "gs://gcf-v2-sources-293337283840-us-central1/teacherUnitsCreate/function-source.zip#1792859542037037",
      "functionTarget": "teacherUnitsCreate",
      "imageUri": "us-central1-docker.pkg.dev/lyfelabz-staging/gcf-artifacts/lyfelabz--staging__us--central1__assessment_lesson_summary:version_1",
      "baseImage": "us-central1-docker.pkg.dev/serverless-runtimes/google-22-full/runtimes/nodejs22",
      "enableAutomaticUpdates": true,
      "environmentVariables": {
        "GOOGLE_NODE_RUN_SCRIPTS": ""
      },
      "serviceAccount": "projects/lyfelabz-staging/serviceAccounts/293337283840-compute@developer.gserviceaccount.com"
    },
    "etag": "\"CJa789YGEMieorwC/cHJvamVjdHMvbHlmZWxhYnotc3RhZ2luZy9sb2NhdGlvbnMvdXMtY2VudHJhbDEvc2VydmljZXMvdGVhY2hlcnVuaXRzY3JlYXRl\""
  },
  "revision": {
    "name": "projects/lyfelabz-staging/locations/us-central1/services/teacherunitscreate/revisions/teacherunitscreate-00002-zay",
    "uid": "e78e9853-a625-4435-9d82-6a65ca3082a5",
    "generation": "1",
    "labels": {
      "goog-drz-cloudfunctions-location": "us-central1",
      "firebase-functions-hash": "2f117109d1caea54f9f414cb4786c017a4bc1122",
      "goog-drz-cloudfunctions-id": "teacherunitscreate",
      "deployment-callable": "true",
      "goog-managed-by": "cloudfunctions",
      "goog-cloudfunctions-runtime": "nodejs22"
    },
    "annotations": {
      "cloudfunctions.googleapis.com/trigger-type": "HTTP_TRIGGER"
    },
    "createTime": "2026-10-24T16:32:22.796398Z",
    "updateTime": "2026-10-24T16:32:23.111031Z",
    "launchStage": "GA",
    "service": "teacherunitscreate",
    "scaling": {
      "maxInstanceCount": 20
    },
    "timeout": "60s",
    "serviceAccount": "293337283840-compute@developer.gserviceaccount.com",
    "containers": [
      {
        "name": "worker",
        "image": "us-central1-docker.pkg.dev/lyfelabz-staging/gcf-artifacts/lyfelabz--staging__us--central1__assessment_lesson_summary@sha256:fedf4cd9ac40f6e3870603c1987ac6ea5569f6050feb13ff2b804aa4c030e8a3",
        "env": [
          {
            "name": "GOOGLE_CLASSROOM_REDIRECT_URI",
            "value": "https://lyfelabz-staging.web.app/app/lms-callback.html"
          },
          {
            "name": "GOOGLE_CLASSROOM_CLIENT_ID",
            "value": "REDACTED_PUBLIC_CLIENT_VALUE"
          },
          {
            "name": "STAGING_WEB_API_KEY",
            "value": "REDACTED_PUBLIC_CLIENT_VALUE"
          },
          {
            "name": "FIREBASE_CONFIG",
            "value": "{\"projectId\":\"lyfelabz-staging\",\"storageBucket\":\"lyfelabz-staging.firebasestorage.app\"}"
          },
          {
            "name": "GCLOUD_PROJECT",
            "value": "lyfelabz-staging"
          },
          {
            "name": "EVENTARC_CLOUD_EVENT_SOURCE",
            "value": "projects/lyfelabz-staging/locations/us-central1/services/teacherUnitsCreate"
          },
          {
            "name": "FUNCTION_TARGET",
            "value": "teacherUnitsCreate"
          },
          {
            "name": "LOG_EXECUTION_ID",
            "value": "true"
          },
          {
            "name": "FUNCTION_SIGNATURE_TYPE",
            "value": "http"
          }
        ],
        "resources": {
          "limits": {
            "cpu": "1",
            "memory": "256Mi"
          },
          "cpuIdle": true,
          "startupCpuBoost": true
        },
        "ports": [
          {
            "name": "http1",
            "containerPort": 8080
          }
        ],
        "startupProbe": {
          "timeoutSeconds": 240,
          "periodSeconds": 240,
          "failureThreshold": 1,
          "tcpSocket": {
            "port": 8080
          }
        },
        "baseImageUri": "us-central1-docker.pkg.dev/serverless-runtimes/google-22-full/runtimes/nodejs22",
        "buildInfo": {
          "functionTarget": "assessmentLessonSummary",
          "sourceLocation": "gs://gcf-v2-sources-293337283840-us-central1/assessmentLessonSummary/function-source.zip#1792859483577734"
        }
      }
    ],
    "conditions": [
      {
        "type": "Ready",
        "state": "CONDITION_SUCCEEDED",
        "message": "Deploying revision succeeded in 13.04s.",
        "lastTransitionTime": "2026-10-24T16:32:35.841674Z"
      },
      {
        "type": "Active",
        "state": "CONDITION_SUCCEEDED",
        "lastTransitionTime": "2026-10-24T16:32:36.029339Z",
        "severity": "INFO"
      },
      {
        "type": "ResourcesAvailable",
        "state": "CONDITION_SUCCEEDED",
        "message": "Provisioning imported containers completed in 6.36s. Checking container health. This will wait for up to 4m for the configured startup probe, including an initial delay of 0s.",
        "lastTransitionTime": "2026-10-24T16:32:29.953883Z"
      },
      {
        "type": "ContainerReady",
        "state": "CONDITION_SUCCEEDED",
        "message": "Container image import completed.",
        "lastTransitionTime": "2026-10-24T16:32:23.589523Z"
      },
      {
        "type": "ContainerHealthy",
        "state": "CONDITION_SUCCEEDED",
        "message": "Containers became healthy in 4.69s.",
        "lastTransitionTime": "2026-10-24T16:32:35.774940Z"
      }
    ],
    "observedGeneration": "1",
    "logUri": "https://console.cloud.google.com/logs/viewer?project=lyfelabz-staging&resource=cloud_run_revision/service_name/teacherunitscreate/revision_name/teacherunitscreate-00002-zay&advancedFilter=resource.type%3D%22cloud_run_revision%22%0Aresource.labels.service_name%3D%22teacherunitscreate%22%0Aresource.labels.revision_name%3D%22teacherunitscreate-00002-zay%22",
    "maxInstanceRequestConcurrency": 80,
    "creator": "service-293337283840@gcf-admin-robot.iam.gserviceaccount.com",
    "client": "cli-firebase",
    "etag": "\"CJe789YGENjl-DQ/cHJvamVjdHMvbHlmZWxhYnotc3RhZ2luZy9sb2NhdGlvbnMvdXMtY2VudHJhbDEvc2VydmljZXMvdGVhY2hlcnVuaXRzY3JlYXRlL3JldmlzaW9ucy90ZWFjaGVydW5pdHNjcmVhdGUtMDAwMDItemF5\""
  }
};
if(require.main===module) {
  // B4S captured this exact source name on 2026-10-26. Only the name is
  // replayed here; provider/build/approval data remain synthetic test fixtures.
  const capturedRulesName='platform/firebase/firestore.rules';
  for(const name of ['firestore.rules',capturedRulesName]) test(`Rules source name ${name} preserves exact bytes and approval binding`,async()=>{
    const content='rules_version = "2";\n// Exact UTF-8 bytes: café\r\n';
    const f=await fixture({mutate:s=>{s.ruleset.source.files=[{name,content}];}});
    try {
      assert.equal(f.evidence.rules.sourceHash,K.sha256Bytes(Buffer.from(content,'utf8')));
      assert.equal(f.evidence.rules.rulesetResource,f.provider.state.rulesRelease.rulesetName);
      assert.equal(O.assertCompatible(f.candidate,f.evidence,f).rules.sourceHash,f.evidence.rules.sourceHash);
      for(const mutate of [
        e=>{e.rules.sourceHash='0'.repeat(64);},
        e=>{e.rules.rulesetResource+='-other';},
      ]) {const e=clone(f.evidence);mutate(e);assert.throws(()=>O.assertCompatible(f.candidate,e,f),/REFUSED/);}
      for(const field of ['rulesApproval','rulesReport','approvalDigest']) assert.throws(()=>O.assertCompatible(f.candidate,f.evidence,{...f,[field]:undefined}),/REFUSED/);
      for(const [field,value] of [['projectId','lyfelabz-prod'],['databaseId','other'],['approvedDeployedSourceHash','0'.repeat(64)],['approvedRulesetResource',f.evidence.rules.rulesetResource+'-other']]) {
        const approval=clone(f.rulesApproval);approval[field]=value;
        assert.throws(()=>O.assertCompatible(f.candidate,f.evidence,{...f,rulesApproval:approval}),/REFUSED/);
      }
      // A changed source under the same accepted name is observed with its
      // new hash, but cannot reuse the original approved byte pair.
      f.provider.state.ruleset.source.files[0].content+='// changed\n';
      const changed=await O.inspectOptionB({project:f.candidate.projectId,get:f.provider.get,now:()=>NOW,plan:f.configurationApproval});
      assert.notEqual(changed.rules.sourceHash,f.evidence.rules.sourceHash);
      assert.throws(()=>O.assertCompatible(f.candidate,changed,f),/REFUSED/);
    } finally {f.cleanup();}
  });
  test('captured Rules source name supports only the explicitly approved equivalent byte pair',async()=>{
    const f=await fixture({mutate:s=>{s.ruleset.source.files[0].name=capturedRulesName;}});
    try {
      const local='rules_version = "2"; // different synthetic local source\n';
      f.candidate.rulesSourceHash=K.sha256Bytes(local);
      f.rulesApproval.comparison='reviewed-equivalent';
      f.rulesApproval.localRulesSourceHash=f.candidate.rulesSourceHash;
      f.rulesApproval.testEvidence.testedLocalSourceHash=f.candidate.rulesSourceHash;
      const report=K.parseStrictJSON(f.rulesReport.toString('utf8'));
      report.localSource={bytesBase64:Buffer.from(local).toString('base64'),sha256:f.candidate.rulesSourceHash};
      f.rulesReport=Buffer.from(K.canonicalJSON(report));
      f.rulesApproval.testEvidence.reportSha256=K.sha256Bytes(f.rulesReport);
      f.approvalDigest=require('./option-b-rules-evidence.cjs').digestApproval(f.rulesApproval);
      assert.equal(O.assertCompatible(f.candidate,f.evidence,f).rules.comparison,'reviewed-equivalent');
      const tampered=clone(report);tampered.deployedSource.bytesBase64=Buffer.from(local).toString('base64');
      const rulesReport=Buffer.from(K.canonicalJSON(tampered)), rulesApproval=clone(f.rulesApproval);
      rulesApproval.testEvidence.reportSha256=K.sha256Bytes(rulesReport);
      const approvalDigest=require('./option-b-rules-evidence.cjs').digestApproval(rulesApproval);
      assert.throws(()=>O.assertCompatible(f.candidate,f.evidence,{...f,rulesReport,rulesApproval,approvalDigest}),/REFUSED/);
    } finally {f.cleanup();}
  });
  for(const name of ['', 'other/firestore.rules','platform/firestore.rules','platform/firebase/other.rules',
    '../firestore.rules','platform/firebase/../firebase/firestore.rules','./firestore.rules',
    '/platform/firebase/firestore.rules','platform//firebase/firestore.rules','platform\\firebase\\firestore.rules',
    'platform/firebase/firestore.rules/','platform/firebase/firestore.rules ', 'platform/firebase/%66irestore.rules',
    'firestore.rules\u0000']) test(`Rules refuses unexpected source name ${JSON.stringify(name)}`,async()=>{
      await assert.rejects(()=>fixture({mutate:s=>{s.ruleset.source.files[0].name=name;}}),/exact Rules file required/);
    });
  for(const [label,mutate,pattern] of [
    ['both accepted names',s=>{s.ruleset.source.files.push({...s.ruleset.source.files[0],name:capturedRulesName});},/unknown Rules source/],
    ['duplicate source identity',s=>{s.ruleset.source.files.push({...s.ruleset.source.files[0]});},/unknown Rules source/],
    ['no sources',s=>{s.ruleset.source.files=[];},/unknown Rules source/],
    ['missing content',s=>{delete s.ruleset.source.files[0].content;},/exact Rules file required/],
    ['nontext content',s=>{s.ruleset.source.files[0].content=null;},/exact Rules file required/],
    ['wrong project resource',s=>{s.rulesRelease.rulesetName=s.rulesRelease.rulesetName.replace('lyfelabz-staging','lyfelabz-prod');},/REFUSED/],
    ['wrong database release',s=>{s.rulesRelease.name+='-other';},/invalid\/disabled Rules release/],
    ['different returned ruleset',s=>{s.ruleset.name+='-other';},/unknown Rules source/],
    ['wrong database identity',s=>{s.database.name=s.database.name.replace('(default)','other');},/wrong database/],
  ]) test(`Rules refuses ${label}`,async()=>{await assert.rejects(()=>fixture({mutate:s=>{s.ruleset.source.files[0].name=capturedRulesName;mutate(s);}}),pattern);});
  test('nine endpoints validate actual schema 2 archive bytes and narrowly accepted Run buildConfig',async()=>{const f=await fixture();try{assert.equal(f.evidence.endpoints.length,9);assert.equal(f.evidence.build.schemaVersion,2);assert.equal(f.evidence.authority,'none');assert.equal(O.assertCompatible(f.candidate,f.evidence,f).authority,'none');assert.ok(f.provider.calls.some(c=>c.url.includes('/functions/teacherUnitsCapabilities')));}finally{f.cleanup();}});
  for(const [label,mutate] of [
    ['unknown service field',s=>{s.endpoints.teacherUnitsCreate.service.unknownSecurityFlag=true;}],
    ['unknown Run buildConfig',s=>{s.endpoints.teacherUnitsCreate.service.buildConfig.unknownCodeSource='x';}],
    ['wrong Run function target',s=>{s.endpoints.teacherUnitsCreate.service.buildConfig.functionTarget='other';}],
    ['wrong runtime policy',s=>{s.endpoints.teacherUnitsCreate.service.buildConfig.enableAutomaticUpdates=false;}],
    ['wrong source generation',s=>{s.endpoints.teacherUnitsCreate.service.buildConfig.sourceLocation='gs://other/source.zip#1';}],
    ['tagged route',s=>{s.endpoints.teacherUnitsCreate.service.traffic.push({type:'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',revision:'old',percent:0,tag:'old'});}],
    ['wrong revision',s=>{s.endpoints.teacherUnitsCapabilities.service.latestReadyRevision='other';}],
    ['unknown nested container',s=>{s.endpoints.teacherUnitsCreate.revision.containers[0].sourceCode={};}],
    ['missing capabilities',s=>{delete s.endpoints.teacherUnitsCapabilities;}],
    ['invalid calendar time',s=>{s.endpoints.teacherUnitsCreate.fn.updateTime='2026-02-30T12:00:00.000Z';}],
    ['future service metadata',s=>{s.endpoints.teacherUnitsCreate.service.createTime='2026-10-27T12:00:00.000Z';}],
    ['future revision condition',s=>{s.endpoints.teacherUnitsCreate.revision.conditions[0].lastTransitionTime='2026-10-27T12:00:00.000Z';}],
    ['unknown base image',s=>{s.endpoints.teacherUnitsCreate.service.buildConfig.baseImage='unreviewed-custom-runtime';}],
  ]) test(`refuses ${label}`,async()=>{await assert.rejects(()=>fixture({mutate}));});
  test('captured 1J response refuses unresolved historical execution context',()=>{
    assert.throws(()=>O.normalizeEndpoint({projectId:'lyfelabz-staging',id:'teacherUnitsCreate',...clone(captured1J),at:NOW,archive:{build:{backendBuildId:'a'.repeat(64)}}}),/unresolved execution context/);
  });
  // Exact captured metadata shapes on a separately synthetic controlled build.
  // Success here does not imply acceptance of the original historical capture.
  function capturedMetadata(s) {
    const e=s.endpoints.teacherUnitsCreate, c=captured1J;
    e.service.template=templateOf(e.revision);
    e.revision.scaling=clone(c.revision.scaling);e.service.template.scaling=clone(c.revision.scaling);e.fn.serviceConfig.maxInstanceCount=c.revision.scaling.maxInstanceCount;
    e.service.scaling=clone(c.service.scaling); e.service.sshEnabled=c.service.sshEnabled;
    e.service.conditions=clone(c.service.conditions); e.service.template.client=c.service.template.client;
    e.service.buildConfig.imageUri=e.service.template.containers[0].image;
    e.revision.client=c.revision.client; e.revision.logUri=c.revision.logUri;
    e.revision.service=c.revision.service; e.revision.conditions=clone(c.revision.conditions);
    const source=e.fn.buildConfig.sourceProvenance.resolvedStorageSource;
    const buildInfo={functionTarget:'teacherUnitsCreate',sourceLocation:`gs://${source.bucket}/${source.object}#${source.generation}`};
    e.revision.containers[0].buildInfo=clone(buildInfo);
  }
  test('reviewed captured metadata shapes stay bound to approved config',async()=>{
    const f=await fixture({mutate:capturedMetadata});try{assert.equal(O.assertCompatible(f.candidate,f.evidence,f).authority,'none');}finally{f.cleanup();}
  });
  for(const [label,mutate] of [
    ['SSH enabled',e=>{e.service.sshEnabled=true;}],['unknown scaling',e=>{e.service.scaling.manualInstanceCount=2;}],
    ['scaling differs',e=>{e.service.scaling.maxInstanceCount++;}],['image differs',e=>{e.service.buildConfig.imageUri+='other';}],
    ['wrong short service',e=>{e.revision.service='other';}],['wrong full revision parent',e=>{e.revision.name=e.revision.name.replace('lyfelabz-staging','lyfelabz-prod');}],
    ['failed condition',e=>{e.revision.conditions[1].state='CONDITION_FAILED';}],['unknown condition',e=>{e.revision.conditions[1].type='Unreviewed';}],
    ['duplicate condition',e=>{e.revision.conditions.push(clone(e.revision.conditions[0]));}],['wrong log project',e=>{e.revision.logUri=e.revision.logUri.replace('project=lyfelabz-staging','project=lyfelabz-prod');}],
    ['captured conflicting provenance',e=>{e.revision.containers[0].buildInfo=clone(captured1J.revision.containers[0].buildInfo);}],
    ['missing execution environment',e=>{delete e.revision.executionEnvironment;}],
    ['captured unpinned image',e=>{e.service.template.containers[0].image=captured1J.service.template.containers[0].image;e.service.buildConfig.imageUri=e.service.template.containers[0].image;}],
  ]) test(`captured profile refuses ${label}`,async()=>{await assert.rejects(()=>fixture({mutate:s=>{capturedMetadata(s);mutate(s.endpoints.teacherUnitsCreate);}}),/REFUSED/);});
  test('configuration approval is independently supplied and bound, never generated from observation',async()=>{const f=await fixture();try{await assert.rejects(()=>O.inspectOptionB({project:f.candidate.projectId,get:f.provider.get,now:()=>NOW,plan:{...f.configurationApproval,configDigest:'a'.repeat(64)}}),/approved plan/);await assert.rejects(()=>O.inspectOptionB({project:f.candidate.projectId,get:f.provider.get,now:()=>NOW}),/REFUSED/);}finally{f.cleanup();}});
  test('mixed/legacy build bytes and forged payload fingerprints refuse',async()=>{const f=await fixture();try{for(const mutation of ['legacy','payload','missing'])await assert.rejects(()=>O.inspectOptionB({project:f.candidate.projectId,get:f.provider.get,now:()=>NOW,plan:f.configurationApproval,unpack:bytes=>{const a=O.unpackOptionB(bytes);if(mutation==='legacy')a.buildRecordBytes=Buffer.from('{"schemaVersion":1}');if(mutation==='payload')a.runtimeFiles['lib/index.js']='f'.repeat(64);if(mutation==='missing')delete a.buildRecordBytes;return a;}}),/REFUSED/);}finally{f.cleanup();}});
  test('wrong Rules resource with identical bytes, changed candidate and stale observation refuse',async()=>{const f=await fixture();try{const wrong=clone(f.evidence);wrong.rules.rulesetResource+= '-other';assert.throws(()=>O.assertCompatible(f.candidate,wrong,f),/REFUSED/);assert.throws(()=>O.assertCompatible({...f.candidate,backendBuildId:'0'.repeat(64)},f.evidence,f),/REFUSED/);assert.throws(()=>O.assertCompatible(f.candidate,f.evidence,{...f,now:'2026-10-26T12:06:00.000Z'}),/stale/);}finally{f.cleanup();}});
  test('unknown candidate metadata refuses rather than implying a supported contract',async()=>{const f=await fixture();try{assert.throws(()=>O.assertCompatible({...f.candidate,skipRules:true},f.evidence,f),/unknown or missing/);assert.throws(()=>O.assertCompatible({...f.candidate,source:{...f.candidate.source,extra:true}},f.evidence,f),/unknown or missing/);}finally{f.cleanup();}});
  test('current release binds closed policy, approved Rules, paired served bytes and explicit review',async()=>{const f=await currentReleaseFixture();try{assert.equal(O.validateCurrentRelease(f.bundle,f.options).activation,'not-approved');for(const field of ['generation','mode','approvedBackendBuildId']) {const policy={...f.policy,[field]:field==='generation'?5:field==='mode'?'enabled':'0'.repeat(64)};assert.throws(()=>O.validateCurrentRelease(f.bundle,{...f.options,policy}),/REFUSED/);}for(const change of [b=>{b.hosting.app.files['app/dist/bundle.js']='0'.repeat(64);},b=>{b.review.iamScopeAccepted=false;},b=>{b.review.routingAccepted=false;},b=>{b.observedAt='2026-10-26T11:54:00.000Z';},b=>{b.certifiedReceipt.kind='lyfelabz.backendReceipt';},b=>{b.rulesReport+=' ';}]){const b=clone(f.bundle);change(b);assert.throws(()=>O.validateCurrentRelease(b,f.options),/REFUSED/);}}finally{f.cleanup();}});
  test('actual certification output passes current-release validation',async()=>{
    const f=await certifiedPathFixture();try{assert.equal(f.certificationRecord.kind,'lyfelabz.hostingCertifiedRelease');assert.equal(Active.validateCurrentRelease(f.bundle,f.options).activation,'not-approved');}finally{f.cleanup();}
  });
  test('current release rejects incomplete, wrong-site and inconsistent certified Hosting',async()=>{
    const f=await currentReleaseFixture();try{
      for(const mutate of [
        h=>{h.app={};},h=>{h.app.site='wrong-project';},h=>{delete h.app.version;},h=>{delete h.marketing.previous;},
        h=>{h.app.previous=h.app.version;},h=>{delete h.app.releaseTime;},h=>{h.app.releaseTime='2026-02-30T12:00:00.000Z';},
        h=>{h.app.releaseTime='2026-10-27T12:00:00.000Z';},h=>{h.app.releaseTime='2026-10-25T12:00:00.000Z';},
        h=>{delete h.app.bytes;},h=>{h.app.bytes.matched=0;},h=>{h.app.bytes.redirected=-1;},
      ]) {const b=clone(f.bundle);mutate(b.certifiedReceipt.hosting);assert.throws(()=>O.validateCurrentRelease(b,f.options));}
      for(const recordedAt of [undefined,'invalid','2026-02-30T12:00:00.000Z']) {const b=clone(f.bundle);b.certifiedReceipt.recordedAt=recordedAt;assert.throws(()=>O.validateCurrentRelease(b,f.options));}
    }finally{f.cleanup();}
  });
  test('synthetic current release can never validate production',async()=>{const f=await currentReleaseFixture({project:'lyfelabz-prod'});try{assert.throws(()=>O.validateCurrentRelease(f.bundle,f.options),/synthetic/);}finally{f.cleanup();}});
  test('provider snapshots changing mid-observation and unknown project refuse',async()=>{const f=await fixture();try{let ownReads=0;f.provider.state.onGet=(url,count,s)=>{if(url.includes('/functions/teacherUnitsCreate')&&++ownReads===2)s.endpoints.teacherUnitsCreate.fn.labels.changed='true';};await assert.rejects(()=>O.inspectOptionB({project:f.candidate.projectId,get:f.provider.get,now:()=>NOW,plan:f.configurationApproval}),/changed/);await assert.rejects(()=>O.inspectOptionB({project:'unknown',get:f.provider.get,plan:f.configurationApproval}),/supported/);}finally{f.cleanup();}});
}
if(require.main===module) {
  // Scaling-only reproduction of E3A's captured staging layout: service=20
  // everywhere; Capabilities omits Functions/template/revision maxima.
  const stagingScaling=s=>{for(const [id,e] of Object.entries(s.endpoints)) {
    e.fn.serviceConfig.maxInstanceCount=20;e.revision.scaling={maxInstanceCount:20};
    e.service.template=templateOf(e.revision);
    if(id==='teacherUnitsCapabilities') {
      delete e.fn.serviceConfig.maxInstanceCount;delete e.revision.scaling;delete e.service.template.scaling;
    }
  }};
  test('E3B accepts service-wide 20 with omitted Capabilities revision ceilings',async()=>{
    const f=await fixture({scoped:true,maxInstances:20,mutate:stagingScaling});
    try {assert.equal(Active.assertCompatible(f.candidate,f.evidence,f).schemaVersion,2);assert.equal(f.evidence.endpoints.length,9);}finally{f.cleanup();}
  });
  for(const id of Active.ENDPOINTS.filter(id=>id!=='teacherUnitsCapabilities')) for(const field of ['function','revision']) {
    test(`E3B preserves ${id} explicit ${field} maximum requirement`,async()=>{
      await assert.rejects(fixture({scoped:true,maxInstances:20,mutate:s=>{
        stagingScaling(s);const e=s.endpoints[id];
        if(field==='function') delete e.fn.serviceConfig.maxInstanceCount;else delete e.revision.scaling;
      }}),/required management maxInstanceCount/);
    });
  }
  for(const id of Active.ENDPOINTS) for(const [label,mutate] of [
    ['missing service maximum',e=>{delete e.service.scaling;}],
    ['excessive service maximum',e=>{e.service.scaling.maxInstanceCount=21;}],
    ['lower service maximum',e=>{e.service.scaling.maxInstanceCount=19;}],
    ['null service maximum',e=>{e.service.scaling.maxInstanceCount=null;}],
    ['manual service scaling',e=>{e.service.scaling.manualInstanceCount=30;}],
    ['manual service mode',e=>{e.service.scaling.scalingMode='MANUAL';}],
    ['conflicting Functions maximum',e=>{e.fn.serviceConfig.maxInstanceCount=21;}],
    ['conflicting revision maximum',e=>{e.revision.scaling={maxInstanceCount:19};}],
    ['conflicting template maximum',e=>{e.service.template.scaling={maxInstanceCount:21};}],
    ['null revision maximum',e=>{e.revision.scaling={maxInstanceCount:null};}],
  ]) test(`E3B refuses ${id}: ${label}`,async()=>{
    await assert.rejects(fixture({scoped:true,maxInstances:20,mutate:s=>{stagingScaling(s);mutate(s.endpoints[id]);}}),/maxInstanceCount|service scaling mode/);
  });
  test('E2 scoped verifier accepts managed tags, omitted Run environment and new harmless metadata without Build/registry/checkpoint reads',async()=>{
    const f=await fixture({scoped:true,mutate:s=>{for(const e of Object.values(s.endpoints)) {
      delete e.revision.executionEnvironment;
      e.service.template=templateOf(e.revision);delete e.service.template.executionEnvironment;
      e.service.template.containers[0].image='provider-managed:version_1';
      e.service.buildConfig={imageUri:'provider-build-destination:version_1'};
      e.service.newProviderMetadata={harmless:true};e.revision.newProviderMetadata=true;
    }}});
    try {
      assert.equal(Active.assertCompatible(f.candidate,f.evidence,f).schemaVersion,2);
      assert.equal(f.evidence.endpoints.length,9);
      assert.ok(!f.provider.calls.some(c=>/cloudbuild|artifactregistry|containeranalysis|checkpoint/.test(c.url)));
    }finally{f.cleanup();}
  });
  for(const [label,mutate] of [
    ['missing endpoint',s=>{delete s.endpoints.teacherUnitsCapabilities;}],
    ['alternate region',s=>{s.extraFunctions.push({...s.endpoints.teacherUnitsCreate.fn,name:'projects/lyfelabz-staging/locations/europe-west1/functions/teacherUnitsCreate'});} ],
    ['failed deployment',s=>{s.endpoints.teacherUnitsCreate.fn.state='FAILED';}],
    ['wrong project',s=>{s.endpoints.teacherUnitsCreate.fn.name=s.endpoints.teacherUnitsCreate.fn.name.replace('lyfelabz-staging','lyfelabz-prod');}],
    ['wrong entrypoint',s=>{s.endpoints.teacherUnitsCreate.fn.buildConfig.entryPoint='other';}],
    ['wrong runtime account',s=>{s.endpoints.teacherUnitsCreate.revision.serviceAccount='wrong@example.iam.gserviceaccount.com';}],
    ['wrong timeout',s=>{s.endpoints.teacherUnitsCreate.fn.serviceConfig.timeoutSeconds=999;}],
    ['code loading override',s=>{s.endpoints.teacherUnitsCreate.revision.containers[0].args=['unreviewed.js'];}],
    ['foreign runtime project',s=>{s.endpoints.teacherUnitsCreate.revision.containers[0].env[0].value='{"projectId":"lyfelabz-prod"}';}],
    ['unreviewed environment',s=>{s.endpoints.teacherUnitsCreate.revision.containers[0].env.push({name:'NODE_OPTIONS',value:'--require=other.js'});}],
    ['unhealthy revision',s=>{s.endpoints.teacherUnitsCreate.revision.conditions[0].state='CONDITION_FAILED';}],
    ['traffic split',s=>{s.endpoints.teacherUnitsCreate.service.trafficStatuses[0].percent=50;}],
    ['tag route',s=>{s.endpoints.teacherUnitsCreate.service.traffic.push({tag:'old',percent:0,revision:'old'});}],
  ]) test(`E2 scoped verification refuses ${label}`,async()=>{await assert.rejects(fixture({scoped:true,mutate}));});
  test('E2 current record rejects obsolete evidence, wrong purpose, missing rollback and production without staging acceptance',async()=>{
    for(const project of ['lyfelabz-staging','lyfelabz-prod']) {
      const f=await currentReleaseFixture({scoped:true,project});
      try {
        assert.equal(Active.validateCurrentRelease(f.bundle,f.options).schemaVersion,2);
        for(const change of [b=>{b.schemaVersion=1;},b=>{b.provenance='synthetic, not provider-verified';},b=>{b.review.purpose='general';},b=>{b.rollback.verifiedClosed=false;},b=>{b.rollback.hosting.app='bad';},b=>{b.rollback=null;},b=>{b.certifiedReceipt.schemaVersion=1;},b=>{b.hosting.app.version='bad';},b=>{b.policyGeneration++;}]) {
          const bad=clone(f.bundle);change(bad);assert.throws(()=>Active.validateCurrentRelease(bad,f.options));
        }
        if(project==='lyfelabz-prod') {const bad=clone(f.bundle);bad.stagingAcceptance=null;assert.throws(()=>Active.validateCurrentRelease(bad,f.options));}
        assert.throws(()=>Active.validateCurrentRelease(f.bundle,{...f.options,approvalRef:'different-decision'}));
      }finally{f.cleanup();}
    }
  });
  test('E2 real refresh rechecks live Hosting versions and bytes without refreshing approvals; partial success fails',async()=>{
    const f=await currentReleaseFixture({scoped:true});
    try {
      const body='actual modeled served bytes',files={app:{'index.html':K.sha256Bytes(body)},marketing:{'index.html':K.sha256Bytes(body)}};
      const readArtifact=async()=>f.rollbackBytes;
      const get=async (url,binary)=>url.includes('firebasehosting.googleapis.com')?{release:{version:{name:`sites/${url.split('/sites/')[1].split('/')[0]}/versions/ccc123`}}}:f.provider.get(url,binary);
      f.bundle.hosting.app.files=files.app;f.bundle.hosting.marketing.files=files.marketing;
      const seen=[],fetchImpl=async url=>{seen.push(url);return new Response(body,{status:200});};
      const refreshed=await Active.refreshCurrentRelease(f.bundle,{get,now:()=>NOW,fetchImpl,readArtifact});
      assert.deepEqual(refreshed.hosting.app.files,files.app);assert.equal(seen.length,2);
      assert.deepEqual(refreshed.review,f.bundle.review);assert.equal(refreshed.preparedAt,f.bundle.preparedAt);
      await assert.rejects(Active.refreshCurrentRelease(f.bundle,{get,now:()=>NOW,fetchImpl:async()=>new Response('missing',{status:404}),readArtifact}),/unavailable/);
      await assert.rejects(Active.refreshCurrentRelease(f.bundle,{get:async(url,binary)=>url.includes('firebasehosting.googleapis.com')?{release:{version:{name:'sites/wrong/versions/old'}}}:get(url,binary),now:()=>NOW,fetchImpl,readArtifact}),/version changed/);
      await assert.rejects(Active.refreshCurrentRelease(f.bundle,{get,now:()=>NOW,fetchImpl,readArtifact:async()=>Buffer.from('wrong archive')}),/archive changed/);
      f.bundle.hosting.app.files={'../secret':K.sha256Bytes(body)};
      await assert.rejects(Active.refreshCurrentRelease(f.bundle,{get,now:()=>NOW,fetchImpl,readArtifact}),/file path/);
    }finally{f.cleanup();}
  });
  test('E2 Rules evidence is reusable across unchanged-source releases, not across source/project changes',async()=>{
    const f=await fixture({scoped:true});try {
      assert.equal(f.rulesApproval.schemaVersion,2);assert.equal(f.rulesApproval.backendBuildId,undefined);
      assert.equal(Active.assertCompatible(f.candidate,f.evidence,f).rules.sourceHash,f.evidence.rules.sourceHash);
      for(const mutate of [a=>{a.projectId='lyfelabz-prod';},a=>{a.approvedDeployedSourceHash='0'.repeat(64);},a=>{a.testEvidence.result='fail';}]) {
        const a=clone(f.rulesApproval);mutate(a);assert.throws(()=>Active.assertCompatible(f.candidate,f.evidence,{...f,rulesApproval:a}));
      }
      const old=await fixture();try{assert.throws(()=>Active.assertCompatible(old.candidate,old.evidence,old),/version/);}finally{old.cleanup();}
    }finally{f.cleanup();}
  });
  test('E2 actual certification producer, live refresh adapter and current-release validator agree end to end',async()=>{
    const f=await certifiedPathFixture();
    try {
      const get=async(url,binary)=>url.includes('firebasehosting.googleapis.com')
        ? {release:{version:{name:`sites/${url.split('/sites/')[1].split('/')[0]}/versions/ccc123`}}}
        : f.provider.get(url,binary);
      const refreshed=await Active.refreshCurrentRelease(f.bundle,{get,now:()=>f.options.now,
        fetchImpl:async()=>new Response('local certification homepage',{status:200}),readArtifact:async()=>f.rollbackBytes});
      const original=Active.validateCurrentRelease(f.bundle,f.options),current=Active.validateCurrentRelease(refreshed,f.options);
      assert.equal(current.releaseId,original.releaseId);
      const historical=await fixture();
      try {
        const hosting=Object.fromEntries(['app','marketing'].map(key=>[key,{site:readTargetSites(historical.candidate.projectId)[key],baseline:{version:'aaa123',releaseTime:NOW}}]));
        const receipt=H.optionBReceipt({phase:'prepared',project:historical.candidate.projectId,intent:'teacher-units',...historical,evidence:historical.evidence,hosting,recordedAt:NOW});
        assert.equal(receipt.schemaVersion,1);
        assert.throws(()=>H.verifyOptionBPrepared({kind:'lyfelabz.hostingPreparedRelease',schemaVersion:3,project:historical.candidate.projectId,environment:'staging',releaseIntent:'teacher-units',source:historical.candidate.source,candidate:historical.candidate,preparedAt:NOW,surfaces:hosting,evidenceReceipt:receipt},historical.candidate.projectId,historical.candidate,NOW),/current Option B prepare/);
      }finally{historical.cleanup();}
    }finally{f.cleanup();}
  });
}

module.exports={fixture:options=>fixture({...options,scoped:true}),currentReleaseFixture:options=>currentReleaseFixture({...options,scoped:true}),certifiedPathFixture,NOW};
