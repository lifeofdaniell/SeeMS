import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import {
  seeMsDir,
  generatedStatePath,
  seedDataPath,
  schemasDir,
  strapiBootstrapDir,
  reportJsonPath,
  reportMdPath,
  loadGeneratedFileState,
  writeGeneratedFileState,
} from "../generated-state";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "see-ms-state-test-"));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe("seeMsDir", () => {
  it("returns .see-ms subdirectory of outputDir", () => {
    expect(seeMsDir("/projects/my-site")).toBe("/projects/my-site/.see-ms");
  });
});

describe("generatedStatePath", () => {
  it("points to .see-ms/generated.json", () => {
    expect(generatedStatePath("/projects/my-site")).toBe(
      "/projects/my-site/.see-ms/generated.json"
    );
  });

  it("does not point to the old flat location", () => {
    expect(generatedStatePath("/projects/my-site")).not.toContain(
      ".see-ms-generated.json"
    );
  });
});

describe("path helpers", () => {
  const out = "/projects/my-site";

  it("seedDataPath points to .see-ms/seed/seed-data.json", () => {
    expect(seedDataPath(out)).toBe(`${out}/.see-ms/seed/seed-data.json`);
  });

  it("schemasDir points to .see-ms/schemas", () => {
    expect(schemasDir(out)).toBe(`${out}/.see-ms/schemas`);
  });

  it("strapiBootstrapDir points to .see-ms/strapi-bootstrap", () => {
    expect(strapiBootstrapDir(out)).toBe(`${out}/.see-ms/strapi-bootstrap`);
  });

  it("reportJsonPath points to .see-ms/report.json", () => {
    expect(reportJsonPath(out)).toBe(`${out}/.see-ms/report.json`);
  });

  it("reportMdPath points to .see-ms/report.md", () => {
    expect(reportMdPath(out)).toBe(`${out}/.see-ms/report.md`);
  });
});

describe("writeGeneratedFileState", () => {
  it("creates .see-ms/ directory if it does not exist", async () => {
    await writeGeneratedFileState(tmpDir, "nuxt", ["pages/index.vue"]);
    expect(await fs.pathExists(path.join(tmpDir, ".see-ms"))).toBe(true);
  });

  it("writes to .see-ms/generated.json", async () => {
    await writeGeneratedFileState(tmpDir, "nuxt", ["pages/index.vue"]);
    expect(
      await fs.pathExists(path.join(tmpDir, ".see-ms", "generated.json"))
    ).toBe(true);
  });

  it("sorts files alphabetically", async () => {
    await writeGeneratedFileState(tmpDir, "nuxt", [
      "pages/z.vue",
      "pages/a.vue",
      "pages/m.vue",
    ]);
    const state = await loadGeneratedFileState(tmpDir);
    expect(state?.files).toEqual(["pages/a.vue", "pages/m.vue", "pages/z.vue"]);
  });

  it("deduplicates files", async () => {
    await writeGeneratedFileState(tmpDir, "nuxt", [
      "pages/index.vue",
      "pages/index.vue",
    ]);
    const state = await loadGeneratedFileState(tmpDir);
    expect(state?.files).toHaveLength(1);
  });
});

describe("loadGeneratedFileState", () => {
  it("returns undefined when no state file exists", async () => {
    expect(await loadGeneratedFileState(tmpDir)).toBeUndefined();
  });

  it("round-trips state correctly", async () => {
    await writeGeneratedFileState(tmpDir, "nuxt", [
      "pages/index.vue",
      "pages/about.vue",
    ]);
    const state = await loadGeneratedFileState(tmpDir);
    expect(state?.version).toBe(1);
    expect(state?.target).toBe("nuxt");
    expect(state?.files).toEqual(["pages/about.vue", "pages/index.vue"]);
    expect(typeof state?.updatedAt).toBe("string");
  });

  it("round-trips astro-vue target", async () => {
    await writeGeneratedFileState(tmpDir, "astro-vue", ["src/pages/index.astro"]);
    const state = await loadGeneratedFileState(tmpDir);
    expect(state?.target).toBe("astro-vue");
  });

  it("returns undefined for corrupt JSON", async () => {
    await fs.ensureDir(path.join(tmpDir, ".see-ms"));
    await fs.writeFile(
      path.join(tmpDir, ".see-ms", "generated.json"),
      "not json"
    );
    expect(await loadGeneratedFileState(tmpDir)).toBeUndefined();
  });

  it("returns undefined if files field is missing", async () => {
    await fs.ensureDir(path.join(tmpDir, ".see-ms"));
    await fs.writeJson(path.join(tmpDir, ".see-ms", "generated.json"), {
      version: 1,
      target: "nuxt",
    });
    expect(await loadGeneratedFileState(tmpDir)).toBeUndefined();
  });
});

describe("migration from .see-ms-generated.json", () => {
  it("reads old file when new path does not exist", async () => {
    await fs.writeJson(path.join(tmpDir, ".see-ms-generated.json"), {
      version: 1,
      target: "nuxt",
      updatedAt: "2024-01-01T00:00:00.000Z",
      files: ["pages/index.vue", "pages/about.vue"],
    });
    const state = await loadGeneratedFileState(tmpDir);
    expect(state?.target).toBe("nuxt");
    expect(state?.files).toContain("pages/index.vue");
  });

  it("prefers new path over old file when both exist", async () => {
    await fs.writeJson(path.join(tmpDir, ".see-ms-generated.json"), {
      version: 1,
      target: "nuxt",
      updatedAt: "2024-01-01T00:00:00.000Z",
      files: ["pages/old.vue"],
    });
    await writeGeneratedFileState(tmpDir, "astro-vue", ["src/pages/new.astro"]);
    const state = await loadGeneratedFileState(tmpDir);
    expect(state?.target).toBe("astro-vue");
    expect(state?.files).toContain("src/pages/new.astro");
    expect(state?.files).not.toContain("pages/old.vue");
  });

  it("writes to new path automatically after migrating", async () => {
    await fs.writeJson(path.join(tmpDir, ".see-ms-generated.json"), {
      version: 1,
      target: "nuxt",
      updatedAt: "2024-01-01T00:00:00.000Z",
      files: ["pages/index.vue"],
    });
    await loadGeneratedFileState(tmpDir);
    expect(
      await fs.pathExists(path.join(tmpDir, ".see-ms", "generated.json"))
    ).toBe(true);
  });
});
