import { describe, it, expect } from "vitest";
import { minimalConfig } from "../config";

describe("minimalConfig", () => {
  it("returns empty object for empty config", () => {
    expect(minimalConfig({})).toEqual({});
  });

  it("keeps all explicitly set values", () => {
    const result = minimalConfig({
      target: "astro-vue",
      cms: { provider: "strapi" },
      editor: { enabled: true },
    });
    expect(result.target).toBe("astro-vue");
    expect(result.cms?.provider).toBe("strapi");
    expect(result.editor?.enabled).toBe(true);
  });

  it("strips empty arrays", () => {
    const result = minimalConfig({
      collections: [],
      components: { rules: [], exclude: [] },
    });
    expect(result.collections).toBeUndefined();
    expect(result.components?.rules).toBeUndefined();
    expect(result.components?.exclude).toBeUndefined();
  });

  it("keeps non-empty arrays", () => {
    const result = minimalConfig({
      collections: [{ className: "c-blogpost", name: "BlogPost" }],
    });
    expect(result.collections).toHaveLength(1);
  });

  it("strips empty nested objects after empty array removal", () => {
    const result = minimalConfig({
      components: { rules: [], exclude: [] },
    });
    expect(result.components).toBeUndefined();
  });

  it("keeps nested objects that still have values after stripping", () => {
    const result = minimalConfig({
      components: { enabled: false, rules: [] },
    });
    expect(result.components?.enabled).toBe(false);
    expect(result.components?.rules).toBeUndefined();
  });
});
