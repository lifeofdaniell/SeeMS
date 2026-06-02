/**
 * Strapi Complete Setup Script
 * Installs schemas, uploads images, and seeds content - all in one command
 */

import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import * as readline from "readline";
import { spawn } from "child_process";
import { isLikelyImagePath, mediaLookupKeys } from "./assets";
import { seedDataPath, schemasDir, strapiBootstrapDir } from "./generated-state";

// @ts-ignore
interface SchemaFile {
  name: string;
  path: string;
  schema: any;
}

interface SetupOptions {
  projectDir: string;
  strapiDir: string;
  strapiUrl?: string;
  apiToken?: string;
  ignoreSavedToken?: boolean;
  scaffold?: boolean;
  scaffoldOptions?: StrapiScaffoldOptions;
}

export interface StrapiScaffoldOptions {
  strapiDir: string;
  packageManager?: "npm" | "pnpm" | "yarn";
  install?: boolean;
  run?: boolean;
  gitInit?: boolean;
  typescript?: boolean;
}

const ENV_FILE = ".env";
const SEEMS_BOOTSTRAP_MARKER = "SeeMS public permissions bootstrap";

/**
 * Load config from .env file in project directory
 */
async function loadConfig(projectDir: string): Promise<{ apiToken?: string; strapiUrl?: string }> {
  const envPath = path.join(projectDir, ENV_FILE);
  if (await fs.pathExists(envPath)) {
    try {
      const content = await fs.readFile(envPath, "utf-8");
      const config: { apiToken?: string; strapiUrl?: string } = {};

      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=").trim();

        if (key === "STRAPI_API_TOKEN") {
          config.apiToken = value;
        } else if (key === "STRAPI_URL") {
          config.strapiUrl = value;
        }
      }
      return config;
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Save/append config to .env file in project directory
 */
async function saveConfig(projectDir: string, config: { apiToken?: string; strapiUrl?: string }): Promise<void> {
  const envPath = path.join(projectDir, ENV_FILE);
  let content = "";

  // Read existing content if file exists
  if (await fs.pathExists(envPath)) {
    content = await fs.readFile(envPath, "utf-8");

    // Remove existing STRAPI_ entries to avoid duplicates
    content = content
      .split("\n")
      .filter(line => !line.startsWith("STRAPI_API_TOKEN=") && !line.startsWith("STRAPI_URL="))
      .join("\n");

    if (content && !content.endsWith("\n")) {
      content += "\n";
    }
  }

  // Add new values
  if (config.strapiUrl) {
    content += `STRAPI_URL=${config.strapiUrl}\n`;
  }
  if (config.apiToken) {
    content += `STRAPI_API_TOKEN=${config.apiToken}\n`;
  }

  await fs.writeFile(envPath, content);
}


/**
 * Detect the package manager used in a directory by checking for lockfiles.
 */
async function detectPackageManager(dir: string): Promise<"pnpm" | "yarn" | "npm"> {
  if (await fs.pathExists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (await fs.pathExists(path.join(dir, "yarn.lock"))) return "yarn";
  return "npm";
}

/**
 * Read the Node version from .nvmrc if present.
 */
async function readNvmrc(dir: string): Promise<string | null> {
  const nvmrcPath = path.join(dir, ".nvmrc");
  if (!(await fs.pathExists(nvmrcPath))) return null;
  return (await fs.readFile(nvmrcPath, "utf-8")).trim();
}

/**
 * Main setup function
 * Exported for use by CLI and direct execution
 */
export async function completeSetup(options: SetupOptions): Promise<void> {
  const { projectDir, strapiDir, strapiUrl: optionUrl, apiToken: optionToken, ignoreSavedToken } = options;

  if (!(await fs.pathExists(strapiDir))) {
    if (!options.scaffold) {
      throw new Error(`Strapi directory not found: ${strapiDir}`);
    }

    await scaffoldStrapiProject({
      strapiDir,
      ...options.scaffoldOptions
    });
  }

  // Detect package manager and Node version for this Strapi project
  const pm = await detectPackageManager(strapiDir);
  const nvmrc = await readNvmrc(strapiDir);
  const runCmd = `${pm} run develop`;
  const installCmd = `${pm} install`;

  // Load saved config
  const savedConfig = await loadConfig(projectDir);
  const strapiUrl = optionUrl || savedConfig.strapiUrl || "http://localhost:1337";

  console.log("🚀 Starting complete Strapi setup...\n");

  // Step 1: Install schemas
  console.log("📦 Step 1: Installing schemas...");
  await installSchemas(projectDir, strapiDir);
  console.log("✓ Schemas installed\n");

  // Step 2: Install bootstrap
  console.log("🔓 Step 2: Installing Strapi bootstrap...");
  await installStrapiBootstrap(projectDir, strapiDir);
  console.log("✓ Bootstrap installed\n");

  // Step 2.5: Clean stray compiled JS and check tsconfig emit safety.
  // A bare `tsc`/IDE build against a tsconfig without `outDir` emits .js next
  // to every .ts in src/, which collides with Strapi's loader and breaks
  // content-type/route registration (every /api write then returns 405).
  await sweepCompiledTsSiblings(strapiDir);
  await warnIfTsconfigEmitsIntoSrc(strapiDir);

  // Step 3: Wait for user to start Strapi
  console.log("⏸️  Step 3: Start Strapi in a separate terminal tab");
  console.log(`   Detected package manager: ${pm}`);
  console.log("");
  console.log("   ┌─ Open a new terminal tab and run: ──────────────────────");
  if (nvmrc) {
    console.log(`   │  cd ${strapiDir}`);
    console.log(`   │  nvm use          # .nvmrc requires Node ${nvmrc}`);
    console.log(`   │  ${installCmd}    # first time only`);
    console.log(`   │  ${runCmd}`);
  } else {
    console.log(`   │  cd ${strapiDir}`);
    console.log(`   │  ${installCmd}    # first time only`);
    console.log(`   │  ${runCmd}`);
  }
  console.log("   └─────────────────────────────────────────────────────────");
  console.log("");
  console.log("   Come back here and press Enter once Strapi is running.");
  console.log("   (you don't need to wait for it to fully boot — just press Enter)");

  await waitForEnter();

  // Step 4: Wait for Strapi to be reachable (polls every 3s for up to 90s)
  console.log("\n🔍 Step 4: Checking Strapi connection...");
  const isRunning = await waitForStrapi(strapiUrl);

  if (!isRunning) {
    console.error(`\n❌ Strapi did not respond at ${strapiUrl} within 90 seconds`);
    console.log(`\n   Switch to the terminal tab where you ran "${runCmd}"`);
    console.log(`   and look for any error messages there.`);
    if (nvmrc) console.log(`\n   Common cause: wrong Node version. Make sure you ran: nvm use`);
    console.log(`\n   Once Strapi is running, re-run: make setup-strapi`);
    process.exit(1);
  }

  console.log("✓ Connected to Strapi\n");

  // Step 5: Get API token
  let token = optionToken || (!ignoreSavedToken ? savedConfig.apiToken : undefined);
  if (token && !ignoreSavedToken) {
    console.log("🔑 Step 5: Using saved API token");
  } else if (token && optionToken) {
    console.log("🔑 Step 5: Using provided API token");
  } else {
    console.log("🔑 Step 5: API Token needed");
    console.log("   1. Open Strapi admin: http://localhost:1337/admin");
    console.log("   2. Go to Settings > API Tokens > Create new API Token");
    console.log("   3. Name: \"Seed Script\", Type: \"Full access\", Duration: \"Unlimited\"");
    console.log("   4. Copy the token and paste it here:\n");

    token = await promptForToken();

    // Ask to save token
    const saveToken = await promptYesNo("   Save token for future use?");
    if (saveToken) {
      await saveConfig(projectDir, { ...savedConfig, apiToken: token, strapiUrl });
      console.log("   ✓ Token saved to .env");
    }
    console.log("");
  }

  // Step 6: Upload images
  console.log("📸 Step 6: Uploading images...");
  const mediaMap = await uploadAllImages(projectDir, strapiUrl, token);
  console.log(`✓ Mapped ${mediaMap.size} media lookup keys\n`);

  // Step 7: Seed content
  console.log("📝 Step 7: Seeding content...");
  await seedContent(projectDir, strapiUrl, token, mediaMap);
  console.log("✓ Content seeded\n");

  console.log("✅ Complete setup finished!");
  console.log("\n📋 Next steps:");
  console.log("   1. Open Strapi admin: http://localhost:1337/admin");
  console.log("   2. Check Content Manager - your content should be there!");
  console.log("   3. Connect your Nuxt app to Strapi API");
}

/**
 * Scaffold a new Strapi project using the official Strapi create CLI.
 */
export async function scaffoldStrapiProject(options: StrapiScaffoldOptions): Promise<void> {
  const {
    strapiDir,
    packageManager = "npm",
    install = true,
    run = false,
    gitInit = false,
    typescript = true
  } = options;

  const resolvedDir = path.resolve(strapiDir);
  if (await fs.pathExists(resolvedDir)) {
    const entries = await fs.readdir(resolvedDir);
    if (entries.length > 0) {
      throw new Error(`Cannot scaffold Strapi into a non-empty directory: ${resolvedDir}`);
    }
  }

  await fs.ensureDir(path.dirname(resolvedDir));

  const args = [
    "create-strapi@latest",
    resolvedDir,
    typescript ? "--typescript" : "--javascript",
    "--skip-cloud",
    "--skip-db",
    "--no-example",
    install ? "--install" : "--no-install",
    gitInit ? "--git-init" : "--no-git-init",
    `--use-${packageManager}`
  ];
  if (!run) {
    args.push("--no-run");
  }

  console.log("🏗️  Scaffolding Strapi project...");
  console.log(`   npx ${args.join(" ")}`);

  await runCommand("npx", args, process.cwd());
  if (!(await fs.pathExists(path.join(resolvedDir, "package.json")))) {
    throw new Error(`Strapi scaffold did not create a project at ${resolvedDir}`);
  }
  console.log(`✓ Strapi project scaffolded at ${resolvedDir}`);
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

/**
 * Install all schemas from cms-schemas folder into Strapi
 */
async function installSchemas(
  projectDir: string,
  strapiDir: string
): Promise<void> {
  // Validate strapi directory exists
  if (!(await fs.pathExists(strapiDir))) {
    console.error(`   ✗ Strapi directory not found: ${strapiDir}`);
    console.error(`   Resolved to: ${path.resolve(strapiDir)}`);
    throw new Error(`Strapi directory not found: ${strapiDir}`);
  }
  // Check it's actually a Strapi project
  const packageJsonPath = path.join(strapiDir, "package.json");
  if (await fs.pathExists(packageJsonPath)) {
    const pkg = await fs.readJson(packageJsonPath);
    if (!pkg.dependencies?.["@strapi/strapi"]) {
      console.warn(`   ⚠️  Warning: ${strapiDir} may not be a Strapi project`);
    }
  }

  const schemaDir = schemasDir(projectDir);

  // Install components first (e.g., shared.link)
  const componentsDir = path.join(schemaDir, "components");
  if (await fs.pathExists(componentsDir)) {
    const componentFiles = await glob("**/*.json", {
      cwd: componentsDir,
      absolute: false
    });

    if (componentFiles.length > 0) {
      console.log(`   Found ${componentFiles.length} component(s)`);
      for (const file of componentFiles) {
        const sourcePath = path.join(componentsDir, file);
        // Components go to src/components/<category>/<name>.json
        const targetPath = path.join(strapiDir, "src", "components", file);
        await fs.ensureDir(path.dirname(targetPath));
        await fs.copy(sourcePath, targetPath);
        console.log(`   ✓ Component: ${file}`);
      }
    }
  }

  const schemaFiles = await glob("*.json", {
    cwd: schemaDir,
    absolute: false
  });

  if (schemaFiles.length === 0) {
    console.log("⚠️  No schema files found");
    return;
  }

  // Wipe the existing src/api directory so stale or renamed schemas don't linger
  const strapiApiDir = path.join(strapiDir, "src", "api");
  if (await fs.pathExists(strapiApiDir)) {
    await fs.emptyDir(strapiApiDir);
    console.log("   ✓ Cleared existing src/api (fresh install)");
  }

  console.log(`   Found ${schemaFiles.length} schema file(s)`);

  for (const file of schemaFiles) {
    const schemaPath = path.join(schemaDir, file);
    const schema = await fs.readJson(schemaPath);
    const singularName =
      schema.info?.singularName || path.basename(file, ".json");
    console.log(`   Installing ${singularName}...`);
    try {
      // Create the Strapi API structure manually (strapi generate is interactive)
      const apiPath = path.join(strapiDir, "src", "api", singularName);
      const contentTypesPath = path.join(
        apiPath,
        "content-types",
        singularName
      );
      const targetPath = path.join(contentTypesPath, "schema.json");

      // Create directories
      await fs.ensureDir(contentTypesPath);
      await fs.ensureDir(path.join(apiPath, "routes"));
      await fs.ensureDir(path.join(apiPath, "controllers"));
      await fs.ensureDir(path.join(apiPath, "services"));

      // Write the schema
      await fs.writeJson(targetPath, schema, { spaces: 2 });

      // Create TypeScript route file (Strapi 5 format)
      const routeContent = `import { factories } from '@strapi/strapi';
         export default factories.createCoreRouter('api::${singularName}.${singularName}');
        `;
      await fs.writeFile(
        path.join(apiPath, "routes", `${singularName}.ts`),
        routeContent
      );

      // Create TypeScript controller file
      const controllerContent = `import { factories } from '@strapi/strapi';
         export default factories.createCoreController('api::${singularName}.${singularName}');
        `;
      await fs.writeFile(
        path.join(apiPath, "controllers", `${singularName}.ts`),
        controllerContent
      );

      // Create TypeScript service file
      const serviceContent = `import { factories } from '@strapi/strapi';
         export default factories.createCoreService('api::${singularName}.${singularName}');
        `;
      await fs.writeFile(
        path.join(apiPath, "services", `${singularName}.ts`),
        serviceContent
      );
    } catch (error: any) {
      console.error(`   ✗ Failed to install ${singularName}: ${error.message}`);
    }
  }
}

async function installStrapiBootstrap(projectDir: string, strapiDir: string): Promise<void> {
  const sourcePath = path.join(strapiBootstrapDir(projectDir), "index.ts");
  if (!(await fs.pathExists(sourcePath))) {
    console.log("   No generated Strapi bootstrap found, skipping");
    return;
  }

  const srcDir = path.join(strapiDir, "src");
  const targetPath = path.join(srcDir, "index.ts");
  await fs.ensureDir(srcDir);

  // Remove legacy src/index.js — TypeScript compiles with allowJs:true, so
  // having both index.js and index.ts causes a "Debug Failure" TS assertion.
  const legacyJsPath = path.join(srcDir, "index.js");
  if (await fs.pathExists(legacyJsPath)) {
    await fs.remove(legacyJsPath);
    console.log("   ✓ Removed legacy src/index.js (replaced by src/index.ts)");
  }

  if (!(await fs.pathExists(targetPath))) {
    await fs.copy(sourcePath, targetPath);
    console.log("   ✓ Created src/index.ts");
    return;
  }

  const existing = await fs.readFile(targetPath, "utf-8");
  if (
    existing.includes(SEEMS_BOOTSTRAP_MARKER) ||
    existing.includes("enableSeeMSPublicPermissions") ||
    existing.includes("Auto-enables public read permissions for all CMS content types")
  ) {
    console.log("   ✓ SeeMS bootstrap already installed");
    return;
  }

  const backupPath = `${targetPath}.before-see-ms-${Date.now()}.bak`;
  await fs.copy(targetPath, backupPath);

  const merged = mergeBootstrap(existing);
  if (!merged) {
    const helperPath = path.join(srcDir, "index.see-ms.ts");
    await fs.copy(sourcePath, helperPath);
    console.log("   ⚠ Could not safely merge existing src/index.ts");
    console.log(`   ✓ Left existing file unchanged and wrote ${path.relative(strapiDir, helperPath)}`);
    console.log(`   ✓ Backup saved to ${path.relative(strapiDir, backupPath)}`);
    return;
  }

  await fs.writeFile(targetPath, merged, "utf-8");
  console.log("   ✓ Merged SeeMS bootstrap into existing src/index.ts");
  console.log(`   ✓ Backup saved to ${path.relative(strapiDir, backupPath)}`);
}

/**
 * Remove compiled .js files that sit next to a .ts source in src/.
 *
 * A `tsc` run (manual, IDE "build", or CI) against a tsconfig that lacks
 * `outDir` emits a .js beside every .ts. Strapi's loader then sees both a
 * .ts and a .js for the same module, fails to resolve content types/routes,
 * and every /api write returns 405. We only delete `X.js` when `X.ts` exists
 * in the same directory, so a genuine JavaScript project (whose files have no
 * .ts sibling) is never touched. `*.example.js` files are always preserved.
 */
async function sweepCompiledTsSiblings(strapiDir: string): Promise<void> {
  const srcDir = path.join(strapiDir, "src");
  if (!(await fs.pathExists(srcDir))) return;

  const jsFiles = await glob("**/*.js", {
    cwd: srcDir,
    absolute: true,
    ignore: ["**/*.example.js"]
  });

  let removed = 0;
  for (const jsFile of jsFiles) {
    const tsSibling = `${jsFile.slice(0, -3)}.ts`;
    if (await fs.pathExists(tsSibling)) {
      await fs.remove(jsFile);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(
      `   ✓ Removed ${removed} stale compiled .js file(s) shadowing .ts sources in src/`
    );
  }
}

/**
 * Warn when the Strapi project's tsconfig will emit compiled .js into src/.
 *
 * The root cause of the stray-.js problem is a tsconfig with neither `outDir`
 * nor `noEmit` (and no `extends` to defer to). We can't reliably resolve
 * `extends` chains here, so we only warn for the unambiguous case to avoid
 * false alarms.
 */
async function warnIfTsconfigEmitsIntoSrc(strapiDir: string): Promise<void> {
  const tsconfigPath = path.join(strapiDir, "tsconfig.json");
  if (!(await fs.pathExists(tsconfigPath))) return;

  try {
    const raw = await fs.readFile(tsconfigPath, "utf-8");
    // Strip // and /* */ comments so JSONC tsconfigs parse.
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const config = JSON.parse(stripped);
    const compilerOptions = config.compilerOptions || {};
    const hasOutDir =
      typeof compilerOptions.outDir === "string" && compilerOptions.outDir.trim() !== "";
    const noEmit = compilerOptions.noEmit === true;
    const hasExtends = typeof config.extends === "string" && config.extends.trim() !== "";

    if (!hasOutDir && !noEmit && !hasExtends) {
      console.log("");
      console.log('   ⚠ Warning: tsconfig.json has no "outDir" and no "noEmit".');
      console.log("     A stray `tsc` or IDE build will emit compiled .js next to every");
      console.log("     .ts in src/, which breaks Strapi route registration (405s on seed).");
      console.log('     Fix: add "compilerOptions": { "outDir": "dist" } to tsconfig.json.');
      console.log("");
    }
  } catch {
    // Ignore unreadable or malformed tsconfig.
  }
}

function mergeBootstrap(existing: string): string | null {
  const helper = renderSeeMSBootstrapHelper();

  if (/async\s+bootstrap\s*\([^)]*\)\s*\{/.test(existing)) {
    return `${helper}\n\n${existing.replace(
      /async\s+bootstrap\s*\([^)]*\)\s*\{/,
      (match) => `${match}\n    const seeMSStrapi = typeof strapi !== 'undefined' ? strapi : arguments[0]?.strapi;\n    await enableSeeMSPublicPermissions(seeMSStrapi);`
    )}`;
  }

  if (/bootstrap\s*\([^)]*\)\s*\{/.test(existing)) {
    return `${helper}\n\n${existing.replace(
      /bootstrap\s*\([^)]*\)\s*\{/,
      (match) => `async ${match}\n    const seeMSStrapi = typeof strapi !== 'undefined' ? strapi : arguments[0]?.strapi;\n    await enableSeeMSPublicPermissions(seeMSStrapi);`
    )}`;
  }

  if (/export\s+default\s+\{/.test(existing)) {
    return existing.replace(
      /export\s+default\s+\{/,
      `${helper}\nexport default {\n  async bootstrap({ strapi }: { strapi: any }) {\n    await enableSeeMSPublicPermissions(strapi);\n  },`
    );
  }

  return null;
}

function renderSeeMSBootstrapHelper(): string {
  return `
async function enableSeeMSPublicPermissions(strapi: any) {
  // ${SEEMS_BOOTSTRAP_MARKER}
  try {
    console.log('[SeeMS Bootstrap] Configuring public permissions for CMS...');

    const publicRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });

    if (!publicRole) {
      console.error('[SeeMS Bootstrap] Public role not found');
      return;
    }

    const contentTypes = Object.keys(strapi.contentTypes).filter((uid) => uid.startsWith('api::'));
    const permissions = await strapi
      .query('plugin::users-permissions.permission')
      .findMany({ where: { role: publicRole.id } });

    let updatedCount = 0;

    for (const contentType of contentTypes) {
      const [, apiName] = contentType.split('::');
      const [controllerName] = apiName.split('.');

      const findPermission = permissions.find(
        (permission: any) =>
          permission.action === \`api::\${apiName}.find\` ||
          (permission.action === 'find' && permission.controller === controllerName)
      );
      const findOnePermission = permissions.find(
        (permission: any) =>
          permission.action === \`api::\${apiName}.findOne\` ||
          (permission.action === 'findOne' && permission.controller === controllerName)
      );

      if (findPermission && !findPermission.enabled) {
        await strapi.query('plugin::users-permissions.permission').update({
          where: { id: findPermission.id },
          data: { enabled: true },
        });
        updatedCount++;
      }

      if (findOnePermission && !findOnePermission.enabled) {
        await strapi.query('plugin::users-permissions.permission').update({
          where: { id: findOnePermission.id },
          data: { enabled: true },
        });
        updatedCount++;
      }

      if (!findPermission) {
        await strapi.query('plugin::users-permissions.permission').create({
          data: {
            action: \`api::\${apiName}.find\`,
            role: publicRole.id,
            enabled: true,
          },
        });
        updatedCount++;
      }

      if (!findOnePermission) {
        await strapi.query('plugin::users-permissions.permission').create({
          data: {
            action: \`api::\${apiName}.findOne\`,
            role: publicRole.id,
            enabled: true,
          },
        });
        updatedCount++;
      }
    }

    console.log(
      \`[SeeMS Bootstrap] Enabled \${updatedCount} public permissions for \${contentTypes.length} content types\`
    );
  } catch (error) {
    console.error('[SeeMS Bootstrap] Error enabling public permissions:', error);
  }
}
`.trim();
}

/**
 * Check if Strapi is running
 */
async function checkStrapiRunning(strapiUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(`${strapiUrl}/_health`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok || response.status === 204;
  } catch {
    return false;
  }
}

/**
 * Poll Strapi health endpoint until it responds or timeout is reached.
 * Shows a progress indicator while waiting.
 */
async function waitForStrapi(strapiUrl: string, timeoutMs = 90_000): Promise<boolean> {
  const interval = 3_000;
  const deadline = Date.now() + timeoutMs;
  let dots = 0;

  process.stdout.write("   Waiting for Strapi");

  while (Date.now() < deadline) {
    const ok = await checkStrapiRunning(strapiUrl);
    if (ok) {
      process.stdout.write(" ✓\n");
      return true;
    }
    process.stdout.write(".");
    dots++;
    await new Promise(r => setTimeout(r, interval));
  }

  process.stdout.write("\n");
  return false;
}

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Wait for user to press Enter
 */
async function waitForEnter(): Promise<void> {
  const rl = createReadline();
  return new Promise((resolve) => {
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Prompt user for API token
 */
async function promptForToken(): Promise<string> {
  const rl = createReadline();

  return new Promise((resolve) => {
    rl.question("   Token: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt user for yes/no
 */
async function promptYesNo(question: string): Promise<boolean> {
  const rl = createReadline();
  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

/**
 * Fetch existing media from Strapi
 * Returns a map of filename to media ID
 */

async function getExistingMedia(
  strapiUrl: string,
  apiToken: string
): Promise<Map<string, number>> {

  const existingMedia = new Map<string, number>();
  try {
    // Fetch all files from Strapi media library (paginated)
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `${strapiUrl}/api/upload/files?pagination[page]=${page}&pagination[pageSize]=${pageSize}`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        }
      );

      if (!response.ok) {
        break;
      }

      const data = await response.json();
      // @ts-ignore
      const files = Array.isArray(data) ? data : data.results || [];

      for (const file of files) {
        if (file.name) {
          existingMedia.set(file.name, file.id);
        }
      }

      hasMore = files.length === pageSize;
      page++;
    }
  } catch (error) {
    // Silently continue - we'll just upload all images
  }
  return existingMedia;
}

/**
 * Upload all images to Strapi media library
 * Returns a map of original paths to Strapi media IDs
 */
async function uploadAllImages(
  projectDir: string,
  strapiUrl: string,
  apiToken: string
): Promise<Map<string, number>> {
  const mediaMap = new Map<string, number>();
  const imagesDir = path.join(projectDir, "public", "assets", "images");

  if (!(await fs.pathExists(imagesDir))) {
    console.log("   No images directory found");
    return mediaMap;
  }

  const imageFiles = await glob("**/*.{jpg,jpeg,png,gif,webp,avif,svg}", {
    cwd: imagesDir,
    absolute: false
  });

  // Fetch existing media to skip duplicates
  console.log(`   Checking for existing media...`);
  const existingMedia = await getExistingMedia(strapiUrl, apiToken);
  let uploadedCount = 0;
  let skippedCount = 0;
  console.log(`   Processing ${imageFiles.length} images...`);

  for (const imageFile of imageFiles) {
    const fileName = path.basename(imageFile);

    // Check if file already exists
    const existingId = existingMedia.get(fileName);

    if (existingId) {
      // Use existing media ID
      addMediaMapEntries(mediaMap, imageFile, existingId);
      skippedCount++;
      continue;
    }

    // Upload new image
    const imagePath = path.join(imagesDir, imageFile);
    const mediaId = await uploadImage(imagePath, imageFile, strapiUrl, apiToken);

    if (mediaId) {
      addMediaMapEntries(mediaMap, imageFile, mediaId);
      uploadedCount++;
      console.log(`   ✓ ${imageFile}`);
    }
  }
  console.log(`   Uploaded: ${uploadedCount}, Skipped (existing): ${skippedCount}`);
  return mediaMap;
}

/**
 * Upload a single image to Strapi
 */
async function uploadImage(
  filePath: string,
  fileName: string,
  strapiUrl: string,
  apiToken: string
): Promise<number | null> {
  try {
    // Read file as buffer and create Blob
    const fileBuffer = await fs.readFile(filePath);
    const mimeType = getMimeType(fileName);
    const blob = new Blob([fileBuffer], { type: mimeType });

    // Use native FormData (works with native fetch)
    const formData = new globalThis.FormData();
    formData.append("files", blob, fileName);

    const response = await fetch(`${strapiUrl}/api/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `   ✗ Failed to upload ${fileName}: ${response.status} - ${errorText}`
      );
      return null;
    }
    const data = await response.json();

    // @ts-ignore
    return data[0]?.id || null;
  } catch (error) {
    console.error(`   ✗ Error uploading ${fileName}:`, error);
    return null;
  }
}


function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml"
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * Seed all content from seed-data.json
 */
async function seedContent(
  projectDir: string,
  strapiUrl: string,
  apiToken: string,
  mediaMap: Map<string, number>
): Promise<void> {
  const seedPath = seedDataPath(projectDir);

  if (!(await fs.pathExists(seedPath))) {
    console.log("   No seed data found");
    return;
  }

  const seedData = await fs.readJson(seedPath);

  const localSchemasDir = schemasDir(projectDir);
  const schemas = new Map<string, any>();

  const schemaFiles = await glob("*.json", { cwd: localSchemasDir });
  for (const file of schemaFiles) {
    const schema = await fs.readJson(path.join(localSchemasDir, file));
    const name = path.basename(file, ".json");
    schemas.set(name, schema);
  }

  let successCount = 0;
  let totalCount = 0;

  for (const [contentType, data] of Object.entries(seedData)) {
    const schema = schemas.get(contentType);

    if (!schema) {
      console.log(`   ⚠️  No schema found for ${contentType}, skipping...`);
      continue;
    }

    const singularName = schema.info.singularName;
    const pluralName = schema.info.pluralName;

    // Check if it's a collection (array) or single type (object)
    if (Array.isArray(data)) {
      // Collection type - use pluralName
      console.log(`   Seeding ${contentType} (${data.length} items)...`);

      for (const item of data) {
        totalCount++;
        const processedItem = processMediaFields(item, mediaMap);
        const success = await createEntry(
          pluralName,
          processedItem,
          strapiUrl,
          apiToken
        );
        if (success) successCount++;
      }
    } else {
      // Single type - use singularName
      console.log(`   Seeding ${contentType}...`);
      totalCount++;
      const processedData = processMediaFields(data, mediaMap);
      const success = await createOrUpdateSingleType(
        singularName,
        processedData,
        strapiUrl,
        apiToken
      );
      if (success) successCount++;
    }
  }

  console.log(`   ✓ Successfully seeded ${successCount}/${totalCount} entries`);
}

/**
 * Process an object to replace image paths with media IDs
 */
function processMediaFields(data: any, mediaMap: Map<string, number>): any {
  const processed: any = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      // Check if this is an image path
      if (
        key.includes("image") ||
        key.includes("img") ||
        key.includes("bg") ||
        value.startsWith("/images/") ||
        value.startsWith("images/") ||
        value.startsWith("/assets/images/") ||
        value.startsWith("assets/images/") ||
        isLikelyImagePath(value)
      ) {
        const mediaId = findMediaId(mediaMap, value);
        if (mediaId) {
          processed[key] = mediaId;
        } else {
          processed[key] = null;
        }
      } else {
        processed[key] = value;
      }
    } else {
      processed[key] = value;
    }
  }

  return processed;
}

function addMediaMapEntries(mediaMap: Map<string, number>, imageFile: string, mediaId: number): void {
  for (const key of mediaLookupKeys(imageFile)) {
    mediaMap.set(key, mediaId);
  }
}

function findMediaId(mediaMap: Map<string, number>, value: string): number | undefined {
  for (const key of mediaLookupKeys(value)) {
    const mediaId = mediaMap.get(key);
    if (mediaId) return mediaId;
  }
  return undefined;
}

/**
 * Create a collection entry
 */
async function createEntry(
  contentType: string,
  data: any,
  strapiUrl: string,
  apiToken: string
): Promise<boolean> {
  try {
    const response = await fetch(`${strapiUrl}/api/${contentType}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`
      },
      body: JSON.stringify({ data })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `   ✗ Failed to create ${contentType}: ${response.status} - ${errorText}`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(`   ✗ Error creating ${contentType}:`, error);
    return false;
  }
}

/**
 * Create or update a single type entry
 */
async function createOrUpdateSingleType(
  contentType: string,
  data: any,
  strapiUrl: string,
  apiToken: string
): Promise<boolean> {
  try {
    const response = await fetch(`${strapiUrl}/api/${contentType}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`
      },
      body: JSON.stringify({ data })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `   ✗ Failed to update ${contentType}: ${response.status} - ${errorText}`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(`   ✗ Error updating ${contentType}:`, error);
    return false;
  }
}

/**
 * CLI wrapper
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(
      "Usage: tsx strapi-setup.ts <project-dir> <strapi-dir> [strapi-url] [api-token]"
    );
    console.log("");
    console.log("Example:");
    console.log("  tsx strapi-setup.ts ./nuxt-project ./strapi-dev");
    console.log(
      "  tsx strapi-setup.ts ./nuxt-project ./strapi-dev http://localhost:1337 abc123"
    );
    process.exit(1);
  }

  const [projectDir, strapiDir, strapiUrl, apiToken] = args;

  await completeSetup({
    projectDir,
    strapiDir,
    strapiUrl,
    apiToken
  });
}

// Run if executed directly (ESM compatible)
// When imported, this won't run. When executed directly, it will.
const isMainModule =
  process.argv[1] && process.argv[1].endsWith("strapi-setup.ts");
if (isMainModule) {
  main().catch((error) => {
    console.error("❌ Setup failed:", error.message);
    process.exit(1);
  });
}
