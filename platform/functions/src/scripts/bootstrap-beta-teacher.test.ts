// Regression coverage for the internal-beta bootstrap script. The
// canonical `requireDistrictContext` helper reads
// `schools/{schoolId}.districtId` (see
// `../shared/auth/require-district-context.ts`), so the bootstrap MUST
// write the beta school under that canonical field name. The earlier
// bootstrap wrote `district`, which caused every district-scoped
// callable (including `classesCreate`) to reject the beta teacher with
// `district-unassigned`. These tests fail the build if that regression
// returns.

import {
  BETA_DISTRICT_ID,
  BETA_SCHOOL,
  BETA_SCHOOL_ID,
} from "./bootstrap-beta-teacher";

describe("bootstrap-beta-teacher canonical shape", () => {
  it("declares the canonical beta district identifier", () => {
    expect(BETA_DISTRICT_ID).toBe("district-beta");
    expect(BETA_SCHOOL_ID).toBe("school-beta");
  });

  it("writes the school's district under the canonical districtId field", () => {
    expect(BETA_SCHOOL.districtId).toBe(BETA_DISTRICT_ID);
  });

  it("does not carry the legacy district field name", () => {
    expect(BETA_SCHOOL).not.toHaveProperty("district");
  });

  it("supplies every required SchoolRecord field (name, shortName, timezone)", () => {
    expect(BETA_SCHOOL.name).toBe("LyfeLabz Beta School");
    expect(BETA_SCHOOL.shortName).toBe("Beta");
    expect(BETA_SCHOOL.timezone).toBe("America/New_York");
  });
});
