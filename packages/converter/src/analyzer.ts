import path from "path";
import fs from "fs-extra";
import type { ConversionReport, SeeMSConfig, SharedComponent } from "@see-ms/types";
import { scanAssets, findHTMLFiles } from "./filesystem";
import { getPageRouteInfo, type PageRouteInfo } from "./routes";
import { findSharedSections, parseAllPages } from "./component-extractor";
import { seeMsDir, reportJsonPath, reportMdPath } from "./generated-state";

export interface ConversionAnalysis {
  inputDir: string;
  pages: PageRouteInfo[];
  assets: Awaited<ReturnType<typeof scanAssets>>;
  componentCandidates: SharedComponent[];
  warnings: string[];
}

export async function analyzeWebflowExport(
  inputDir: string,
  config: SeeMSConfig = {}
): Promise<ConversionAnalysis> {
  const inputExists = await fs.pathExists(inputDir);
  if (!inputExists) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  const [assets, htmlFiles] = await Promise.all([
    scanAssets(inputDir),
    findHTMLFiles(inputDir)
  ]);

  const pages = htmlFiles.sort().map(getPageRouteInfo);
  const warnings: string[] = [];

  if (pages.length === 0) {
    warnings.push("No HTML pages were found in the input directory.");
  }

  const componentConfig = config.components || {};
  const parsedPages = await parseAllPages(inputDir, {
    minSectionSize: componentConfig.minSectionSize
  });
  const componentCandidates = findSharedSections(parsedPages, {
    match: componentConfig.match,
    minOccurrences: componentConfig.minOccurrences,
    minPages: componentConfig.minPages,
    include: componentConfig.include,
    exclude: componentConfig.exclude,
    rules: componentConfig.rules
  }).map((component) => ({
    name: component.name,
    selector: component.selector,
    pages: component.pages,
    confidence: component.confidence,
    reason: component.reason
  }));

  return {
    inputDir,
    pages,
    assets,
    componentCandidates,
    warnings
  };
}

export function createConversionReport(input: {
  analysis: ConversionAnalysis;
  provider: "strapi" | "contentful" | "sanity";
  stages: ConversionReport["stages"];
  components: SharedComponent[];
  fields: number;
  collections: number;
  schemas: number;
  seedPages: number;
  warnings?: string[];
}): ConversionReport {
  return {
    generatedAt: new Date().toISOString(),
    stages: input.stages,
    pages: input.analysis.pages.map((page) => ({
      source: page.sourcePath,
      pageId: page.pageId,
      route: page.route,
      output: page.outputPath
    })),
    assets: {
      css: input.analysis.assets.css.length,
      images: input.analysis.assets.images.length,
      fonts: input.analysis.assets.fonts.length,
      js: input.analysis.assets.js.length,
      preservedStructure: true
    },
    components: input.components.map((component) => ({
      name: component.name,
      selector: component.selector,
      pages: component.pages,
      confidence: component.confidence,
      reason: component.reason
    })),
    cms: {
      provider: input.provider,
      fields: input.fields,
      collections: input.collections,
      schemas: input.schemas,
      seedPages: input.seedPages
    },
    warnings: [...input.analysis.warnings, ...(input.warnings || [])]
  };
}

export async function writeConversionReport(outputDir: string, report: ConversionReport): Promise<void> {
  const jsonPath = reportJsonPath(outputDir);
  const mdPath = reportMdPath(outputDir);

  await fs.ensureDir(seeMsDir(outputDir));
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  await fs.writeFile(mdPath, renderReportMarkdown(report), "utf-8");
}

export function renderReportMarkdown(report: ConversionReport): string {
  const lines = [
    "# SeeMS Conversion Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Stages",
    report.stages.map((stage) => `- ${stage}`).join("\n") || "- none",
    "",
    "## Pages",
    ...report.pages.map((page) => `- ${page.source} -> ${page.output} (${page.route}, id: ${page.pageId})`),
    "",
    "## Assets",
    `- CSS: ${report.assets.css}`,
    `- Images: ${report.assets.images}`,
    `- Fonts: ${report.assets.fonts}`,
    `- JS: ${report.assets.js}`,
    `- Preserved folder structure: ${report.assets.preservedStructure ? "yes" : "no"}`,
    "",
    "## Components",
    ...(report.components.length
      ? report.components.map((component) => `- ${component.name} (${component.confidence || "unknown"}): ${component.pages.join(", ")}`)
      : ["- none"]),
    "",
    "## CMS",
    `- Provider: ${report.cms.provider}`,
    `- Editable fields: ${report.cms.fields}`,
    `- Collections: ${report.cms.collections}`,
    `- Schemas: ${report.cms.schemas}`,
    `- Seeded pages: ${report.cms.seedPages}`,
    "",
    "## Warnings",
    ...(report.warnings.length ? report.warnings.map((warning) => `- ${warning}`) : ["- none"]),
    ""
  ];

  return lines.join("\n");
}
