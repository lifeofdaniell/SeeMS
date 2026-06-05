import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { transformVueToReactive } from "../vue-transformer";
import type { CMSManifest } from "../manifest";

/**
 * Regression: a shared component (e.g. a nav) extracted from the very top of
 * <body> becomes a `<!--COMPONENT:...-->` marker that is the first node of the
 * page template. The HTML parser hoists a leading comment outside <html>, so
 * the old body-slicing logic dropped it — the component was imported but never
 * rendered and the nav silently disappeared (only on pages where it was the
 * first body child, e.g. transparent-hero pages). The transform must keep the
 * marker and restore it to a real tag regardless of its position.
 */
function manifest(): CMSManifest {
  return {
    version: 1,
    pages: {
      index: { route: "/", fields: {} },
    },
    global: {
      components: {
        Sitenav: {
          name: "Sitenav",
          selector: ".capital-nav",
          pages: ["index"],
          role: "shared-section",
          contentMode: "shared-global",
        },
      },
    },
  } as any;
}

async function runOn(template: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seems-marker-"));
  const file = path.join(dir, "index.vue");
  await fs.writeFile(file, `<template>\n${template}\n</template>\n`, "utf-8");
  await transformVueToReactive(file, "index", manifest(), { target: "astro-vue" });
  return fs.readFile(file, "utf-8", );
}

describe("leading component marker survives the page transform", () => {
  const TAG = `<Sitenav :content="globals && globals['sitenav']" />`;

  it("restores the tag when the marker is the FIRST node (transparent-hero pages)", async () => {
    const out = await runOn(`<!--COMPONENT:Sitenav-->\n<div class="page-wrapper">hero</div>`);
    expect(out).toContain(TAG);
    expect(out).toContain("import Sitenav from");
    // the placeholder comment must be fully consumed, not left dangling
    expect(out).not.toContain("COMPONENT:Sitenav");
  });

  it("still restores the tag when the marker is nested deeper", async () => {
    const out = await runOn(
      `<div class="lib-global_embed">x</div>\n<!--COMPONENT:Sitenav-->\n<div class="page-wrapper">body</div>`
    );
    expect(out).toContain(TAG);
    expect(out).not.toContain("COMPONENT:Sitenav");
  });
});
