# Add and maintain a module

A module is one manifest, one runtime factory, and one reversible lifecycle. Start in the functional
directory that owns the behavior; do not add a new framework or directory for a single feature.

## 1. Write the manifest

Create `feature.manifest.ts` beside the implementation. Manifests may import types and the shared
gettext helper, but no GNOME Shell UI libraries. Preferences imports every manifest in a separate
process.

```typescript
import type { ModuleManifest } from '~/module.ts';
import { gettext as _ } from '~/shared/i18n.ts';

export const manifest: ModuleManifest = {
  key: 'my-module',
  settingsKey: 'module-my-module',
  section: 'behavior',
  title: _('My Module'),
  subtitle: _('Describe the behavior a user will observe'),
};
```

`key` identifies the runtime factory and documentation entry. `settingsKey` is the master switch.
Choose one existing section: `dock-panel`, `appearance`, `behavior`, or `privacy-clipboard`.

Runtime policy is optional. Its defaults are `{ roles: ['desktop'], scope: 'session' }`. Add policy
only when the feature differs from that default:

```typescript
runtime: {
  roles: ['desktop', 'mobile'],
  requires: ['touch'],
  scope: 'session',
},
```

The manager runs a module only when at least one declared role is active and every declared
capability is present. If a dependency is an optional application or D-Bus service rather than a
device capability, keep the module loadable and handle absence locally.

## 2. Declare options and schema defaults

Add user-facing options to `options`. Supported types are defined by `ModuleOption` in
`src/module.ts` and rendered by `src/prefs.ts`. Reuse one of them before adding preferences code.

Each option `key`, each time option's `hourKey` and `minuteKey`, and each `internalSettings` entry
must have a matching key in
`data/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml`. The schema is the source of types
and defaults. Use `module-<key>` for the master switch and `<key>-<option>` for feature settings.

Defaults are product behavior. New modules should be opt-in unless enabling them by default is part
of the accepted change. New shortcuts that access clipboard data must be unset by default.

## 3. Register it once

Import the manifest into `src/moduleCatalog.ts` and add it to `MODULE_CATALOG` in the intended
preferences order. Then add one factory with the same key to `src/registry.ts`.

Do not import the implementation into the manifest or catalog. `registry.ts` is the boundary that
associates presentation metadata with Shell runtime code.

## 4. Implement a reversible lifecycle

Extend `Module`, construct a fresh `LifecycleScope` during each `enable()`, and release all work from
`disable()`. A typical module needs no extra abstraction:

```typescript
export class MyModule extends Module {
  private _lifecycle: LifecycleScope | null = null;

  enable(): void {
    if (this._lifecycle) return;
    const lifecycle = new LifecycleScope();
    this._lifecycle = lifecycle;
    lifecycle.connect(source, 'changed', () => this._sync());
    lifecycle.onDispose(() => this._removeUi());
    this._sync();
  }

  disable(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;
  }
}
```

Anything created after `enable()` must have an owner: signals, GLib sources, D-Bus subscriptions,
cancellables, patches, actors, menus, and global settings changes. Register cleanup immediately
after acquisition. Reverse order matters when later resources depend on earlier ones. `disable()`
must also handle a failed, partial `enable()` because `ModuleManager` invokes it after factory or
enable errors.

Direct imports of `Main`, Shell, St, Clutter, and Meta are normal inside runtime implementations.
Keep only calculations that benefit from Node tests in Shell-free TypeScript files.

## 5. Add evidence

- Put parsers, state transitions, geometry, matching, and other pure logic in `tests/unit`.
- Put actor trees, Shell patches, Quick Settings, panel integration, and teardown behavior in
  `tests/shell`.
- Add or update the module's single row in [Module reference](module-reference.md).
- Run the structural checks, which reject catalog, registry, schema, and documentation drift.

The smallest standard check for a new module is:

```bash
just test unit
just validate
just test shell tests/shell/path/to/module.test.js
just shexli
```

Use [Testing](testing.md) to choose Toolbox and package checks when the change crosses those
boundaries.

## Logging and review constraints

Use `logger` from `~/core/logger.ts`. Include the owning feature as a PascalCase prefix and log only
state that helps diagnose a failure:

```typescript
logger.warn('Service is unavailable', { prefix: '[MyModule]' });
```

Aurora Shell follows the
[GNOME Extensions review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
In particular, do no dynamic work at import or construction time, clean up all enabled resources,
keep GTK/Adw out of the Shell process, keep Shell libraries out of preferences, declare clipboard
access, and do not ship executable binaries.
