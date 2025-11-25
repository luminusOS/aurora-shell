EXTENSION_UUID = aurora-shell@luminusos.com
EXTENSION_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(EXTENSION_UUID)

.PHONY: help build install uninstall clean logs

help:
	@echo "Aurora Shell - Available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""

build:
	@echo "Installing dependencies..."
	@npm install
	@echo "Building project..."
	@npm run build
	@echo "Build complete!"

install: build
	@echo "Installing extension..."
	@mkdir -p $(EXTENSION_DIR)
	@cp dist/extension.js $(EXTENSION_DIR)/
	@cp dist/stylesheet.css $(EXTENSION_DIR)/
	@cp dist/stylesheet-light.css $(EXTENSION_DIR)/
	@cp dist/stylesheet-dark.css $(EXTENSION_DIR)/
	@cp dist/metadata.json $(EXTENSION_DIR)/
	@echo "Extension installed at: $(EXTENSION_DIR)"
	@echo ""
	@echo "To activate:"
	@echo "  make enable"
	@echo "Or restart GNOME Shell (Alt+F2 → r on Xorg, or logout/login on Wayland)"

uninstall:
	@echo "Uninstalling extension..."
	@gnome-extensions disable $(EXTENSION_UUID) 2>/dev/null || true
	@rm -rf $(EXTENSION_DIR)
	@echo "Extension uninstalled!"

logs:
	@echo "Recent Aurora Shell logs:"
	@echo ""
	@journalctl -b 0 /usr/bin/gnome-shell | grep "Aurora Shell" | tail -n 20

clean:
	@echo "Cleaning..."
	@rm -rf dist node_modules
	@echo "Cleanup complete!"

quick: build
	@echo "Quick update..."
	@cp dist/extension.js $(EXTENSION_DIR)/
	@cp dist/stylesheet.css $(EXTENSION_DIR)/
	@cp dist/stylesheet-light.css $(EXTENSION_DIR)/
	@cp dist/stylesheet-dark.css $(EXTENSION_DIR)/
	@cp dist/metadata.json $(EXTENSION_DIR)/
	@echo "Files updated!"
	@echo "Run 'make reload' to apply changes"

all: clean build install
	@echo ""
	@echo "Complete installation finished!"
	@echo "Aurora Shell is active!"
