import { describe, it, expect } from "vitest";
import path from "path";
import { sharedComponentsDir, sharedComponentsRelDir } from "../filesystem";

describe("sharedComponentsDir", () => {
  it("puts components under src/components for astro-vue", () => {
    expect(sharedComponentsDir("/proj", "astro-vue")).toBe(path.join("/proj", "src/components"));
    expect(sharedComponentsRelDir("astro-vue")).toBe("src/components");
  });

  it("uses components/ for nuxt", () => {
    expect(sharedComponentsDir("/proj", "nuxt")).toBe(path.join("/proj", "components"));
    expect(sharedComponentsRelDir("nuxt")).toBe("components");
  });
});
