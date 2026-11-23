/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Gio from 'gi://Gio';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../support/testUtils.js';
import { getClipboardModule } from './scenarios/panelEnvironment.js';

const SETTING = 'clipboard-history-link-previews';

export function init() {
  Scripting.defineScriptEvent(
    'previewCancellation',
    'Removing clipboard entries cancels only their own link preview requests',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  const settings = getAuroraSettings();
  const previousSetting = settings.get_boolean(SETTING);
  const clipboard = getClipboardModule();
  const resolver = Gio.Resolver.get_default();
  const lookups = [];
  const pending = new Set();

  resolver.lookup_by_name_with_flags_async = (host, _flags, cancellable, callback) => {
    const finish = () => {
      pending.delete(finish);
      callback(resolver, null);
    };
    pending.add(finish);
    lookups.push({ host, cancellable, finish });
  };
  resolver.lookup_by_name_with_flags_finish = () => [];

  try {
    settings.set_boolean(SETTING, true);
    clipboard.clearHistory();

    const removed = 'https://removed.example.com/';
    clipboard.addText(removed);
    clipboard.addText('https://retained.example.com/');
    clipboard.addText('https://over-budget.example.com/');
    const [first, second] = lookups;
    if (
      lookups.length !== 2 ||
      first.host !== 'removed.example.com.' ||
      second.host !== 'retained.example.com.'
    )
      throw new Error('Expected only the two in-flight DNS lookups');

    const id = clipboard._store.entryForText(removed).id;
    clipboard._onRemove(id);
    if (!first.cancellable.is_cancelled() || second.cancellable.is_cancelled())
      throw new Error('Individual deletion must cancel only the removed entry');

    clipboard.addText(removed);
    const replacement = lookups[2];
    if (!replacement || replacement.host !== first.host || replacement.cancellable.is_cancelled())
      throw new Error('An explicitly copied replacement must start its own preview');

    first.finish();
    await Scripting.waitLeisure();
    clipboard.clearHistory();
    if (
      !second.cancellable.is_cancelled() ||
      !replacement.cancellable.is_cancelled() ||
      lookups.length !== 3
    )
      throw new Error('Clearing must cancel remaining requests without starting dropped lookups');

    Scripting.scriptEvent('previewCancellation');
  } finally {
    for (const finish of pending) finish();
    delete resolver.lookup_by_name_with_flags_async;
    delete resolver.lookup_by_name_with_flags_finish;
    settings.set_boolean(SETTING, previousSetting);
    clipboard.clearHistory();
  }
}

export function script_previewCancellation() {
  return true;
}
