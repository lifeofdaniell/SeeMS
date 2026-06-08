CLI := node packages/converter/dist/cli.mjs
DIR ?= ../qzgroup
SRC ?= ~/Downloads/quantum-zenith-group-check.webflow

default: help

help:
	@echo ""
	@echo "Usage: make <target> [DIR=./path]   (DIR defaults to ./convert)"
	@echo ""
	@echo "Build:"
	@echo "  make build-types                  rebuild @see-ms/types"
	@echo "  make build-converter              rebuild the CLI"
	@echo "  make build                        rebuild types then the CLI (correct order)"
	@echo ""
	@echo "Conversion:"
	@echo "  make convert                      convert Webflow export → Vue/Astro project"
	@echo ""
	@echo "Extract (run after convert):"
	@echo "  make extract-collections          add/update collection types"
	@echo "  make extract-components           extract a shared component"
	@echo ""
	@echo "Strapi:"
	@echo "  make setup-strapi                 install schemas, seed content into Strapi"
	@echo ""

build-types:
	pnpm --filter @see-ms/types build

build-converter:
	pnpm --filter @see-ms/converter build

# Types must build before the converter (its DTS build resolves against them).
build: build-types build-converter

convert:
	$(CLI) convert $(SRC)

extract-collections:
	$(CLI) extract collections $(DIR)

extract-component:
	$(CLI) extract components $(DIR)

setup-strapi:
	$(CLI) setup-strapi $(DIR)
