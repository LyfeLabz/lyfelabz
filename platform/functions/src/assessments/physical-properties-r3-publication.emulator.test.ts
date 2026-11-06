// Physical Properties r3 forward-only publication against the real Firestore
// emulator, using the committed payload files verbatim through the certified
// `deployAssessmentRevision` transaction (the same function the
// deploy-assessment CLIs call).
//
// Production holds Physical Properties r1 only, and staging holds r1 and r2.
// r3 must therefore be publishable directly after r1 (skipping r2) as well as
// after r2, and once r3 is current no older revision may replace it or
// rewrite any published revision. An assignment frozen at r1 keeps r1.
import * as fs from "fs";
import * as path from "path";
import { getApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type DocumentReference } from "firebase-admin/firestore";

import { deployAssessmentRevision } from "./assessment-deployment";
import {
  assessmentAnswerKeyDocRef,
  assessmentDocRef,
  assessmentRevisionDocRef,
} from "../shared/firestore/typed-ref";

const PROJECT = "demo-bootstrap";
const host = process.env.FIRESTORE_EMULATOR_HOST;
const hasEmulator = !!host;
const describeEmulator = hasEmulator ? describe : describe.skip;

if (hasEmulator) {
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error("Publication tests require a loopback Firestore emulator.");
  }
  for (const project of [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT]) {
    if (project !== undefined && project !== PROJECT) {
      throw new Error(`Refusing publication tests for project "${project}"; expected ${PROJECT}.`);
    }
  }
  let app;
  try {
    app = getApp();
  } catch {
    app = initializeApp({ projectId: PROJECT });
  }
  if (app.options.projectId !== PROJECT) {
    throw new Error("Publication tests require the demo project's default Admin app.");
  }
}
const db = hasEmulator ? getFirestore() : (undefined as never);

const PAYLOAD_DIR = path.join(__dirname, "..", "scripts", "assessments");
const SLUG = "physical-properties";
const ASSESSMENT_ID = `assessment_${SLUG}`;
const revisionId = (n: number): string => `${ASSESSMENT_ID}__r${String(n)}`;

type Payload = { activityId: string; revisionOrdinal: number; items: { options: unknown[] }[] };
function payload(n: number): Payload {
  return JSON.parse(fs.readFileSync(path.join(PAYLOAD_DIR, `${SLUG}.r${String(n)}.json`), "utf8")) as Payload;
}

async function clearPublication(): Promise<void> {
  const batch = db.batch();
  batch.delete(assessmentDocRef(ASSESSMENT_ID, db));
  for (const n of [1, 2, 3]) {
    batch.delete(assessmentRevisionDocRef(revisionId(n), db));
    batch.delete(assessmentAnswerKeyDocRef(revisionId(n), db));
  }
  await batch.commit();
}

async function snapshot(ref: DocumentReference): Promise<{ data: unknown; updateTime: Timestamp | undefined }> {
  const snap = await ref.get();
  expect(snap.exists).toBe(true);
  return { data: snap.data(), updateTime: snap.updateTime };
}

async function expectUnchanged(ref: DocumentReference, before: { data: unknown; updateTime: Timestamp | undefined }): Promise<void> {
  const after = await ref.get();
  expect(after.data()).toEqual(before.data);
  expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);
}

async function currentRevisionId(): Promise<unknown> {
  return (await assessmentDocRef(ASSESSMENT_ID, db).get()).get("currentRevisionId");
}

describeEmulator("Physical Properties r3 publication (real Firestore emulator)", () => {
  beforeEach(clearPublication);
  afterAll(async () => {
    if (hasEmulator) {
      await clearPublication();
      await db.terminate();
    }
  });

  it("uses the committed four-choice r3 payload", () => {
    const r3 = payload(3);
    expect(r3).toMatchObject({ activityId: SLUG, revisionOrdinal: 3 });
    expect(r3.items).toHaveLength(10);
    for (const item of r3.items) expect(item.options).toHaveLength(4);
  });

  it("advances directly from production r1 to r3 without r2, and keeps a frozen r1 assignment on r1", async () => {
    const r1 = await deployAssessmentRevision(payload(1));
    expect(r1).toMatchObject({ revisionId: revisionId(1), revisionOrdinal: 1, assessmentCreated: true });
    const assignmentRef = db.doc(`assignments/pp-r3-frozen-${Date.now().toString(36)}`);
    await assignmentRef.set({ lessonSlug: SLUG, assessmentRevisionId: revisionId(1), status: "published", createdAt: Timestamp.now() });
    const r1Revision = await snapshot(assessmentRevisionDocRef(revisionId(1), db));
    const r1Key = await snapshot(assessmentAnswerKeyDocRef(revisionId(1), db));
    const assignment = await snapshot(assignmentRef);

    const r3 = await deployAssessmentRevision(payload(3));
    expect(r3).toMatchObject({ revisionId: revisionId(3), revisionOrdinal: 3, assessmentCreated: false });
    expect(await currentRevisionId()).toBe(revisionId(3));
    expect((await assessmentRevisionDocRef(revisionId(2), db).get()).exists).toBe(false);

    const r3Revision = (await assessmentRevisionDocRef(revisionId(3), db).get()).data() as unknown as {
      items: { options: unknown[] }[];
    };
    expect(r3Revision.items).toHaveLength(10);
    for (const item of r3Revision.items) expect(item.options).toHaveLength(4);
    const r3Key = (await assessmentAnswerKeyDocRef(revisionId(3), db).get()).data() as unknown as {
      items: { itemId: string; correctOptionId: string }[];
    };
    expect(r3Key.items.map((i) => i.correctOptionId)).toEqual(["B", "A", "D", "C", "A", "D", "B", "A", "C", "C"]);

    // r1 and the assignment frozen at r1 are untouched by the r3 publication.
    await expectUnchanged(assessmentRevisionDocRef(revisionId(1), db), r1Revision);
    await expectUnchanged(assessmentAnswerKeyDocRef(revisionId(1), db), r1Key);
    await expectUnchanged(assignmentRef, assignment);
    await assignmentRef.delete();
  });

  it("advances from staging r2 to r3", async () => {
    await deployAssessmentRevision(payload(1));
    await deployAssessmentRevision(payload(2));
    expect(await currentRevisionId()).toBe(revisionId(2));
    await expect(deployAssessmentRevision(payload(3))).resolves.toMatchObject({ revisionId: revisionId(3), assessmentCreated: false });
    expect(await currentRevisionId()).toBe(revisionId(3));
  });

  it("refuses every older or repeated revision once r3 is current, and rewrites nothing", async () => {
    await deployAssessmentRevision(payload(1));
    await deployAssessmentRevision(payload(3));
    const parent = await snapshot(assessmentDocRef(ASSESSMENT_ID, db));
    const r3Revision = await snapshot(assessmentRevisionDocRef(revisionId(3), db));
    const r3Key = await snapshot(assessmentAnswerKeyDocRef(revisionId(3), db));
    const r1Revision = await snapshot(assessmentRevisionDocRef(revisionId(1), db));

    // r2 was never published here, so only the ordinal guard can stop it.
    await expect(deployAssessmentRevision(payload(2))).rejects.toMatchObject({
      code: "assessmentDeployment.nonMonotonicRevisionOrdinal",
    });
    await expect(deployAssessmentRevision(payload(1))).rejects.toMatchObject({
      code: "assessmentDeployment.duplicateRevision",
    });
    await expect(deployAssessmentRevision(payload(3))).rejects.toMatchObject({
      code: "assessmentDeployment.duplicateRevision",
    });

    expect((await assessmentRevisionDocRef(revisionId(2), db).get()).exists).toBe(false);
    expect((await assessmentAnswerKeyDocRef(revisionId(2), db).get()).exists).toBe(false);
    await expectUnchanged(assessmentDocRef(ASSESSMENT_ID, db), parent);
    await expectUnchanged(assessmentRevisionDocRef(revisionId(3), db), r3Revision);
    await expectUnchanged(assessmentAnswerKeyDocRef(revisionId(3), db), r3Key);
    await expectUnchanged(assessmentRevisionDocRef(revisionId(1), db), r1Revision);
  });
});
