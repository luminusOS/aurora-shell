import '@girs/gjs';
import { gettext as _ } from 'gettext';
import Gio from '@girs/gio-2.0';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import type { SettingsManager } from '~/core/settings.ts';
import type { ModuleDefinition } from '~/moduleDefinition.ts';

const GDM_DIR = '/etc/dconf/db/gdm.d';
const GDM_FILE = `${GDM_DIR}/00-aurora-shell`;
const TMP_FILE = '/tmp/aurora-shell-gdm-colorscheme';

export class GdmSync extends Module {
  private _interfaceSettings: SettingsManager | null = null;
  private _signalId: number | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    try {
      this._interfaceSettings = this.context.settings.getSchema('org.gnome.desktop.interface');
      const current = this._interfaceSettings.getString('color-scheme');
      this._syncToGdm(current);
      this._signalId = this._interfaceSettings.connect('changed::color-scheme', () => {
        const scheme = this._interfaceSettings!.getString('color-scheme');
        this._syncToGdm(scheme);
      });
    } catch (error) {
      this.context.logger.error('GdmSync: enable failed:', error);
    }
  }

  override disable(): void {
    if (this._signalId !== null && this._interfaceSettings !== null) {
      this._interfaceSettings.disconnect(this._signalId);
      this._signalId = null;
    }
    this._interfaceSettings = null;
  }

  private _syncToGdm(scheme: string): void {
    if (scheme !== 'prefer-light' && scheme !== 'prefer-dark') return;

    const content = `[org/gnome/desktop/interface]\ncolor-scheme='${scheme}'\n`;
    const bytes = new Uint8Array(content.length);
    for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i);

    try {
      const tmp = Gio.File.new_for_path(TMP_FILE);
      tmp.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (error) {
      this.context.logger.error('GdmSync: failed to write temp file:', error);
      return;
    }

    try {
      const proc = Gio.Subprocess.new(
        [
          'pkexec',
          'bash',
          '-c',
          `mkdir -p ${GDM_DIR} && cp ${TMP_FILE} ${GDM_FILE} && dconf update`,
        ],
        Gio.SubprocessFlags.NONE,
      );
      proc.wait_async(null, (_src, result) => {
        try {
          proc.wait_finish(result);
          if (!proc.get_successful())
            this.context.logger.warn(`GdmSync: pkexec failed for '${scheme}'`);
        } catch (e) {
          this.context.logger.warn(`GdmSync: wait error: ${e}`);
        }
      });
    } catch (error) {
      this.context.logger.error('GdmSync: failed to spawn pkexec:', error);
    }
  }
}

export const definition: ModuleDefinition = {
  key: 'gdm-sync',
  settingsKey: 'module-gdm-sync',
  title: _('GDM Sync'),
  subtitle: _('Syncs the color scheme to the GDM login screen (requires admin authorization)'),
  factory: (ctx) => new GdmSync(ctx),
};
