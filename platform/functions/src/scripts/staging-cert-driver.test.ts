import {
  STAGING_PROJECT_ID,
  assertStagingProject,
  callableUrl,
  redact,
} from "./staging-cert-driver";

// Pure exports only; firebase-admin/network never enter the test process.

describe("assertStagingProject (fail-closed)", () => {
  test("accepts exactly lyfelabz-staging", () => {
    expect(assertStagingProject("lyfelabz-staging", {})).toBeNull();
  });
  test("requires explicit project", () => {
    expect(assertStagingProject(undefined, {})).toContain("required");
  });
  test("refuses production", () => {
    expect(assertStagingProject("lyfelabz-prod", {})).toContain("refusing project 'lyfelabz-prod'");
  });
  test("refuses a conflicting ambient project", () => {
    expect(assertStagingProject("lyfelabz-staging", { GCLOUD_PROJECT: "lyfelabz-prod" })).toContain("lyfelabz-prod");
    expect(assertStagingProject("lyfelabz-staging", { GOOGLE_CLOUD_PROJECT: "other" })).toContain("other");
  });
});

describe("callableUrl (staging-only endpoint derivation)", () => {
  test("builds the staging endpoint with the project interpolated", () => {
    expect(callableUrl("lyfelabz-staging", "assessmentSessionsBegin")).toBe(
      "https://us-central1-lyfelabz-staging.cloudfunctions.net/assessmentSessionsBegin",
    );
  });
  test("refuses a non-staging project", () => {
    expect(() => callableUrl("lyfelabz-prod", "x")).toThrow("non-staging");
  });
  test("refuses a malformed callable name", () => {
    expect(() => callableUrl("lyfelabz-staging", "../evil")).toThrow("malformed");
  });
});

describe("redact (no token ever reaches a log)", () => {
  test("redacts secret-named keys", () => {
    const r = redact({ authorization: "Bearer abc", idToken: "x", launchRef: "g", nested: { refreshToken: "y", safe: "keep" } }) as any;
    expect(r.authorization).toBe("<redacted>");
    expect(r.idToken).toBe("<redacted>");
    expect(r.launchRef).toBe("<redacted>");
    expect(r.nested.refreshToken).toBe("<redacted>");
    expect(r.nested.safe).toBe("keep");
  });
  test("redacts a bearer string and a JWT-shaped value", () => {
    expect(redact("Bearer eyJhbGciOi")).toBe("Bearer <redacted>");
    expect(redact("eyJhbGciOiJSUzI1NiIsImtpZCI6.eyJpc3MiOiJodHRw.SIGNATUREPART_xxxxx")).toBe("<redacted-jwt>");
  });
  test("leaves ordinary evidence untouched", () => {
    const ev = { deliveryOutcome: "differentiated", variantKey: "reading-adapted", presentationRevisionId: "prabc" };
    expect(redact(ev)).toEqual(ev);
  });
  test("STAGING_PROJECT_ID literal", () => {
    expect(STAGING_PROJECT_ID).toBe("lyfelabz-staging");
  });
});
