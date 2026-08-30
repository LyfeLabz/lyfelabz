/**
 * @jest-environment node
 *
 * Sprint 29B - Public legal surfaces (Privacy Policy + Terms of Use).
 *
 * These are configuration/contract pins, not verbatim legal-text assertions.
 * They verify that the public legal pages exist, that Firebase Hosting is
 * configured to serve them at stable, unauthenticated routes suitable for
 * Google OAuth configuration (/privacy, /terms), that the canonical public
 * surfaces link to them, and that the pages follow the repository style rule
 * (no em dashes). The bodies are intentionally free-form so copy can be
 * refined without churning tests.
 */
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("Sprint 29B public legal surfaces", () => {
  test("Firebase Hosting rewrites the clean /privacy and /terms routes to the legal pages", () => {
    const config = JSON.parse(read("firebase.json")) as {
      hosting?: { rewrites?: Array<{ source: string; destination: string }> };
    };
    const rewrites = config.hosting?.rewrites ?? [];
    const privacy = rewrites.find((r) => r.source === "/privacy");
    const terms = rewrites.find((r) => r.source === "/terms");
    expect(privacy?.destination).toBe("/about_privacy.html");
    expect(terms?.destination).toBe("/about_terms.html");
    // The pre-existing /app/** rewrite must be preserved.
    expect(
      rewrites.some(
        (r) => r.source === "/app/**" && r.destination === "/app/index.html",
      ),
    ).toBe(true);
  });

  test("the Privacy Policy page exists, is served from repo root, and is not Hosting-ignored", () => {
    const config = JSON.parse(read("firebase.json")) as {
      hosting?: { public?: string; ignore?: string[] };
    };
    expect(config.hosting?.public).toBe(".");
    const ignore = config.hosting?.ignore ?? [];
    // Neither legal artifact is inside an ignored path.
    expect(ignore).not.toContain("about_privacy.html");
    expect(ignore).not.toContain("about_terms.html");
    expect(() => read("about_privacy.html")).not.toThrow();
    expect(() => read("about_terms.html")).not.toThrow();
  });

  test("the Privacy Policy declares the /privacy canonical URL and covers Google user-data disclosures", () => {
    const html = read("about_privacy.html");
    expect(html).toContain(
      '<link rel="canonical" href="https://lyfelabz.com/privacy">',
    );
    // Repository-verifiable Google integration disclosures.
    expect(html).toContain("classroom.courses.readonly");
    expect(html).toContain("classroom.rosters.readonly");
    expect(html).toContain("classroom.coursework.students");
    expect(html).toContain("Google API Services User Data Policy");
    // Load-bearing accuracy claims established by the platform.
    expect(html.toLowerCase()).toContain("never sends grades");
    expect(html.toLowerCase()).toContain("does not sell");
  });

  test("the Terms of Use declares the /terms canonical URL and covers the expected sections", () => {
    const html = read("about_terms.html");
    expect(html).toContain(
      '<link rel="canonical" href="https://lyfelabz.com/terms">',
    );
    expect(html).toContain("Acceptable Use");
    expect(html).toContain("Google Classroom Integration");
    expect(html).toContain("Intellectual Property");
  });

  test("the public homepage footer links to both legal routes", () => {
    const html = read("index.html");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  test("the sitemap lists the canonical legal routes", () => {
    const xml = read("sitemap.xml");
    expect(xml).toContain("<loc>https://lyfelabz.com/privacy</loc>");
    expect(xml).toContain("<loc>https://lyfelabz.com/terms</loc>");
  });

  test("the legal pages contain no em dashes (repository style rule)", () => {
    const emDash = String.fromCharCode(0x2014);
    expect(read("about_privacy.html")).not.toContain(emDash);
    expect(read("about_terms.html")).not.toContain(emDash);
  });

  // Sprint 29B.1: the pages are finalized against the locked owner decisions.
  test("both legal pages carry the finalized effective date and contact address", () => {
    for (const page of ["about_privacy.html", "about_terms.html"]) {
      const html = read(page);
      expect(html).toContain("Effective Date: August 30, 2026");
      expect(html).toContain("privacy@lyfelabz.com");
    }
  });

  test("no unresolved release-blocking placeholder remains in either page", () => {
    for (const page of ["about_privacy.html", "about_terms.html"]) {
      const html = read(page);
      expect(html).not.toContain("TO CONFIRM");
      expect(html).not.toContain("legal-placeholder");
      expect(html).not.toContain("TBD");
    }
  });

  // Sprint 29B.1: accuracy guardrail - the public copy must not overclaim any
  // Google approval/verification or a formal compliance status.
  test("the Privacy Policy makes no unsupported Google-approval or compliance claim", () => {
    const html = read("about_privacy.html").toLowerCase();
    expect(html).not.toContain("google has approved");
    expect(html).not.toContain("google-approved");
    expect(html).not.toContain("ferpa compliant");
    expect(html).not.toContain("coppa compliant");
  });
});
