/**
 * Strapi Complete Setup Script
 * Installs schemas, uploads images, and seeds content - all in one command
 */

import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import * as readline from "readline";

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
}

/**
 * Main setup function
 * Exported for use by CLI and direct execution
 */
export async function completeSetup(options: SetupOptions): Promise<void> {
  const {
    projectDir,
    strapiDir,
    strapiUrl = "http://localhost:1337",
    apiToken
  } = options;

  console.log("🚀 Starting complete Strapi setup...\n");

  // Step 1: Install schemas
  console.log("📦 Step 1: Installing schemas...");
  await installSchemas(projectDir, strapiDir);
  console.log("✓ Schemas installed\n");

  // Step 2: Wait for user to restart Strapi
  console.log("⏸️  Step 2: Restart Strapi to load schemas");
  console.log("   Run: npm run develop (in Strapi directory)");
  console.log("   Press Enter when Strapi is running...");

  await waitForEnter();

  // Step 3: Check Strapi is running
  console.log("\n🔍 Step 3: Checking Strapi connection...");
  const isRunning = await checkStrapiRunning(strapiUrl);

  if (!isRunning) {
    console.error("❌ Cannot connect to Strapi at", strapiUrl);
    console.log("   Make sure Strapi is running: npm run develop");
    process.exit(1);
  }

  console.log("✓ Connected to Strapi\n");

  // Step 4: Get API token
  let token = apiToken;
  if (!token) {
    console.log("🔑 Step 4: API Token needed");
    console.log("   1. Open Strapi admin: http://localhost:1337/admin");
    console.log("   2. Go to Settings > API Tokens > Create new API Token");
    console.log(
      "   3. Name: \"Seed Script\", Type: \"Full access\", Duration: \"Unlimited\""
    );
    console.log("   4. Copy the token and paste it here:\n");

    token = await promptForToken();
    console.log("");
  }

  // Step 5: Upload images
  console.log("📸 Step 5: Uploading images...");
  const mediaMap = await uploadAllImages(projectDir, strapiUrl, token);
  console.log(`✓ Uploaded ${Object.keys(mediaMap).length} images\n`);

  // Step 6: Seed content
  console.log("📝 Step 6: Seeding content...");
  await seedContent(projectDir, strapiUrl, token, mediaMap);
  console.log("✓ Content seeded\n");

  console.log("✅ Complete setup finished!");
  console.log("\n📋 Next steps:");
  console.log("   1. Open Strapi admin: http://localhost:1337/admin");
  console.log("   2. Check Content Manager - your content should be there!");
  console.log("   3. Connect your Nuxt app to Strapi API");
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

  const schemaDir = path.join(projectDir, "cms-schemas");

  const schemaFiles = await glob("*.json", {
    cwd: schemaDir,
    absolute: false
  });

  if (schemaFiles.length === 0) {
    console.log("⚠️  No schema files found");
    return;
  }

  console.log(`   Found ${schemaFiles.length} schema file(s)`);

  for (const file of schemaFiles) {
    const schemaPath = path.join(schemaDir, file);
    const schema = await fs.readJson(schemaPath);
    const singularName =
      schema.info?.singularName || path.basename(file, ".json");

    // console.log(`   Generating ${singularName}...`);
    //
    // try {
    //     execSync(`npx strapi generate api ${singularName}`, {
    //         cwd: strapiDir,
    //         stdio: 'pipe',
    //     });
    //
    //     const apiPath = path.join(strapiDir, 'src', 'api', singularName);
    //     const contentTypesPath = path.join(apiPath, 'content-types', singularName);
    //     const targetPath = path.join(contentTypesPath, 'schema.json');
    //
    //     await fs.writeJson(targetPath, schema, { spaces: 2 });
    //     console.log(`   ✓ Created ${singularName}`);
    // } catch (error: any) {
    //     const errorMessage = error.stderr?.toString() || error.message || 'Unknown error';
    //     console.error(`   ✗ Failed to generate ${singularName}: ${errorMessage}`);
    // }
    // // const apiPath = path.join(strapiDir, 'src', 'api', singularName);
    // // const contentTypesPath = path.join(apiPath, 'content-types', singularName);
    // // const targetPath = path.join(contentTypesPath, 'schema.json');
    // //
    // // await fs.ensureDir(contentTypesPath);
    // // await fs.writeJson(targetPath, schema, { spaces: 2 });
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

/**
 * Check if Strapi is running
 */
async function checkStrapiRunning(strapiUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${strapiUrl}/_health`);
    return response.ok;
  } catch {
    return false;
  }
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

  const imageFiles = await glob("**/*.{jpg,jpeg,png,gif,webp,svg}", {
    cwd: imagesDir,
    absolute: false
  });

  console.log(`   Uploading ${imageFiles.length} images...`);

  for (const imageFile of imageFiles) {
    const imagePath = path.join(imagesDir, imageFile);
    const mediaId = await uploadImage(
      imagePath,
      imageFile,
      strapiUrl,
      apiToken
    );

    if (mediaId) {
      // Store both with and without /images/ prefix for lookup
      mediaMap.set(`/images/${imageFile}`, mediaId);
      mediaMap.set(imageFile, mediaId);
      console.log(`   ✓ ${imageFile}`);
    }
  }

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
  const seedPath = path.join(projectDir, "cms-seed", "seed-data.json");

  if (!(await fs.pathExists(seedPath))) {
    console.log("   No seed data found");
    return;
  }

  const seedData = await fs.readJson(seedPath);

  const schemasDir = path.join(projectDir, "cms-schemas");
  const schemas = new Map<string, any>();

  const schemaFiles = await glob("*.json", { cwd: schemasDir });
  for (const file of schemaFiles) {
    const schema = await fs.readJson(path.join(schemasDir, file));
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
        key.includes("bg") ||
        value.startsWith("/images/")
      ) {
        const mediaId = mediaMap.get(value);
        if (mediaId) {
          processed[key] = mediaId;
        } else {
          processed[key] = value; // Keep original if not found
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
