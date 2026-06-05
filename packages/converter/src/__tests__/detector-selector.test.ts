import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import {
  buildUniqueSelector,
  buildFullPath,
  buildRobustSelector,
  isEditableLeaf,
  isInlineTextContainer,
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

describe("buildRobustSelector — class-anchored & structure-resilient", () => {
  // Mirrors the real Webflow bug: repeated cards (.value/.label reused), plus an
  // earlier block with the same nested-div shape. A positional-from-root path
  // for a card field collides with the leading block; an anchored one doesn't.
  const CARDS_HTML = `
<body>
  <div class="announce"><div><div>
    <div class="cell"></div><div class="cell">ANNOUNCEMENT</div>
  </div></div></div>
  <div class="content"><div class="cards">
    <div class="card"><div class="value">A</div><div class="label">LabelA</div></div>
    <div class="card"><div class="value">B</div><div class="label">LabelB</div></div>
  </div></div>
</body>`;

  it("prefers an element's own unique class", () => {
    const $ = cheerio.load(`<body><h1 class="page-title">x</h1><p class="body">y</p></body>`);
    expect(buildRobustSelector($, $(".page-title"))).toBe(".page-title");
  });

  it("anchors a reused-class leaf to the nearest unique ancestor (unique + correct)", () => {
    const $ = cheerio.load(CARDS_HTML);
    const $b = $(".card").eq(1).find(".value");
    const sel = buildRobustSelector($, $b);
    expect($(sel).length).toBe(1);
    expect($(sel).text()).toBe("B");
    // Must carry a class/id anchor — not a bare root `div:nth-of-type(...)` chain.
    expect(/[.#]/.test(sel.split(">")[0])).toBe(true);
  });

  it("does not collide with a structurally-similar block earlier in the document", () => {
    const $ = cheerio.load(CARDS_HTML);
    const $a = $(".card").eq(0).find(".value");
    const sel = buildRobustSelector($, $a);
    expect($(sel).length).toBe(1);
    expect($(sel).text()).toBe("A");
  });

  it("survives unrelated structural changes above the element (the regression)", () => {
    // The whole point: a selector built against one DOM must keep resolving to
    // the same element after content is inserted/removed elsewhere — the failure
    // mode that corrupted seed data when a nav was extracted into a component.
    const $ = cheerio.load(CARDS_HTML);
    const sel = buildRobustSelector($, $(".card").eq(1).find(".value"));

    const shifted = CARDS_HTML.replace(
      "<body>",
      `<body><div class="injected"><div><p>new</p></div></div>`
    );
    const $shifted = cheerio.load(shifted);
    expect($shifted(sel).length).toBe(1);
    expect($shifted(sel).text()).toBe("B");
  });

  it("falls back to a unique selector for class-less deep nesting", () => {
    const $ = cheerio.load(REUSED_CLASS_HTML);
    const $target = $('[data-test="target"]');
    const sel = buildRobustSelector($, $target);
    expect($(sel).length).toBe(1);
    expect($(sel).text().trim()).toBe("NavTwo");
  });
});

describe("isInlineTextContainer — mixed text + inline children", () => {
  const $h2 = (html: string) => {
    const $ = cheerio.load(`<body>${html}</body>`);
    return { $, $el: $("h2") };
  };

  it("is true for a heading with its own text plus an inline span", () => {
    const { $, $el } = $h2(`<h2>Our <span class="text-red">Core Values</span></h2>`);
    expect(isInlineTextContainer($, $el)).toBe(true);
  });

  it("is true when the text comes after the inline child", () => {
    const { $, $el } = $h2(`<h2><span class="text-red">Recognised</span> For Excellence</h2>`);
    expect(isInlineTextContainer($, $el)).toBe(true);
  });

  it("is false for a plain leaf (no child elements)", () => {
    const { $, $el } = $h2(`<h2>Just text</h2>`);
    expect(isInlineTextContainer($, $el)).toBe(false);
  });

  it("is false when the element wraps the text in a single span (no orphan)", () => {
    const { $, $el } = $h2(`<h2><span class="text-red">All Red</span></h2>`);
    expect(isInlineTextContainer($, $el)).toBe(false);
  });

  it("is false for block-level children (a real structural container)", () => {
    const { $, $el } = $h2(`<h2>Label<div class="card">x</div></h2>`);
    expect(isInlineTextContainer($, $el)).toBe(false);
  });

  it("is true for multiple direct text runs split by <br>", () => {
    const { $, $el } = $h2(`<h2>Our Reach<br>& Local Mastery</h2>`);
    expect(isInlineTextContainer($, $el)).toBe(true);
  });

  it("yields one indexed plain field per <br>-split text run", () => {
    const html = `<body><h2 class="uc-h2">Our Reach<br>&amp; Local Mastery</h2></body>`;
    const { fields } = detectEditableFields(html);
    const entries = Object.values(fields).filter((f) => typeof f.textNodeIndex === "number");

    // Two runs → two fields with textNodeIndex 0 and 1, same selector.
    expect(entries.map((f) => f.textNodeIndex).sort()).toEqual([0, 1]);
    expect(new Set(entries.map((f) => f.selector)).size).toBe(1);

    const $ = cheerio.load(html);
    const runText = (idx: number) => {
      const el: any = $(entries[0].selector)[0];
      const runs = el.children.filter(
        (n: any) => n.type === "text" && typeof n.data === "string" && n.data.trim()
      );
      return String(runs[idx].data).replace(/\s+/g, " ").trim();
    };
    expect(runText(0)).toBe("Our Reach");
    expect(runText(1)).toBe("& Local Mastery");
  });

  it("yields TWO fields — parent's own text + the span — for a mixed heading", () => {
    const html = `<body><h2 class="uc-h2">Our <span class="text-red">Core Values</span></h2></body>`;
    const { fields } = detectEditableFields(html);
    const $ = cheerio.load(html);

    const values = Object.values(fields).map((f) => {
      const $el = $(f.selector);
      // plain extraction = direct text only
      return $el.clone().children().remove().end().text().trim();
    });

    expect(values).toContain("Our"); // the previously-orphaned parent text
    expect(values).toContain("Core Values"); // the styled span, still its own field

    // Every selector resolves to exactly one element.
    for (const f of Object.values(fields)) {
      expect($(f.selector).length).toBe(1);
    }
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
