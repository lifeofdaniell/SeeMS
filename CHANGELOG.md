# Changelog

All notable changes to the see-ms monorepo will be documented in this file.

## [Unreleased] — feat/astro-native-pages

### @see-ms/converter — Astro target rewrite

#### Changed

- **`astro-vue` target now generates pure Astro SSR pages** instead of
  `<Page client:only="vue" />` wrappers. Each Webflow page becomes a single
  `.astro` file with the full HTML body rendered server-side. Scripts run
  against a fully-rendered DOM — no timing hacks required.

- **Script deduplication**: inline scripts shared across 2+ pages go into
  `BaseLayout.astro`; scripts unique to one page embed inline at the end of
  that page's file inside a `<Fragment slot="page-scripts">` block.

- **Script execution order**: per-page scripts now render via a named
  `<slot name="page-scripts" />` placed *after* CDN libraries and shared
  inline scripts in `BaseLayout`. This guarantees that globals set up by
  shared scripts (e.g. `window.clp`, `window.lenis`) are already defined
  when page-specific `DOMContentLoaded` handlers fire.

- **CSS link order** preserved from original Webflow HTML (`normalize →
  components → site CSS → main.css`) instead of glob alphabetical order.
  `main.css` (embedded styles) is always last so project-level overrides win.

- **CSS destination** for `astro-vue` target corrected to
  `public/assets/css/` (was `assets/css/`, unreachable by Astro's static
  server).

#### Added

- **Video and document asset support**: `videos/**/*` and `documents/**/*`
  are now scanned from the Webflow export and copied to
  `public/assets/videos/` and `public/assets/documents/`.

- **Media path normalization** in `transformForNuxt`:
  - `<video src>`, `<video poster>`, `<source src>`
  - `data-poster-url`, `data-video-urls` (Webflow background-video attributes)
  - `data-src` on any element (Lottie JSON files, deferred images)
  - Inline `style` background-image URLs referencing video/image/document paths

- **`extractPageScripts`** utility (`parser.ts`) — pulls head/body CDN and
  inline scripts from raw Webflow HTML before `parseHTML` strips them. Used
  by the two-pass converter flow to deduplicate and route scripts to the right
  place.

- **`wfPage`, `wfSite`, `bodyClass`** extracted from the source HTML and
  forwarded as props to `BaseLayout` so Webflow JS interactions that depend on
  `data-wf-page` / `data-wf-site` continue to work.

- **`generateBaseLayout`** (`filesystem.ts`) — generates
  `src/layouts/BaseLayout.astro` with CSS links, head CDN scripts, head inline
  scripts, body CDN scripts, shared body inline scripts, and the
  `page-scripts` slot.

- **`writeAstroPage`** (`filesystem.ts`) — writes a single `.astro` page with
  HTML body inline and per-page scripts in the `page-scripts` slot.

- **`analyzeVuePages`** updated (`detector.ts`) to also parse `.astro` files
  (strips frontmatter, passes body HTML to field detector). CMS manifest
  generation now works correctly against the new output structure.

#### Fixed

- Local dev-server script URLs (`http://localhost:*`, `http://127.0.0.1:*`)
  are filtered out of extracted CDN scripts and never written to output.

- `vue-transformer` post-processing, `formatVueFiles`, and
  `extractSharedComponents` are all skipped for the `astro-vue` target in
  this architecture — they operated on `.vue` page components that no longer
  exist in this output structure.

#### Why the rewrite was needed

The previous `astro-vue` approach (on `main`) rendered each page as
`<Page client:only="vue" />`. Astro sends an **empty `<body>`** to the browser
for `client:only` components — the HTML is injected by JavaScript after the
Vue bundle hydrates. Webflow sites assume fully-rendered DOM on load: GSAP
animations, Lenis smooth scroll, Swiper, nav dropdowns, and Webflow's own
`webflow.js` all query DOM elements immediately and fail silently against an
empty body.

Pure Astro SSR renders the complete HTML on the server. `DOMContentLoaded`
fires after the browser has parsed the full document, by which point all CDN
libraries have been loaded synchronously — so every Webflow script works
exactly as it did in the original export.

---

## [1.0.0] - 2026-01-11

### Major Release - Production Ready

This marks the first stable release of the see-ms CMS conversion system.

### Added

#### @see-ms/editor-overlay v1.0.0

- **Comprehensive README documentation** with API reference, quick start guide, and examples
- Full inline editing capabilities with real-time preview
- Draft management with IndexedDB storage
- Rich text editing with QuillJS integration
- Image editing with URL input
- Strapi v5 authentication and API integration
- Navigation protection for unsaved changes
- Floating toolbar UI with save/publish controls
- Vue reactive state integration via `window.__editorState`
- TypeScript definitions for all public APIs

#### @see-ms/converter v1.0.0

- **Strapi bootstrap file generation** for auto-enabling public permissions
- **Image URL population fix** - adds `populate: '*'` query parameter
- **Strapi image transformation** - converts media objects to URL strings
- Enhanced Vue reactive template generation
- Support for Strapi v5 API format (`response.data`)
- Automatic detection and transformation of text, rich text, and image fields
- Collection support with v-for generation
- SSR-enabled composables for production use
- Clean single-root templates without loading state wrappers
- Auto-generated editor integration (plugins, composables, API endpoints)

### Fixed

- **403 Forbidden errors** - Bootstrap file auto-enables public read permissions
- **Empty image URLs** - Images now populate correctly with `populate: '*'`
- **Preview mode blank pages** - Editor state initializes properly on first load
- **SSR disabled** - Removed `server: false` for production compatibility
- **Drafts not updating UI** - Reactive state updates immediately on edit
- **Multiple root elements** - Templates now have single root element
- **HTML wrapper tags** - Cheerio-generated tags are stripped from output
- **Converter version reference** - Updated to use `^1.0.0` for editor-overlay

### Changed

- **Version bump** - Both packages moved from 0.1.x to 1.0.0
- **Editor overlay dependency** - Converter now adds `@see-ms/editor-overlay@^1.0.0`
- **Documentation** - Complete overhaul of editor-overlay README
- **Transformation logic** - Improved image field detection and URL extraction

### Technical Details

#### Strapi v5 Integration

- Uses `populate: '*'` for media fields
- Transforms image objects: `{ url, mime, formats }` → `'http://...'`
- Handles nested objects and arrays recursively
- Supports both absolute and relative image URLs

#### Vue Reactivity

- Global `window.__editorState` for editor-Vue communication
- Immediate UI updates without page refresh
- Draft changes sync with reactive state
- SSR-compatible with client-side hydration

#### Bootstrap File

- Located at `strapi-bootstrap/index.ts` in generated projects
- Auto-enables `find` and `findOne` for all content types
- Runs on Strapi startup
- Safe to run multiple times (idempotent)

### Migration Guide

For projects created with earlier versions:

1. **Update editor-overlay dependency** in `package.json`:
   ```json
   "@see-ms/editor-overlay": "^1.0.0"
   ```

2. **Update useStrapiContent composable** with image transformation:
   ```typescript
   query: { populate: '*' },
   transform: (response) => {
     const data = response?.data || response;
     return transformStrapiImages(data, strapiUrl);
   }
   ```

3. **Copy bootstrap file** to Strapi project:
   ```bash
   cp strapi-bootstrap/index.ts <strapi-project>/src/index.ts
   ```

4. **Rebuild and restart** both Nuxt and Strapi

---

## [0.1.x] - 2025-2026

### Initial Development

- Basic converter functionality
- Editor overlay prototype
- Vue template generation
- CMS manifest creation
- Content extraction and seeding
- Strapi schema generation

---

## Legend

- **Added** - New features
- **Changed** - Changes to existing functionality
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Security fixes
