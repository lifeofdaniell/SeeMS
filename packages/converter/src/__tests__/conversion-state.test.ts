import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { conversionStatePath } from "../generated-state";
import {
  loadConversionState,
  writeConversionState,
  hashSourceFiles,
} from "../conversion-state";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "see-ms-conv-state-test-"));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe("conversionStatePath", () => {
  it("points to .see-ms/state.json", () => {
    expect(conversionStatePath("/projects/my-site")).toBe(
      "/projects/my-site/.see-ms/state.json"
    );
  });
});

describe("writeConversionState / loadConversionState", () => {
  it("returns undefined when no state file exists", async () => {
    expect(await loadConversionState(tmpDir)).toBeUndefined();
  });

  it("creates .see-ms/ if it does not exist", async () => {
    await writeConversionState(tmpDir, {
      inputDir: "/tmp/webflow-export",
      target: "astro-vue",
      extractComponents: false,
      sources: {},
    });
    expect(await fs.pathExists(path.join(tmpDir, ".see-ms"))).toBe(true);
  });

  it("writes to .see-ms/state.json", async () => {
    await writeConversionState(tmpDir, {
      inputDir: "/tmp/webflow-export",
      target: "astro-vue",
      extractComponents: false,
      sources: {},
    });
    expect(
      await fs.pathExists(path.join(tmpDir, ".see-ms", "state.json"))
    ).toBe(true);
  });

  it("round-trips all fields correctly", async () => {
    const sources = { "index.html": "abc123", "about.html": "def456" };
    const collections = [{ className: "c-blogpost", name: "BlogPost" }];
    await writeConversionState(tmpDir, {
      inputDir: "/tmp/webflow-export",
      target: "astro-vue",
      extractComponents: true,
      collections,
      sources,
    });
    const state = await loadConversionState(tmpDir);
    expect(state?.version).toBe(1);
    expect(state?.inputDir).toBe("/tmp/webflow-export");
    expect(state?.target).toBe("astro-vue");
    expect(state?.extractComponents).toBe(true);
    expect(state?.collections).toEqual(collections);
    expect(state?.sources).toEqual(sources);
    expect(typeof state?.convertedAt).toBe("string");
  });

  it("stores empty collections array when skipped", async () => {
    await writeConversionState(tmpDir, {
      inputDir: "/tmp/webflow-export",
      target: "astro-vue",
      extractComponents: false,
      collections: [],
      sources: {},
    });
    const state = await loadConversionState(tmpDir);
    expect(state?.collections).toEqual([]);
  });

  it("returns undefined for corrupt JSON", async () => {
    await fs.ensureDir(path.join(tmpDir, ".see-ms"));
    await fs.writeFile(
      path.join(tmpDir, ".see-ms", "state.json"),
      "not json"
    );
    expect(await loadConversionState(tmpDir)).toBeUndefined();
  });
});

describe("hashSourceFiles", () => {
  it("returns empty object for empty directory", async () => {
    expect(await hashSourceFiles(tmpDir)).toEqual({});
  });

  it("ignores non-HTML files", async () => {
    await fs.writeFile(path.join(tmpDir, "style.css"), "body {}");
    await fs.writeFile(path.join(tmpDir, "script.js"), "console.log()");
    expect(await hashSourceFiles(tmpDir)).toEqual({});
  });

  it("hashes HTML files keyed by relative posix path", async () => {
    await fs.writeFile(path.join(tmpDir, "index.html"), "<html><body>hello</body></html>");
    const result = await hashSourceFiles(tmpDir);
    expect(Object.keys(result)).toContain("index.html");
    expect(typeof result["index.html"]).toBe("string");
    expect(result["index.html"].length).toBeGreaterThan(0);
  });

  it("hashes files in subdirectories with posix paths", async () => {
    await fs.ensureDir(path.join(tmpDir, "creating-value"));
    await fs.writeFile(
      path.join(tmpDir, "creating-value", "reports.html"),
      "<html><body>reports</body></html>"
    );
    const result = await hashSourceFiles(tmpDir);
    expect(Object.keys(result)).toContain("creating-value/reports.html");
  });

  it("same content produces same hash", async () => {
    const html = "<html><body>hello</body></html>";
    await fs.writeFile(path.join(tmpDir, "a.html"), html);
    await fs.writeFile(path.join(tmpDir, "b.html"), html);
    const result = await hashSourceFiles(tmpDir);
    expect(result["a.html"]).toBe(result["b.html"]);
  });

  it("different content produces different hash", async () => {
    await fs.writeFile(path.join(tmpDir, "a.html"), "<html><body>hello</body></html>");
    await fs.writeFile(path.join(tmpDir, "b.html"), "<html><body>world</body></html>");
    const result = await hashSourceFiles(tmpDir);
    expect(result["a.html"]).not.toBe(result["b.html"]);
  });

  it("strips Webflow volatile attributes before hashing", async () => {
    const base = `<html><body><div class="nav">content</div></body></html>`;
    const withNoise = `<html><body><div class="nav" data-w-id="abc123" data-wf-page="xyz" data-wf-site="site1">content</div></body></html>`;
    await fs.writeFile(path.join(tmpDir, "clean.html"), base);
    await fs.writeFile(path.join(tmpDir, "noisy.html"), withNoise);
    const result = await hashSourceFiles(tmpDir);
    expect(result["clean.html"]).toBe(result["noisy.html"]);
  });

  it("re-export with no real changes produces same hashes", async () => {
    const html = `<html><body><nav data-w-id="old-id">Nav</nav></body></html>`;
    const reExported = `<html><body><nav data-w-id="new-id">Nav</nav></body></html>`;
    await fs.writeFile(path.join(tmpDir, "index.html"), html);
    const first = await hashSourceFiles(tmpDir);
    await fs.writeFile(path.join(tmpDir, "index.html"), reExported);
    const second = await hashSourceFiles(tmpDir);
    expect(first["index.html"]).toBe(second["index.html"]);
  });
});
