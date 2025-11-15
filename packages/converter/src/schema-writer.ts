/**
 * Write Strapi schemas to disk
 */

import fs from 'fs-extra';
import path from 'path';
import type { StrapiSchema } from '@see-ms/types';

/**
 * Write a single Strapi schema to a flat directory
 */
export async function writeStrapiSchema(
  outputDir: string,
  name: string,
  schema: StrapiSchema
): Promise<void> {
  const schemasDir = path.join(outputDir, 'cms-schemas');
  await fs.ensureDir(schemasDir);
  
  const schemaPath = path.join(schemasDir, `${name}.json`);
  await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2), 'utf-8');
}

/**
 * Write all schemas
 */
export async function writeAllSchemas(
  outputDir: string,
  schemas: Record<string, StrapiSchema>
): Promise<void> {
  for (const [name, schema] of Object.entries(schemas)) {
    await writeStrapiSchema(outputDir, name, schema);
  }
}

/**
 * Create a README for the CMS schemas
 */
export async function createStrapiReadme(outputDir: string): Promise<void> {
  const readmePath = path.join(outputDir, 'cms-schemas', 'README.md');
  
  const content = `# CMS Schemas

Auto-generated Strapi content type schemas from your Webflow export.

## What's in this folder?

Each \`.json\` file is a Strapi content type schema:

- **Pages** (single types) - Unique pages like \`index.json\`, \`about.json\`
- **Collections** (collection types) - Repeating content like \`portfolio_cards.json\`

## How to use with Strapi

### Option 1: Manual Setup (Recommended for learning)

1. Start your Strapi project
2. In Strapi admin, go to **Content-Type Builder**
3. Create each content type manually using these schemas as reference
4. Match the field names and types

### Option 2: Automated Setup (Advanced)

Copy schemas to your Strapi project structure:

\`\`\`bash
# For each schema file, create the Strapi directory structure
# Example for index.json (single type):
mkdir -p strapi/src/api/index/content-types/index
cp cms-schemas/index.json strapi/src/api/index/content-types/index/schema.json

# Example for portfolio_cards.json (collection type):
mkdir -p strapi/src/api/portfolio-cards/content-types/portfolio-card
cp cms-schemas/portfolio_cards.json strapi/src/api/portfolio-cards/content-types/portfolio-card/schema.json
\`\`\`

Then restart Strapi - it will auto-create the content types.

## Schema Structure

Each schema defines:
- \`kind\`: "singleType" (unique page) or "collectionType" (repeating)
- \`attributes\`: Fields and their types (string, richtext, media, etc.)
- \`displayName\`: How it appears in Strapi admin

## Field Types

- \`string\` - Plain text
- \`richtext\` - Formatted text with HTML
- \`media\` - Image uploads

## Next Steps

1. Set up a Strapi project: \`npx create-strapi-app@latest my-strapi\`
2. Use these schemas to create content types
3. Populate content in Strapi admin
4. Connect your Nuxt app to Strapi API

## API Usage in Nuxt

Once Strapi is running with these content types:

\`\`\`typescript
// Fetch single type (e.g., home page)
const { data } = await $fetch('http://localhost:1337/api/index')

// Fetch collection type (e.g., portfolio cards)
const { data } = await $fetch('http://localhost:1337/api/portfolio-cards')
\`\`\`
`;
  
  await fs.writeFile(readmePath, content, 'utf-8');
}
