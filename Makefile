COMMIT_COUNT := $(shell git rev-list --count HEAD)
CALENDAR_VERSION := $(shell date +"%Y.%m")
VERSION := $(shell echo "${CALENDAR_VERSION}-${COMMIT_COUNT}")

-include .env
export

start:
	yarn start

init:
	cp -n .env.example .env || true


install: install-tools install-deps

install-tools:
ifneq ($(shell which asdf),)
	asdf install
	corepack enable
	corepack prepare yarn@4.3.1 --activate
	asdf reshim nodejs
endif

install-deps:
ifeq ($(CI),true)
	yarn install --immutable
else
	yarn install
endif

lint:
	yarn lint

version:
	@echo "$(VERSION)"

release: version
ifdef CI
	git config --global user.email "actions@github.com"
	git config --global user.name "GitHub Actions"
endif
	git tag -a ${VERSION} -m "Release ${VERSION}"
	git push origin ${VERSION}
	gh release create ${VERSION} \
		--title "${VERSION}" \
		--generate-notes \
		--target main

undo-release:
	git tag -d ${VERSION}
	git push origin :refs/tags/${VERSION}
	gh release delete -y ${VERSION}

gh-release:
	gh workflow run release.yml