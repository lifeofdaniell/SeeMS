# SeeMS

**HTML to Nuxt converter with inline CMS editing**

Convert your HTML websites into production-ready Nuxt 3 applications with automatic CMS integration.

---

## 🚀 Quick Start
```bash
npx @see-ms/converter convert ./webflow-export ./nuxt-site
```

---

## 📦 Packages

This monorepo contains:

- **[@see-ms/converter](./packages/converter)** - CLI tool for HTML → Nuxt conversion
- **[@see-ms/types](./packages/types)** - Shared TypeScript definitions
- **[@see-ms/editor-overlay](./packages/editor-overlay)** - Inline CMS editor (coming soon)

---

## ✨ Features

- 🎨 **Visual to Code** - Convert HTML files to clean Vue components
- 🔗 **Smart Routing** - Automatic `<NuxtLink>` conversion with proper paths
- 📦 **Asset Management** - Organized asset structure for Nuxt
- 🎯 **Boilerplate Support** - Use your own Nuxt starter template
- 🔧 **CMS Ready** - Prepare for Strapi, Contentful, or Sanity integration

---

## 📖 Documentation

See the [converter README](./packages/converter/README.md) for full documentation.

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
