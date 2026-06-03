import { describe, it, expect } from "vitest";
import { formatForStrapi } from "../content-extractor";

describe("formatForStrapi — seemsKey for idempotent re-seeding", () => {
  it("stamps each collection item with a deterministic seemsKey", () => {
    const extracted = {
      pages: {
        home: {
          fields: {},
          collections: {
            slides: [{ title: "A" }, { title: "B" }, { title: "C" }],
          },
        },
      },
    };

    const seed = formatForStrapi(extracted as any);

    expect(seed.slides.map((i: any) => i.seemsKey)).toEqual([
      "slides-0",
      "slides-1",
      "slides-2",
    ]);
    // original fields preserved
    expect(seed.slides[1].title).toBe("B");
  });

  it("is stable across runs (same source → same keys → upsert, not duplicate)", () => {
    const extracted = {
      pages: { p: { fields: {}, collections: { faqs: [{ q: "x" }, { q: "y" }] } } },
    };
    const a = formatForStrapi(extracted as any);
    const b = formatForStrapi(extracted as any);
    expect(a.faqs.map((i: any) => i.seemsKey)).toEqual(b.faqs.map((i: any) => i.seemsKey));
  });

  it("does not add seemsKey to single-type fields", () => {
    const extracted = {
      pages: { about: { fields: { heading: "Hi" }, collections: {} } },
    };
    const seed = formatForStrapi(extracted as any);
    expect(seed.about.seemsKey).toBeUndefined();
    expect(seed.about.heading).toBe("Hi");
  });
});
