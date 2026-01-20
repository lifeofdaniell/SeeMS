# Contributing to SeeMS

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/lifeofdaniell/SeeMS.git
cd SeeMS

# Install dependencies (requires pnpm)
pnpm install

# Build all packages
pnpm build

# Run in dev mode
pnpm dev
```

## Project Structure

```
packages/
├── converter/       # CLI tool (@see-ms/converter)
├── types/           # Shared TypeScript definitions (@see-ms/types)
└── editor-overlay/  # Inline CMS editor (@see-ms/editor-overlay)
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm build` to ensure everything compiles
4. Test your changes locally
5. Submit a PR

## Branch Naming

- `feat/short-description` - new features
- `fix/short-description` - bug fixes
- `docs/short-description` - documentation
- `refactor/short-description` - code refactoring

## Commit Messages

Keep them concise and descriptive:

```
feat(converter): add support for nested components
fix(types): correct CmsConfig interface
docs: update installation instructions
```

## Code Style

- TypeScript for all packages
- Run type checks before submitting

## Questions?

Open an issue or start a discussion. Happy to help!

