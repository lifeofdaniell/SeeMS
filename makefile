CLI := node packages/converter/dist/cli.mjs
DIR ?= ../qzam
SRC ?= ~/Downloads/quantum-zenith----asset-management.webflow

default: help

help:
	@echo ""
	@echo "Usage: make <target> [DIR=./path]   (DIR defaults to ./convert)"
	@echo ""
	@echo "Build:"
	@echo "  make build-converter              rebuild the CLI"
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

build-converter:
	pnpm --filter @see-ms/converter build

convert:
	$(CLI) convert $(SRC)

extract-collections:
	$(CLI) extract collections $(DIR)

extract-components:
	$(CLI) extract components $(DIR)

setup-strapi:
	$(CLI) setup-strapi $(DIR)
