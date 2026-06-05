# @see-ms/converter

SeeMS converts Webflow HTML exports into **Astro + Vue** (default) or **Nuxt 3** projects with a reviewable CMS
manifest, Strapi schemas/seed data, and an inline editing overlay.

The goal is not just HTML-to-Vue syntax. SeeMS tries to preserve the site, explain what it found, componentize obvious
reusable sections, make content editable, and wire a developer-friendly Strapi workflow.

## Quick Start

```bash
cms analyze ./webflow-export
cms convert ./webflow-export ./site            # defaults to Astro + Vue
cms convert ./webflow-export ./site --target nuxt
```

`convert` produces pages, page-level CMS fields, schemas, and seed. To turn repeating sections into collections and
nav/footer into shared single-types, run the dedicated `extract` commands afterward:

```bash
cms extract collections ./site
cms extract components ./site
```

Use `--skip-prompts` for repeatable runs:

```bash
cms convert ./webflow-export ./site \
  --config ./site/see-ms.config.ts \
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

### 4. Convert

Run the interactive converter (defaults to Astro + Vue):

```bash
cms convert ./webflow-export ./site
cms convert ./webflow-export ./site --target nuxt   # Nuxt 3
```

With your own boilerplate:

```bash
cms convert ./webflow-export ./site \
  --boilerplate /path/to/boilerplate
```

The converter writes (Astro + Vue shown):

```text
site/
  src/
    pages/*.astro                 # one SSR page per Webflow page
    components/pages/*.vue         # the rendered Vue body for each page
    layouts/BaseLayout.astro       # shared shell (CSS, scripts)
    composables/                   # Strapi content runtime
    cms-editor.ts                  # inline editor entry (dev/preview only)
  public/
    cms-manifest.json              # provider-neutral source of truth
    assets/                        # images, css, videos, documents
  .see-ms/
    schemas/*.json                 # Strapi content-type schemas
    seed/seed-data.json            # seed content
    strapi-bootstrap/index.ts      # public-permissions bootstrap
    report.md, report.json         # human + machine conversion report
    state.json, generated.json     # internal state / generated-file manifest
  astro.config.mjs
  see-ms.config.ts                 # repeatable settings
```

For Nuxt the page files live in `pages/*.vue` and shared components in `components/`; the `.see-ms/`, `public/cms-manifest.json`,
and `see-ms.config.ts` outputs are the same.

### 5. Review the report and config

Start with:

```text
site/.see-ms/report.md
site/see-ms.config.ts
site/public/cms-manifest.json
```

Use the report to check pages, routes, assets, editable fields, schemas, seed data, and warnings.

Use `see-ms.config.ts` to make future runs repeatable.

### 6. Extract collections and shared components

`convert` covers pages and page-level fields. Run the `extract` commands to model repeating sections and shared
chrome:

```bash
cms extract collections ./site     # repeating cards/lists → Strapi collection types
cms extract components ./site      # nav/footer/hero → shared single-types
```

Both are interactive and re-run the CMS layer (manifest → pages → schemas → seed) against the original Webflow HTML, so
you can iterate without a full reconversion. See **Extract Commands** below.

### 7. Repeat conversion without prompts

After reviewing config, rerun non-interactively:

```bash
cms convert ./webflow-export ./site \
  --config ./site/see-ms.config.ts \
  --skip-prompts
```

### 8. Create or connect Strapi

If you do not have Strapi yet:

```bash
cms scaffold-strapi ./strapi-app
```

Or scaffold it during conversion:

```bash
cms convert ./webflow-export ./site \
  --scaffold-strapi ./strapi-app
```

If you already have Strapi:

```bash
cms setup-strapi ./site ./strapi-app
```

`setup-strapi` copies generated schemas, installs the generated Strapi bootstrap into `strapi-app/src/index.ts`, uploads
media, and seeds content. If `src/index.ts` already exists, SeeMS backs it up and merges the public-permissions bootstrap
when it can do so safely. It installs schemas first, then asks you to start Strapi in another terminal and press Enter —
no stop/restart cycle required.

If the target Strapi directory does not exist yet, `setup-strapi` can create it:

```bash
cms setup-strapi ./site ./strapi-app --scaffold
```

### 9. Run the site and Strapi

In the converted project:

```bash
cd ./site
pnpm install
pnpm dev          # astro dev (or nuxt dev for the Nuxt target)
```

In the Strapi project:

```bash
cd ./strapi-app
npm run develop
```

Use the package manager you chose when scaffolding Strapi.

### 10. Open the inline editor

Open the app normally (`http://localhost:4321` for Astro, `http://localhost:3000` for Nuxt), then open
preview/editing mode by appending `?preview=true`:

```text
http://localhost:4321?preview=true
```

The inline editor reads `public/cms-manifest.json` and lets you edit text, rich text, links, images, and icons, then
save/publish through Strapi. (Astro: the editor's API routes need the `@astrojs/node` adapter, which SeeMS wires in
automatically when the editor is enabled.)

### 11. Use the fixture for local testing

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

1. **Analyze** scans pages, routes, and assets.
2. **Convert** writes pages (Astro `.astro` + Vue, or Nuxt `.vue`), page-level CMS fields, schemas, and seed.
3. **Extract** (`extract collections` / `extract components`) models repeating sections and shared chrome.
4. **Strapi** — `setup-strapi` installs schemas, the bootstrap, media, and seed data.
5. **Editor** — the inline overlay is wired during convert/extract for `?preview=true`.

Every conversion writes:

- `see-ms.config.ts` for repeatable settings
- `.see-ms/report.md` for a human-readable summary
- `.see-ms/report.json` for automation
- `public/cms-manifest.json` as the provider-neutral source of truth

## Extract Commands

Shared components and collections are owned by the `extract` commands rather than the convert wizard. They read the
original Webflow HTML, rebuild the manifest, regenerate page bindings, and regenerate schemas + seed — so they are safe
to re-run as you iterate.

```bash
# Repeating cards/lists → Strapi collection types (interactive)
cms extract collections ./site

# nav / footer / hero → shared single-types rendered via <Component/> (interactive)
cms extract components ./site
```

`extract components` prompts for a name, a CSS selector, a role
(**shared-section** = one per page, or **collection-item** = repeats within a page), and — for collection items — a
collection name and any nested repeating children (e.g. tags inside a card), which become a Strapi repeatable component.

> The convert wizard's old "Extract shared components" and "Configure collection types" prompts are temporarily
> disabled (kept in source behind `ENABLE_COMPONENT_PROMPT` / `ENABLE_COLLECTION_PROMPT`). Use the `extract` commands
> for now; `--collection-classes` and config hints still work in `convert`.

## Interactive Conversion

By default, `cms convert` opens a small wizard:

- asks the target framework (**Astro + Vue** default, or Nuxt 3)
- confirms input, output, boilerplate, and CMS provider
- previews discovered pages and routes
- asks whether to generate seed content
- asks whether to wire the inline editor

The wizard is designed for developers: it explains what the converter sees before it writes the final project.

> Shared-component and collection prompts have moved out of the wizard. Run `extract components` / `extract
> collections` after converting (see **Extract Commands**).

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

SeeMS detects editable fields from the page HTML:

- headings, paragraphs, spans, list items, and leaf text nodes
- rich text when nested formatting is present
- images and icons as media fields
- links as `{ url, text, newTab }`
- collections from configured classes / selectors (via `extract collections`)
- shared components from explicit selectors (via `extract components`)

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
cms convert ./webflow-export ./site \
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
cms setup-strapi ./site ./strapi-app
cms generate ./site/public/cms-manifest.json --type strapi   # regenerate schemas from the manifest
```

The manifest stays provider-neutral so Contentful and Sanity adapters can be added later without changing the detection
model.

## Inline Editor

When enabled, SeeMS wires `@see-ms/editor-overlay`.

Open the generated site in preview mode (Astro: `http://localhost:4321`, Nuxt: `http://localhost:3000`):

```text
http://localhost:4321?preview=true
```

The editor reads `public/cms-manifest.json`, then supports:

- click-to-edit text and headings
- basic rich text controls
- link text, URL, and new-tab editing
- image/icon path replacement
- draft restore/discard
- save and publish through Strapi

On the Astro target, the editor's save/publish API routes are server-rendered (`prerender = false`), which is why SeeMS
adds the `@astrojs/node` adapter automatically when the editor is enabled.

## Fixtures And Local Test Projects

- `packages/converter/fixtures/webflow-basic` is a small repeatable Webflow-style fixture.
