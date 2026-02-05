BRANCH    ?= $(shell git rev-parse --abbrev-ref HEAD)
BUILDDATE ?= $(shell date -u +%FT%T%z)
BUILDTS   ?= $(shell date -u +%s)
REVISION  ?= $(shell git rev-parse HEAD)
VERSION_DEV ?= 0.1.1-dev
VERSION ?= 0.1.1

PROMETHEUS_TAG := github.com/prometheus/common/version
KVM_PKG_NAME := kvm

GO_BUILD_ARGS := -tags netgo
GO_RELEASE_BUILD_ARGS := -trimpath $(GO_BUILD_ARGS)
GO_LDFLAGS := \
  -s -w \
  -X $(PROMETHEUS_TAG).Branch=$(BRANCH) \
  -X $(PROMETHEUS_TAG).BuildDate=$(BUILDDATE) \
  -X $(PROMETHEUS_TAG).Revision=$(REVISION) \
  -X $(KVM_PKG_NAME).builtTimestamp=$(BUILDTS)

GO_CMD := GOOS=linux GOARCH=arm GOARM=7 go
BIN_DIR := $(shell pwd)/bin

TEST_DIRS := $(shell find . -name "*_test.go" -type f -exec dirname {} \; | sort -u)

build_dev:
	@echo "Building..."
	$(GO_CMD) build \
		-ldflags="$(GO_LDFLAGS) -X $(KVM_PKG_NAME).builtAppVersion=$(VERSION_DEV)" \
		$(GO_RELEASE_BUILD_ARGS) \
		-o $(BIN_DIR)/kvm_app cmd/main.go

frontend:
	cd ui && npm ci && npm run build:device

build_release: frontend
	@echo "Building release..."
	$(GO_CMD) build \
		-ldflags="$(GO_LDFLAGS) -X $(KVM_PKG_NAME).builtAppVersion=$(VERSION)" \
		$(GO_RELEASE_BUILD_ARGS) \
		-o bin/kvm_app cmd/main.go
