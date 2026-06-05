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

  it("merges the adapter into a copied boilerplate that ships its own config (no adapter)", async () => {
    const source = await tmpDir();
    const dir = path.join(await tmpDir(), "out");
    try {
      // A boilerplate that already has astro.config.mjs + package.json, neither
      // mentioning the Node adapter — the create-from-scratch templates won't run.
      await fs.writeFile(
        path.join(source, "astro.config.mjs"),
        `import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

export default defineConfig({
  integrations: [vue()],
});
`,
        "utf-8"
      );
      await fs.writeJson(path.join(source, "package.json"), {
        name: "shipped",
        dependencies: { "@astrojs/vue": "^5.0.0", astro: "^5.0.0", vue: "^3.5.14" },
      });

      await setupBoilerplate(source, dir, "astro-vue", true);

      const config = await fs.readFile(path.join(dir, "astro.config.mjs"), "utf-8");
      expect(config).toContain("import node from '@astrojs/node'");
      expect(config).toContain("adapter: node({ mode: 'standalone' })");
      // Existing vue integration must be preserved.
      expect(config).toContain("integrations: [vue()]");

      const pkg = await fs.readJson(path.join(dir, "package.json"));
      expect(pkg.dependencies["@astrojs/node"]).toBeTruthy();
      expect(pkg.dependencies["@astrojs/vue"]).toBeTruthy();
    } finally {
      await fs.remove(source);
      await fs.remove(path.dirname(dir));
    }
  });

  it("leaves a copied boilerplate untouched when the editor is disabled", async () => {
    const source = await tmpDir();
    const dir = path.join(await tmpDir(), "out");
    try {
      await fs.writeFile(
        path.join(source, "astro.config.mjs"),
        `import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

export default defineConfig({
  integrations: [vue()],
});
`,
        "utf-8"
      );
      await fs.writeJson(path.join(source, "package.json"), {
        name: "shipped",
        dependencies: { "@astrojs/vue": "^5.0.0", astro: "^5.0.0", vue: "^3.5.14" },
      });

      await setupBoilerplate(source, dir, "astro-vue", false);

      const config = await fs.readFile(path.join(dir, "astro.config.mjs"), "utf-8");
      expect(config).not.toContain("@astrojs/node");

      const pkg = await fs.readJson(path.join(dir, "package.json"));
      expect(pkg.dependencies["@astrojs/node"]).toBeUndefined();
    } finally {
      await fs.remove(source);
      await fs.remove(path.dirname(dir));
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
