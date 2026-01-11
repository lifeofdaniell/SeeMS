# Changelog

All notable changes to the see-ms monorepo will be documented in this file.

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
