import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { findHTMLFiles } from "../filesystem";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "see-ms-filesystem-test-"));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe("findHTMLFiles", () => {
  it("returns empty array for empty directory", async () => {
    expect(await findHTMLFiles(tmpDir)).toEqual([]);
  });

  it("finds top-level HTML files", async () => {
    await fs.writeFile(path.join(tmpDir, "index.html"), "<html/>");
    await fs.writeFile(path.join(tmpDir, "about.html"), "<html/>");
    const files = await findHTMLFiles(tmpDir);
    expect(files).toContain("index.html");
    expect(files).toContain("about.html");
  });

  it("finds HTML files in subdirectories", async () => {
    await fs.ensureDir(path.join(tmpDir, "creating-value"));
    await fs.writeFile(path.join(tmpDir, "creating-value", "reports.html"), "<html/>");
    const files = await findHTMLFiles(tmpDir);
    expect(files).toContain("creating-value/reports.html");
  });

  it("excludes Webflow component-[uuid].html files", async () => {
    await fs.writeFile(path.join(tmpDir, "index.html"), "<html/>");
    await fs.writeFile(
      path.join(tmpDir, "component-49a9fc69-c595-e2e8-8dd6-73d7bf0a6f3e.html"),
      "<!DOCTYPE html>"
    );
    await fs.writeFile(
      path.join(tmpDir, "component-8e01af51-ea00-e6eb-5ca8-1829224ee2b3.html"),
      "<!DOCTYPE html>"
    );
    const files = await findHTMLFiles(tmpDir);
    expect(files).toContain("index.html");
    expect(files.every(f => !f.startsWith("component-"))).toBe(true);
  });

  it("excludes component-[uuid].html in subdirectories too", async () => {
    await fs.ensureDir(path.join(tmpDir, "sub"));
    await fs.writeFile(
      path.join(tmpDir, "sub", "component-b6d1c761-b168-d70d-dbcb-1f58d80002ed.html"),
      "<!DOCTYPE html>"
    );
    await fs.writeFile(path.join(tmpDir, "sub", "page.html"), "<html/>");
    const files = await findHTMLFiles(tmpDir);
    expect(files).toContain("sub/page.html");
    expect(files.every(f => !f.includes("component-"))).toBe(true);
  });

  it("does not exclude a legitimate page that happens to start with 'component'", async () => {
    await fs.writeFile(path.join(tmpDir, "component-library.html"), "<html/>");
    const files = await findHTMLFiles(tmpDir);
    expect(files).toContain("component-library.html");
  });
});
