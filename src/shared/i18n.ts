import GLib from '@girs/glib-2.0';
import { bindtextdomain } from 'gettext';

export const GETTEXT_DOMAIN = 'aurora-shell@luminusos.github.io';

const [modulePath] = GLib.filename_from_uri(import.meta.url);
const extensionPath = GLib.path_get_dirname(GLib.path_get_dirname(modulePath));
bindtextdomain(GETTEXT_DOMAIN, GLib.build_filenamev([extensionPath, 'locale']));

export function gettext(message: string): string {
  return GLib.dgettext(GETTEXT_DOMAIN, message);
}

export function ngettext(singular: string, plural: string, count: number): string {
  return GLib.dngettext(GETTEXT_DOMAIN, singular, plural, count);
}

export function pgettext(context: string, message: string): string {
  return GLib.dpgettext2(GETTEXT_DOMAIN, context, message);
}
