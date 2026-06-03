import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import {
  buildUniqueSelector,
  buildFullPath,
  isEditableLeaf,
  determineFieldType,
  detectEditableFields,
} from "../detector";
import { extractContentFromHTML } from "../content-extractor";

/**
 * Regression coverage for the selector generation that caused content
 * over-capture: deeply-nested Webflow markup with reused class names fell
 * through to a positional path that was truncated to 4 levels, never anchored,
 * and returned without verifying uniqueness. At extraction time `$(selector)`
 * then matched several elements, `.first()` landed on the wrong one (often a
 * container), and `.text()` slurped the whole subtree.
 *
 * The core contract every selector must satisfy:
 *   $(selector) resolves to EXACTLY ONE element, and it is the intended one.
 */

/** Reused-class, deeply-nested fixture (mirrors the Webflow structure). */
const REUSED_CLASS_HTML = `
<body>
  <header>
    <div class="wrap"><div class="inner"><div class="col"><div class="txt"><p class="t">NavOne</p></div></div></div></div>
    <div class="wrap"><div class="inner"><div class="col"><div class="txt"><p class="t" data-test="target">NavTwo</p></div></div></div></div>
  </header>
  <footer>
    <div class="wrap"><div class="inner"><div class="col"><div class="txt"><p class="t">FootOne</p></div></div></div></div>
  </footer>
</body>`;

function selectorIsUnique(html: string, selector: string): boolean {
  return cheerio.load(html)(selector).length === 1;
}

describe("buildUniqueSelector — uniqueness contract", () => {
  it("returns an id selector when the element has a unique id", () => {
    const $ = cheerio.load(`<body><div id="hero">x</div><div>y</div></body>`);
    const sel = buildUniqueSelector($, $("#hero"));
    expect(sel).toBe("#hero");
    expect($(sel).length).toBe(1);
  });

  it("returns a data-cms selector when present", () => {
    const $ = cheerio.load(`<body><div data-cms="title">x</div></body>`);
    const sel = buildUniqueSelector($, $('[data-cms="title"]'));
    expect($(sel).length).toBe(1);
    expect($(sel).attr("data-cms")).toBe("title");
  });

  it("returns a single unique class selector when one exists", () => {
    const $ = cheerio.load(`<body><h1 class="page-title">x</h1><p class="body">y</p></body>`);
    const sel = buildUniqueSelector($, $(".page-title"));
    expect($(sel).length).toBe(1);
    expect($(sel).text()).toBe("x");
  });

  it("resolves to EXACTLY ONE element for reused-class deep nesting", () => {
    const $ = cheerio.load(REUSED_CLASS_HTML);
    const $target = $('[data-test="target"]');
    const sel = buildUniqueSelector($, $target);

    // Must be unique...
    expect($(sel).length).toBe(1);
    // ...and must resolve to the intended element, not a sibling/container.
    expect($(sel).text().trim()).toBe("NavTwo");
  });

  it("never returns a selector that matches multiple elements", () => {
    const $ = cheerio.load(REUSED_CLASS_HTML);
    // Every leaf <p> must get its own unique selector.
    const texts = ["NavOne", "NavTwo", "FootOne"];
    for (const t of texts) {
      const $el = $("p").filter((_, el) => $(el).text().trim() === t);
      const sel = buildUniqueSelector($, $el);
      expect($(sel).length, `selector for "${t}" => ${sel}`).toBe(1);
      expect($(sel).text().trim()).toBe(t);
    }
  });
});

describe("buildFullPath — anchored & unique", () => {
  it("produces a selector matching exactly one element for a deep leaf", () => {
    const $ = cheerio.load(REUSED_CLASS_HTML);
    const $target = $('[data-test="target"]');
    const sel = buildFullPath($, $target);
    expect(selectorIsUnique(REUSED_CLASS_HTML, sel)).toBe(true);
    expect($(sel).text().trim()).toBe("NavTwo");
  });

  it("disambiguates repeated sibling structures", () => {
    const $ = cheerio.load(`
      <body><main>
        <section><div><span>a</span></div></section>
        <section><div><span>b</span></div></section>
        <section><div><span>c</span></div></section>
      </main></body>`);
    const $b = $("span").filter((_, el) => $(el).text() === "b");
    const sel = buildFullPath($, $b);
    expect($(sel).length).toBe(1);
    expect($(sel).text()).toBe("b");
  });
});

describe("isEditableLeaf", () => {
  it("is true for an element with text and no child elements", () => {
    const $ = cheerio.load(`<body><p>hello</p></body>`);
    expect(isEditableLeaf($("p"))).toBe(true);
  });

  it("is false for an element that contains child elements", () => {
    const $ = cheerio.load(`<body><div><span>x</span></div></body>`);
    expect(isEditableLeaf($("div"))).toBe(false);
  });

  it("is false for an empty element", () => {
    const $ = cheerio.load(`<body><div>   </div></body>`);
    expect(isEditableLeaf($("div"))).toBe(false);
  });
});

describe("determineFieldType", () => {
  it("classifies plain text as plain", () => {
    const $ = cheerio.load(`<body><p>just text</p></body>`);
    expect(determineFieldType($("p"), "p")).toBe("plain");
  });

  it("classifies inline-formatted text as rich", () => {
    const $ = cheerio.load(`<body><p>hi <strong>there</strong></p></body>`);
    expect(determineFieldType($("p"), "p")).toBe("rich");
  });

  it("classifies an anchor as link", () => {
    const $ = cheerio.load(`<body><a href="/x">go</a></body>`);
    expect(determineFieldType($("a"), "a")).toBe("link");
  });
});

describe("detect + extract integration — no over-capture", () => {
  it("every detected field selector resolves to exactly one element", () => {
    const { fields } = detectEditableFields(REUSED_CLASS_HTML);
    const $ = cheerio.load(REUSED_CLASS_HTML);
    for (const [name, field] of Object.entries(fields)) {
      expect($(field.selector).length, `${name} => ${field.selector}`).toBe(1);
    }
  });

  it("extracts each leaf's own text, with no duplicated blobs", () => {
    const { fields, collections } = detectEditableFields(REUSED_CLASS_HTML);
    const content = extractContentFromHTML(REUSED_CLASS_HTML, "test", {
      fields,
      collections,
    } as any);

    const values = Object.values(content.fields).filter(
      (v): v is string => typeof v === "string"
    );

    // We expect the three distinct nav/footer labels, each captured once.
    expect(values.sort()).toEqual(["FootOne", "NavOne", "NavTwo"]);

    // No value should contain another value (the signature of a container slurp).
    for (const a of values) {
      for (const b of values) {
        if (a !== b) expect(a.includes(b)).toBe(false);
      }
    }
  });
});

describe("extractor safety net — plain fields never slurp a subtree", () => {
  it("returns only direct text when a plain selector lands on a container", () => {
    const html = `<body><div class="box">Header<span>ignored child</span></div></body>`;
    const content = extractContentFromHTML(html, "test", {
      fields: {
        heading: { selector: ".box", type: "plain", editable: true, source: "auto" },
      },
      collections: {},
    } as any);
    expect(content.fields.heading).toBe("Header");
  });
});
