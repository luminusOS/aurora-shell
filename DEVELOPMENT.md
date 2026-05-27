# Aurora Shell — Developer Guide

Complete reference for setting up the development environment, building, testing, and contributing to Aurora Shell.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Project Structure](#project-structure)
- [Build System](#build-system)
- [Validation](#validation)
- [Installing the Extension](#installing-the-extension)
- [Testing](#testing)
- [Debugging](#debugging)
- [Emergency Procedures](#emergency-procedures)
- [Troubleshooting](#troubleshooting)
- [Module Reference — Clipboard History](#module-reference--clipboard-history)

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | **22 LTS** (minimum 20) | Build toolchain (TypeScript, ESBuild, Sass) |
| **Yarn** | 4+ | Package manager (managed via Corepack / `.yarn/`) |
| **just** | any | Command runner (`justfile`) |
| **GNOME Shell** | **50** | Target runtime |
| **glib-compile-schemas** | — | Schema compilation (`glib2-devel` on Fedora) |
| **gnome-extensions** CLI | — | Extension install/uninstall |
| **msgfmt / xgettext** | — | Translation compilation (`gettext`) |

> **Important:** Node.js 20+ is required. The project's Yarn bundle (`.yarn/releases/yarn-4.x.cjs`) uses modern JavaScript syntax that **fails on Node 10, 12, or 14**. Always verify your active Node version before building.

---

## Environment Setup

### 1. Clone the repository

```sh
git clone https://github.com/luminusOS/aurora-shell.git
cd aurora-shell
```

### 2. Set up Node.js 22 via nvm

The project requires Node 22. If you manage Node versions with [nvm](https://github.com/nvm-sh/nvm):

```sh
# Install Node 22 if not already present
nvm install 22

# Activate it for this shell session
nvm use 22

# Verify
node --version   # must print v22.x.x
```

> **Permanent fix (recommended):** Add `nvm use 22` to your `~/.bashrc` or `~/.zshrc`, or set a default:
> ```sh
> nvm alias default 22
> ```

#### If `just` invokes the wrong Node version

`just` inherits the shell's `PATH` at the time it was launched. If Node 22 is not first in `PATH`, builds will fail with `SyntaxError: Unexpected token`. Fix by prepending the correct bin directory:

```sh
# Option A — prepend to PATH in your shell profile
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"

# Option B — create a symlink in ~/.local/bin (already in PATH)
ln -sf ~/.nvm/versions/node/v22.19.0/bin/node ~/.local/bin/node
ln -sf ~/.nvm/versions/node/v22.19.0/bin/yarn ~/.local/bin/yarn
ln -sf ~/.nvm/versions/node/v22.19.0/bin/npx  ~/.local/bin/npx
```

### 3. Install project dependencies

```sh
just deps
# equivalent to: yarn install
```

Dependencies are cached in `.yarn/cache/` (zero-installs). `yarn install` is only needed after cloning or when `package.json` changes.

### 4. Install system dependencies (Fedora / RHEL)

```sh
sudo dnf install just glib2-devel gettext gnome-shell-devel
```

On other distros, install the equivalent packages providing `glib-compile-schemas`, `msgfmt`, and `gnome-extensions`.

---

## Project Structure

```
aurora-shell/
├── src/
│   ├── extension.ts          Entry point — iterates registry, enables modules
│   ├── module.ts             Abstract Module base class + ModuleDefinition types
│   ├── registry.ts           Aggregator — imports all module definitions
│   ├── prefsMetadata.ts      Metadata mirror for the preferences UI (hand-maintained)
│   ├── prefs.ts              Generic preferences UI driven by prefsMetadata.ts
│   ├── core/
│   │   ├── context.ts        ExtensionContext interface and default implementation
│   │   ├── logger.ts         Structured logger (wraps GLib.log_structured)
│   │   ├── settings.ts       SettingsManager abstraction over Gio.Settings
│   │   └── adapters/
│   │       └── shell.ts      ShellEnvironment adapter (startup, overview)
│   ├── modules/              One folder per feature module
│   │   ├── clipboardHistory/ Clipboard history (Super+Shift+V)
│   │   ├── dock/             Smart per-monitor dock
│   │   ├── trayIcons/        SNI system tray
│   │   ├── volumeMixer/      Per-app volume in Quick Settings
│   │   └── ...
│   ├── shared/               Utilities shared across modules (icons, UI helpers)
│   ├── styles/               SCSS source (compiled to light + dark CSS)
│   └── types/                TypeScript ambient declarations for GJS / GNOME Shell
├── data/
│   ├── schemas/              GSettings XML schema
│   ├── icons/                SVG icons
│   └── po/                   Translation files (.po / .pot)
├── tests/
│   ├── unit/                 Vitest unit tests (no GNOME Shell needed)
│   └── shell/                Integration tests (headless GNOME Shell)
├── dist/                     Build output (gitignored)
├── justfile                  All project commands
├── package.json
├── tsconfig.json
├── esbuild.ts                ESBuild bundler config
└── sass.config.ts            Sass compiler config
```

---

## Build System

### Full reference

| Command | What it does |
|---------|-------------|
| `just deps` | `yarn install` — install/update Node dependencies |
| `just build` | Compile TypeScript + SCSS, copy metadata + schemas, compile `.mo` translations |
| `just package` | `build` + pack a `.zip` into `dist/target/` |
| `just install` | Install the already-packaged `.zip` into GNOME Shell (`~/.local/share/gnome-shell/extensions/`) |
| `just full-install` | `package` + `install` in one step — the standard deploy command |
| `just all` | `clean` + `full-install` (full rebuild from scratch) |
| `just uninstall` | Disable and remove the extension from GNOME Shell |
| `just clean` | Delete `dist/` |
| `just distclean` | Delete `dist/` and `node_modules/` |
| `just watch` | Watch `src/styles/` and recompile SCSS on change |

### Typical workflow

```sh
# 1. Make code changes in src/
# 2. Build and install
just full-install

# 3. Reload the extension in the live session
gnome-extensions disable aurora-shell@luminusos.github.io
gnome-extensions enable  aurora-shell@luminusos.github.io
# If that doesn't pick up the changes, log out and log back in.
```

---

## Validation

Run all checks before committing:

```sh
just validate
```

This runs in sequence:
1. **`tsc --noEmit`** — TypeScript type checking (no output files)
2. **ESLint** — code quality and import style rules
3. **Prettier** — formatting check (`src/**/*.{ts,scss}`)
4. **Stylelint** — SCSS linting

Fix formatting automatically:

```sh
# Format all TypeScript and SCSS files
yarn prettier --write "src/**/*.{ts,scss}"
```

Fix lint issues:

```sh
yarn lint --fix
```

> **Rule:** `just validate` must pass with zero errors before opening a PR. CI enforces this as the first job.

---

## Installing the Extension

### Standard install (live session)

```sh
just full-install
```

After install, reload the extension:

```sh
# Quick reload (may not always pick up all changes on Wayland)
gnome-extensions disable aurora-shell@luminusos.github.io
gnome-extensions enable  aurora-shell@luminusos.github.io

# Definitive reload: log out and log back in
```

### Verify install path

```sh
ls ~/.local/share/gnome-shell/extensions/aurora-shell@luminusos.github.io/
```

### Read or reset settings

```sh
# Must point to the extension's compiled schema dir
export SCHEMA_DIR=~/.local/share/gnome-shell/extensions/aurora-shell@luminusos.github.io/schemas

# List all keys
GSETTINGS_SCHEMA_DIR=$SCHEMA_DIR \
  gsettings list-recursively org.gnome.shell.extensions.aurora-shell

# Read a specific key
GSETTINGS_SCHEMA_DIR=$SCHEMA_DIR \
  gsettings get org.gnome.shell.extensions.aurora-shell clipboard-history-shortcut

# Reset a key to its default value
GSETTINGS_SCHEMA_DIR=$SCHEMA_DIR \
  gsettings reset org.gnome.shell.extensions.aurora-shell clipboard-history-shortcut
```

> **Why the `GSETTINGS_SCHEMA_DIR` prefix?** The extension schema lives in the extension directory, not in the system's `/usr/share/glib-2.0/schemas/`. `gsettings` only searches system paths by default.

---

## Testing

### Unit tests (no GNOME Shell required)

```sh
just unit-test
```

Uses Node's built-in test runner (no Vitest binary needed). Covers:
- `registry.ts` ↔ `prefsMetadata.ts` ↔ schema XML parity
- `ClipboardStore` logic
- Monitor topology helpers
- Tray state transitions

These are the first tests to run — they catch missing schema keys, duplicate `settingsKey` values, and metadata drift without needing a running shell.

### Integration tests (headless GNOME Shell)

Run a single test:

```sh
just test tests/shell/auroraClipboardHistory.js
```

Run all integration tests:

```sh
# On the host (requires gnome-shell-test-tool installed)
just test-all

# Inside the Fedora toolbox (recommended — isolated from your session)
just toolbox create    # first time only
just toolbox test-all

# Read only the pass/fail summary
just toolbox test-all 2>&1 | grep -E "PASS:|FAIL:|Results:"
```

### Manual testing in an isolated session

```sh
# Launches a fresh GNOME Shell session (Wayland) separate from your desktop
just run

# Or inside toolbox
just toolbox run
```

> **Note:** `just run` requires `/usr/libexec/mutter-devkit` for an interactive window. If that binary is absent (some Fedora versions), the session is headless and you won't see a UI. Use `just vagrant run` for a fully interactive VM-based session.

### Vagrant VM (fully interactive, safest option)

```sh
just vagrant create   # provision the VM (first time only, takes a few minutes)
just vagrant run      # launch GNOME Shell inside the VM
just vagrant ssh      # SSH into the VM for debugging
just vagrant remove   # destroy the VM when done
```

---

## Debugging

### Live logs

```sh
# Show aurora-related logs from the current boot
just logs

# Follow logs in real time
journalctl -f /usr/bin/gnome-shell | grep "aurora\|ClipboardHistory\|GNOME Shell"

# Show all logs with timestamps
journalctl -b 0 /usr/bin/gnome-shell | grep -i aurora
```

### GNOME Shell Looking Glass (in-session debugger)

Press `Alt + F2`, type `lg`, press Enter.

- **Extensions tab:** toggle modules on/off without reloading the shell
- **Evaluator tab:** run arbitrary JavaScript in the shell context, e.g.:
  ```js
  // Check if the clipboard module is loaded
  imports.misc.extensionUtils.getExtensionByUuid('aurora-shell@luminusos.github.io')
  ```

### Enable/disable a single module without touching the UI

```sh
SCHEMA_DIR=~/.local/share/gnome-shell/extensions/aurora-shell@luminusos.github.io/schemas

# Disable clipboard history
GSETTINGS_SCHEMA_DIR=$SCHEMA_DIR \
  gsettings set org.gnome.shell.extensions.aurora-shell module-clipboard-history false

# Re-enable
GSETTINGS_SCHEMA_DIR=$SCHEMA_DIR \
  gsettings set org.gnome.shell.extensions.aurora-shell module-clipboard-history true
```

---

## Emergency Procedures

If the extension causes the shell to become unresponsive or breaks the UI:

### Option 1 — TTY (always works, even with a frozen UI)

```sh
Ctrl + Alt + F2            # switch to text terminal

# Disable only the aurora extension
gnome-extensions disable aurora-shell@luminusos.github.io

# Or disable ALL extensions at once
gsettings set org.gnome.shell disable-user-extensions true

Ctrl + Alt + F1            # return to the graphical session
```

### Option 2 — GNOME Safe Mode

At the login screen: click the accessibility icon → **Disable Extensions**. This boots GNOME without any extensions loaded.

Or via terminal before logging in:

```sh
gsettings set org.gnome.shell disable-user-extensions true
```

### Option 3 — Remove the extension entirely

```sh
just uninstall
# or manually:
rm -rf ~/.local/share/gnome-shell/extensions/aurora-shell@luminusos.github.io
```

---

## Troubleshooting

### `SyntaxError: Unexpected token .` when running `just`

**Cause:** Node.js version is too old. The Yarn 4 bundle requires Node 20+.

**Fix:**
```sh
nvm use 22
node --version   # must be v22.x.x
just full-install
```

If `just` still uses the wrong Node, the shell that launched `just` has a stale `PATH`. Fix permanently:

```sh
echo 'export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### `No such schema "org.gnome.shell.extensions.aurora-shell"`

The schema is not in the system schema path. Always prefix with `GSETTINGS_SCHEMA_DIR`:

```sh
GSETTINGS_SCHEMA_DIR=~/.local/share/gnome-shell/extensions/aurora-shell@luminusos.github.io/schemas \
  gsettings get org.gnome.shell.extensions.aurora-shell clipboard-history-shortcut
```

### Extension loads but a module isn't activating

```sh
# Check for errors in the journal
just logs | grep -E "ERROR|error|Warning|clipboard"

# Check if the module key is enabled
SCHEMA_DIR=~/.local/share/gnome-shell/extensions/aurora-shell@luminusos.github.io/schemas
GSETTINGS_SCHEMA_DIR=$SCHEMA_DIR \
  gsettings get org.gnome.shell.extensions.aurora-shell module-clipboard-history
```

### Changes not picked up after `just full-install`

On Wayland, you must restart the shell to reload modules:

```sh
gnome-extensions disable aurora-shell@luminusos.github.io
gnome-extensions enable  aurora-shell@luminusos.github.io
```

If that doesn't work: **log out and log back in**. There is no in-place shell restart on Wayland.

### `just run` starts but there's no window to interact with

`/usr/libexec/mutter-devkit` is absent on some Fedora builds. Use the toolbox or Vagrant VM instead:

```sh
just toolbox run    # requires: just toolbox create (first time)
just vagrant run    # requires: just vagrant create (first time)
```

---

## Module Reference — Clipboard History

Located in `src/modules/clipboardHistory/`.

### Files

| File | Responsibility |
|------|---------------|
| `clipboardHistory.ts` | Module class + `definition` export. Orchestrates store, monitor, panel, keybinding. |
| `clipboardStore.ts` | Pure data layer. Loads/saves JSON, manages pinned/history arrays, deduplicates, debounces writes. |
| `clipboardMonitor.ts` | Polling loop using `GLib.timeout_add` + `St.Clipboard`. |
| `clipboardPanel.ts` | Centered floating overlay. Uses `Main.uiGroup` + `Main.pushModal`. |
| `clipboardList.ts` | Scrollable list widget with pinned + history sections and keyboard selection. |
| `clipboardItem.ts` | Individual row: truncated text label + pin icon. |

### GSettings keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `module-clipboard-history` | boolean | `true` | Enable/disable the entire module |
| `clipboard-history-shortcut` | string[] | `['<Super><Shift>v']` | Global keybinding (array of strings, GNOME accelerator format) |
| `clipboard-history-max-items` | integer (10–200) | `50` | Max non-pinned entries to keep |
| `clipboard-history-poll-interval` | integer (250–5000) | `1000` | Clipboard check frequency in milliseconds |

### Persistence

History is saved to `~/.config/aurora-shell/clipboard-history.json`.

```json
{
  "version": 1,
  "entries": [
    {
      "id": "1234567890",
      "text": "docker ps -a",
      "pinned": false,
      "timestamp": 1748320000000
    },
    {
      "id": "9876543210",
      "text": "my-api-token",
      "pinned": true,
      "timestamp": 1748310000000
    }
  ]
}
```

Writes are debounced (300 ms). A final flush happens in `disable()`.

### Keyboard shortcuts inside the panel

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate items |
| `Enter` | Copy selected item to clipboard and close |
| `Esc` | Close panel |
| `Delete` | Remove selected item |
| `P` | Pin / unpin selected item (only when search field is not focused) |
| `Ctrl + F` | Focus the search field |

### Changing the shortcut

Via `gsettings` (requires schema dir prefix):

```sh
SCHEMA_DIR=~/.local/share/gnome-shell/extensions/aurora-shell@luminusos.github.io/schemas

# Set a new shortcut
GSETTINGS_SCHEMA_DIR=$SCHEMA_DIR \
  gsettings set org.gnome.shell.extensions.aurora-shell \
  clipboard-history-shortcut "['<Super><Shift>v']"

# Reset to default
GSETTINGS_SCHEMA_DIR=$SCHEMA_DIR \
  gsettings reset org.gnome.shell.extensions.aurora-shell clipboard-history-shortcut
```

The default is set in the schema (`data/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml`) and takes effect only on fresh installs or after a reset.

### Testing the Clipboard History module

**Unit test** (no shell needed):

```sh
just unit-test
```

**Integration test** (headless GNOME Shell):

```sh
just test tests/shell/auroraClipboardHistory.js
# or inside toolbox:
just toolbox test tests/shell/auroraClipboardHistory.js
```

**Manual test checklist:**

```
□ Press Super+Shift+V → panel opens centered on screen
□ Search field receives focus automatically
□ Type characters → list filters in real time
□ ↑ / ↓ → selection moves
□ Enter → item copied to clipboard, panel closes (verify with Ctrl+V)
□ Open panel again → copied item appears at the top of history
□ Select an item, press P → item moves to "Pinned" section
□ Press P again → item returns to history
□ Press Delete → item removed from list
□ Press Esc → panel closes
□ Lock screen → panel disappears automatically
□ Restart session → pinned items survive; history survives up to max-items
□ Disable module in Preferences → no crash, panel gone
□ Re-enable → works again
```

**Inspect the stored history file:**

```sh
cat ~/.config/aurora-shell/clipboard-history.json | python3 -m json.tool
```

**Clear history manually:**

```sh
rm ~/.config/aurora-shell/clipboard-history.json
```

---

## Translation Workflow

```sh
# 1. After adding new _('...') strings, regenerate the .pot template
just pot

# 2. Merge new strings into existing .po files
just update-po

# 3. Edit po/*.po files with Poedit or a text editor

# 4. Build (compiles .po → .mo automatically)
just build
```
