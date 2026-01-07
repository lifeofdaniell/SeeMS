/**
 * Seed Data Writer
 * Writes extracted content to seed data files
 */

import fs from 'fs-extra';
import path from 'path';

/**
 * Write seed data to JSON file
 */
export async function writeSeedData(
    outputDir: string,
    seedData: Record<string, any>
): Promise<void> {
    const seedDir = path.join(outputDir, 'cms-seed');
    await fs.ensureDir(seedDir);

    const seedPath = path.join(seedDir, 'seed-data.json');
    await fs.writeJson(seedPath, seedData, { spaces: 2 });
}

/**
 * Create README for seed data
 */
export async function createSeedReadme(outputDir: string): Promise<void> {
    const readmePath = path.join(outputDir, 'cms-seed', 'README.md');

    const content = `# CMS Seed Data

Auto-extracted content from your Webflow export, ready to seed into Strapi.

## What's in this folder?

\`seed-data.json\` contains the actual content extracted from your HTML:
- **Single types** - Page-specific content (homepage, about page, etc.)
- **Collection types** - Repeating items (portfolio cards, team members, etc.)

## Structure

\`\`\`json
{
  "index": {
    "hero_heading_container": "Actual heading from HTML",
    "hero_bg_image": "/images/hero.jpg",
    ...
  },
  "portfolio_cards": [
    {
      "image": "/images/card1.jpg",
      "tag": "Technology",
      "description": "Card description"
    }
  ]
}
\`\`\`

## How to Seed Strapi

### Option 1: Manual Entry
1. Open Strapi admin panel
2. Go to Content Manager
3. Create entries using the data from \`seed-data.json\`

### Option 2: Automated Seeding (Coming Soon)
We'll provide a seeding script that:
1. Uploads images to Strapi media library
2. Creates content entries via Strapi API
3. Handles relationships between content types

## Image Paths

Image paths in the seed data reference files in your Nuxt \`public/\` directory:
- \`/images/hero.jpg\` → \`public/images/hero.jpg\`

When seeding Strapi, these images will be uploaded to Strapi's media library.

## Next Steps

1. Review the extracted data for accuracy
2. Set up your Strapi instance with the schemas from \`cms-schemas/\`
3. Use this seed data to populate your CMS
`;

    await fs.writeFile(readmePath, content, 'utf-8');
}
