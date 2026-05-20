# @see-ms/converter

SeeMS converts Webflow HTML exports into Nuxt 3 projects with a reviewable CMS manifest, Strapi schemas/seed data, and
an inline editing overlay.

The goal is not just HTML-to-Vue syntax. SeeMS tries to preserve the site, explain what it found, componentize obvious
reusable sections, make content editable, and wire a developer-friendly Strapi workflow.

## Quick Start

```bash
cms analyze ./webflow-export
cms convert ./webflow-export ./nuxt-site
```

Use `--skip-prompts` for repeatable runs:

```bash
cms convert ./webflow-export ./nuxt-site \
  --config ./see-ms.config.ts \
  --skip-prompts
```

## Full Step-By-Step Usage

### 1. Build or install the CLI

When working from this monorepo:

```bash
pnpm install
pnpm --filter @see-ms/types build
pnpm --filter @see-ms/editor-overlay build
pnpm --filter @see-ms/converter build
```

Then use:

```bash
node packages/converter/dist/cli.mjs --help
```

If installed globally or through `npx`, use `cms` in place of `node packages/converter/dist/cli.mjs`.

### 2. Export your Webflow site

Your Webflow export should contain HTML plus asset folders:

```text
webflow-export/
  index.html
  about.html
  products/item.html
  css/
  images/
  fonts/
  js/
```

Nested pages are supported.

### 3. Analyze the export

Run analysis before generating anything:

```bash
cms analyze ./webflow-export
```

This previews pages, Nuxt routes, assets, shared component candidates, and warnings.

### 4. Convert to Nuxt

Run the interactive converter:

```bash
cms convert ./webflow-export ./nuxt-site
```

With a Nuxt boilerplate:

```bash
cms convert ./webflow-export ./nuxt-site \
  --boilerplate /path/to/nuxt-boilerplate
```

The converter writes:

```text
nuxt-site/
  pages/
  components/
  assets/
  public/cms-manifest.json
  cms-schemas/
  cms-seed/seed-data.json
  strapi-bootstrap/
  see-ms.config.ts
  see-ms-report.md
  see-ms-report.json
```

### 5. Review the report and config

Start with:

```text
nuxt-site/see-ms-report.md
nuxt-site/see-ms.config.ts
nuxt-site/public/cms-manifest.json
```

Use the report to check pages, routes, assets, components, editable fields, collections, schemas, seed data, and
warnings.

Use `see-ms.config.ts` to make future runs repeatable.

### 6. Repeat conversion without prompts

After reviewing config, rerun non-interactively:

```bash
cms convert ./webflow-export ./nuxt-site \
  --config ./nuxt-site/see-ms.config.ts \
  --skip-prompts
```

### 7. Create or connect Strapi

If you do not have Strapi yet:

```bash
cms scaffold-strapi ./strapi-app
```

Or scaffold it during conversion:

```bash
cms convert ./webflow-export ./nuxt-site \
  --scaffold-strapi ./strapi-app
```

If you already have Strapi:

```bash
cms setup-strapi ./nuxt-site ./strapi-app
```

If the target Strapi directory does not exist yet, `setup-strapi` can create it:

```bash
cms setup-strapi ./nuxt-site ./strapi-app --scaffold
```

### 8. Run Nuxt and Strapi

In the Nuxt project:

```bash
cd ./nuxt-site
pnpm install
pnpm dev
```

In the Strapi project:

```bash
cd ./strapi-app
npm run develop
```

Use the package manager you chose when scaffolding Strapi.

### 9. Open the inline editor

Open the Nuxt app normally:

```text
http://localhost:3000
```

Open preview/editing mode:

```text
http://localhost:3000?preview=true
```

The inline editor reads `public/cms-manifest.json` and lets you edit text, rich text, links, images, and icons, then
save/publish through Strapi.

### 10. Use the fixture for local testing

From this repo:

```bash
node packages/converter/dist/cli.mjs analyze packages/converter/fixtures/webflow-basic

node packages/converter/dist/cli.mjs convert \
  packages/converter/fixtures/webflow-basic \
  /private/tmp/see-ms-fixture-output \
  --skip-prompts \
  --no-editor
```

## Workflow

1. **Analyze** scans pages, routes, assets, and reusable component candidates.
2. **Plan** guides you through collections, shared components, seed content, and editor wiring.
3. **Convert** writes Nuxt pages and preserves nested asset folders.
4. **CMS** writes `public/cms-manifest.json`, Strapi schemas, and optional seed data.
5. **Editor** installs the inline editor overlay for `?preview=true`.

Every conversion writes:

- `see-ms.config.ts` for repeatable settings
- `see-ms-report.md` for a human-readable summary
- `see-ms-report.json` for automation
- `public/cms-manifest.json` as the provider-neutral source of truth

## Interactive Conversion

By default, `cms convert` opens a small wizard:

- confirms input, output, boilerplate, and CMS provider
- previews discovered pages and routes
- previews shared component candidates
- asks for collection hints when none exist in config
- asks whether to generate seed content
- asks whether to wire the inline editor

The wizard is designed for developers: it explains what the converter sees before it writes the final project.

## Config File

SeeMS writes and reads `see-ms.config.ts`:

```ts
import type {SeeMSConfig} from "@see-ms/types";

const config: SeeMSConfig = {
    cms: {provider: "strapi"},
    collections: [
        {className: "blog-card", name: "blog_posts"}
    ],
    components: {
        enabled: true,
        minOccurrences: 2,
        include: ["nav", "header", "footer"]
    },
    ignore: {
        selectors: [".sr-only"],
        classes: ["decorative-icon"]
    },
    editor: {
        enabled: true,
        previewParam: "preview"
    }
};

export default config;
```

CLI flags can override the config for a single run, but config is the durable source of truth.

## Detection Model

SeeMS detects editable fields from generated Vue templates:

- headings, paragraphs, spans, list items, and leaf text nodes
- rich text when nested formatting is present
- images and icons as media fields
- links as `{ url, text, newTab }`
- collections from `data-cms-collection` or configured classes
- shared components from repeated nav/header/footer/top-level structures

Use Webflow custom attributes for stronger hints:

```html
<h1 data-cms="hero-heading">Solar finance made simple</h1>
<div data-cms-collection="faq-items">...</div>
<p data-cms-ignore>Decorative helper text</p>
```

## Strapi Setup

For v1, Strapi is the supported CMS provider.

If you do not have a Strapi project yet, scaffold one:

```bash
cms scaffold-strapi ./strapi-app
```

Or do it as part of conversion:

```bash
cms convert ./webflow-export ./nuxt-site \
  --scaffold-strapi ./strapi-app
```

For repeatable runs, put it in config:

```ts
const config: SeeMSConfig = {
    cms: {
        provider: "strapi",
        strapi: {
            scaffold: true,
            directory: "./strapi-app",
            packageManager: "npm",
            install: true
        }
    }
};
```

Use `--no-strapi-install` if you want SeeMS to create the Strapi files but skip dependency installation.

If you already have a Strapi project:

```bash
cms setup-strapi ./nuxt-site ./strapi-app
cms generate-schemas ./nuxt-site/public/cms-manifest.json --type strapi
```

The manifest stays provider-neutral so Contentful and Sanity adapters can be added later without changing the detection
model.

## Inline Editor

When enabled, SeeMS wires `@see-ms/editor-overlay`.

Open the generated Nuxt site with:

```text
http://localhost:3000?preview=true
```

The editor reads `cms-manifest.json`, then supports:

- click-to-edit text and headings
- basic rich text controls
- link text, URL, and new-tab editing
- image/icon path replacement
- draft restore/discard
- save and publish through generated Nuxt API routes

## Fixtures And Local Test Projects

- `packages/converter/fixtures/webflow-basic` is a small repeatable Webflow-style fixture.
