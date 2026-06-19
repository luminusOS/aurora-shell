# Aurora Shell Architecture

Aurora Shell is a modular GNOME Shell extension. Regular features live as registry modules: each
module exports a colocated `definition` object and is instantiated by `src/extension.ts` through
`src/registry.ts`.

## Overview

```mermaid
flowchart TD
  Shell[GNOME Shell] --> Extension[src/extension.ts]
  Extension --> Context[src/core/context.ts]
  Extension --> Registry[src/registry.ts]
  Registry --> Modules[semantic module folders]
  Modules --> Shared[src/shared/*]
  Modules --> Core[src/core/*]
  Context --> Device[src/device/*]
  Prefs[src/prefs.ts] --> PrefsMetadata[src/prefsMetadata.ts]
  PrefsMetadata -. mirrors .-> Registry
  Schema[data/schemas/*.xml] -. validates settings .-> Registry
  Tests[tests/unit + tests/shell] --> Registry
  Tests --> Modules
```

## Source Layout

```text
src/
  core/                  Extension context, settings, and logging
  clipboard/             Clipboard history module and UI
  desktop/               Desktop-only modules such as tray icons
  dev/                   Developer-only tools
  device/                Runtime target and hardware capability detection
  dock/                  Dock module and dock-specific helpers
  panel/                 GNOME panel and Quick Settings integrations
  patches/               Focused Shell behavior patches and monkey-patches
  privacy/               Privacy and screen-sharing behavior
  shared/                Utilities shared by modules
  styles/                SCSS partials compiled into Shell stylesheets
  theme/                 Theme and color-scheme modules
```

## Runtime Lifecycle

```mermaid
sequenceDiagram
  participant Shell as GNOME Shell
  participant Ext as extension.ts
  participant Ctx as ExtensionContext
  participant Reg as registry.ts
  participant Mod as Module
  participant Settings as GSettings

  Shell->>Ext: enable()
  Ext->>Settings: getSettings()
  Ext->>Ctx: create context
  Ext->>Reg: getModuleRegistry()
  Reg-->>Ext: ModuleDefinition[]
  loop enabled module setting
    Ext->>Settings: get_boolean(def.settingsKey)
    Ext->>Mod: def.factory(context)
    Ext->>Mod: enable()
  end
  Ext->>Settings: connect changed::module-*
  Settings-->>Ext: setting changed
  Ext->>Mod: enable() or disable()
  Shell->>Ext: disable()
  Ext->>Settings: disconnectObject(this)
  Ext->>Mod: disable()
```

## Module Contract

```mermaid
classDiagram
  class Module {
    <<abstract>>
    #context ExtensionContext
    +enable() void
    +disable() void
  }

  class ModuleDefinition {
    +key string
    +settingsKey string
    +section string
    +title string
    +subtitle string
    +options ModuleOption[]
    +runtime ModuleRuntimePolicy
    +factory(context) Module
  }

  class ExtensionContext {
    +uuid string
    +path string
    +settings SettingsManager
    +device DeviceService
  }

  ModuleDefinition --> Module : creates
  Module --> ExtensionContext : uses
```

Each module owns its runtime behavior and cleanup. `enable()` and `disable()` must stay symmetric:
actors, signal handlers, timeouts, D-Bus watches, and injected Shell UI must be removed by the same
module that created them.

`ModuleDefinition.runtime` is optional. When omitted, the module is treated as desktop-only. Use
`targets: ['shared']` only for modules that are intentionally valid on both desktop and future
mobile runtimes. Hardware-specific modules should declare `requires` capabilities instead of
probing and failing late inside `enable()`.

## Registry And Preferences

Every registry module must stay in sync across:

- `src/registry.ts`
- `src/prefsMetadata.ts`
- `data/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml`

```mermaid
flowchart LR
  Definition[Module definition] --> Registry[src/registry.ts]
  Definition --> PrefsMirror[src/prefsMetadata.ts]
  Definition --> SchemaKey[GSettings module-* key]

  Registry --> Runtime[Runtime enable/disable]
  PrefsMirror --> Preferences[Preferences UI]
  SchemaKey --> Settings[GSettings storage]

  UnitTests[registry.test.ts + schema.test.ts] --> Registry
  UnitTests --> PrefsMirror
  UnitTests --> SchemaKey
```

`tests/unit/registry.test.ts` and `tests/unit/schema.test.ts` enforce that parity. A module addition
is incomplete until all three places are updated.

## Test Boundaries

```mermaid
flowchart TD
  Pure[Pure TypeScript logic] --> Unit[tests/unit/*.test.ts]
  ShellGlue[St / Clutter / Main integration] --> ShellTests[tests/shell/aurora*.js]
  Build[TypeScript + SCSS + schemas] --> Validate[just validate]
  ShellTests --> Toolbox[just toolbox test-all]
```

Keep heavy algorithms outside Shell imports when practical. Shell-facing code is expected to import
GNOME Shell internals directly and is verified through integration tests running a real headless
Shell session.

## Packaging

```mermaid
flowchart TD
  Source[src/**/*.ts] --> Build[yarn build]
  Styles[src/styles/*.scss] --> Build
  Metadata[metadata.json] --> Package[gnome-extensions pack]
  Schemas[data/schemas] --> Package
  Icons[data/icons] --> Package
  Translations[data/po] --> MO[compile .mo files]
  Build --> Dist[dist/]
  MO --> Dist
  Dist --> Package
  Package --> Zip[dist/target/*.shell-extension.zip]
```

`just package` builds TypeScript and SCSS into `dist/`, compiles schemas and translations, then
packs the GNOME extension zip. Top-level generated directories imported at runtime must be listed as
extra sources in the `justfile`.
