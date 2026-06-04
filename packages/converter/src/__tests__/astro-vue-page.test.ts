import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { writeAstroVuePage } from "../filesystem";

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "seems-astro-"));
}

describe("writeAstroVuePage", () => {
  it("wires a server-side Strapi fetch and renders the content-bound .vue", async () => {
    const dir = await tmpDir();
    try {
      await writeAstroVuePage(
        dir,
        "about.html",
        "about",
        { title: "About Us", wfPage: "p1", wfSite: "s1", bodyClass: "page" },
        true
      );
      const out = await fs.readFile(path.join(dir, "src/pages/about.astro"), "utf-8");

      expect(out).toContain("import BaseLayout from");
      expect(out).toContain("import Page from '../components/pages/about.vue'");
      // server-side fetch of the page's content type
      expect(out).toContain("/api/about?populate=*");
      expect(out).toContain("import.meta.env.PUBLIC_STRAPI_URL");
      // pass fetched content into the component
      expect(out).toContain("<Page content={content} />");
      // graceful fallback so a down Strapi doesn't fail the build
      expect(out).toContain("try {");
      expect(out).toContain("catch");
      // BaseLayout metadata preserved
      expect(out).toContain('title="About Us"');
      expect(out).toContain('wfPage="p1"');
      // editor wired (preview mode)
      expect(out).toContain("import '../cms-editor'");
    } finally {
      await fs.remove(dir);
    }
  });

  it("server-renders the component (no client directive, so Webflow scripts run on real DOM)", async () => {
    const dir = await tmpDir();
    try {
      await writeAstroVuePage(dir, "index.html", "index", {}, false);
      const out = await fs.readFile(path.join(dir, "src/pages/index.astro"), "utf-8");
      expect(out).not.toMatch(/client:(load|visible|only|idle)/);
    } finally {
      await fs.remove(dir);
    }
  });

  it("fetches collections at the collapsed kebab route, stored under the underscore key", async () => {
    const dir = await tmpDir();
    try {
      await writeAstroVuePage(dir, "index.html", "index", {}, false, [
        "quantum_zenith_design_system__clock_cards",
        "section_slider_slides",
      ]);
      const out = await fs.readFile(path.join(dir, "src/pages/index.astro"), "utf-8");
      // `__` collapses to a single `-` to match the schema's pluralName route
      expect(out).toContain("/api/quantum-zenith-design-system-clock-cards?populate=*");
      expect(out).not.toContain("system--clock-cards");
      expect(out).toContain("/api/section-slider-slides?populate=*");
      // ...but stored under the original underscore key the Vue template binds
      expect(out).toContain("content['quantum_zenith_design_system__clock_cards']");
    } finally {
      await fs.remove(dir);
    }
  });

  it("pluralizes the collection route when the key doesn't end in 's' (board → boards)", async () => {
    const dir = await tmpDir();
    try {
      await writeAstroVuePage(dir, "governance.html", "governance", {}, false, ["board"]);
      const out = await fs.readFile(path.join(dir, "src/pages/governance.astro"), "utf-8");
      expect(out).toContain("/api/boards?populate=*"); // matches schema pluralName
      expect(out).not.toContain("/api/board?populate=*");
      expect(out).toContain("content['board']"); // stored under the key the Vue binds
    } finally {
      await fs.remove(dir);
    }
  });

  it("omits the editor import when the editor is disabled", async () => {
    const dir = await tmpDir();
    try {
      await writeAstroVuePage(dir, "index.html", "index", {}, false);
      const out = await fs.readFile(path.join(dir, "src/pages/index.astro"), "utf-8");
      expect(out).toContain("import Page from '../components/pages/index.vue'");
      expect(out).toContain("/api/index?populate=*");
      expect(out).not.toContain("cms-editor");
    } finally {
      await fs.remove(dir);
    }
  });

  it("resolves correct relative imports for a nested page", async () => {
    const dir = await tmpDir();
    try {
      await writeAstroVuePage(dir, "press-release/article.html", "article", {}, true);
      const out = await fs.readFile(
        path.join(dir, "src/pages/press-release/article.astro"),
        "utf-8"
      );
      expect(out).toContain("import Page from '../../components/pages/press-release/article.vue'");
      expect(out).toContain("import '../../cms-editor'");
    } finally {
      await fs.remove(dir);
    }
  });
});
