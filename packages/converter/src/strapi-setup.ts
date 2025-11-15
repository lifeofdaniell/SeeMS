/**
 * Strapi Schema Installation Script
 * Copies generated schemas from cms-schema/ to Strapi's api directory
 */

import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';

interface SchemaFile {
    name: string;
    path: string;
    schema: any;
}

/**
 * Install all schemas from cms-schema folder into Strapi
 */
export async function installSchemas(
    schemaDir: string,
    strapiDir: string
): Promise<void> {
    console.log('📦 Installing Strapi schemas...\n');

    // Find all schema JSON files
    const schemaFiles = await glob('*.json', {
        cwd: schemaDir,
        absolute: false,
    });

    if (schemaFiles.length === 0) {
        console.log('⚠️  No schema files found in', schemaDir);
        return;
    }

    console.log(`Found ${schemaFiles.length} schema file(s):\n`);

    const schemas: SchemaFile[] = [];

    // Read all schemas
    for (const file of schemaFiles) {
        const schemaPath = path.join(schemaDir, file);
        const schema = await fs.readJson(schemaPath);
        const name = path.basename(file, '.json');

        schemas.push({ name, path: schemaPath, schema });
        console.log(`  - ${name}.json (${schema.kind})`);
    }

    console.log('');

    // Install each schema
    for (const { name, schema } of schemas) {
        await installSchema(name, schema, strapiDir);
    }

    console.log('\n✅ All schemas installed successfully!');
    console.log('\n💡 Next steps:');
    console.log('   1. Restart Strapi: npm run develop');
    console.log('   2. Check Content-Type Builder in admin panel');
    console.log('   3. Your content types should appear automatically');
}

/**
 * Install a single schema into Strapi
 */
async function installSchema(
    name: string,
    schema: any,
    strapiDir: string
): Promise<void> {
    // CRITICAL: Use singularName from schema for the API folder name
    // Strapi requires the folder name to match singularName exactly
    const singularName = schema.info?.singularName || name;

    // Determine the target path using singularName
    const apiPath = path.join(strapiDir, 'src', 'api', singularName);
    const contentTypesPath = path.join(apiPath, 'content-types', singularName);
    const schemaPath = path.join(contentTypesPath, 'schema.json');

    // Create directory structure
    await fs.ensureDir(contentTypesPath);

    // Write schema file
    await fs.writeJson(schemaPath, schema, { spaces: 2 });

    console.log(`✓ Installed: ${name}`);
    console.log(`  → src/api/${singularName}/content-types/${singularName}/schema.json`);
}

/**
 * CLI wrapper for easy testing
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log('Usage: tsx strapi-setup.ts <cms-schema-dir> <strapi-dir>');
        console.log('');
        console.log('Example:');
        console.log('  tsx strapi-setup.ts ./test-editor/cms-schema ./strapi-dev');
        process.exit(1);
    }

    const [schemaDir, strapiDir] = args;

    // Validate paths
    if (!(await fs.pathExists(schemaDir))) {
        console.error(`❌ Schema directory not found: ${schemaDir}`);
        process.exit(1);
    }

    if (!(await fs.pathExists(strapiDir))) {
        console.error(`❌ Strapi directory not found: ${strapiDir}`);
        process.exit(1);
    }

    // Check if it's actually a Strapi project
    const strapiPackageJson = path.join(strapiDir, 'package.json');
    if (!(await fs.pathExists(strapiPackageJson))) {
        console.error(`❌ Not a valid Strapi project: ${strapiDir}`);
        process.exit(1);
    }

    const pkg = await fs.readJson(strapiPackageJson);
    if (!pkg.dependencies?.['@strapi/strapi']) {
        console.error(`❌ Not a Strapi project (missing @strapi/strapi dependency)`);
        process.exit(1);
    }

    // Install schemas
    await installSchemas(schemaDir, strapiDir);
}

// Run if executed directly
if (require.main === module) {
    main().catch((error) => {
        console.error('❌ Error:', error.message);
        process.exit(1);
    });
}
