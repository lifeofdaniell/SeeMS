import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { isSeeMsIgnored } from "../gitignore-check";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "see-ms-gitignore-test-"));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe("isSeeMsIgnored", () => {
  it("returns false when no .gitignore exists", async () => {
    expect(await isSeeMsIgnored(tmpDir)).toBe(false);
  });

  it("returns false when .gitignore does not match .see-ms", async () => {
    await fs.writeFile(
      path.join(tmpDir, ".gitignore"),
      ".env\nnode_modules/\ndist/\n"
    );
    expect(await isSeeMsIgnored(tmpDir)).toBe(false);
  });

  it("detects exact pattern `.see-ms/`", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), ".see-ms/\n");
    expect(await isSeeMsIgnored(tmpDir)).toBe(true);
  });

  it("detects exact pattern `.see-ms` without trailing slash", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), ".see-ms\n");
    expect(await isSeeMsIgnored(tmpDir)).toBe(true);
  });

  it("detects wildcard `.*` matching all dot entries", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), ".*\n");
    expect(await isSeeMsIgnored(tmpDir)).toBe(true);
  });

  it("detects wildcard `.*/` matching all dot directories", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), ".*/\n");
    expect(await isSeeMsIgnored(tmpDir)).toBe(true);
  });

  it("detects wildcard `.*/**`", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), ".*/**\n");
    expect(await isSeeMsIgnored(tmpDir)).toBe(true);
  });

  it("ignores commented-out patterns", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "# .see-ms/\n");
    expect(await isSeeMsIgnored(tmpDir)).toBe(false);
  });

  it("ignores inline comments that look like patterns", async () => {
    await fs.writeFile(
      path.join(tmpDir, ".gitignore"),
      ".env # .see-ms/\n"
    );
    expect(await isSeeMsIgnored(tmpDir)).toBe(false);
  });

  it("detects when mixed with unrelated rules", async () => {
    await fs.writeFile(
      path.join(tmpDir, ".gitignore"),
      ".env\n.*\nnode_modules/\n"
    );
    expect(await isSeeMsIgnored(tmpDir)).toBe(true);
  });

  it("respects negation: `.*` then `!.see-ms` means not ignored", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), ".*\n!.see-ms\n");
    expect(await isSeeMsIgnored(tmpDir)).toBe(false);
  });

  it("respects negation: `.*` then `!.see-ms/` means not ignored", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), ".*\n!.see-ms/\n");
    expect(await isSeeMsIgnored(tmpDir)).toBe(false);
  });

  it("returns false for empty .gitignore", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "");
    expect(await isSeeMsIgnored(tmpDir)).toBe(false);
  });
});
