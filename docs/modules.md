# Adding and Maintaining Modules

## Add a Module

1. Add `feature.manifest.ts` and its runtime implementation in the appropriate functional area.
2. Import the manifest into `moduleCatalog.ts` in preference order.
3. Associate the manifest key with its factory in `registry.ts`.
4. Add every module, option, and internal key to the GSettings schema.
5. Add unit coverage for pure logic and a Shell integration test for GNOME behavior.

A minimal manifest looks like this:

```typescript
import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'my-module',
  settingsKey: 'module-my-module',
  section: 'behavior',
  title: _('My Module'),
  subtitle: _('Description'),
  runtime: { roles: ['desktop'], scope: 'session' },
  options: [
    {
      key: 'my-option',
      title: _('Option'),
      subtitle: _('Description'),
      type: 'switch',
    },
  ],
};
```

`tests/unit/registry.test.ts` enforces catalog order, uniqueness, known sections, and factory
coverage. `tests/unit/schema.test.ts` requires manifest-declared setting keys to match the schema.

## Lifecycle and Dependencies

Implement the small `enable()` and `disable()` contract. Create a fresh `LifecycleScope` for each
enable cycle so signal connections and teardown callbacks are released in reverse order. Keep
timers, D-Bus subscriptions, and other stateful GNOME APIs explicit at their call sites.

Read settings through the shared context. Direct imports of `Main`, Shell, St, and Clutter are
idiomatic for GNOME integration; extract complex calculations into Shell-free TypeScript when they
can be tested independently. See the [adapter decision](gnome-shell-adapter.md) for the rationale.

## Coding Conventions

- Name TypeScript files with `camelCase` and classes with `PascalCase`.
- Prefix private members with `_` and use `UPPER_CASE` for constants.
- Disconnect or destroy everything connected or created during `enable()`.
- Keep manifests free of Shell UI imports so preferences can load the catalog safely.

## Logging

Use `logger` from `~/core/logger.ts` instead of `console` or direct GLib logging. Prefix messages
with the module name in `PascalCase` brackets:

```typescript
import { logger } from '~/core/logger.ts';

logger.log('[AuroraTray] Item added: ' + id);
logger.warn('[IconWeave] No match found for ' + wmClass);
```

Do not add an `[Aurora Shell]` prefix; the structured log identifier already routes entries to the
extension.
