# SeeMS

**Webflow HTML to Nuxt converter with CMS manifests and inline editing**

Convert Webflow exports into Nuxt 3 applications with reusable components, Strapi-ready content models, seed data, and
an inline editor overlay.

---

## 🚀 Quick Start

```bash
npx @see-ms/converter convert ./webflow-export ./nuxt-site
```

Preview what SeeMS will do before generating an app:

```bash
npx @see-ms/converter analyze ./webflow-export
```

If you do not have Strapi yet, SeeMS can scaffold it too:

```bash
npx @see-ms/converter convert ./webflow-export ./nuxt-site \
  --scaffold-strapi ./strapi-app
```

`setup-strapi` also installs the generated Strapi bootstrap automatically, so public read permissions are configured on
Strapi startup without manually copying `strapi-bootstrap/index.ts`.

---

## 📦 Packages

This monorepo contains:

- **[@see-ms/converter](./packages/converter)** - CLI tool for HTML → Nuxt conversion
- **[@see-ms/types](./packages/types)** - Shared TypeScript definitions
- **[@see-ms/editor-overlay](./packages/editor-overlay)** - Inline CMS editor overlay

---

## ✨ Features

- 🎨 **Visual to Code** - Convert HTML files to clean Vue components
- 🔗 **Smart Routing** - Automatic `<NuxtLink>` conversion with proper paths
- 📦 **Asset Management** - Organized asset structure for Nuxt
- 🧭 **Reviewable Output** - Generates `see-ms-report.md` and `see-ms.config.ts`
- 🎯 **Boilerplate Support** - Use your own Nuxt starter template
- 🔧 **CMS Ready** - Generates a provider-neutral manifest plus Strapi v1 schemas
- ✍️ **Inline Editing** - Edit text, rich text, links, images, and icons in preview mode

---

## 📖 Documentation

See the [converter README](./packages/converter/README.md) for full documentation.
Start with its **Full Step-By-Step Usage** section for the complete Webflow → Nuxt → Strapi → inline editor flow.

---

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run in dev mode
pnpm dev
```

---

## 📝 License

MIT
