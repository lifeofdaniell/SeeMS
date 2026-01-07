# @see-ms/converter

CLI tool for converting HTML exports to Nuxt 3 projects with automatic CMS integration.

## Features

✨ **Automatic Conversion**

- Convert HTML to Vue components
- Transform `<a>` tags to `<NuxtLink>` with proper routing
- Normalize all asset paths automatically

🎨 **Asset Management**

- CSS files → `assets/css/`
- Images, fonts, JS → `public/assets/`
- Auto-generate Vite plugin for path resolution (For Webflow)

🔧 **Smart Transforms**

- Extract and deduplicate embedded styles
- Remove unnecessary attributes (srcset, sizes)
- Clean up script tags and inline code
- Format output with Prettier

📦 **Boilerplate Support**

- Clone from GitHub repository
- Copy from local directory
- Works with your custom Nuxt boilerplate

---

## Installation

### Quick Use (npx - no installation)

```bash
npx @see-ms/converter convert <webflow-export> <output-dir> [options]
```

### Global Installation

```bash
npm install -g @see-ms/converter
# or
pnpm add -g @see-ms/converter
```

Then use anywhere:

```bash
cms convert <webflow-export> <output-dir> [options]
```

---

## Usage

### Basic Conversion

```bash
cms convert ./my-webflow-export ./my-nuxt-site
```

### With Boilerplate (Recommended)

```bash
# From GitHub
cms convert ./webflow-export ./nuxt-site \
  --boilerplate git@github.com:username/nuxt-boilerplate.git

# From local directory
cms convert ./webflow-export ./nuxt-site \
  --boilerplate /path/to/local/boilerplate
```

### Full Example

```bash
cms convert ./project-html ./project-nuxt \
  --boilerplate git@github.com:username/repo-boilerplate.git \
  --cms strapi
```

---

## Options

| Option                       | Description                                  | Default |
|------------------------------|----------------------------------------------|---------|
| `-b, --boilerplate <source>` | GitHub URL or local path to Nuxt boilerplate | none    |
| `-o, --overrides <path>`     | Path to overrides JSON file                  | none    |
| `--generate-schemas`         | Generate CMS schemas after conversion        | false   |
| `--cms <type>`               | CMS type: strapi, contentful, or sanity      | strapi  |

---

## What Gets Converted

### HTML → Vue Components

**Before (Webflow):**

```html
<!-- index.html -->
<a href="about.html">About</a>
<img src="images/logo.svg" srcset="..." sizes="...">
```

**After (Nuxt):**

```vue
<!-- pages/index.vue -->
<script setup lang="ts">
  // Page: index
</script>

<template>
  <div class="page-index">
    <NuxtLink to="/about">About</NuxtLink>
    <img src="/assets/images/logo.svg">
  </div>
</template>
```

### Asset Structure

```
webflow-export/              nuxt-project/
├── css/                  →  ├── assets/css/
├── images/               →  ├── public/assets/images/
├── fonts/                →  ├── public/assets/fonts/
├── js/                   →  ├── public/assets/js/
└── *.html                →  └── pages/*.vue
```

### Auto-Generated Files

- ✅ `utils/webflow-assets.ts` - Vite plugin for CSS path resolution on Webflow files
- ✅ `assets/css/main.css` - Extracted embedded styles
- ✅ Updated `nuxt.config.ts` with CSS imports

---

## Transformations Applied

### Links

- `<a href="about.html">` → `<NuxtLink to="/about">`
- `<a href="../index.html">` → `<NuxtLink to="/">`
- `<a href="index.html">` → `<NuxtLink to="/">`
- External links remain as `<a>` tags

### Images

- `images/logo.svg` → `/assets/images/logo.svg`
- Removes `srcset` and `sizes` attributes
- Normalizes relative paths

### Styles

- Extracts `.global-embed` styles (For Webflow)
- Deduplicates repeated styles
- Adds to `assets/css/main.css`

### Scripts

- Removes all inline `<script>` tags
- Cleans up Webflow-specific JavaScript

---

## Output Structure

```
my-nuxt-site/
├── pages/
│   ├── index.vue
│   └── others.cue
│ 
├── assets/
│   └── css/
│       ├── normalize.css
│       ├── components.css
│       ├── webflow.css
│       └── main.css
├── public/
│   └── assets/
│       ├── images/
│       ├── fonts/
│       └── js/
├── utils/
│   └── webflow-assets.ts
└── nuxt.config.ts (updated)
```

---

## After Conversion

1. **Install dependencies:**

```bash
   cd my-nuxt-site
   pnpm install
```

2. **Start development server:**

```bash
   pnpm dev
```

3. **Your site should be running!** 🎉

---

## Requirements

- Node.js >= 18
- A Webflow export (HTML, CSS, images, fonts)
- (Optional) A Nuxt 3 boilerplate

---

## Tips

### Using Your Own Boilerplate

If you have a standard Nuxt boilerplate for all projects:

1. Create a GitHub repo with your boilerplate
2. Use it in every conversion:

```bash
   cms convert ./webflow ./output --boilerplate git@github.com:you/boilerplate.git
```

### Webflow Export Tips

- Export from Webflow: **Site Settings → Export Code**
- Make sure to include all assets
- Check that images are properly linked

### Handling Custom Code

If your Webflow site has custom JavaScript that you need:

1. The converter removes inline scripts for clean Vue components
2. Port necessary JavaScript to Vue composables or plugins
3. Add to your Nuxt `plugins/` or `composables/` folders

---

## Troubleshooting

### `nuxt.config.ts not found`

The converter expects a `nuxt.config.ts` file. Either:

- Use a boilerplate that has one, or
- The converter will create a minimal one if no boilerplate is specified

### Assets not loading

Make sure the `webflow-assets.ts` plugin is imported in your `nuxt.config.ts`:

```typescript
import webflowAssets from './utils/webflow-assets'

export default defineNuxtConfig({
    vite: {
        plugins: [webflowAssets()]
    }
})
```

### Routes not working

Check that your `pages/` directory is enabled in Nuxt. It should be automatic, but verify in `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
    pages: true
})
```

---

## Contributing

Issues and pull requests welcome!

## License

MIT

---

## Related Packages

- [@see-ms/types](../types) - Shared TypeScript types
- [@see-ms/editor-overlay](../editor-overlay) - Inline CMS editor (coming soon)

---

**Made with ❤**
