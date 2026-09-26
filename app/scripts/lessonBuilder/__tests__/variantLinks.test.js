/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

const { relocateHtml, relocateReference, isRelativeReference } = require("../variantLinks.cjs");

describe("variantLinks - relative reference relocation", () => {
  test("relocates relative markup references to their /app/lessons/ targets", () => {
    const html =
      '<a href="index.html">Home</a><a href="index.html#geo">Geo</a>' +
      '<a href="lesson_other.html?x=1#top">Other</a><img src="images/d.png" alt="d">' +
      '<link rel="icon" href="favicon.ico"><a href="../about.html">About</a>' +
      "<a href='single.html'>S</a><use xlink:href=\"sprites.svg#i\"></use>";
    const { html: out, rewritten } = relocateHtml(html);
    expect(out).toContain('href="/app/lessons/index.html"');
    expect(out).toContain('href="/app/lessons/index.html#geo"');
    expect(out).toContain('href="/app/lessons/lesson_other.html?x=1#top"');
    expect(out).toContain('src="/app/lessons/images/d.png"');
    expect(out).toContain('href="/app/lessons/favicon.ico"');
    expect(out).toContain('href="/app/about.html"');
    expect(out).toContain("href='/app/lessons/single.html'");
    expect(out).toContain('xlink:href="/app/lessons/sprites.svg#i"');
    expect(rewritten).toHaveLength(8);
  });

  test("never touches fragments, queries, absolute paths, or schemes", () => {
    const html =
      '<a href="#quiz">q</a><a href="?a=1">a</a><a href="/app/">app</a>' +
      '<script defer src="/assets/r.js"></script><a href="https://x.test/y.html">x</a>' +
      '<a href="mailto:a@b.test">m</a><img src="data:image/png;base64,AAA=" alt=""><a href="//cdn.test/z.js">z</a><a href="">e</a>';
    const { html: out, rewritten } = relocateHtml(html);
    expect(out).toBe(html);
    expect(rewritten).toHaveLength(0);
  });

  test("relocates CSS url() in style blocks and style attributes but keeps fragment urls", () => {
    const html =
      '<style>.a{background:url("img/a.png")} .b{fill:url(#grad)}</style>' +
      "<div style=\"background:url('img/b.png')\"></div>";
    const { html: out } = relocateHtml(html);
    expect(out).toContain('url("/app/lessons/img/a.png")');
    expect(out).toContain("url(#grad)");
    expect(out).toContain("url('/app/lessons/img/b.png')");
  });

  test("leaves script bodies and comments byte-identical", () => {
    const script = "<script>var fxQuiz = [{q: 'Why?'}]; document.getElementById('x');</script>";
    const comment = '<!-- see index.html -->';
    const html = `${comment}<p>t</p>${script}`;
    expect(relocateHtml(html).html).toBe(html);
  });

  test("is idempotent: relocating relocated output rewrites nothing", () => {
    const once = relocateHtml('<a href="lesson_a.html">a</a><img src="i.png" alt="">').html;
    expect(relocateHtml(once).rewritten).toHaveLength(0);
    expect(relocateHtml(once).html).toBe(once);
  });

  test("refuses a <base> element (it would break in-page anchors)", () => {
    expect(() => relocateHtml('<head><base href="/app/lessons/"></head>')).toThrow(/<base>/);
  });

  test("refuses srcset with relative candidates and relative @import", () => {
    expect(() => relocateHtml('<img srcset="a.png 1x, /b.png 2x" src="/c.png" alt="">')).toThrow(/srcset/);
    expect(() => relocateHtml('<style>@import "theme.css";</style>')).toThrow(/@import/);
  });

  test("refuses scripts that carry relative URLs rather than rewriting them", () => {
    expect(() => relocateHtml("<script>location.href = 'lesson_x.html';</script>")).toThrow(/relative URL/);
    expect(() => relocateHtml("<script>go('lesson_x.html');</script>")).toThrow(/relative URL literal/);
    expect(() => relocateHtml("<script>el.innerHTML = '<a href=\"x.html\">x</a>';</script>")).toThrow(/relative URL attribute/);
    expect(() => relocateHtml("<script>location.href = '/app/lessons/lesson_x.html';</script>")).not.toThrow();
  });

  test("reference helpers", () => {
    expect(isRelativeReference("a.html")).toBe(true);
    expect(isRelativeReference("#a")).toBe(false);
    expect(isRelativeReference("javascript:void(0)")).toBe(false);
    expect(relocateReference("sub/dir/")).toBe("/app/lessons/sub/dir/");
  });
});
