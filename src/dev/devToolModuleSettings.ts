import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import Meta from '@girs/meta-18';
import Pango from '@girs/pango-1.0';
import Atk from '@girs/atk-1.0';

import type { SettingsManager } from '~/core/settings.ts';
import type { Module, ModuleManifest, ModuleOption } from '~/module.ts';
import { MODULE_CATALOG } from '~/moduleCatalog.ts';
import { parseCustomCommand, serializeCustomCommand } from '~/panel/auroraMenuState.ts';
import { gettext as _ } from '~/shared/i18n.ts';
import { createIcon } from '~/shared/icons.ts';

import { plainText } from './devToolModuleBrowser.ts';
import {
  createDevToolButton,
  createDevToolGroup,
  createDevToolRow,
  createDevToolSwitch,
} from './devToolUi.ts';

type ModuleSettingsCallbacks = {
  getModule(key: string): Module | null;
  rebuild(requestedFocusName?: string): void;
  openCommands(key: string, optionKey: string, returnFocusName: string): void;
  openDeveloperTool(key: string, returnFocusName: string): void;
  hasDeveloperTool(key: string): boolean;
  buildHero(title: string, subtitle: string): St.Widget;
};

type CommandEditor = {
  index: number | null;
  original: string | null;
  label: string;
  command: string;
};

const MODIFIER_KEYSYMS = new Set([
  Clutter.KEY_Alt_L,
  Clutter.KEY_Alt_R,
  Clutter.KEY_Control_L,
  Clutter.KEY_Control_R,
  Clutter.KEY_Hyper_L,
  Clutter.KEY_Hyper_R,
  Clutter.KEY_Meta_L,
  Clutter.KEY_Meta_R,
  Clutter.KEY_Shift_L,
  Clutter.KEY_Shift_R,
  Clutter.KEY_Super_L,
  Clutter.KEY_Super_R,
]);

export class DevToolModuleSettings {
  private _commandEditor: CommandEditor | null = null;

  constructor(
    private readonly _settings: SettingsManager,
    private readonly _callbacks: ModuleSettingsCallbacks,
  ) {}

  resetEditor(): void {
    this._commandEditor = null;
  }

  buildModule(key: string): St.Widget {
    const manifest = MODULE_CATALOG.find((entry) => entry.key === key);
    const content = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-content',
    });
    if (!manifest) return content;

    const enabled = this._settings.getBoolean(manifest.settingsKey);
    const running = this._callbacks.getModule(manifest.key) !== null;
    content.add_child(
      this._callbacks.buildHero(plainText(manifest.title), plainText(manifest.subtitle)),
    );
    if (!enabled) content.add_child(this._buildDisabledBanner(manifest));

    const moduleGroup = createDevToolGroup(_('Module'));
    moduleGroup.list.add_child(
      createDevToolRow(
        _('Enable %s').format(plainText(manifest.title)),
        running
          ? _('Module is running in this session')
          : enabled
            ? _('Module is enabled but not running in this session')
            : _('Module is off'),
        createDevToolSwitch(
          enabled,
          (state) => {
            this._settings.setBoolean(manifest.settingsKey, state);
            this._callbacks.rebuild();
          },
          _('Enable %s').format(plainText(manifest.title)),
          `module-enabled-${manifest.key}`,
        ),
      ),
    );
    content.add_child(moduleGroup.container);

    if (manifest.options && manifest.options.length > 0) {
      const settingsGroup = createDevToolGroup(_('Settings'));
      for (const option of manifest.options) {
        const row = this._buildOption(manifest, option);
        if (!enabled) this._disableActor(row);
        settingsGroup.list.add_child(row);
      }
      content.add_child(settingsGroup.container);
    }
    if (this._callbacks.hasDeveloperTool(key)) {
      const developerTitle = _('%s Dev Tools').format(plainText(manifest.title));
      const developerFocusName = `aurora-devtool-focus-developer-${key}`;
      const developer = createDevToolGroup(_('Developer'));
      developer.list.add_child(
        this._buildNavigationRow(
          developerTitle,
          _('Simulate runtime states and trigger module actions'),
          () => this._callbacks.openDeveloperTool(key, developerFocusName),
          'applications-engineering-symbolic',
          developerFocusName,
        ),
      );
      content.add_child(developer.container);
    }
    return content;
  }

  buildCommands(key: string, optionKey: string): St.Widget {
    const content = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-content',
    });
    content.add_child(
      new St.Label({ text: _('Custom Menu Commands'), style_class: 'aurora-devtool-page-title' }),
    );
    content.add_child(
      new St.Label({
        text: _('Shortcuts that run commands from Aurora Menu'),
        style_class: 'aurora-devtool-page-subtitle',
      }),
    );
    const group = createDevToolGroup(_('Commands'));
    const rawCommands = this._settings.getStrv(optionKey);
    let validCommands = 0;
    rawCommands.forEach((raw, index) => {
      const command = parseCustomCommand(raw);
      if (!command) return;

      validCommands++;
      const actions = new St.BoxLayout({ style_class: 'aurora-devtool-inline-controls' });
      actions.add_child(
        createDevToolButton(
          _('Edit'),
          () => {
            this._commandEditor = { index, original: raw, ...command };
            this._callbacks.rebuild();
          },
          undefined,
          _('Edit %s').format(command.label),
          false,
          'flat',
          `command-edit-${index}`,
        ),
      );
      actions.add_child(
        createDevToolButton(
          _('Delete'),
          () => {
            const currentCommands = this._settings.getStrv(optionKey);
            if (currentCommands[index] !== raw) {
              this._callbacks.rebuild();
              return;
            }

            currentCommands.splice(index, 1);
            this._settings.setStrv(optionKey, currentCommands);
            this._callbacks.rebuild();
          },
          undefined,
          _('Delete %s').format(command.label),
          false,
          'destructive',
          `command-delete-${index}`,
        ),
      );
      group.list.add_child(createDevToolRow(command.label, command.command, actions));
    });
    if (validCommands === 0)
      group.list.add_child(createDevToolRow(_('No custom commands'), _('Add one below.')));

    if (this._commandEditor) {
      content.add_child(group.container);
      content.add_child(this._buildCommandEditor(optionKey, this._commandEditor));
    } else {
      const buttonRow = new St.BoxLayout({
        style_class: 'aurora-devtool-button-row',
        x_expand: true,
      });
      const add = createDevToolButton(
        _('Add Command'),
        () => {
          this._commandEditor = { index: null, original: null, label: '', command: '' };
          this._callbacks.rebuild();
        },
        'list-add-symbolic',
        undefined,
        false,
        'suggested',
      );
      add.x_expand = true;
      buttonRow.add_child(add);
      group.list.add_child(buttonRow);
      content.add_child(group.container);
    }

    const note = new St.BoxLayout({ style_class: 'aurora-devtool-commands-note' });
    note.add_child(new St.Label({ text: _('Stored in'), y_align: Clutter.ActorAlign.CENTER }));
    note.add_child(
      new St.Label({
        text: optionKey,
        style_class: 'aurora-devtool-kbd-chip',
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    note.add_child(
      new St.Label({
        text: _('· module %s').format(key),
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    content.add_child(note);
    return content;
  }

  private _buildDisabledBanner(manifest: ModuleManifest): St.Widget {
    const banner = new St.BoxLayout({ style_class: 'aurora-devtool-banner', x_expand: true });
    banner.add_child(
      new St.Icon({
        icon_name: 'dialog-warning-symbolic',
        icon_size: 16,
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    const bannerLabel = new St.Label({
      text: _('This module is disabled. Its settings are stored but have no effect.'),
      style_class: 'aurora-devtool-banner-label',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    bannerLabel.clutter_text.line_wrap = true;
    banner.add_child(bannerLabel);
    banner.add_child(
      createDevToolButton(
        _('Enable'),
        () => {
          this._settings.setBoolean(manifest.settingsKey, true);
          this._callbacks.rebuild();
        },
        undefined,
        _('Enable %s').format(plainText(manifest.title)),
      ),
    );
    return banner;
  }

  private _buildOption(manifest: ModuleManifest, option: ModuleOption): St.Widget {
    const title = plainText(option.title);
    const subtitle = plainText(option.subtitle);
    if (option.type === 'switch' && option.key) {
      const optionKey = option.key;
      return createDevToolRow(
        title,
        subtitle,
        createDevToolSwitch(
          this._settings.getBoolean(optionKey),
          (state) => this._settings.setBoolean(optionKey, state),
          title,
        ),
      );
    }
    if (option.type === 'entry' && option.key) {
      const optionKey = option.key;
      const entry = new St.Entry({
        text: this._settings.getString(optionKey),
        can_focus: true,
        accessible_name: title,
        style_class: 'aurora-devtool-entry',
      });
      entry.clutter_text.connect('text-changed', () =>
        this._settings.setString(optionKey, entry.get_text()),
      );
      const entryWrap = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        style_class: 'aurora-devtool-entry-wrap',
        y_align: Clutter.ActorAlign.CENTER,
      });
      entryWrap.add_child(entry);
      return createDevToolRow(title, subtitle, entryWrap);
    }
    if (option.type === 'spin' && option.key)
      return createDevToolRow(title, subtitle, this._buildStepper(option.key, option, title));
    if (option.type === 'time' && option.hourKey && option.minuteKey) {
      const time = new St.BoxLayout({ style_class: 'aurora-devtool-inline-controls' });
      time.add_child(
        this._buildStepper(
          option.hourKey,
          { ...option, min: 0, max: 23 },
          `${title}: ${_('Hours')}`,
        ),
      );
      time.add_child(
        new St.Label({
          text: ':',
          style_class: 'aurora-devtool-time-colon',
          y_align: Clutter.ActorAlign.CENTER,
        }),
      );
      time.add_child(
        this._buildStepper(
          option.minuteKey,
          { ...option, min: 0, max: 59 },
          `${title}: ${_('Minutes')}`,
        ),
      );
      return createDevToolRow(title, subtitle, time);
    }
    if ((option.type === 'select' || option.type === 'icon-select') && option.key) {
      const optionKey = option.key;
      const choices = option.choices || [];
      const container = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
      });
      container.add_child(createDevToolRow(title, subtitle));
      const segmented = new St.BoxLayout({
        style_class: 'aurora-devtool-segmented',
        x_expand: true,
      });
      const buttons: Array<{ value: string; button: St.Button }> = [];
      for (const choice of choices) {
        const button = createDevToolButton(
          plainText(choice.title),
          () => {
            this._settings.setString(optionKey, choice.value);
            for (const entry of buttons) entry.button.checked = entry.value === choice.value;
          },
          choice.iconName,
          `${title}: ${plainText(choice.title)}`,
          choice.value === this._settings.getString(optionKey),
          undefined,
          `select-${optionKey}-${choice.value}`,
          true,
        );
        button.x_expand = true;
        button.add_style_class_name('aurora-devtool-segmented-button');
        buttons.push({ value: choice.value, button });
        segmented.add_child(button);
      }
      container.add_child(segmented);
      return container;
    }
    if (option.type === 'shortcut' && option.key)
      return createDevToolRow(title, subtitle, this._buildShortcut(option.key));
    if (option.type === 'command-list' && option.key) {
      const optionKey = option.key;
      const focusName = `aurora-devtool-focus-commands-${manifest.key}`;
      return this._buildNavigationRow(
        title,
        subtitle,
        () => this._callbacks.openCommands(manifest.key, optionKey, focusName),
        undefined,
        focusName,
      );
    }
    return createDevToolRow(title, subtitle || _('Unsupported option'));
  }

  private _buildStepper(key: string, option: ModuleOption, title: string): St.Widget {
    const value = this._settings.getInt(key);
    const control = new St.BoxLayout({
      style_class: 'aurora-devtool-stepper-control',
      y_align: Clutter.ActorAlign.CENTER,
    });
    control.add_child(
      new St.Label({
        text: String(value).padStart(2, '0'),
        style_class: 'aurora-devtool-stepper-value',
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    const stepper = new St.BoxLayout({ style_class: 'aurora-devtool-stepper' });
    const decrease = createDevToolButton(
      '−',
      () => {
        const minimum = option.min === undefined ? value - 1 : option.min;
        this._settings.setInt(key, Math.max(minimum, value - 1));
        this._callbacks.rebuild();
      },
      undefined,
      _('Decrease %s').format(title),
      false,
      undefined,
      `decrease-${key}`,
    );
    decrease.add_style_class_name('aurora-devtool-stepper-button');
    stepper.add_child(decrease);
    const increase = createDevToolButton(
      '+',
      () => {
        const maximum = option.max === undefined ? value + 1 : option.max;
        this._settings.setInt(key, Math.min(maximum, value + 1));
        this._callbacks.rebuild();
      },
      undefined,
      _('Increase %s').format(title),
      false,
      undefined,
      `increase-${key}`,
    );
    increase.add_style_class_name('aurora-devtool-stepper-button');
    stepper.add_child(increase);
    control.add_child(stepper);
    if (option.resettable) {
      const reset = new St.Button({
        child: new St.Icon({ icon_name: 'edit-undo-symbolic', icon_size: 16 }),
        style_class: 'button aurora-devtool-header-button aurora-devtool-stepper-reset',
        can_focus: true,
        accessible_name: _('Reset'),
        name: `aurora-devtool-focus-Reset ${key}`,
      });
      reset.connect('clicked', () => {
        this._settings.getRawSettings().reset(key);
        this._callbacks.rebuild();
      });
      control.add_child(reset);
    }
    return control;
  }

  private _buildShortcut(key: string): St.Widget {
    const shortcut = this._settings.getStrv(key)[0] || '';
    let capturing = false;
    const label = new St.Label({ text: shortcut || _('Disabled') });
    const content = new St.BoxLayout({ style_class: 'aurora-devtool-button-content' });
    content.add_child(label);
    const button = new St.Button({
      child: content,
      style_class: 'button aurora-devtool-button aurora-devtool-kbd',
      can_focus: true,
      accessible_name: _('Keyboard shortcut'),
      name: `aurora-devtool-focus-shortcut-${key}`,
    });
    button.connect('clicked', () => {
      capturing = !capturing;
      label.text = capturing ? _('Press shortcut…') : shortcut || _('Disabled');
      if (capturing) button.grab_key_focus();
    });
    button.connect('event', (_actor, event) => {
      if (!capturing || event.type() !== Clutter.EventType.KEY_PRESS)
        return Clutter.EVENT_PROPAGATE;

      const keyval = event.get_key_symbol();
      if (keyval === Clutter.KEY_Escape) {
        this._callbacks.rebuild();
        return Clutter.EVENT_STOP;
      }
      if (keyval === Clutter.KEY_BackSpace || keyval === Clutter.KEY_Delete) {
        this._settings.setStrv(key, []);
        this._callbacks.rebuild();
        return Clutter.EVENT_STOP;
      }
      const supportedModifiers =
        Clutter.ModifierType.CONTROL_MASK |
        Clutter.ModifierType.MOD1_MASK |
        Clutter.ModifierType.SHIFT_MASK |
        Clutter.ModifierType.SUPER_MASK;
      const modifiers = event.get_state() & supportedModifiers;
      if (modifiers === 0 || MODIFIER_KEYSYMS.has(keyval)) return Clutter.EVENT_STOP;

      const accelerator = Meta.accelerator_name(modifiers, keyval);
      if (!accelerator) return Clutter.EVENT_STOP;

      this._settings.setStrv(key, [accelerator]);
      this._callbacks.rebuild();
      return Clutter.EVENT_STOP;
    });
    return button;
  }

  private _buildCommandEditor(optionKey: string, editor: CommandEditor): St.Widget {
    const group = createDevToolGroup(editor.index === null ? _('Add Command') : _('Edit Command'));
    const name = new St.Entry({
      text: editor.label,
      hint_text: _('Name'),
      accessible_name: _('Name'),
      can_focus: true,
      style_class: 'aurora-devtool-entry',
      x_expand: true,
    });
    const command = new St.Entry({
      text: editor.command,
      hint_text: _('Command'),
      accessible_name: _('Command'),
      can_focus: true,
      style_class: 'aurora-devtool-entry',
      x_expand: true,
    });
    const error = new St.Label({
      style_class: 'aurora-devtool-error',
      accessible_role: Atk.Role.NOTIFICATION,
    });
    group.list.add_child(createDevToolRow(_('Name'), _('Shown in the Aurora menu'), name));
    group.list.add_child(createDevToolRow(_('Command'), _('Executed when selected'), command));

    const actions = new St.BoxLayout({ style_class: 'aurora-devtool-inline-controls' });
    actions.add_child(
      createDevToolButton(_('Cancel'), () => {
        this._commandEditor = null;
        this._callbacks.rebuild();
      }),
    );
    actions.add_child(
      createDevToolButton(
        _('Save'),
        () => {
          const label = name.get_text().trim();
          const value = command.get_text().trim();
          if (!label || !value || label.includes('|')) {
            error.text =
              !label || !value
                ? _('Name and command are required.')
                : _('Name cannot contain “|”.');
            return;
          }

          const serialized = serializeCustomCommand({ label, command: value });
          const next = this._settings.getStrv(optionKey);
          if (editor.index === null) next.push(serialized);
          else {
            if (next[editor.index] !== editor.original) {
              error.text = _('Command list changed. Reopen this command before saving.');
              return;
            }
            next[editor.index] = serialized;
          }
          this._settings.setStrv(optionKey, next);
          this._commandEditor = null;
          this._callbacks.rebuild();
        },
        undefined,
        _('Save'),
        false,
        'suggested',
      ),
    );

    const footer = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-group-footer',
      x_expand: true,
    });
    footer.add_child(error);
    footer.add_child(actions);
    group.container.add_child(footer);
    return group.container;
  }

  private _buildNavigationRow(
    title: string,
    subtitle: string,
    onClick: () => void,
    iconName?: string,
    focusName?: string,
  ): St.Button {
    const content = new St.BoxLayout({
      style_class: 'aurora-devtool-navigation-content',
      x_expand: true,
    });
    if (iconName)
      content.add_child(
        createIcon(iconName, {
          icon_size: 18,
          style_class: 'aurora-devtool-row-icon',
        }),
      );
    content.add_child(this._buildRowLabels(title, subtitle));
    content.add_child(
      new St.Icon({
        icon_name: 'go-next-symbolic',
        icon_size: 16,
        style_class: 'aurora-devtool-chevron',
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    const button = new St.Button({
      child: content,
      style_class: 'button aurora-devtool-row aurora-devtool-list-button',
      can_focus: true,
      x_expand: true,
      accessible_name: title,
      name: focusName || null,
    });
    button.connect('clicked', onClick);
    return button;
  }

  private _buildRowLabels(title: string, subtitle: string): St.Widget {
    const labels = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-row-labels',
      x_expand: true,
    });
    labels.add_child(new St.Label({ text: title, style_class: 'aurora-devtool-row-title' }));
    const subtitleLabel = new St.Label({
      text: subtitle,
      style_class: 'aurora-devtool-row-subtitle',
      x_expand: true,
    });
    subtitleLabel.clutter_text.line_wrap = true;
    subtitleLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    subtitleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    labels.add_child(subtitleLabel);
    return labels;
  }

  private _disableActor(actor: Clutter.Actor): void {
    actor.opacity = 128;
    const disable = (child: Clutter.Actor): void => {
      child.reactive = false;
      if (child instanceof St.Widget) child.can_focus = false;
      for (const descendant of child.get_children()) disable(descendant);
    };
    disable(actor);
  }
}
