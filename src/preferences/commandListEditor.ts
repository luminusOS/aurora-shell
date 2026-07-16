import '@girs/gjs';

import Adw from '@girs/adw-1';
import type Gio from '@girs/gio-2.0';
import Gtk from '@girs/gtk-4.0';

import {
  parseCustomCommand,
  serializeCustomCommand,
  type CustomMenuCommand,
} from '~/panel/auroraMenuState.ts';
import { gettext as _, ngettext } from '~/shared/i18n.ts';

const COMMAND_ICON = 'utilities-terminal-symbolic';

export function buildCommandListRow(
  key: string,
  title: string,
  description: string,
  settings: Gio.Settings,
): Adw.ActionRow {
  return new CommandListEditor(key, title, description, settings).row;
}

class CommandListEditor {
  readonly row: Adw.ActionRow;

  private readonly _key: string;
  private readonly _title: string;
  private readonly _description: string;
  private readonly _settings: Gio.Settings;

  constructor(key: string, title: string, description: string, settings: Gio.Settings) {
    this._key = key;
    this._title = title;
    this._description = description;
    this._settings = settings;

    this.row = new Adw.ActionRow({
      title,
      use_markup: false,
    });

    const manageButton = this._iconButton('list-add-symbolic', _('Manage Commands'));
    manageButton.connect('clicked', () => this._showManager());
    this.row.add_suffix(manageButton);
    this.row.activatable_widget = manageButton;

    this._settings.connect(`changed::${this._key}`, () => this._syncSummary());
    this._syncSummary();
  }

  private _syncSummary(): void {
    const count = this._readCommands().length;
    if (count === 0) {
      this.row.subtitle = _('No custom commands');
      return;
    }

    this.row.subtitle = ngettext('%d custom command', '%d custom commands', count).replace(
      '%d',
      String(count),
    );
  }

  private _showManager(): void {
    const dialog = new Adw.PreferencesDialog({
      title: this._title,
      content_width: 680,
      content_height: 520,
    });
    const page = new Adw.PreferencesPage({
      title: this._title,
      icon_name: COMMAND_ICON,
    });
    const group = new Adw.PreferencesGroup({
      title: _('Menu Commands'),
      description: this._description,
      separate_rows: false,
    });
    const addButton = this._iconButton('list-add-symbolic', _('Add Command'));
    addButton.connect('clicked', () => this._showEditor(dialog));
    group.header_suffix = addButton;

    page.add(group);
    dialog.add(page);

    let renderedRows: Gtk.Widget[] = [];
    let moveInProgress = false;
    let pendingMove: { index: number; direction: -1 | 1 } | null = null;

    const moveCommand = (row: Adw.ActionRow, from: number, to: number) => {
      if (moveInProgress) return;

      const direction = to > from ? 1 : -1;
      moveInProgress = true;
      this._animateCommandRow(row, direction, false, () => {
        pendingMove = { index: to, direction };
        this._moveCommand(from, to);
      });
    };

    const rebuild = () => {
      for (const renderedRow of renderedRows) group.remove(renderedRow);
      renderedRows = [];

      const commands = this._readCommands();
      if (commands.length === 0) {
        const emptyRow = new Adw.ActionRow({
          title: _('No commands yet'),
          subtitle: _('Use Add Command to create a shortcut in Aurora Menu'),
          use_markup: false,
        });
        emptyRow.add_prefix(
          new Gtk.Image({
            icon_name: 'view-list-symbolic',
            valign: Gtk.Align.CENTER,
          }),
        );
        group.add(emptyRow);
        renderedRows.push(emptyRow);
        moveInProgress = false;
        pendingMove = null;
        return;
      }

      const moveToAnimate = pendingMove;
      pendingMove = null;
      commands.forEach((command, index) => {
        const commandRow = this._buildCommandRow(
          dialog,
          command,
          index,
          commands.length,
          moveCommand,
        );
        group.add(commandRow);
        renderedRows.push(commandRow);

        if (moveToAnimate?.index === index) {
          this._animateCommandRow(commandRow, moveToAnimate.direction, true, () => {
            moveInProgress = false;
          });
        }
      });

      if (moveToAnimate && moveToAnimate.index >= commands.length) moveInProgress = false;
    };

    const changedId = this._settings.connect(`changed::${this._key}`, rebuild);
    dialog.connect('closed', () => this._settings.disconnect(changedId));
    rebuild();
    dialog.present(this.row);
  }

  private _buildCommandRow(
    dialog: Adw.PreferencesDialog,
    command: CustomMenuCommand,
    index: number,
    commandCount: number,
    moveCommand: (row: Adw.ActionRow, from: number, to: number) => void,
  ): Adw.ActionRow {
    const row = new Adw.ActionRow({
      title: command.label,
      subtitle: command.command,
      subtitle_lines: 2,
      use_markup: false,
    });
    row.add_prefix(
      new Gtk.Image({
        icon_name: COMMAND_ICON,
        valign: Gtk.Align.CENTER,
      }),
    );

    const actions = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 0,
      valign: Gtk.Align.CENTER,
    });
    const moveUp = this._iconButton('go-up-symbolic', _('Move Up'));
    const moveDown = this._iconButton('go-down-symbolic', _('Move Down'));
    const edit = this._iconButton('document-edit-symbolic', _('Edit Command'));
    const remove = this._iconButton('user-trash-symbolic', _('Remove Command'));

    moveUp.sensitive = index > 0;
    moveDown.sensitive = index < commandCount - 1;
    remove.add_css_class('destructive-action');

    moveUp.connect('clicked', () => moveCommand(row, index, index - 1));
    moveDown.connect('clicked', () => moveCommand(row, index, index + 1));
    edit.connect('clicked', () => this._showEditor(dialog, index, command));
    remove.connect('clicked', () => this._confirmRemove(dialog, index, command));

    actions.append(moveUp);
    actions.append(moveDown);
    actions.append(edit);
    actions.append(remove);
    row.add_suffix(actions);
    row.activatable_widget = edit;
    return row;
  }

  private _showEditor(parent: Gtk.Widget, index?: number, command?: CustomMenuCommand): void {
    const labelRow = new Adw.EntryRow({
      title: _('Name'),
      text: command?.label ?? '',
      activates_default: true,
    });
    const commandRow = new Adw.EntryRow({
      title: _('Command'),
      text: command?.command ?? '',
      activates_default: true,
    });
    commandRow.add_prefix(
      new Gtk.Image({
        icon_name: COMMAND_ICON,
        valign: Gtk.Align.CENTER,
      }),
    );

    const fields = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
    });
    fields.add_css_class('boxed-list');
    fields.append(labelRow);
    fields.append(commandRow);

    const validationMessage = new Gtk.Label({
      label: _('The name cannot contain “|”'),
      halign: Gtk.Align.START,
      margin_start: 12,
      margin_end: 12,
      wrap: true,
      visible: false,
    });
    validationMessage.add_css_class('error');

    const form = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6,
    });
    form.append(fields);
    form.append(validationMessage);

    const description = new Gtk.Label({
      label: _('Choose the name shown in Aurora Menu and the command to run.'),
      halign: Gtk.Align.START,
      wrap: true,
    });
    description.add_css_class('dim-label');
    form.prepend(description);
    form.margin_top = 18;
    form.margin_bottom = 18;
    form.margin_start = 18;
    form.margin_end = 18;

    const saveButton = new Gtk.Button({
      label: command ? _('Save') : _('Add'),
      sensitive: false,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      margin_top: 6,
    });
    saveButton.add_css_class('pill');
    saveButton.add_css_class('suggested-action');
    form.append(saveButton);

    const header = new Adw.HeaderBar();
    const toolbarView = new Adw.ToolbarView({ content: form });
    toolbarView.add_top_bar(header);
    const dialog = new Adw.Dialog({
      title: command ? _('Edit Command') : _('Add Command'),
      child: toolbarView,
      content_width: 480,
      default_widget: saveButton,
      follows_content_size: true,
    });

    const validate = () => {
      const label = labelRow.text.trim();
      const invalidSeparator = label.includes('|');
      validationMessage.visible = invalidSeparator;
      if (invalidSeparator) labelRow.add_css_class('error');
      else labelRow.remove_css_class('error');
      saveButton.sensitive =
        label.length > 0 && !invalidSeparator && commandRow.text.trim().length > 0;
    };
    labelRow.connect('changed', validate);
    commandRow.connect('changed', validate);
    validate();

    saveButton.connect('clicked', () => {
      const updated: CustomMenuCommand = {
        label: labelRow.text.trim(),
        command: commandRow.text.trim(),
      };
      const commands = this._readCommands();
      if (index === undefined) commands.push(updated);
      else if (commands[index]) commands[index] = updated;
      this._writeCommands(commands);
      dialog.close();
    });

    dialog.present(parent);
    labelRow.grab_focus();
  }

  private _confirmRemove(parent: Gtk.Widget, index: number, command: CustomMenuCommand): void {
    const dialog = new Adw.AlertDialog({
      heading: _('Remove Command?'),
      body: _('“%s” will be removed from Aurora Menu.').replace('%s', command.label),
      close_response: 'cancel',
      default_response: 'remove',
      prefer_wide_layout: true,
    });
    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('remove', _('Remove'));
    dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.connect('response', (_source, response) => {
      if (response !== 'remove') return;
      const commands = this._readCommands();
      if (commands[index]) commands.splice(index, 1);
      this._writeCommands(commands);
    });
    dialog.present(parent);
  }

  private _moveCommand(from: number, to: number): void {
    const commands = this._readCommands();
    const command = commands[from];
    if (!command || to < 0 || to >= commands.length) return;

    commands.splice(from, 1);
    commands.splice(to, 0, command);
    this._writeCommands(commands);
  }

  private _animateCommandRow(
    row: Adw.ActionRow,
    direction: -1 | 1,
    entering: boolean,
    done: () => void,
  ): void {
    const offset = 12;
    const target = Adw.CallbackAnimationTarget.new((value) => {
      const progress = entering ? 1 - value : value;
      row.opacity = 1 - progress * 0.35;

      const margin = Math.round(progress * offset);
      if (direction > 0) row.margin_top = margin;
      else row.margin_bottom = margin;
    });
    const animation = Adw.TimedAnimation.new(row, 0, 1, entering ? 180 : 140, target);
    animation.easing = entering ? Adw.Easing.EASE_OUT_CUBIC : Adw.Easing.EASE_IN_CUBIC;
    animation.connect('done', () => {
      row.opacity = 1;
      row.margin_top = 0;
      row.margin_bottom = 0;
      done();
    });
    animation.play();
  }

  private _readCommands(): CustomMenuCommand[] {
    return this._settings
      .get_strv(this._key)
      .map(parseCustomCommand)
      .filter((command): command is CustomMenuCommand => command !== null);
  }

  private _writeCommands(commands: CustomMenuCommand[]): void {
    this._settings.set_strv(this._key, commands.map(serializeCustomCommand));
  }

  private _iconButton(iconName: string, tooltip: string): Gtk.Button {
    const button = new Gtk.Button({
      icon_name: iconName,
      tooltip_text: tooltip,
      valign: Gtk.Align.CENTER,
      has_frame: false,
    });
    button.add_css_class('flat');
    return button;
  }
}
