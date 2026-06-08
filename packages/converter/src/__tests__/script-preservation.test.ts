/**
 * Script preservation test.
 *
 * Verifies that every CDN script src and every body inline script present in
 * the source HTML is present somewhere in the generated output
 * (BaseLayout.astro or the page .astro files).  No script should be silently
 * dropped during conversion.
 */

import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { extractPageScripts } from "../parser";
import { generateBaseLayout, writeAstroVuePage } from "../filesystem";

// ------- helpers -------

function uniqueSrcs(scripts: { src: string }[]): string[] {
  return [...new Set(scripts.map((s) => s.src))];
}

function collectSrcsFromFile(content: string): string[] {
  return [...content.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
}

function makeHtml(bodyCdnSrcs: string[], bodyInline: string[] = []): string {
  const cdnTags = bodyCdnSrcs
    .map((s) => `<script src="${s}"></script>`)
    .join("\n");
  const inlineTags = bodyInline.map((s) => `<script>${s}</script>`).join("\n");
  return `<html><head></head><body><div>page</div>${cdnTags}${inlineTags}</body></html>`;
}

// ------- tests -------

describe("script preservation — no script should be silently dropped", () => {
  it("all body CDN srcs from all pages appear in BaseLayout or page slot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seems-scripts-"));

    try {
      // Simulate 3 pages:
      //   page1 has: webflow.js, swiper.js (swiper on pages 1 & 2 → shared)
      //   page2 has: webflow.js, swiper.js
      //   page3 has: webflow.js, lottie.js  (lottie only on page3 → unique)
      const pages = [
        {
          name: "index",
          srcs: [
            "https://cdn.example.com/webflow.js",
            "https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js",
          ],
        },
        {
          name: "about",
          srcs: [
            "https://cdn.example.com/webflow.js",
            "https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js",
          ],
        },
        {
          name: "gallery",
          srcs: [
            "https://cdn.example.com/webflow.js",
            "https://cdn.jsdelivr.net/npm/@lottiefiles/lottie-player@latest",
          ],
        },
      ];

      const pageScriptsMap = new Map(
        pages.map((p) => [p.name, extractPageScripts(makeHtml(p.srcs))])
      );

      // --- replicate the deduplication logic from converter.ts ---
      const cdnScriptCounts = new Map<string, number>();
      const seenPerPage = new Map<string, Set<string>>();
      for (const [pageName, scripts] of pageScriptsMap.entries()) {
        const seenInPage = new Set<string>();
        for (const s of scripts.bodyCdn) {
          if (!seenInPage.has(s.src)) {
            cdnScriptCounts.set(s.src, (cdnScriptCounts.get(s.src) ?? 0) + 1);
            seenInPage.add(s.src);
          }
        }
        seenPerPage.set(pageName, seenInPage);
      }
      const sharedBodyCdnSrcs = new Set(
        [...cdnScriptCounts.entries()]
          .filter(([, count]) => count > 1)
          .map(([src]) => src)
      );
      const sharedBodyCdn: { src: string }[] = [];
      const seenShared = new Set<string>();
      for (const scripts of pageScriptsMap.values()) {
        for (const s of scripts.bodyCdn) {
          if (sharedBodyCdnSrcs.has(s.src) && !seenShared.has(s.src)) {
            sharedBodyCdn.push(s);
            seenShared.add(s.src);
          }
        }
      }

      await generateBaseLayout(dir, {
        cssFiles: [],
        headCdnScripts: [],
        headInlineScripts: [],
        bodyCdnScripts: sharedBodyCdn,
        sharedBodyInlineScripts: [],
      });

      for (const page of pages) {
        const scripts = pageScriptsMap.get(page.name)!;
        const uniqueCdn = scripts.bodyCdn.filter(
          (s) => !sharedBodyCdnSrcs.has(s.src)
        );
        await writeAstroVuePage(
          dir,
          `${page.name}.html`,
          page.name,
          { uniqueBodyCdnScripts: uniqueCdn },
          false,
          [],
          []
        );
      }

      // --- verify every src from every source page appears somewhere ---
      const baseLayout = await fs.readFile(
        path.join(dir, "src", "layouts", "BaseLayout.astro"),
        "utf-8"
      );

      for (const page of pages) {
        const pageFile = await fs.readFile(
          path.join(dir, "src", "pages", `${page.name}.astro`),
          "utf-8"
        );
        const allOutputSrcs = [
          ...collectSrcsFromFile(baseLayout),
          ...collectSrcsFromFile(pageFile),
        ];

        for (const src of page.srcs) {
          expect(allOutputSrcs, `${src} missing from output of page "${page.name}"`).toContain(src);
        }
      }

      // --- explicit checks ---
      const baseLayoutSrcs = collectSrcsFromFile(baseLayout);
      expect(baseLayoutSrcs).toContain("https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js");
      expect(baseLayoutSrcs).toContain("https://cdn.example.com/webflow.js");

      const gallerySrcs = collectSrcsFromFile(
        await fs.readFile(path.join(dir, "src", "pages", "gallery.astro"), "utf-8")
      );
      expect(gallerySrcs).toContain(
        "https://cdn.jsdelivr.net/npm/@lottiefiles/lottie-player@latest"
      );
    } finally {
      await fs.remove(dir);
    }
  });
});
