/**
 * @jest-environment node
 *
 * Sprint 29B / 29E.2 - Public legal surfaces (Privacy Policy + Terms of Use).
 *
 * These are configuration/contract pins, not verbatim legal-text assertions.
 * They verify that the canonical legal pages exist at their clean-path filenames
 * (privacy.html / terms.html), that Firebase Hosting is configured to serve
 * them directly at /privacy and /terms on app.lyfelabz.com, that the old
 * about_privacy.html / about_terms.html filenames redirect to the clean paths,
 * that the canonical public surfaces link to the clean paths, and that the
 * pages follow the repository style rule (no em dashes). The bodies are
 * intentionally free-form so copy can be refined without churning tests.
 *
 * GitHub Pages clean-path behavior: privacy.html is served at /privacy
 * (extensionless) by the GitHub Pages hosting layer. This is standard Pages
 * behavior for .html files at the repo root. Actual live behavior can only be
 * confirmed after the commit is pushed; these tests verify the repository
 * structure that enables it.
 */
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("Sprint 29E.2 public legal surfaces", () => {
  // ── Canonical content files ────────────────────────────────────────────────

  test("privacy.html exists at repository root and contains the Privacy Policy", () => {
    const html = read("privacy.html");
    expect(html).toContain("Privacy Policy");
    expect(html).toContain("Effective Date: August 30, 2026");
    expect(html).toContain("privacy@lyfelabz.com");
  });

  test("terms.html exists at repository root and contains the Terms of Use", () => {
    const html = read("terms.html");
    expect(html).toContain("Terms of Use");
    expect(html).toContain("Effective Date: August 30, 2026");
    expect(html).toContain("privacy@lyfelabz.com");
  });

  test("privacy.html contains explicit Jekyll permalink for /privacy", () => {
    const html = read("privacy.html");
    expect(html).toContain("permalink: /privacy");
  });

  test("terms.html contains explicit Jekyll permalink for /terms", () => {
    const html = read("terms.html");
    expect(html).toContain("permalink: /terms");
  });

  test("privacy.html declares the /privacy canonical URL", () => {
    const html = read("privacy.html");
    expect(html).toContain(
      '<link rel="canonical" href="https://lyfelabz.com/privacy">',
    );
  });

  test("terms.html declares the /terms canonical URL", () => {
    const html = read("terms.html");
    expect(html).toContain(
      '<link rel="canonical" href="https://lyfelabz.com/terms">',
    );
  });

  test("privacy.html covers Google user-data disclosures", () => {
    const html = read("privacy.html");
    expect(html).toContain("classroom.courses.readonly");
    expect(html).toContain("classroom.rosters.readonly");
    expect(html).toContain("classroom.coursework.students");
    expect(html).toContain("Google API Services User Data Policy");
    expect(html.toLowerCase()).toContain("never sends grades");
    expect(html.toLowerCase()).toContain("does not sell");
  });

  test("terms.html covers the expected sections", () => {
    const html = read("terms.html");
    expect(html).toContain("Acceptable Use");
    expect(html).toContain("Google Classroom Integration");
    expect(html).toContain("Intellectual Property");
  });

  // ── Compatibility redirect stubs ───────────────────────────────────────────

  test("about_privacy.html exists and redirects to /privacy", () => {
    const html = read("about_privacy.html");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("url=/privacy");
  });

  test("about_terms.html exists and redirects to /terms", () => {
    const html = read("about_terms.html");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("url=/terms");
  });

  test("about_privacy.html stub contains a visible fallback link to /privacy", () => {
    const html = read("about_privacy.html");
    expect(html).toContain('href="/privacy"');
  });

  test("about_terms.html stub contains a visible fallback link to /terms", () => {
    const html = read("about_terms.html");
    expect(html).toContain('href="/terms"');
  });

  test("about_privacy.html stub has the /privacy canonical", () => {
    const html = read("about_privacy.html");
    expect(html).toContain(
      '<link rel="canonical" href="https://lyfelabz.com/privacy">',
    );
  });

  test("about_terms.html stub has the /terms canonical", () => {
    const html = read("about_terms.html");
    expect(html).toContain(
      '<link rel="canonical" href="https://lyfelabz.com/terms">',
    );
  });

  // ── Firebase Hosting configuration ─────────────────────────────────────────

  test("Firebase Hosting redirects /privacy to the canonical apex URL (301)", () => {
    const config = JSON.parse(read("firebase.json")) as {
      hosting?: { redirects?: Array<{ source: string; destination: string; type: number }> };
    };
    const redirects = config.hosting?.redirects ?? [];
    const privacy = redirects.find((r) => r.source === "/privacy");
    expect(privacy?.destination).toBe("https://lyfelabz.com/privacy");
    expect(privacy?.type).toBe(301);
  });

  test("Firebase Hosting redirects /terms to the canonical apex URL (301)", () => {
    const config = JSON.parse(read("firebase.json")) as {
      hosting?: { redirects?: Array<{ source: string; destination: string; type: number }> };
    };
    const redirects = config.hosting?.redirects ?? [];
    const terms = redirects.find((r) => r.source === "/terms");
    expect(terms?.destination).toBe("https://lyfelabz.com/terms");
    expect(terms?.type).toBe(301);
  });

  test("Firebase Hosting does not rewrite /privacy or /terms to local files", () => {
    const config = JSON.parse(read("firebase.json")) as {
      hosting?: { rewrites?: Array<{ source: string; destination: string }> };
    };
    const rewrites = config.hosting?.rewrites ?? [];
    const privacy = rewrites.find((r) => r.source === "/privacy");
    const terms = rewrites.find((r) => r.source === "/terms");
    expect(privacy).toBeUndefined();
    expect(terms).toBeUndefined();
  });

  test("the /app/** rewrite is preserved", () => {
    const config = JSON.parse(read("firebase.json")) as {
      hosting?: { rewrites?: Array<{ source: string; destination: string }> };
    };
    const rewrites = config.hosting?.rewrites ?? [];
    expect(
      rewrites.some(
        (r) => r.source === "/app/**" && r.destination === "/app/index.html",
      ),
    ).toBe(true);
  });

  // ── Link integrity ─────────────────────────────────────────────────────────

  test("the public homepage footer links to the clean /privacy and /terms routes", () => {
    const html = read("index.html");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  test("the sitemap lists the canonical /privacy and /terms routes", () => {
    const xml = read("sitemap.xml");
    expect(xml).toContain("<loc>https://lyfelabz.com/privacy</loc>");
    expect(xml).toContain("<loc>https://lyfelabz.com/terms</loc>");
  });

  // ── Style and quality rules ────────────────────────────────────────────────

  test("the canonical legal pages contain no em dashes (repository style rule)", () => {
    const emDash = String.fromCharCode(0x2014);
    expect(read("privacy.html")).not.toContain(emDash);
    expect(read("terms.html")).not.toContain(emDash);
  });

  test("no unresolved release-blocking placeholder remains in either canonical legal page", () => {
    for (const page of ["privacy.html", "terms.html"]) {
      const html = read(page);
      expect(html).not.toContain("TO CONFIRM");
      expect(html).not.toContain("legal-placeholder");
      expect(html).not.toContain("TBD");
    }
  });

  test("the Privacy Policy makes no unsupported Google-approval or compliance claim", () => {
    const html = read("privacy.html").toLowerCase();
    expect(html).not.toContain("google has approved");
    expect(html).not.toContain("google-approved");
    expect(html).not.toContain("ferpa compliant");
    expect(html).not.toContain("coppa compliant");
  });
});
