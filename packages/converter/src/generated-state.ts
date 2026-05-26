import fs from "fs-extra";
import path from "path";
import type { AssetPaths } from "./filesystem";
import type { ProjectTarget } from "./boilerplate";

export interface GeneratedFileState {
  version: 1;
  target: ProjectTarget;
  updatedAt: string;
  files: string[];
}

const LEGACY_STATE_FILE = ".see-ms-generated.json";
const STATE_DIR = ".see-ms";
const STATE_FILE = "generated.json";

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function seeMsDir(outputDir: string): string {
  return path.join(outputDir, STATE_DIR);
}

export function generatedStatePath(outputDir: string): string {
  return path.join(outputDir, STATE_DIR, STATE_FILE);
}

export function seedDataPath(outputDir: string): string {
  return path.join(outputDir, STATE_DIR, "seed", "seed-data.json");
}

export function schemasDir(outputDir: string): string {
  return path.join(outputDir, STATE_DIR, "schemas");
}

export function strapiBootstrapDir(outputDir: string): string {
  return path.join(outputDir, STATE_DIR, "strapi-bootstrap");
}

export function reportJsonPath(outputDir: string): string {
  return path.join(outputDir, STATE_DIR, "report.json");
}

export function reportMdPath(outputDir: string): string {
  return path.join(outputDir, STATE_DIR, "report.md");
}

function legacyStatePath(outputDir: string): string {
  return path.join(outputDir, LEGACY_STATE_FILE);
}

function parseState(raw: unknown): GeneratedFileState | undefined {
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as Record<string, unknown>).version !== 1 ||
    !Array.isArray((raw as Record<string, unknown>).files)
  ) {
    return undefined;
  }
  const state = raw as Record<string, unknown>;
  return {
    version: 1,
    target: state.target === "astro-vue" ? "astro-vue" : "nuxt",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date().toISOString(),
    files: (state.files as unknown[]).filter((f): f is string => typeof f === "string"),
  };
}

export async function loadGeneratedFileState(outputDir: string): Promise<GeneratedFileState | undefined> {
  const newPath = generatedStatePath(outputDir);

  if (await fs.pathExists(newPath)) {
    try {
      return parseState(await fs.readJson(newPath));
    } catch {
      return undefined;
    }
  }

  // Migrate from legacy flat file
  const legacyPath = legacyStatePath(outputDir);
  if (!(await fs.pathExists(legacyPath))) return undefined;

  try {
    const state = parseState(await fs.readJson(legacyPath));
    if (state) {
      await fs.ensureDir(seeMsDir(outputDir));
      await fs.writeJson(newPath, state, { spaces: 2 });
    }
    return state;
  } catch {
    return undefined;
  }
}

export async function writeGeneratedFileState(
  outputDir: string,
  target: ProjectTarget,
  files: Iterable<string>
): Promise<void> {
  const state: GeneratedFileState = {
    version: 1,
    target,
    updatedAt: new Date().toISOString(),
    files: Array.from(new Set(files)).sort(),
  };

  await fs.ensureDir(seeMsDir(outputDir));
  await fs.writeJson(generatedStatePath(outputDir), state, { spaces: 2 });
}

export async function removeStaleGeneratedFiles(
  outputDir: string,
  previousState: GeneratedFileState | undefined,
  nextFiles: Iterable<string>
): Promise<string[]> {
  if (!previousState) return [];

  const next = new Set(nextFiles);
  const removed: string[] = [];

  for (const previousFile of previousState.files) {
    if (next.has(previousFile) || !isSafeProjectFile(previousFile)) continue;

    const absolutePath = path.resolve(outputDir, previousFile);
    if (!isInsideOutputDir(outputDir, absolutePath) || !(await fs.pathExists(absolutePath))) continue;

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) continue;

    await fs.remove(absolutePath);
    removed.push(previousFile);
  }

  return removed;
}

export function keepPreviousNonPageFiles(
  previousState: GeneratedFileState | undefined,
  nextFiles: Iterable<string>
): string[] {
  const files = new Set(nextFiles);
  for (const previousFile of previousState?.files || []) {
    if (!isGeneratedPageFile(previousFile)) files.add(previousFile);
  }
  return Array.from(files);
}

export function getGeneratedAssetFiles(assets: AssetPaths): string[] {
  return [
    ...assets.css.map((file) => toPosixPath(path.join("assets", "css", path.relative("css", file)))),
    ...assets.images.map((file) => toPosixPath(path.join("public", "assets", "images", path.relative("images", file)))),
    ...assets.fonts.map((file) => toPosixPath(path.join("public", "assets", "fonts", path.relative("fonts", file)))),
    ...assets.js.map((file) => toPosixPath(path.join("public", "assets", "js", path.relative("js", file)))),
  ];
}

export function getGeneratedPageFiles(htmlFiles: string[], target: ProjectTarget): string[] {
  if (target === "astro-vue") {
    return htmlFiles.flatMap((file) => [
      toPosixPath(path.join("src", "components", "pages", file.replace(/\.html$/i, ".vue"))),
      toPosixPath(path.join("src", "pages", file.replace(/\.html$/i, ".astro"))),
    ]);
  }

  return htmlFiles.map((file) => toPosixPath(path.join("pages", file.replace(/\.html$/i, ".vue"))));
}

export function getGeneratedRuntimeFiles(target: ProjectTarget, editorEnabled: boolean): string[] {
  const common = [
    "see-ms.config.ts",
    "public/cms-manifest.json",
    ".see-ms/seed/seed-data.json",
    ".see-ms/seed/README.md",
    ".see-ms/schemas/README.md",
    ".see-ms/strapi-bootstrap/index.ts",
    ".see-ms/strapi-bootstrap/README.md",
    ".see-ms/report.md",
    ".see-ms/report.json",
  ];

  if (target === "astro-vue") {
    return [
      ...common,
      "src/composables/useStrapiContent.ts",
      ...(editorEnabled
        ? [
            "src/cms-editor.ts",
            "src/pages/api/cms/save.ts",
            "src/pages/api/cms/publish.ts",
          ]
        : []),
    ];
  }

  return [
    ...common,
    "composables/useEditorContent.ts",
    "composables/useStrapiContent.ts",
    "utils/webflow-assets.ts",
    ...(editorEnabled
      ? [
          "plugins/cms-editor.client.ts",
          "server/api/cms/save.post.ts",
          "server/api/cms/publish.post.ts",
        ]
      : []),
  ];
}

function isSafeProjectFile(projectFile: string): boolean {
  return !path.isAbsolute(projectFile) && !projectFile.split("/").includes("..") && projectFile !== STATE_FILE;
}

function isGeneratedPageFile(projectFile: string): boolean {
  return (
    /^pages\/.+\.vue$/.test(projectFile) ||
    /^src\/components\/pages\/.+\.vue$/.test(projectFile) ||
    /^src\/pages\/(?!api\/).+\.astro$/.test(projectFile)
  );
}

function isInsideOutputDir(outputDir: string, absolutePath: string): boolean {
  const relative = path.relative(path.resolve(outputDir), absolutePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
