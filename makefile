default: help

help:
	@echo "Available commands:"
	@echo "  make dev      - start dev server"
	@echo "  make test     - run tests"
	@echo "  make lint     - run linter"
	@echo "  make build    - build app"

build-converter:
	pnpm --filter @see-ms/converter build
