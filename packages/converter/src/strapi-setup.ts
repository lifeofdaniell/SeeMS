/**
 * Strapi Complete Setup Script
 * Installs schemas, uploads images, and seeds content - all in one command
 */

import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import FormData from 'form-data';

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
 */
export async function completeSetup(options: SetupOptions): Promise<void> {
    const { projectDir, strapiDir, strapiUrl = 'http://localhost:1337', apiToken } = options;

    console.log('🚀 Starting complete Strapi setup...\n');

    // Step 1: Install schemas
    console.log('📦 Step 1: Installing schemas...');
    await installSchemas(projectDir, strapiDir);
    console.log('✓ Schemas installed\n');

    // Step 2: Wait for user to restart Strapi
    console.log('⏸️  Step 2: Restart Strapi to load schemas');
    console.log('   Run: npm run develop (in Strapi directory)');
    console.log('   Press Enter when Strapi is running...');

    await waitForEnter();

    // Step 3: Check Strapi is running
    console.log('\n🔍 Step 3: Checking Strapi connection...');
    const isRunning = await checkStrapiRunning(strapiUrl);

    if (!isRunning) {
        console.error('❌ Cannot connect to Strapi at', strapiUrl);
        console.log('   Make sure Strapi is running: npm run develop');
        process.exit(1);
    }

    console.log('✓ Connected to Strapi\n');

    // Step 4: Get API token
    let token = apiToken;
    if (!token) {
        console.log('🔑 Step 4: API Token needed');
        console.log('   1. Open Strapi admin: http://localhost:1337/admin');
        console.log('   2. Go to Settings > API Tokens > Create new API Token');
        console.log('   3. Name: "Seed Script", Type: "Full access", Duration: "Unlimited"');
        console.log('   4. Copy the token and paste it here:\n');

        token = await promptForToken();
        console.log('');
    }

    // Step 5: Upload images
    console.log('📸 Step 5: Uploading images...');
    const mediaMap = await uploadAllImages(projectDir, strapiUrl, token);
    console.log(`✓ Uploaded ${Object.keys(mediaMap).length} images\n`);

    // Step 6: Seed content
    console.log('📝 Step 6: Seeding content...');
    await seedContent(projectDir, strapiUrl, token, mediaMap);
    console.log('✓ Content seeded\n');

    console.log('✅ Complete setup finished!');
    console.log('\n📋 Next steps:');
    console.log('   1. Open Strapi admin: http://localhost:1337/admin');
    console.log('   2. Check Content Manager - your content should be there!');
    console.log('   3. Connect your Nuxt app to Strapi API');
}

/**
 * Install all schemas from cms-schemas folder into Strapi
 */
async function installSchemas(projectDir: string, strapiDir: string): Promise<void> {
    const schemaDir = path.join(projectDir, 'cms-schemas');

    const schemaFiles = await glob('*.json', {
        cwd: schemaDir,
        absolute: false,
    });

    if (schemaFiles.length === 0) {
        console.log('⚠️  No schema files found');
        return;
    }

    console.log(`   Found ${schemaFiles.length} schema file(s)`);

    for (const file of schemaFiles) {
        const schemaPath = path.join(schemaDir, file);
        const schema = await fs.readJson(schemaPath);
        const singularName = schema.info?.singularName || path.basename(file, '.json');

        const apiPath = path.join(strapiDir, 'src', 'api', singularName);
        const contentTypesPath = path.join(apiPath, 'content-types', singularName);
        const targetPath = path.join(contentTypesPath, 'schema.json');

        await fs.ensureDir(contentTypesPath);
        await fs.writeJson(targetPath, schema, { spaces: 2 });
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

/**
 * Wait for user to press Enter
 */
async function waitForEnter(): Promise<void> {
    return new Promise((resolve) => {
        process.stdin.once('data', () => resolve());
    });
}

/**
 * Prompt user for API token
 */
async function promptForToken(): Promise<string> {
    return new Promise((resolve) => {
        process.stdout.write('   Token: ');
        process.stdin.once('data', (data) => {
            resolve(data.toString().trim());
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
    const imagesDir = path.join(projectDir, 'public', 'images');

    if (!(await fs.pathExists(imagesDir))) {
        console.log('   No images directory found');
        return mediaMap;
    }

    const imageFiles = await glob('**/*.{jpg,jpeg,png,gif,webp,svg}', {
        cwd: imagesDir,
        absolute: false,
    });

    console.log(`   Uploading ${imageFiles.length} images...`);

    for (const imageFile of imageFiles) {
        const imagePath = path.join(imagesDir, imageFile);
        const mediaId = await uploadImage(imagePath, imageFile, strapiUrl, apiToken);

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
        const formData = new FormData();
        const fileStream = fs.createReadStream(filePath);
        formData.append('files', fileStream, fileName);

        const response = await fetch(`${strapiUrl}/api/upload`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiToken}`,
            },
            body: formData as any,
        });

        if (!response.ok) {
            console.error(`   ✗ Failed to upload ${fileName}`);
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

/**
 * Seed all content from seed-data.json
 */
async function seedContent(
    projectDir: string,
    strapiUrl: string,
    apiToken: string,
    mediaMap: Map<string, number>
): Promise<void> {
    const seedPath = path.join(projectDir, 'cms-seed', 'seed-data.json');

    if (!(await fs.pathExists(seedPath))) {
        console.log('   No seed data found');
        return;
    }

    const seedData = await fs.readJson(seedPath);
    let successCount = 0;
    let totalCount = 0;

    for (const [contentType, data] of Object.entries(seedData)) {
        // Check if it's a collection (array) or single type (object)
        if (Array.isArray(data)) {
            // Collection type
            console.log(`   Seeding ${contentType} (${data.length} items)...`);

            for (const item of data) {
                totalCount++;
                const processedItem = processMediaFields(item, mediaMap);
                const success = await createEntry(contentType, processedItem, strapiUrl, apiToken);
                if (success) successCount++;
            }
        } else {
            // Single type
            console.log(`   Seeding ${contentType}...`);
            totalCount++;
            const processedData = processMediaFields(data, mediaMap);
            const success = await createOrUpdateSingleType(contentType, processedData, strapiUrl, apiToken);
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
        if (typeof value === 'string') {
            // Check if this is an image path
            if (key.includes('image') || key.includes('bg') || value.startsWith('/images/')) {
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
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify({ data }),
        });

        return response.ok;
    } catch {
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
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify({ data }),
        });

        return response.ok;
    } catch {
        return false;
    }
}

/**
 * CLI wrapper
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log('Usage: tsx strapi-setup.ts <project-dir> <strapi-dir> [strapi-url] [api-token]');
        console.log('');
        console.log('Example:');
        console.log('  tsx strapi-setup.ts ./nuxt-project ./strapi-dev');
        console.log('  tsx strapi-setup.ts ./nuxt-project ./strapi-dev http://localhost:1337 abc123');
        process.exit(1);
    }

    const [projectDir, strapiDir, strapiUrl, apiToken] = args;

    await completeSetup({
        projectDir,
        strapiDir,
        strapiUrl,
        apiToken,
    });
}

// Run if executed directly
// When imported, this won't run. When executed directly, it will.
const isMainModule = process.argv[1] && process.argv[1].endsWith('strapi-setup.ts');
if (isMainModule) {
    main().catch((error) => {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    });
}
