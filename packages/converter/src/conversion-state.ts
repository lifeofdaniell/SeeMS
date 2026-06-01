import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import { seeMsDir, conversionStatePath, toPosixPath } from "./generated-state";
import type { ProjectTarget } from "./boilerplate";

export interface ConversionCollection {
  className: string;
  name: string;
  /** Nested repeating children within each item */
  children?: Array<{ fieldName: string; selector: string }>;
}

export interface ConversionState {
  version: 1;
  inputDir: string;
  target: ProjectTarget;
  extractComponents: boolean;
  collections: ConversionCollection[];
  convertedAt: string;
  sources: Record<string, string>;
}

export async function loadConversionState(
  outputDir: string
): Promise<ConversionState | undefined> {
  const statePath = conversionStatePath(outputDir);
  if (!(await fs.pathExists(statePath))) return undefined;
  try {
    const raw = await fs.readJson(statePath);
    if (raw?.version !== 1 || typeof raw.inputDir !== "string") return undefined;
    return raw as ConversionState;
  } catch {
    return undefined;
  }
}

export async function writeConversionState(
  outputDir: string,
  data: Omit<ConversionState, "version" | "convertedAt">
): Promise<void> {
  const state: ConversionState = {
    version: 1,
    convertedAt: new Date().toISOString(),
    ...data,
  };
  await fs.ensureDir(seeMsDir(outputDir));
  await fs.writeJson(conversionStatePath(outputDir), state, { spaces: 2 });
}

function normalizeHtml(html: string): string {
  return html
    .replace(/\s*data-w-id="[^"]*"/g, "")
    .replace(/\s*data-wf-page="[^"]*"/g, "")
    .replace(/\s*data-wf-site="[^"]*"/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function hashSourceFiles(
  inputDir: string
): Promise<Record<string, string>> {
  const htmlFiles = await glob("**/*.html", { cwd: inputDir, nodir: true });
  const result: Record<string, string> = {};

  for (const file of htmlFiles) {
    const content = await fs.readFile(path.join(inputDir, file), "utf-8");
    const normalized = normalizeHtml(content);
    const hash = crypto
      .createHash("md5")
      .update(normalized)
      .digest("hex")
      .substring(0, 12);
    result[toPosixPath(file)] = hash;
  }

  return result;
}
