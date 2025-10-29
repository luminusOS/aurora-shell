# Aurora Shell 🌊

An alternative GNOME Shell with various modifications and features missing in vanilla GNOME to make the user's life easier.

Aurora Shell is a modular GNOME Shell extension designed to scale from simple customizations to a complete custom shell experience. It provides quality-of-life improvements, visual enhancements, and workflow optimizations that vanilla GNOME lacks.

## ✨ Features

### Current
- 🎨 **Automatic Theme Sync** - Panel automatically matches your system theme
- 🌓 **Dark Mode Integration** - Seamlessly toggles between light and dark styles
- 🔄 **Smart Color Management** - Forces consistent color scheme preferences
- ⚡ **Zero Configuration** - Works automatically after installation
- 🎯 **Lightweight & Efficient** - Minimal performance impact
- 🏗️ **Modular Architecture** - Easy to extend with new features

### Planned
- 🪟 **Enhanced Window Management** - Tiling and snap assist
- �️ **Custom Animations** - Smooth transitions and effects
- 📊 **Workspace Enhancements** - Better workspace management
- 🎛️ **Hot Corners Customization** - Configurable corner actions
- 🔔 **Notification Improvements** - Enhanced notification center
- 🎨 **Full Theming Support** - Complete visual customization

## 📋 Requirements

- GNOME Shell 49+
- Node.js and npm (for development/compilation)
- TypeScript 5.9+
- Sass (for stylesheet compilation)

## 🚀 Quick Installation

### Method 1: Using Make (Easiest)

```bash
# Clone the repository
git clone https://github.com/luminusOS/aurora-shell.git
cd aurora-shell

# Install and activate (all in one command)
make all
```

### Method 2: Installation Script

```bash
# Clone the repository
git clone https://github.com/luminusOS/aurora-shell.git
cd aurora-shell

# Run the installation script
npm install
npm run build
make install
make enable
```

## 🗑️ Uninstallation

```bash
make uninstall
```

Or manually:

```bash
gnome-extensions disable aurora-shell@luminusos.com
rm -rf ~/.local/share/gnome-shell/extensions/aurora-shell@luminusos.com
```

## 🏗️ Architecture

Aurora Shell is built with scalability in mind, using a modular architecture that makes it easy to add new features without affecting existing code.

### Module System

All modules implement the `AuroraModule` interface and extend `BaseAuroraModule`:

```typescript
export interface AuroraModule {
  enable(): void;
  disable(): void;
}

export abstract class BaseAuroraModule implements AuroraModule {
  protected _console: ConsoleLike;
  
  constructor(console: ConsoleLike) {
    this._console = console;
  }
  
  protected log(message: string, ...args: any[]): void;
  protected error(message: string, ...args: any[]): void;
  protected warn(message: string, ...args: any[]): void;
  
  abstract enable(): void;
  abstract disable(): void;
}
```

**Benefits:**
- ✅ Clean separation of concerns
- ✅ Easy to add new features
- ✅ Each module is independently testable
- ✅ Consistent logging interface
- ✅ Type-safe with TypeScript

### Style System

Styles are organized using SCSS with a modular structure:

```
src/styles/
├── stylesheet.scss      # Main file (imports all modules)
├── _variables.scss      # Global variables
│   ├── Colors ($aurora-dash-bg, $aurora-hover-bg, etc)
│   ├── Transitions ($aurora-transition-duration, etc)
│   ├── Spacing ($aurora-button-padding, etc)
│   └── Border radius ($aurora-border-radius, etc)
└── _panel.scss         # Panel-specific styles
```

**Features:**
- ✅ Variables for easy customization
- ✅ Modular organization (one file per component)
- ✅ Modern SCSS with `@use` syntax
- ✅ Automatic compilation with Sass
- ✅ Single compiled output: `dist/stylesheet.css`

**Adding new styles:**
1. Create `_component.scss` with component styles
2. Add `@use 'component';` to `stylesheet.scss`
3. Run `npm run build:css` to compile

### Current Modules

#### ThemeChanger
- **File**: `src/modules/themeChanger.ts`
- **Purpose**: Monitors and controls GNOME's Dark Style
- **Features**:
  - Detects `color-scheme` changes
  - Forces `prefer-light` when Dark Style is disabled
  - Adds CSS classes to panel (`aurora-dark-mode`, `aurora-light-mode`)
  - Public API: `setDarkMode()`, `setLightMode()`, `toggleMode()`

### Adding New Modules

1. **Create module file** in `src/modules/`
2. **Extend BaseAuroraModule**
3. **Implement enable() and disable()**
4. **Register in extension.ts**

Example:

```typescript
// src/modules/MyFeature.ts
import { BaseAuroraModule } from './BaseModule.js';

export class MyFeature extends BaseAuroraModule {
  enable(): void {
    this.log('MyFeature: Enabling');
    // Your initialization code
  }

  disable(): void {
    this.log('MyFeature: Disabling');
    // Cleanup code
  }
}

// src/extension.ts
import { MyFeature } from "./modules/MyFeature.js";

private _initializeModules(): void {
  this._modules.set('myFeature', new MyFeature(this._console!));
}
```

### Build System

Aurora Shell uses **esbuild** for fast bundling:

- **Target**: Firefox 102 (GJS 1.73.2+)
- **Format**: ESM (ES Modules)
- **Bundle**: Single file output
- **External**: `gi://*`, `resource://*`, `system`, `gettext`, `cairo`

Build commands:
```bash
npm run build        # Full build (TS + CSS)
npm run build:ts     # TypeScript only
npm run build:css    # SCSS only
npm run validate     # Type check without compiling
```

## 🐛 Troubleshooting

### Extension not working

1. Check if extension is enabled:
```bash
gnome-extensions list
```

2. Check logs for errors:
```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep "Aurora Shell"
```

Or use the test command:
```bash
make test
```

### Colors not syncing

1. Make sure you're in dark mode
2. Restart GNOME Shell (logout/login on Wayland)
3. Try disabling and re-enabling:
```bash
make reload
```

### Compilation errors

Clean and rebuild:
```bash
make clean
npm install
npm run build
```

### Type checking

Validate TypeScript without compiling:
```bash
npm run validate
```

## 💻 Development

### Building

```bash
npm run build        # Build everything
npm run build:ts     # TypeScript only
npm run build:css    # SCSS only
```

### Active Development

For development with auto-recompilation:

```bash
npm run watch:css    # Watch CSS changes
make dev            # Development mode with logs
```

### Testing

Monitor logs in real-time:

```bash
make test
```

Quick reload after changes:

```bash
make reload
```

### Code Style

- **Files**: camelCase (`themeChanger.ts`)
- **Classes**: PascalCase (`ThemeChanger`)
- **Private methods**: Prefix `_` (`_applyTheme()`)
- **Constants**: UPPER_CASE (`DASH_COLOR`)

### Logging

Always prefix logs with module name:

```typescript
this.log('MyModule: Something happened');
this.error('MyModule: Error occurred:', error);
```

## 📝 License

LGPL-3.0-or-later

## 🤝 Contributing

Contributions are very welcome! Feel free to:

- 🐛 Report bugs
- 💡 Suggest new features
- 🔧 Submit pull requests
- 📖 Improve documentation

### How to Contribute

1. Fork the project
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: Add MyFeature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

### Development Guidelines

- One module = one feature
- Always implement `enable()` and `disable()`
- Clean up all resources in `disable()`
- Add informative logs
- Document parameters and behavior
- Follow TypeScript best practices

## �️ Roadmap

### Version 1.x - Solid Foundation
- [x] v1.0: Theme management module
- [ ] v1.1: Modular architecture
- [ ] v1.2: Build system with esbuild
- [ ] v1.3: Configuration system
- [ ] v1.4: Preferences UI

### Version 2.x - Enhanced Functionality
- [ ] v2.0: Window management improvements
- [ ] v2.1: Custom workspaces behavior
- [ ] v2.2: Animation system
- [ ] v2.3: Hot corners customization

### Version 3.x - Complete Shell
- [ ] v3.0: All shell components customization
- [ ] v3.1: Complete theming system
- [ ] v3.2: "Aurora Desktop" mode
- [ ] v3.3: Extension API for third-party modules

## 🙏 Acknowledgments

Developed with ❤️ for the GNOME community.

Special thanks to:
- GNOME Shell team
- GJS contributors
- @girs package maintainers

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/luminusOS/aurora-shell/issues)
- **Discussions**: [GitHub Discussions](https://github.com/luminusOS/aurora-shell/discussions)
