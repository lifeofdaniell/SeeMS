import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { setupBoilerplate } from "../boilerplate";

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "seems-bp-"));
}

describe("setupBoilerplate — astro-vue server adapter", () => {
  it("includes @astrojs/node when the editor is enabled (its API routes need an adapter)", async () => {
    const dir = await tmpDir();
    try {
      await setupBoilerplate(undefined, dir, "astro-vue", true);

      const config = await fs.readFile(path.join(dir, "astro.config.mjs"), "utf-8");
      expect(config).toContain("import node from '@astrojs/node'");
      expect(config).toContain("adapter: node({ mode: 'standalone' })");

      const pkg = await fs.readJson(path.join(dir, "package.json"));
      expect(pkg.dependencies["@astrojs/node"]).toBeTruthy();
    } finally {
      await fs.remove(dir);
    }
  });

  it("omits the adapter when the editor is disabled (pure static build)", async () => {
    const dir = await tmpDir();
    try {
      await setupBoilerplate(undefined, dir, "astro-vue", false);

      const config = await fs.readFile(path.join(dir, "astro.config.mjs"), "utf-8");
      expect(config).not.toContain("@astrojs/node");
      expect(config).toContain("integrations: [vue()]");

      const pkg = await fs.readJson(path.join(dir, "package.json"));
      expect(pkg.dependencies["@astrojs/node"]).toBeUndefined();
    } finally {
      await fs.remove(dir);
    }
  });
});
