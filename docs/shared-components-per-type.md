# Refactor: shared-component content → one Strapi single type per component

**Status:** ✅ IMPLEMENTED (converter, 101 tests green, builds clean). Needs E2E verification (re-extract → setup-strapi → restart → `pnpm dev`).

Implemented across:
- `manifest.ts` — shared-global components keep un-prefixed fields; no merged `globalFields`.
- `transformer.ts` — emits one single type per shared component via `sharedComponentTypeName()` (exported); `global` bucket only for non-component global fields.
- `content-extractor.ts` — `extractAllContent` adds per-component content; `formatForStrapi` emits `seed.<type>` (un-prefixed). `ExtractedContent.components` added.
- `vue-transformer.ts` — astro shared components use `defineProps<{content}>` (not `useStrapiContent`); bindings now un-prefixed (fields are un-prefixed); page declares `globals` prop; `restoreComponentTags` emits `<Comp :content="globals['<type>']" />` on astro.
- `filesystem.ts` `writeAstroVuePage` — new `sharedComponents: string[]` param; fetches `/api/<type>` per shared component into `globals` (media-resolved); renders `<Page content={content} globals={globals} />`.
- call sites `converter.ts` + `extract.ts` pass `pageComponentMap.get(pageName) || []`.

**Remaining:** E2E run to confirm a real nav/footer renders server-side with content. And the older `docs` text below describes the pre-refactor state — kept for reference.

---
(original spec below)


## Problem
Today, every extracted **shared-section** component (Nav, Footer, …) has its
fields funneled into ONE Strapi single type called `global`, with each field
**prefixed by the component name** (`Nav_quantum_zenith_design_system__…`,
`Footer_…`). Result: a single ~115-field Strapi form that's unmanageable, plus
ugly prefixes that only exist to avoid collisions in the shared bucket.

Verify current state: `GET http://localhost:1337/api/global` → one object, all
`Nav_*`/`Footer_*` fields.

## Goal
One single type **per shared component**, fields **un-prefixed**:
- `nav` single type → `announcement_label_text`, `live_ticker_code`, …
- `footer` single type → its own fields
- The `.astro` fetches each component's single type and passes it to that
  component: `<Nav :content="nav" />`. Server-rendered (no client composable).

This also closes the existing rendering bug: shared components currently use
`useStrapiContent('global')` (a client-side `onMounted` fetch) but are mounted
with **no `client:*` directive**, so on astro they never hydrate → render blank.

## Naming rules (Strapi — learned the hard way, see `board` incident)
For each shared component `Nav`:
- content-type key / folder / `singularName` MUST match → use `nav`
- `singularName !== pluralName` → `singularName: "nav"`, `pluralName: "navs"`
  (pluralize: if name ends in `s` keep it, else append `s`)
- It's a **single type** (`kind: "singleType"`), but still needs a valid
  unique `pluralName`.

## The 6 changes (with locations)

### 1. Schema generation — split `global` into per-component single types
- Find where the `global` content type is assembled from
  `manifest.global.components`. Grep: `global` in `src/transformer.ts`,
  `src/manifest.ts`, `src/component-extractor.ts`, `src/seed-writer.ts`.
  The seed side is `formatForStrapi` in `src/content-extractor.ts` (produces
  `seedData.global` from `extracted.global.fields`).
- Instead of one `global` schema with prefixed fields, emit one
  `singleType` per component in `manifest.global.components`, named after the
  component (kebab/lower), with fields **de-prefixed** (strip `^<Component>_`).
- Run the existing `upgradeLongStringFieldsToText(contentTypes, seedData)` over
  these too (string→text safety net — see `src/transformer.ts`).

### 2. Seed generation — `seed.<component>` instead of `seed.global`
- In `formatForStrapi` (`src/content-extractor.ts`): emit `seedData.nav`,
  `seedData.footer` (un-prefixed keys) rather than a single `seedData.global`.

### 3. Shared component `.vue` — prop, de-prefixed bindings
- `transformSharedComponentsToReactive` in `src/vue-transformer.ts` (~line 305).
- It already computes `originalName` (the de-prefixed field) but binds the
  **prefixed** `fieldName`. Switch the bindings to `originalName`.
- For astro-vue shared-section, generate `defineProps<{ content: Record<string,
  any> }>();` instead of `const { content } = useStrapiContent('global');`
  (~line 355–363). Nuxt keeps the composable (but pointed at the per-component
  type, e.g. `useStrapiContent('nav')`).

### 4. Page `.vue` — pass each shared component its content
- `transformAllVuePages` astro branch (`src/vue-transformer.ts` ~line 271–285):
  the page receives a `globals` object prop, e.g.
  `defineProps<{ content: Record<string, any>; globals?: Record<string, any> }>();`
- `restoreComponentTags` (`src/vue-transformer.ts` ~line 377): emit
  `<Nav :content="globals.nav" />` for shared components on astro (key = the
  component's content-type name). Currently emits `<Nav />`. Needs the target +
  a name→key map.

### 5. `.astro` page — fetch each shared component's type
- `writeAstroVuePage` in `src/filesystem.ts` (the big template literal).
- Add a `sharedComponents: string[]` param (the page's shared components — get
  it from `pageComponentMap` at the call sites in `converter.ts` and
  `extract.ts`, same way `collectionNames` is passed).
- In the frontmatter: fetch `/api/<component>` for each, build
  `const globals = { nav: …, footer: … }`, run them through the existing
  `resolveStrapiMedia(...)`, and render `<Page content={content} globals={globals} />`.

### 6. Call sites
- `converter.ts` and `extract.ts` call `writeAstroVuePage(...)` — thread the
  page's shared-component list through (alongside `editorEnabled`,
  `collectionNames`).

## Gotchas
- Media: `resolveStrapiMedia` (already in `writeAstroVuePage`) must run over
  the `globals` content too.
- Component naming collisions: two shared components can't both produce a type
  named `nav` — they won't (component names are unique).
- The `manifest.global.components[c].fields` keys are already prefixed
  (`Nav_…`); de-prefix with `fieldName.replace(new RegExp('^'+component+'_'), '')`.

## Build / test / verify
- Node ≥20.19 (repo `.nvmrc` = 22). Use ONE pnpm consistently (pnpm store
  mismatches corrupted `node_modules` repeatedly this cycle).
- `pnpm --filter @see-ms/converter build` (ESM + DTS must both pass).
- `npx vitest run` (currently 99 tests). Add tests for: per-component schema
  names (singular≠plural, key==singular), de-prefixed bindings, `.astro`
  fetching `/api/<component>` and `globals.<name>` wiring.
- E2E: re-extract a shared component, `setup-strapi`, restart Strapi, `pnpm dev`
  → the nav/footer should render real content, server-side, no blank flash.

## Context from the session that produced this
- astro-vue page model: `.astro` fetches Strapi server-side, passes `content`
  (and collections) as props to the page `.vue`, which v-fors collections and
  (after this work) passes `globals.*` to shared components. No client hydration.
- Parity rule: anything `convert` generates, the `extract` commands must too
  (string→text safety net, editor overlay, page rewrites). Keep that in mind —
  schema/seed for per-component types must regenerate from BOTH paths.
- Many converter fixes from this session may still be **uncommitted** — commit
  before starting this.
