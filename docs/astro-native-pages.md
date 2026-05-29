# Astro Native Pages Architecture

**Branch:** `feat/astro-native-pages`
**Status:** In progress — Phase 1A complete, Phase 1B next

---

## The problem with the previous approach

The `astro-vue` target on `main` generated two files per Webflow page:

```
src/pages/about.astro          ← thin shell
src/components/pages/about.vue ← page rendered client:only="vue"
```

The `.astro` shell looked like:

```astro
---
import Page from '../components/pages/about.vue';
---
<Page client:only="vue" />
```

`client:only="vue"` tells Astro to skip server-side rendering entirely and
hydrate the component in the browser using JavaScript. This means Astro sends
an **empty `<body>`** — just a script tag — to the browser.

Webflow sites are built around the assumption that the DOM is fully rendered on
load. Every script that ships with a Webflow export queries DOM elements
immediately:

- `gsap.utils.toArray('.award-block')` — returns nothing against empty body
- `document.querySelector('.c-nav')` — returns null, causes TypeError
- `lenis`, `Swiper`, `ScrollTrigger` — all set up against elements that don't
  exist yet

The result: pages appeared blank or broken until Vue finished hydrating, and
even then many scripts had already failed.

---

## What we changed

Every Webflow page now generates as a **single `.astro` file** with the full
HTML body inline:

```
src/
  layouts/BaseLayout.astro     ← CSS, CDN scripts, shared scripts, slots
  pages/
    about.astro                ← full HTML inline + page-specific scripts
    index.astro
    ...
public/
  assets/
    css/                       ← all Webflow CSS files
    images/
    fonts/
    js/
    videos/                    ← new: video files
    documents/                 ← new: Lottie JSON and other documents
```

### BaseLayout.astro

One shared layout that every page imports. Contains:

1. CSS links (in original Webflow order — `normalize → components → site → main.css`)
2. Head CDN scripts (WebFont, Swiper CDN, etc.)
3. Head inline scripts (WebFont.load, Webflow browser detection)
4. `<slot />` — page HTML renders here
5. Body CDN scripts (jQuery, webflow.js, Lenis, GSAP, ScrollTrigger, etc.)
6. Shared inline scripts (scripts that appear on 2+ pages — nav logic, Lenis
   init, heroIntro, etc.)
7. `<slot name="page-scripts" />` — page-specific scripts render here, **after**
   all CDN libraries and shared scripts

### Page files

```astro
---
// see-ms:generated
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="About" wfPage="..." wfSite="..." bodyClass="...">
  <!-- full Webflow HTML body inline -->
  <div class="c-nav">...</div>
  <main>...</main>
  <footer>...</footer>

  <Fragment slot="page-scripts">
    <script is:inline>
      document.addEventListener('DOMContentLoaded', function () {
        // page-specific GSAP animations, etc.
      });
    </script>
  </Fragment>
</BaseLayout>
```

### Why `DOMContentLoaded` now works

With server-rendered HTML, the browser receives a complete document. Script
loading order in the rendered HTML is:

1. Page HTML (slot) — DOM elements exist in the document
2. Body CDN scripts load **synchronously** (no `async`/`defer`) — GSAP, Lenis,
   ScrollTrigger, SplitText are all available by the time parsing completes
3. Shared inline scripts run immediately — `lenis = new Lenis()`, `gsap.registerPlugin(...)`,
   `heroIntro` function defined, `window.clp` set up inside DOMContentLoaded handler
4. `<slot name="page-scripts" />` — page script DOMContentLoaded handlers register
5. `DOMContentLoaded` fires — handlers run in registration order:
   shared handlers first (define `window.clp`, etc.), then page handlers

This is the correct order. Nothing is patched or polyfilled.

---

## Script deduplication

During conversion, the converter runs two passes over the Webflow HTML:

**Pass 1** — for each page:
- Extract all scripts from the raw HTML with `extractPageScripts()`
- Run `parseHTML()` + `transformForNuxt()` to get clean body HTML
- Store both

**Pass 2** — after all pages:
- Count how many pages each inline script body appears on
- Scripts on 2+ pages → **shared** → go into BaseLayout
- Scripts on exactly 1 page → **unique** → go into that page's `page-scripts` slot
- CDN scripts (same on every Webflow page) → always go into BaseLayout

---

## Asset path normalization

`transformForNuxt()` normalizes all asset references to `/assets/*` paths:

| HTML attribute | Before | After |
|---|---|---|
| `<img src>` | `images/logo.svg` | `/assets/images/logo.svg` |
| `<video src>` | `videos/intro.mp4` | `/assets/videos/intro.mp4` |
| `<video poster>` | `videos/poster.jpg` | `/assets/videos/poster.jpg` |
| `<source src>` | `videos/intro.webm` | `/assets/videos/intro.webm` |
| `data-poster-url` | `videos/poster.jpg` | `/assets/videos/poster.jpg` |
| `data-video-urls` | `videos/a.mp4,videos/b.webm` | `/assets/videos/a.mp4,/assets/videos/b.webm` |
| `data-src` (Lottie) | `documents/anim.json` | `/assets/documents/anim.json` |

Localhost/127.0.0.1 CDN script URLs (dev-only Live Server embeds) are filtered
out and never written to output.

---

## Phases

### Phase 1A — Complete ✅

Pure Astro SSR pages. No `client:only`. Scripts, CSS, animations, video, Lottie
all working.

### Phase 1B — Next

CMS integration rework. Instead of Vue template bindings (`{{ content.title }}`),
inject `data-cms-field="fieldName"` attributes on editable elements. A small
runtime script patches DOM values from Strapi at load time. This keeps page
rendering completely decoupled from CMS availability.

### Phase 2 — Planned

CMS field detection improvements:
- Exclude nav/footer fields from per-page Strapi schemas (they currently bleed
  into every page's schema)
- `news-open` template → collection type, not single type
- More conservative text field detection

### Phase 3 — Planned

Editor overlay: a single `<CmsEditor client:load />` Vue island added once in
`BaseLayout`. Reads `data-cms-field` attributes from the DOM, shows edit
affordances, writes back to Strapi. Fully decoupled from page rendering.

---

## Key files changed

| File | What changed |
|---|---|
| `packages/converter/src/parser.ts` | Added `extractPageScripts()`, `ScriptTag`, `PageScripts` interfaces; extended `ParsedPage` with `wfPage`, `wfSite`, `bodyClass`; added media/Lottie path normalization in `transformForNuxt`; localhost URL filter |
| `packages/converter/src/filesystem.ts` | Added `generateBaseLayout()`, `writeAstroPage()`, `copyGenericPublicAssets()`; added `videos`/`documents` to `AssetPaths`; fixed CSS destination to `public/assets/css/` for Astro; added `page-scripts` named slot |
| `packages/converter/src/converter.ts` | Two-pass page processing for `astro-vue`; CSS order from original HTML; skip `extractSharedComponents`, `vue-transformer`, `formatVueFiles` for `astro-vue` target |
| `packages/converter/src/detector.ts` | `analyzeVuePages` now reads `.astro` files (strips frontmatter) in addition to `.vue` |
| `packages/converter/src/generated-state.ts` | `getGeneratedPageFiles` returns only `.astro` entries for `astro-vue`; added `BaseLayout.astro` to runtime files list |
