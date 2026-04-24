/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Workspace Thumbnails DnD smoke test
 *
 * Verifies that:
 *  - The extension is enabled
 *  - The overview opens and workspace thumbnails are present
 *  - The overview closes without errors
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.zip \
 *     tests/shell/auroraWorkspaceThumbnails.js
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const EXTENSION_UUID = 'aurora-shell@luminusos.github.io';
const EXTENSION_STATE_ENABLED = 1;

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Aurora Shell extension is enabled');
  Scripting.defineScriptEvent('thumbnailsFound', 'Workspace thumbnails found in overview');
  Scripting.defineScriptEvent('overviewHidden', 'Overview hidden successfully');
}

/** @returns {Promise<void>} */
export async function run() {
  const ext = Main.extensionManager.lookup(EXTENSION_UUID);
  if (!ext)
    throw new Error(`Extension ${EXTENSION_UUID} not found in ExtensionManager`);

  if (ext.state !== EXTENSION_STATE_ENABLED)
    throw new Error(`Extension state is ${ext.state} (expected ${EXTENSION_STATE_ENABLED} = ENABLED)`);

  Scripting.scriptEvent('extensionEnabled');

  Main.overview.connect('hidden', () => Scripting.scriptEvent('overviewHidden'));

  Main.overview.show();
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const controls = Main.overview._overview?._controls;
  const thumbnailsBox = controls?._thumbnailsBox;

  if (!thumbnailsBox)
    throw new Error('WorkspaceThumbnailsBox not found — overview structure may have changed');

  if (thumbnailsBox.get_children().length === 0)
    throw new Error('No workspace thumbnails present in overview');

  Scripting.scriptEvent('thumbnailsFound');

  Main.overview.hide();
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}

let _extensionEnabled = false;
let _thumbnailsFound = false;
let _overviewHidden = false;

/** @returns {void} */
export function script_extensionEnabled() { _extensionEnabled = true; }

/** @returns {void} */
export function script_thumbnailsFound() { _thumbnailsFound = true; }

/** @returns {void} */
export function script_overviewHidden() { _overviewHidden = true; }

/** @returns {void} */
export function finish() {
  if (!_extensionEnabled)
    throw new Error('Aurora Shell extension was not found or not enabled');

  if (!_thumbnailsFound)
    throw new Error('Workspace thumbnails were not found in the overview');

  if (!_overviewHidden)
    throw new Error('Overview failed to hide cleanly');
}
