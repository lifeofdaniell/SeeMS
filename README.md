# SeeMS

**Webflow HTML → Astro/Nuxt converter with CMS manifests, Strapi schemas, and inline editing**

Convert Webflow exports into Astro + Vue (default) or Nuxt 3 applications with provider-neutral content models,
Strapi-ready schemas, seed data, and an inline editor overlay.

---

## 🚀 Quick Start

```bash
# Convert (defaults to Astro + Vue)
npx @see-ms/converter convert ./webflow-export ./site

# ...or target Nuxt 3
npx @see-ms/converter convert ./webflow-export ./site --target nuxt
```

Preview what SeeMS will do before generating anything:

```bash
npx @see-ms/converter analyze ./webflow-export
```

### The full workflow

```bash
# 1. Convert pages + page-level CMS fields
npx @see-ms/converter convert ./webflow-export ./site

# 2. Turn repeating sections into collections, and nav/footer into shared single-types
npx @see-ms/converter extract collections ./site
npx @see-ms/converter extract components ./site

# 3. Install schemas + seed into Strapi (scaffolds Strapi too if missing)
npx @see-ms/converter setup-strapi ./site ./strapi-app --scaffold
```

> **Why two steps?** `convert` handles pages, fields, schemas, and seed.
> Shared components (nav/footer) and collections (cards, lists) are extracted by
> the dedicated `extract` commands — the vetted engine — so they can be iterated
> on without re-running a full conversion.

`setup-strapi` installs the generated Strapi bootstrap automatically, so public read permissions are configured on
Strapi startup without manually copying `.see-ms/strapi-bootstrap/index.ts`.

---

## 📦 Packages

This monorepo contains:

- **[@see-ms/converter](./packages/converter)** — CLI for Webflow → Astro/Nuxt conversion
- **[@see-ms/types](./packages/types)** — Shared TypeScript definitions
- **[@see-ms/editor-overlay](./packages/editor-overlay)** — Inline CMS editor overlay

---

## ✨ Features

- 🎨 **Visual to Code** — Convert Webflow HTML into Astro SSR pages (or Vue components for Nuxt)
- 🧩 **Shared Components** — Extract nav/footer/hero into reusable single-types (`extract components`)
- 🗂️ **Collections** — Turn repeating cards/lists into Strapi collection types (`extract collections`)
- 🔧 **CMS Ready** — Provider-neutral `cms-manifest.json` plus Strapi v1 schemas + seed data
- 🔗 **Smart Routing & Assets** — Preserves routes, nested pages, CSS order, scripts, and media
- ✍️ **Inline Editing** — Edit text, rich text, links, images, and icons in `?preview=true`

---

## 📖 Documentation

- **[Converter README](./packages/converter/README.md)** — full CLI reference and the Webflow → site → Strapi → editor flow
- **[Full Flow Testing Runbook](./docs/FULL_FLOW_TESTING_README.md)** — step-by-step local testing, every command, every prompt
- **[Changelog](./docs/CHANGELOG.md)** — what changed and why

---

## 🛠️ Development

```bash
pnpm install        # install deps
pnpm build          # build all packages (types → editor-overlay → converter)
pnpm dev            # watch mode
```

This repo also ships a `makefile` with shortcuts for a working project:

```bash
make build              # rebuild @see-ms/types then the converter CLI
make convert            # convert SRC → DIR
make extract-collections
make extract-component
make setup-strapi       # install schemas + seed into Strapi
```

Run `make help` to see all targets and the `SRC` / `DIR` variables.

---

## 📝 License

MIT
