# SeeMS Full Flow Testing README

This README is a practical runbook for testing the full SeeMS flow from a fresh Webflow export to a converted
**Astro + Vue** (default) or Nuxt project, Strapi schemas, seeded content, and inline editing.

It also documents every current `cms` CLI command, the interactive wizard prompts, expected inputs and outputs, and the
most automatic path available today.

> **The flow in one line:** `convert` → `extract collections` / `extract components` → `setup-strapi` → run both dev
> servers → `?preview=true`. Convert handles pages, fields, schemas, and seed; the `extract` commands add collections
> and shared components (nav/footer). The convert wizard no longer prompts for components/collections — those run
> through the `extract` commands now.

## Prerequisites

- Node.js 18+
- pnpm 8+
- A Webflow export directory containing HTML plus optional `css/`, `images/`, `fonts/`, and `js/` folders
- Network access if scaffolding Strapi with `npx create-strapi@latest`

From this repo, build the CLI before local testing:

```bash
pnpm --filter @see-ms/converter build
```

When testing from source, use:

```bash
node packages/converter/dist/cli.mjs <command>
```

When installed globally or through `npx`, use:

```bash
cms <command>
```

## Recommended Fresh Test Flow

This is the fastest repeatable local flow using the bundled fixture.

```bash
export WEBFLOW_EXPORT="$PWD/packages/converter/fixtures/webflow-basic"
export SITE="/tmp/see-ms-full-flow/site"
export STRAPI_APP="/tmp/see-ms-full-flow/strapi-app"
export STRAPI_URL="http://localhost:1337"

rm -rf /tmp/see-ms-full-flow
pnpm --filter @see-ms/converter build
```

Analyze the export:

```bash
node packages/converter/dist/cli.mjs analyze "$WEBFLOW_EXPORT"
```

Expected output:

- Markdown report printed to the terminal
- Pages and routes found in the export
- Asset counts
- Warnings, if any

Convert the Webflow export (defaults to Astro + Vue; add `--target nuxt` for Nuxt):

```bash
node packages/converter/dist/cli.mjs convert "$WEBFLOW_EXPORT" "$SITE" \
  --skip-prompts
```

Expected converted project output (Astro + Vue):

- `$SITE/src/pages/**/*.astro` — one SSR page per Webflow page
- `$SITE/src/components/pages/*.vue` — rendered Vue body per page
- `$SITE/src/layouts/BaseLayout.astro`
- `$SITE/public/assets/{images,css,videos,documents}/*`
- `$SITE/public/cms-manifest.json`
- `$SITE/.see-ms/schemas/*.json`
- `$SITE/.see-ms/seed/seed-data.json`
- `$SITE/.see-ms/strapi-bootstrap/index.ts`
- `$SITE/.see-ms/report.md`, `$SITE/.see-ms/report.json`
- `$SITE/.see-ms/state.json`, `$SITE/.see-ms/generated.json`
- `$SITE/see-ms.config.ts`
- `$SITE/astro.config.mjs`

(For `--target nuxt`: pages live in `pages/*.vue`, shared components in `components/`; the `.see-ms/` and
`public/cms-manifest.json` outputs are identical.)

Optionally model collections and shared components (interactive — run after convert):

```bash
# Repeating cards/lists → Strapi collection types
node packages/converter/dist/cli.mjs extract collections "$SITE"

# nav / footer / hero → shared single-types
node packages/converter/dist/cli.mjs extract components "$SITE"
```

These re-read the original Webflow HTML, rebuild the manifest, regenerate page bindings, and regenerate
`.see-ms/schemas` + `.see-ms/seed/seed-data.json`. Safe to re-run as you iterate.

Scaffold Strapi:

```bash
node packages/converter/dist/cli.mjs scaffold-strapi "$STRAPI_APP" \
  --package-manager npm
```

Expected Strapi scaffold output:

- `$STRAPI_APP/package.json`
- `$STRAPI_APP/src/`
- Dependencies installed unless `--no-install` is used

Run `setup-strapi` **first** — it installs the schema files and bootstrap, then pauses and asks you to start Strapi.
(Do not start Strapi before this; it installs the schemas Strapi will load on boot.)

```bash
node packages/converter/dist/cli.mjs setup-strapi "$SITE" "$STRAPI_APP" \
  --url "$STRAPI_URL"
```

When it pauses with:

```text
⏸️  Step 3: Start Strapi in a separate terminal tab
   Come back here and press Enter once Strapi is running.
   (you don't need to wait for it to fully boot — just press Enter)
```

do the following in a **separate terminal**:

```bash
cd "$STRAPI_APP"
npm run develop          # boots with the freshly installed schemas — no restart needed
```

Then, the first time only, create your admin user and an API token:

1. `open "$STRAPI_URL/admin"` and create the first admin user.
2. Settings > API Tokens > create `Seed Script`, `Full access`, `Unlimited` duration. Copy it.

Back in the `setup-strapi` terminal, press Enter. It polls Strapi's health, then prompts for the token (paste it; you
can opt to save it to `$SITE/.env` for next time). You can also pass `--token <token>` up front to skip the prompt.

Expected setup output:

- Schemas copied into `$STRAPI_APP/src/api/*`
- Components copied into `$STRAPI_APP/src/components/*`
- Generated Strapi bootstrap installed into `$STRAPI_APP/src/index.ts`
  (existing `src/index.ts` is backed up and the public-permissions bootstrap merged in when safe)
- Strapi health check succeeds
- Images uploaded to Strapi Media Library
- Seed content written to Strapi content types
- `$SITE/.env` updated if you choose to save the token interactively

Start the converted app:

```bash
cd "$SITE"
pnpm install
pnpm dev          # astro dev → http://localhost:4321  (nuxt dev → http://localhost:3000)
```

Open the site, then inline editing mode by appending `?preview=true`:

```bash
open http://localhost:4321
open 'http://localhost:4321?preview=true'
```

## Most Automatic Current Flow

This minimizes prompts, but Strapi still needs a running server and a token.

```bash
export ROOT="/tmp/see-ms-auto"
export WEBFLOW_EXPORT="$PWD/packages/converter/fixtures/webflow-basic"
export SITE="$ROOT/site"
export STRAPI_APP="$ROOT/strapi-app"
export STRAPI_URL="http://localhost:1337"

rm -rf "$ROOT"
pnpm --filter @see-ms/converter build

node packages/converter/dist/cli.mjs convert "$WEBFLOW_EXPORT" "$SITE" \
  --skip-prompts

node packages/converter/dist/cli.mjs scaffold-strapi "$STRAPI_APP" \
  --package-manager npm
```

Start Strapi, create the first admin user, create an API token, then macOS users can reduce token pasting by copying the token in the browser and running:

```bash
export STRAPI_TOKEN="$(pbpaste)"

node packages/converter/dist/cli.mjs setup-strapi "$SITE" "$STRAPI_APP" \
  --url "$STRAPI_URL" \
  --token "$STRAPI_TOKEN"
```

After the first successful setup, the token can be saved in `$SITE/.env`:

```text
STRAPI_URL=http://localhost:1337
STRAPI_API_TOKEN=...
```

Then future runs can omit `--token` unless you pass `--new-token`.

There is also a compact conversion form:

```bash
node packages/converter/dist/cli.mjs convert "$WEBFLOW_EXPORT" "$SITE" \
  --skip-prompts \
  --scaffold-strapi "$STRAPI_APP"
```

Important: that form does not only scaffold Strapi. It also starts `setup-strapi`, installs schemas, and pauses until
you start Strapi and press Enter. It does **not** run `extract collections` / `extract components` — run those
separately if you need collections or shared components.

## What Is Not Fully Automated Yet

These steps still need human action in the current CLI:

- Creating the first Strapi admin user
- Creating a Strapi API token in the admin UI
- Restarting Strapi after schema files are installed
- Pressing Enter in `setup-strapi` after Strapi is back online
- Starting the converted Nuxt/Astro dev server

Good future automation targets:

- Add a `setup-strapi --wait` mode that polls Strapi instead of waiting for Enter.
- Add a `setup-strapi --no-pause` mode for scripted runs where the caller manages restarts.
- Add a `convert --run-strapi` or separate orchestration script that starts Strapi and the app in managed child processes.
- Use Strapi admin/bootstrap APIs, where possible, to reduce token setup friction.

## CLI Command Reference

Use help at any time:

```bash
cms --help
cms <command> --help
```

From this repo:

```bash
node packages/converter/dist/cli.mjs --help
node packages/converter/dist/cli.mjs <command> --help
```

### `cms analyze [input]`

Scans a Webflow export without writing a converted project.

```bash
cms analyze ./webflow-export
cms analyze ./webflow-export --config ./see-ms.config.ts
```

Arguments:

- `input`: Webflow export directory. If omitted, the CLI prompts for it.

Options:

- `--config <path>`: Load SeeMS config before analyzing. This affects collection hints, ignored selectors/classes, and component detection settings.

Expected output:

- A Markdown analysis report printed to stdout
- Page source paths, page ids, routes, and output paths
- Asset counts
- Shared component candidates
- Warnings

No files are written by this command.

### `cms convert [input] [output]`

Converts a Webflow export into a Nuxt 3 or Astro + Vue project and generates CMS metadata.

```bash
cms convert ./webflow-export ./site
cms convert ./webflow-export ./site --skip-prompts --target nuxt
cms convert ./webflow-export ./astro-site --skip-prompts --target astro-vue
```

Arguments:

- `input`: Webflow export directory. If omitted without `--skip-prompts`, the wizard asks for it.
- `output`: Output project directory. If omitted without `--skip-prompts`, the wizard suggests `<input-name>-seems`.

Options:

- `--target <target>`: `nuxt` or `astro-vue`. Defaults to the config target, otherwise **`astro-vue`**.
- `-b, --boilerplate <source>`: Local path or GitHub URL for a starter project. If used, output must not already exist.
- `-o, --overrides <path>`: Reserved path for overrides JSON. Passed through to conversion options.
- `--config <path>`: Load existing `see-ms.config.ts` or JSON.
- `--cms <type>`: CMS provider. Currently only `strapi` is wired.
- `--skip-prompts`: Non-interactive mode. Requires `input` and `output`.
- `--collection-classes <classes>`: Comma-separated class names for repeating collection items.
- `--no-content`: Skip initial CMS seed content generation.
- `--no-editor`: Skip inline editor wiring.
- `--scaffold-strapi <dir>`: Scaffold a new Strapi project after conversion.
- `--strapi-dir <dir>`: Run Strapi setup against an existing Strapi project after conversion.
- `--strapi-package-manager <manager>`: `npm`, `pnpm`, or `yarn` for Strapi scaffolding.
- `--no-strapi-install`: Scaffold Strapi without installing dependencies.

Expected output:

- Converted pages
- Copied assets
- `public/cms-manifest.json`
- `.see-ms/schemas/`
- `.see-ms/seed/`
- `see-ms.config.ts`
- `.see-ms/report.md`
- `.see-ms/report.json`
- `.see-ms/generated.json`
- `.see-ms/state.json`
- Optional inline editor files
- Optional Strapi scaffold/setup

Idempotency behavior:

- SeeMS tracks generated files in `.see-ms/generated.json`.
- Rerunning conversion updates converter-owned files.
- Stale files generated by previous runs are removed when they disappear from the new export.
- Manual edits inside generated files can still be overwritten.
- Custom files outside the generated file list are left alone.

### `cms scaffold-strapi [strapi-dir]`

Creates a new Strapi project using `npx create-strapi@latest`.

```bash
cms scaffold-strapi ./strapi-app
cms scaffold-strapi ./strapi-app --package-manager pnpm
cms scaffold-strapi ./strapi-app --no-install
```

Arguments:

- `strapi-dir`: Directory where Strapi should be created. If omitted, the CLI prompts for it.

Options:

- `--package-manager <manager>`: `npm`, `pnpm`, or `yarn`. Default: `npm`.
- `--no-install`: Create project files without dependency install.
- `--run`: Start Strapi after scaffolding.
- `--git-init`: Initialize a git repository for the Strapi project.
- `--javascript`: Use JavaScript instead of TypeScript.

Expected output:

- A new Strapi project at `strapi-dir`
- Official Strapi files generated by `create-strapi`
- Dependencies installed unless `--no-install` is used

Failure cases:

- The target directory exists and is not empty.
- Network or package-manager install fails.

### `cms setup-strapi [project-dir] [strapi-dir]`

Installs generated schemas into Strapi, uploads media, and seeds content.

```bash
cms setup-strapi ./site ./strapi-app
cms setup-strapi ./site ./strapi-app --url http://localhost:1337 --token "$STRAPI_TOKEN"
cms setup-strapi ./site ./strapi-app --scaffold
```

Arguments:

- `project-dir`: Converted SeeMS project directory. Must contain `.see-ms/schemas/` and usually `.see-ms/seed/`.
- `strapi-dir`: Strapi project directory.

Options:

- `--url <url>`: Strapi URL. Default: `http://localhost:1337`.
- `--token <token>`: Strapi API token. Avoids token prompt.
- `--new-token`: Ignore saved token in `.env` and prompt for a new one.
- `--scaffold`: Create the Strapi project if `strapi-dir` does not exist.
- `--package-manager <manager>`: Package manager for scaffolding.
- `--no-install`: Scaffold without dependency install.
- `--only <types>`: Seed only these content types (comma-separated seed keys), e.g. `--only news,faqs`. Useful after re-extracting to seed just a newly-added collection.
- `--fresh <types>`: Clear these collections before seeding (comma-separated, or `all`). Wipes the collection's entries, then reseeds clean.
- `--skip-existing`: Skip content types that already have data, so admin edits and existing entries are preserved (only brand-new/empty types are seeded).

Re-seeding is idempotent: collection items carry a stable `seemsKey`, so re-running upserts (updates in place) instead of duplicating. See "Re-seeding and the iterative workflow" below.

What it does:

1. Copies component schemas from `.see-ms/schemas/components/*` to `strapi/src/components/*`.
2. Copies content type schemas from `.see-ms/schemas/*.json` to `strapi/src/api/*`.
3. Creates Strapi route/controller/service files for each content type.
4. Installs the generated Strapi bootstrap into `strapi/src/index.ts`.
5. Backs up and merges an existing `src/index.ts` when it can do so safely.
6. Pauses and asks you to start Strapi in another terminal (schemas are installed first, so Strapi loads them on boot — no restart needed for a fresh setup). Press Enter once it is running.
7. Checks `GET <strapi-url>/_health`.
8. Uses a provided, saved, or prompted API token.
9. Uploads images from `public/assets/images`.
10. Seeds single types with `PUT /api/<type>`.
11. Seeds collection types by upserting on `seemsKey` (`PUT` existing / `POST` new), so re-seeds don't duplicate.

Expected output:

- New files under `strapi/src/api/`
- New files under `strapi/src/components/`
- Installed or merged `strapi/src/index.ts` bootstrap
- Media uploaded to Strapi
- Seeded content entries
- Optional saved `STRAPI_URL` and `STRAPI_API_TOKEN` in the converted project `.env`

#### Re-seeding and the iterative workflow

You don't have to model everything up front. Convert a few collections/components, seed, wire and review the site, then turn more sections into collections later and re-seed — without duplicating data or losing edits.

How it stays safe:

- Each collection item is stamped with a deterministic `seemsKey` (e.g. `news_cards-0`), and a hidden `seemsKey` field is added to every collection schema.
- On re-seed, collections **upsert** by `seemsKey` (update in place / create only new items). Single types `PUT` (overwrite) unless `--skip-existing`.
- Items you add by hand in the Strapi admin have no matching `seemsKey`, so they're never touched.

Typical loop:

```bash
# 1. First pass: convert a few collections, then seed
cms setup-strapi ./site ./strapi-app

# 2. Later: turn more sections into collections, regenerate, restart Strapi to migrate, reseed
cms extract collections ./site
cms setup-strapi ./site ./strapi-app                 # upsert: existing updated, new created, no duplicates
cms setup-strapi ./site ./strapi-app --only news     # or seed just the new collection
cms setup-strapi ./site ./strapi-app --skip-existing # or preserve everything already populated
cms setup-strapi ./site ./strapi-app --fresh news    # or wipe + reseed one collection clean
```

Migration note (one-time): `seemsKey` is a new schema field. The first time you re-seed an existing project after upgrading, **restart Strapi after schemas are reinstalled** so the `seemsKey` column is created. Data seeded *before* `seemsKey` existed has no key, so the first upsert can't match it — run that first re-seed with `--fresh all` (or start from a clean DB) to establish keyed items. Subsequent re-seeds are fully idempotent.

### `cms generate [manifest]`

Generates CMS schemas from an existing manifest.

```bash
cms generate ./site/public/cms-manifest.json
cms generate ./site/public/cms-manifest.json --type strapi --output ./site
```

Arguments:

- `manifest`: Path to `cms-manifest.json`. If omitted, the CLI prompts for it.

Options:

- `-t, --type <cms>`: CMS type. Currently only Strapi is supported.
- `-o, --output <dir>`: Directory where `.see-ms/schemas/` should be written.

Expected output:

- `.see-ms/schemas/*.json`
- Optional `.see-ms/schemas/components/shared/link.json`
- `.see-ms/schemas/README.md`

## Interactive Convert Wizard

Run:

```bash
cms convert
```

or:

```bash
cms convert ./webflow-export ./site
```

The wizard asks the following questions when `--skip-prompts` is not used.

### Webflow Export Directory

Prompt:

```text
Webflow export directory:
```

Expected input:

- Path to the unzipped Webflow export.

Expected behavior:

- The converter reads HTML pages and assets from this directory.

### Output Project Directory

Prompt:

```text
Output project directory (<default>):
```

Expected input:

- Path for the generated Nuxt/Astro project.
- Press Enter to accept the suggested default.

Expected behavior:

- Without a boilerplate, SeeMS creates or reuses this directory.
- With `--boilerplate`, the directory must not already exist.

### Target Framework

Prompt:

```text
🎯 What are you converting to?
  1. Astro + Vue default
  2. Nuxt 3
```

Expected input:

- `1`, `astro-vue`, or Enter for Astro + Vue (the default).
- `2` or `nuxt` for Nuxt 3.

Expected output:

- Astro writes `src/pages/**/*.astro` plus `src/components/pages/**/*.vue`.
- Nuxt writes `pages/**/*.vue`.

### CMS Provider

Prompt:

```text
Which CMS provider?
1. Strapi
```

Expected input:

- Press Enter or choose `1`.

Expected behavior:

- Strapi schemas and seed data are generated.
- Other CMS providers are not implemented yet.

### Shared Components & Collections (now via the `extract` commands)

The convert wizard **no longer prompts** for *"Extract shared components"* or *"Configure collection types"*. Those
prompts are kept in source but disabled behind `ENABLE_COMPONENT_PROMPT` / `ENABLE_COLLECTION_PROMPT` flags. Convert
focuses on pages, page-level fields, schemas, and seed.

To model shared components and collections, run the dedicated commands after converting:

```bash
cms extract collections ./site
cms extract components ./site
```

`cms extract components` prompts:

```text
Component name (e.g. tabs, hero-section):
CSS selector for the root element (e.g. .w-tabs):
What kind of component?
  1. Shared section — one instance per page (nav, footer, hero)
  2. Collection item — repeats within a page (cards, tabs)
Collection name (default: …)            # only for collection items
```

- **Shared section** → a Strapi single type rendered via `<Component/>` on every page that has it (nav, footer).
- **Collection item** → a Strapi collection type; the page `v-for`s over it. You can also map nested repeating
  children (e.g. tags inside a card), which become a Strapi repeatable component.

`cms extract collections` takes one or more class names and turns each repeating block into a collection type.

Both commands re-read the original Webflow HTML, rebuild `public/cms-manifest.json`, regenerate the page bindings, and
regenerate `.see-ms/schemas/` + `.see-ms/seed/seed-data.json`. They are safe to re-run as you iterate. Collection
definitions are also persisted to `see-ms.config.ts`.

`--collection-classes <classes>` and config-driven `collections` hints still work in `cms convert` for non-interactive
runs.

### Analysis Preview

The wizard prints:

```text
Analysis Preview
Pages: ...
Component candidates: ...
```

Expected action:

- Review page routes and component candidates before writing files.

No input is required for the preview itself.

### Generate Initial CMS Content

Prompt:

```text
Generate initial CMS content from HTML? (Y/n):
```

Expected input:

- `Y`/Enter to write `.see-ms/seed/seed-data.json`.
- `n` to skip seed data.

Expected output:

- Seed JSON extracted from original Webflow HTML.

### Install Inline Editor Overlay

Prompt:

```text
Install and wire the inline editor overlay? (Y/n):
```

Expected input:

- `Y`/Enter to add editor package/runtime files.
- `n` to skip editor setup.

Expected output when enabled:

- Nuxt:
  - `plugins/cms-editor.client.ts`
  - `server/api/cms/save.post.ts`
  - `server/api/cms/publish.post.ts`
  - `composables/useEditorContent.ts`
  - `composables/useStrapiContent.ts`
- Astro:
  - `src/cms-editor.ts`
  - `src/pages/api/cms/save.ts`
  - `src/pages/api/cms/publish.ts`
  - `src/composables/useStrapiContent.ts`

### Optional Strapi Setup

Prompt:

```text
Would you like to set up Strapi now? (y/N):
```

Expected input:

- `n`/Enter to do it later with `cms setup-strapi`.
- `y` to install schemas and seed data now.

If `y`, the wizard asks:

```text
Enter path to your Strapi directory:
That Strapi directory does not exist. Scaffold a new Strapi project there? (Y/n):
Install Strapi dependencies after scaffolding? (Y/n):
```

Expected output:

- Existing Strapi project updated, or new Strapi project scaffolded.
- Generated Strapi bootstrap installed automatically.
- Schema install and seed flow begins.

## Interactive Strapi Setup Prompts

Run:

```bash
cms setup-strapi
```

Prompts:

```text
📁 Converted project directory:
📁 Strapi directory:
That Strapi directory does not exist. Scaffold it now? (Y/n):
Install Strapi dependencies after scaffolding? (Y/n):
⏸️  Step 3: Start Strapi in a separate terminal tab
   Come back here and press Enter once Strapi is running.
   (you don't need to wait for it to fully boot — just press Enter)
   Token:
   Save token for future use? (y/n):
```

Expected inputs:

- Converted project directory: path containing `.see-ms/schemas/`.
- Strapi directory: path to a Strapi app, or a new path if scaffolding.
- Scaffold: yes if the app does not exist.
- Install: yes for normal local testing.
- Press Enter only after Strapi is running.
- Token: Strapi full-access API token.
- Save token: yes for easier future reruns.

Expected output:

- Strapi source files generated
- Media uploaded
- Content seeded

## Cleanup Before A Fresh Test

For the recommended `/tmp` paths:

```bash
rm -rf /tmp/see-ms-full-flow /tmp/see-ms-auto
```

If Strapi or Nuxt ports are still occupied:

```bash
lsof -i :1337
lsof -i :3000
```

Stop the listed processes if they are old test servers.

## Troubleshooting

### `Cannot connect to Strapi`

Make sure Strapi is running:

```bash
cd "$STRAPI_APP"
npm run develop
```

Check:

```bash
curl http://localhost:1337/_health
```

### `401 Unauthorized` or `403 Forbidden`

Create a full-access API token in Strapi Admin and rerun:

```bash
cms setup-strapi "$SITE" "$STRAPI_APP" --token "$STRAPI_TOKEN"
```

For public reads from the generated app, `setup-strapi` installs the generated bootstrap automatically. If reads still 403, check the Strapi startup logs for `[SeeMS Bootstrap]` and verify public role permissions in Strapi Admin.

### Duplicate Content On Rerun

Single types are updated with `PUT`.

Collection types are currently inserted with `POST`, so rerunning seed setup can create duplicate collection entries. For clean tests, start with a fresh Strapi database or delete collection entries before reseeding.

### Manual Edits Disappear After Conversion

Generated files are SeeMS-owned. Rerunning conversion overwrites them. Keep manual app code outside generated files until a generated/custom split or merge strategy is implemented.

### `cms generate-schemas` Does Not Exist

The current command is:

```bash
cms generate ./site/public/cms-manifest.json --type strapi
```
