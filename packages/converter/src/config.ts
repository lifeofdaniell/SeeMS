import fs from "fs-extra";
import path from "path";
import type { SeeMSConfig } from "@see-ms/types";

export const DEFAULT_SEEMS_CONFIG: Required<Pick<SeeMSConfig, "target" | "cms" | "components" | "ignore" | "editor" | "assets">> = {
  target: "nuxt",
  cms: { provider: "strapi", strapi: { scaffold: false, packageManager: "npm", install: true } },
  components: {
    enabled: true,
    match: "structure",
    minOccurrences: 2,
    minPages: 2,
    minSectionSize: 200,
    writeConfidence: "medium",
    include: ["nav", "header", "footer"],
    exclude: [],
    rules: []
  },
  ignore: {
    selectors: [],
    classes: []
  },
  editor: {
    enabled: true,
    previewParam: "preview"
  },
  assets: {
    excludeResponsiveVariants: true
  }
};

export function mergeConfig(base: SeeMSConfig = {}, override: SeeMSConfig = {}): SeeMSConfig {
  return {
    ...base,
    ...override,
    cms: {
      ...base.cms,
      ...override.cms,
      strapi: { ...base.cms?.strapi, ...override.cms?.strapi }
    },
    components: { ...base.components, ...override.components },
    ignore: { ...base.ignore, ...override.ignore },
    editor: { ...base.editor, ...override.editor },
    assets: { ...base.assets, ...override.assets },
    collections: override.collections ?? base.collections,
    fields: { ...base.fields, ...override.fields }
  };
}

export async function loadSeeMSConfig(configPath?: string): Promise<SeeMSConfig> {
  if (!configPath) return {};

  const absolutePath = path.resolve(configPath);
  if (!(await fs.pathExists(absolutePath))) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  if (absolutePath.endsWith(".json")) {
    return JSON.parse(await fs.readFile(absolutePath, "utf-8")) as SeeMSConfig;
  }

  const content = await fs.readFile(absolutePath, "utf-8");
  const objectMatch =
    content.match(/export\s+default\s+(\{[\s\S]*\})\s*(?:satisfies\s+\w+)?\s*;?\s*$/) ||
    content.match(/const\s+\w+(?::\s*[\w<>]+)?\s*=\s*(\{[\s\S]*\})\s*;\s*export\s+default\s+\w+\s*;?\s*$/);
  if (!objectMatch) {
    throw new Error("see-ms config must export an object literal or be JSON");
  }

  return Function(`"use strict"; return (${objectMatch[1]});`)() as SeeMSConfig;
}

export async function writeSeeMSConfig(outputDir: string, config: SeeMSConfig): Promise<void> {
  const target = path.join(outputDir, "see-ms.config.ts");
  const content = `import type { SeeMSConfig } from "@see-ms/types";

const config: SeeMSConfig = ${JSON.stringify(config, null, 2)};

export default config;
`;

  await fs.writeFile(target, content, "utf-8");
}

export function normalizeConfig(config: SeeMSConfig = {}): SeeMSConfig {
  return mergeConfig(DEFAULT_SEEMS_CONFIG, config);
}
