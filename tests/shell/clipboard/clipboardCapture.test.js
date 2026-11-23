import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  waitForCondition,
  waitForExtension,
  waitForTiming,
} from '../support/testUtils.js';
import { getClipboardModule } from './scenarios/panelEnvironment.js';

const clipboardType = St.ClipboardType.CLIPBOARD;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function expectHistory(module, match, description) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const entries = module._store.getHistory();
    if (match(entries)) return entries;
    await waitForTiming(25, description);
  }
  throw new Error(`${description}; got ${module._store.getHistory().map(({ text }) => text)}`);
}

async function waitForWrites(store) {
  for (let attempt = 0; attempt < 800 && store._writing; attempt++)
    await waitForTiming(10, 'in progress history writes');
  if (store._writing) throw new Error('Clipboard writes did not finish');
}

async function capturesBurstInOwnerOrder(module, clipboard, png) {
  const originalAddImage = module.addImage;
  const persistenceStarted = deferred();
  const releasePersistence = deferred();
  module.addImage = async function (payload) {
    persistenceStarted.resolve();
    await releasePersistence.promise;
    return originalAddImage.call(this, payload);
  };

  try {
    clipboard.set_content(clipboardType, 'image/png', png);
    await persistenceStarted.promise;
    for (const text of ['burst-a', 'burst-b', 'burst-c']) clipboard.set_text(clipboardType, text);
    releasePersistence.resolve();
    await expectHistory(
      module,
      (entries) =>
        entries
          .map(({ text }) => text)
          .slice(0, 4)
          .join() === 'burst-c,burst-b,burst-a,Image',
      'all burst entries in reverse owner order',
    );
  } finally {
    releasePersistence.resolve();
    module.addImage = originalAddImage;
  }
}

async function retriesFailedImage(module, clipboard, png) {
  const originalAddImage = module.addImage;
  const rejected = deferred();
  module.addImage = async () => {
    rejected.resolve();
    return false;
  };

  try {
    clipboard.set_content(clipboardType, 'image/png', png);
    await rejected.promise;
  } finally {
    module.addImage = originalAddImage;
  }
  clipboard.set_content(clipboardType, 'image/png', png);
  await expectHistory(
    module,
    (entries) => entries[0]?.kind === 'image',
    'identical image to be added after the failed attempt',
  );
}

async function recopiesAfterClearingHistory(module, clipboard) {
  const text = 'copy-again-after-clear';
  clipboard.set_text(clipboardType, text);
  await expectHistory(module, (entries) => entries[0]?.text === text, 'first copy before clear');
  if (!module.clearHistory() || module.entryCount !== 0) throw new Error('History did not clear');

  clipboard.set_text(clipboardType, text);
  await expectHistory(module, (entries) => entries[0]?.text === text, 'same copy after clear');
}

async function clearingPreservesPinnedAndClipboard(module, clipboard) {
  module.addText('pinned-before-clear');
  const pinned = module._store.entryForText('pinned-before-clear');
  module._store.pin(pinned.id);
  clipboard.set_text(clipboardType, 'clipboard-before-clear');
  await expectHistory(
    module,
    (entries) => entries[0]?.text === 'clipboard-before-clear',
    'clipboard before clear',
  );
  module.clearHistory();
  const text = await new Promise((resolve) =>
    clipboard.get_text(clipboardType, (_clipboard, value) => resolve(value)),
  );
  if (text !== 'clipboard-before-clear') throw new Error('Clear changed the clipboard');
  if (module._store.getPinned()[0]?.id !== pinned.id)
    throw new Error('Clear removed the pinned item');
  if (module._store.getHistory().length) throw new Error('Clear retained history');
  module._store.remove(pinned.id);
}

async function clearingCompactsPersistentHistory(module) {
  const directory = `${GLib.get_user_runtime_dir()}/aurora-clear-${GLib.uuid_string_random()}`;
  GLib.mkdir_with_parents(directory, 0o700);
  const path = `${directory}/history`;
  const store = new module._store.constructor(path, `${directory}/media`);
  let reloaded;
  try {
    await store.load();
    store.addText('pinned-persisted');
    store.pin(store.entryForText('pinned-persisted').id);
    store.addText('secret-cleared-from-log');
    await waitForWrites(store);
    const compacted = deferred();
    const release = deferred();
    const originalCompact = store._compactLog;
    store._compactLog = async function () {
      await originalCompact.call(this);
      compacted.resolve();
      await release.promise;
    };
    store._compactionRequested = true;
    void store._drainWrites();
    await compacted.promise;
    store.clear();
    release.resolve();
    await waitForWrites(store);
    const [, bytes] = GLib.file_get_contents(path);
    const log = new globalThis.TextDecoder().decode(bytes);
    if (log.includes('secret-cleared-from-log')) throw new Error('Cleared text remains in log');
    reloaded = new module._store.constructor(path, `${directory}/media`);
    await reloaded.load();
    if (reloaded.getPinned()[0]?.text !== 'pinned-persisted' || reloaded.getHistory().length)
      throw new Error('Reload did not preserve only pinned entries');
  } finally {
    if (reloaded) reloaded.destroy();
    store.destroy();
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null)) file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
  }
}

async function emptyHistoryCompactionKeepsPersistenceWorking(module) {
  const directory = `${GLib.get_user_runtime_dir()}/aurora-empty-${GLib.uuid_string_random()}`;
  GLib.mkdir_with_parents(directory, 0o700);
  const path = `${directory}/history`;
  const store = new module._store.constructor(path, `${directory}/media`);
  let reloaded;
  try {
    await store.load();
    store.addText('removed-before-empty-compaction');
    await waitForWrites(store);
    store.clear();
    await waitForWrites(store);
    const [, clearedBytes] = GLib.file_get_contents(path);
    if (
      new globalThis.TextDecoder().decode(clearedBytes).includes('removed-before-empty-compaction')
    )
      throw new Error('Cleared text remains in the compacted history');
    store.addText('copy-after-empty-compaction');
    await waitForWrites(store);
    reloaded = new module._store.constructor(path, `${directory}/media`);
    await reloaded.load();
    if (
      reloaded
        .getHistory()
        .map(({ text }) => text)
        .join() !== 'copy-after-empty-compaction'
    )
      throw new Error('New copy did not persist after empty compaction');
  } finally {
    if (reloaded) reloaded.destroy();
    store.destroy();
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null)) file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
  }
}

async function compactionDoesNotDuplicateConcurrentCaptures(module) {
  const directory = `${GLib.get_user_runtime_dir()}/aurora-compact-${GLib.uuid_string_random()}`;
  GLib.mkdir_with_parents(directory, 0o700);
  const path = `${directory}/history`;
  const store = new module._store.constructor(path, `${directory}/media`);
  const started = deferred();
  const release = deferred();
  const compactStarted = deferred();
  const releaseCompact = deferred();
  let reloaded;
  try {
    await store.load();
    store.addText('keep-pinned');
    store.pin(store.entryForText('keep-pinned').id);
    store.addText('remove-before-captures');
    await waitForWrites(store);
    const originalAppend = store._appendBatch;
    store._appendBatch = async function (data) {
      if (data.includes('"op":"delete"')) {
        started.resolve();
        await release.promise;
      }
      await originalAppend.call(this, data);
    };
    const originalCompact = store._compactLog;
    store._compactLog = async function () {
      const pending = originalCompact.call(this);
      compactStarted.resolve();
      await releaseCompact.promise;
      await pending;
    };
    store.clear();
    await started.promise;
    store.addText('capture-first');
    store.addText('capture-second');
    release.resolve();
    await compactStarted.promise;
    store.addText('capture-during-replacement');
    releaseCompact.resolve();
    await waitForWrites(store);
    reloaded = new module._store.constructor(path, `${directory}/media`);
    await reloaded.load();
    const history = reloaded.getHistory().map(({ text }) => text);
    if (history.join() !== 'capture-during-replacement,capture-second,capture-first')
      throw new Error(`Reloaded history has duplicates or wrong order: ${history}`);
    if (
      reloaded
        .getPinned()
        .map(({ text }) => text)
        .join() !== 'keep-pinned'
    )
      throw new Error('Concurrent compaction did not preserve the pinned item');
    const [, bytes] = GLib.file_get_contents(path);
    if (new globalThis.TextDecoder().decode(bytes).includes('remove-before-captures'))
      throw new Error('Cleared text remains in the compacted log');
  } finally {
    release.resolve();
    releaseCompact.resolve();
    if (reloaded) reloaded.destroy();
    store.destroy();
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null)) file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
  }
}

async function recoversFailedWrites(module) {
  const failures = [];
  for (const failure of ['partial', 'flush']) {
    const directory = `${GLib.get_user_runtime_dir()}/aurora-recovery-${GLib.uuid_string_random()}`;
    GLib.mkdir_with_parents(directory, 0o700);
    const path = `${directory}/history`;
    const store = new module._store.constructor(path, `${directory}/media`);
    let reloaded;
    try {
      await store.load();
      store.addText('pinned-recovery');
      store.pin(store.entryForText('pinned-recovery').id);
      await waitForWrites(store);
      const originalAppend = store._appendBatch;
      let failed = false;
      store._appendBatch = async function (data) {
        if (failed) return originalAppend.call(this, data);
        failed = true;
        const written = failure === 'partial' ? data.slice(0, 12) : data;
        await originalAppend.call(this, written);
        throw new Error(`simulated ${failure} failure`);
      };
      store.addText(`recovered-${failure}`);
      await waitForWrites(store);
      store.addText('later-capture');
      await waitForWrites(store);
      reloaded = new module._store.constructor(path, `${directory}/media`);
      await reloaded.load();
      const history = reloaded.getHistory().map(({ text }) => text);
      if (history.join() !== `later-capture,recovered-${failure}`)
        throw new Error(`${failure} failure corrupted or duplicated history: ${history}`);
      if (
        reloaded
          .getPinned()
          .map(({ text }) => text)
          .join() !== 'pinned-recovery'
      )
        throw new Error(`${failure} failure lost pinned history`);
    } catch (error) {
      failures.push(error.message);
    } finally {
      if (reloaded) reloaded.destroy();
      store.destroy();
      const file = Gio.File.new_for_path(path);
      if (file.query_exists(null)) file.delete(null);
      Gio.File.new_for_path(directory).delete(null);
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
}

async function retriesFailedClearCompaction(module) {
  const directory = `${GLib.get_user_runtime_dir()}/aurora-retry-${GLib.uuid_string_random()}`;
  GLib.mkdir_with_parents(directory, 0o700);
  const path = `${directory}/history`;
  const store = new module._store.constructor(path, `${directory}/media`);
  let reloaded;
  try {
    await store.load();
    store.addText('pinned-retry');
    store.pin(store.entryForText('pinned-retry').id);
    store.addText('cleared-retry');
    await waitForWrites(store);
    store.remove(store.entryForText('cleared-retry').id);
    await waitForWrites(store);
    const compact = store._compactLog;
    let attempts = 0;
    store._compactLog = async function () {
      attempts++;
      if (attempts === 1) throw new Error('simulated transient compaction failure');
      await compact.call(this);
    };
    store.clear();
    await waitForWrites(store);
    const [, bytes] = GLib.file_get_contents(path);
    if (attempts !== 2 || new globalThis.TextDecoder().decode(bytes).includes('cleared-retry'))
      throw new Error(`Clear compaction did not retry without new captures: ${attempts}`);
    reloaded = new module._store.constructor(path, `${directory}/media`);
    await reloaded.load();
    if (
      reloaded
        .getPinned()
        .map(({ text }) => text)
        .join() !== 'pinned-retry'
    )
      throw new Error('Retry lost the pinned item');
  } finally {
    if (reloaded) reloaded.destroy();
    store.destroy();
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null)) file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
  }
}

async function reportsPermanentPersistenceFailure(module) {
  const directory = `${GLib.get_user_runtime_dir()}/aurora-failure-${GLib.uuid_string_random()}`;
  GLib.mkdir_with_parents(directory, 0o700);
  const path = `${directory}/history`;
  let reports = 0;
  const store = new module._store.constructor(path, `${directory}/media`, () => reports++);
  let reloaded;
  try {
    await store.load();
    store.addText('pinned-failure');
    store.pin(store.entryForText('pinned-failure').id);
    store.addText('cleared-failure');
    await waitForWrites(store);
    const compact = store._compactLog;
    let attempts = 0;
    store._compactLog = async () => {
      attempts++;
      throw new Error('simulated persistent write failure');
    };
    store._retryDelay = 100;
    store.clear();
    await waitForWrites(store);
    if (attempts !== 3 || reports !== 1)
      throw new Error(`Failure was not bounded and reported: ${attempts}, ${reports}`);
    store._compactLog = compact;
    store.addText('after-recovery');
    await waitForTiming(150, 'backoff delay before recovery');
    await waitForWrites(store);
    reloaded = new module._store.constructor(path, `${directory}/media`);
    await reloaded.load();
    if (
      reloaded
        .getHistory()
        .map(({ text }) => text)
        .join() !== 'after-recovery'
    )
      throw new Error('Recovery after persistent failure lost or duplicated history');
    if (
      reloaded
        .getPinned()
        .map(({ text }) => text)
        .join() !== 'pinned-failure'
    )
      throw new Error('Recovery after persistent failure lost the pin');
  } finally {
    if (reloaded) reloaded.destroy();
    store.destroy();
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null)) file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
  }
}

async function retriesCaptureArrivingDuringFinalFailure(
  module,
  _clipboard,
  _png,
  keepFailing = false,
) {
  const directory = `${GLib.get_user_runtime_dir()}/aurora-late-${GLib.uuid_string_random()}`;
  GLib.mkdir_with_parents(directory, 0o700);
  const path = `${directory}/history`;
  let reports = 0;
  const store = new module._store.constructor(path, `${directory}/media`, () => reports++);
  const thirdStarted = deferred();
  const releaseThird = deferred();
  let reloaded;
  try {
    await store.load();
    store.addText('pinned-late');
    store.pin(store.entryForText('pinned-late').id);
    store.addText('cleared-late');
    await waitForWrites(store);
    const compact = store._compactLog;
    let attempts = 0;
    store._compactLog = async function () {
      attempts++;
      if (attempts === 3) {
        thirdStarted.resolve();
        await releaseThird.promise;
      }
      if (keepFailing || attempts <= 3) throw new Error('simulated persistence failure');
      await compact.call(this);
    };
    store._retryDelay = 100;
    store.clear();
    await Promise.race([
      thirdStarted.promise,
      waitForTiming(8000, 'deadline for the third persistence attempt').then(() => {
        throw new Error('Third persistence attempt did not start');
      }),
    ]);
    store.addText('capture-during-final-failure');
    releaseThird.resolve();
    await waitForWrites(store);
    await waitForTiming(150, 'backoff delay for late capture');
    await waitForWrites(store);
    const expectedAttempts = keepFailing ? 6 : 4;
    const expectedReports = 1;
    if (attempts !== expectedAttempts || reports !== expectedReports)
      throw new Error(`Late capture was not retried: attempts=${attempts}, reports=${reports}`);
    if (keepFailing) {
      store._compactLog = compact;
      store.addText('recovery-trigger');
      await waitForTiming(250, 'backoff delay before restored I/O');
      await waitForWrites(store);
    }
    reloaded = new module._store.constructor(path, `${directory}/media`);
    await reloaded.load();
    const expected = keepFailing
      ? 'recovery-trigger,capture-during-final-failure'
      : 'capture-during-final-failure';
    if (
      reloaded
        .getHistory()
        .map(({ text }) => text)
        .join() !== expected
    )
      throw new Error('Late capture was not persisted exactly once');
    if (
      reloaded
        .getPinned()
        .map(({ text }) => text)
        .join() !== 'pinned-late'
    )
      throw new Error('Late retry lost the pin');
  } finally {
    releaseThird.resolve();
    if (reloaded) reloaded.destroy();
    store.destroy();
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null)) file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
  }
}

async function boundsRetriesWhenLateCaptureStillFails(module) {
  await retriesCaptureArrivingDuringFinalFailure(module, null, null, true);
}

async function coalescesContinuousCaptureDuringFailure(module) {
  const directory = `${GLib.get_user_runtime_dir()}/aurora-backoff-${GLib.uuid_string_random()}`;
  GLib.mkdir_with_parents(directory, 0o700);
  const path = `${directory}/history`;
  let reports = 0;
  const store = new module._store.constructor(path, `${directory}/media`, () => reports++);
  let reloaded;
  try {
    await store.load();
    store.addText('pinned-backoff');
    store.pin(store.entryForText('pinned-backoff').id);
    store.addText('clear-backoff');
    await waitForWrites(store);
    const compact = store._compactLog;
    let attempts = 0;
    let available = false;
    store._retryDelay = 300;
    store._compactLog = async function () {
      attempts++;
      if (!available) {
        if (attempts <= 9) store.addText(`captured-in-failure-${attempts}`);
        throw new Error('simulated prolonged I/O failure');
      }
      await compact.call(this);
    };
    store.clear();
    await waitForWrites(store);
    if (attempts !== 3 || reports !== 1 || !store._retryTimeout.active || store._retryDelay !== 600)
      throw new Error(`Failure caused an immediate retry loop: ${attempts}, ${reports}`);
    for (let index = 0; index < 5; index++) store.addText(`captured-in-backoff-${index}`);
    await waitForTiming(80, 'backoff delay must coalesce captures');
    if (attempts !== 3 || reports !== 1)
      throw new Error(`Captures restarted retries during backoff: ${attempts}, ${reports}`);
    available = true;
    await waitForTiming(400, 'backoff delay before recovery');
    await waitForWrites(store);
    if (attempts !== 4 || reports !== 1)
      throw new Error(`I/O recovery did not run once: ${attempts}, ${reports}`);
    reloaded = new module._store.constructor(path, `${directory}/media`);
    await reloaded.load();
    const history = reloaded.getHistory().map(({ text }) => text);
    const expected = [
      ...Array.from({ length: 5 }, (_, index) => `captured-in-backoff-${4 - index}`),
      ...Array.from({ length: 3 }, (_, index) => `captured-in-failure-${3 - index}`),
    ];
    if (history.join() !== expected.join())
      throw new Error(`Backoff recovery lost or duplicated captures: ${history}`);
    if (
      reloaded
        .getPinned()
        .map(({ text }) => text)
        .join() !== 'pinned-backoff'
    )
      throw new Error('Backoff recovery lost the pinned item');
  } finally {
    if (reloaded) reloaded.destroy();
    store.destroy();
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null)) file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
  }
}

async function clearDialogConfirmsAndCancels(module, clipboard) {
  module.openPanel();
  const panel = module._panel;
  if (!panel._clearButton.can_focus || !panel._clearButton.accessible_name)
    throw new Error('Clear button is not accessible');
  panel._clearButton.grab_key_focus();
  await waitForCondition({
    evaluate: () => panel._clearTooltip.visible,
    signals: [[panel._clearTooltip, 'notify::visible']],
    description: 'clear tooltip to appear on keyboard focus',
  });
  const keyboard = global.stage.context
    .get_backend()
    .get_default_seat()
    .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  async function press(key, state) {
    const painted = new Promise((resolve) => {
      const id = global.stage.connect('after-paint', () => {
        global.stage.disconnect(id);
        resolve();
      });
    });
    keyboard.notify_keyval(GLib.get_monotonic_time(), key, state);
    global.stage.queue_redraw();
    await painted;
  }
  await press(Clutter.KEY_Return, Clutter.KeyState.PRESSED);
  await press(Clutter.KEY_Return, Clutter.KeyState.RELEASED);
  const dialog = panel._clearDialog;
  if (!dialog || !dialog._hasModal || !panel.isOpen || !panel.visible)
    throw new Error('Enter on clear did not open the confirmation with a modal grab');
  const settings = module.context.settings.getRawSettings();
  const shortcut = settings.get_strv('clipboard-history-shortcut');
  settings.set_strv('clipboard-history-shortcut', ['<Super>F8']);
  try {
    await press(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    await press(Clutter.KEY_F8, Clutter.KeyState.PRESSED);
    await press(Clutter.KEY_F8, Clutter.KeyState.RELEASED);
    await press(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    if (!panel.isOpen || !dialog._hasModal)
      throw new Error('Clipboard shortcut interfered with the confirmation');
  } finally {
    settings.set_strv('clipboard-history-shortcut', shortcut);
  }
  if (module.togglePanel() || !panel.isOpen)
    throw new Error('Clipboard shortcut changed the panel during confirmation');
  const buttons = dialog.buttonLayout.get_children();
  if (buttons.length !== 2 || !buttons[0].has_style_class_name('destructive-action'))
    throw new Error('Clear confirmation actions are missing');
  if (dialog.buttonLayout.layout_manager.orientation !== Clutter.Orientation.VERTICAL)
    throw new Error('Clear confirmation actions are not stacked');
  const before = module.entryCount;
  await press(Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
  await press(Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
  await Scripting.waitLeisure();
  if (dialog._hasModal || module.entryCount !== before || !panel.isOpen)
    throw new Error('Escape did not cancel without clearing');
  await waitForCondition({
    evaluate: () => panel._clearDialog === null,
    signals: [[dialog, 'destroy']],
    description: 'cancelled dialog to close',
  });

  clipboard.set_text(clipboardType, 'dialog-clear-clipboard');
  await expectHistory(module, (entries) => entries[0]?.text === 'dialog-clear-clipboard', 'copy');
  module.openPanel();
  panel._clearButton.emit('clicked', 1);
  const confirmation = panel._clearDialog;
  confirmation.buttonLayout.get_children()[0].emit('clicked', 1);
  if (confirmation._hasModal || module._store.getHistory().length || !panel.isOpen)
    throw new Error('Confirmation did not clear history and release the grab');
  const text = await new Promise((resolve) =>
    clipboard.get_text(clipboardType, (_clipboard, value) => resolve(value)),
  );
  if (text !== 'dialog-clear-clipboard') throw new Error('Dialog changed the clipboard');
}

async function clearingHistoryDropsPendingCaptures(module, clipboard, png) {
  const store = module._store;
  const originalWriteImage = store._writeImage;
  const imageWriteStarted = deferred();
  const releaseImageWrite = deferred();
  store._writeImage = async function (...args) {
    imageWriteStarted.resolve();
    await releaseImageWrite.promise;
    return originalWriteImage.apply(this, args);
  };

  try {
    clipboard.set_content(clipboardType, 'image/png', png);
    await imageWriteStarted.promise;
    clipboard.set_text(clipboardType, 'queued-before-clear-a');
    clipboard.set_text(clipboardType, 'queued-before-clear-b');
    if (!module.clearHistory() || module.entryCount !== 0)
      throw new Error('History did not clear while captures were queued');

    const afterClear = 'copied-after-queue-clear';
    clipboard.set_text(clipboardType, afterClear);
    releaseImageWrite.resolve();
    const entries = await expectHistory(
      module,
      (history) => history[0]?.text === afterClear,
      'new capture to survive clearing the pending queue',
    );
    if (entries.length !== 1)
      throw new Error(`Pre-clear captures repopulated history: ${entries.map(({ text }) => text)}`);
  } finally {
    releaseImageWrite.resolve();
    store._writeImage = originalWriteImage;
  }
}

async function recopiesAfterRestoringAnotherEntry(module, clipboard, png) {
  const text = 'copy-again-after-restore';
  await module.addImage({
    mimeType: 'image/png',
    bytes: new GLib.Bytes(png),
    fingerprint: 'dedupe-restore',
  });
  const image = module._store.getHistory()[0];
  clipboard.set_text(clipboardType, text);
  await expectHistory(module, (entries) => entries[0]?.text === text, 'first copy before restore');

  const originalAddText = module.addText;
  let repeatedCopyAccepted = false;
  module.addText = function (receivedText) {
    const added = originalAddText.call(this, receivedText);
    if (receivedText === text) repeatedCopyAccepted = added;
    return added;
  };
  try {
    await module._restoreImage(image);
    if (!clipboard.get_mimetypes(clipboardType).includes('image/png'))
      throw new Error('Image did not own the clipboard before the repeated copy');

    const marker = 'capture-after-repeated-copy';
    clipboard.set_text(clipboardType, text);
    clipboard.set_text(clipboardType, marker);
    await expectHistory(module, (entries) => entries[0]?.text === marker, 'copies after restore');
    if (!repeatedCopyAccepted) throw new Error('The copy after restoration was suppressed');
  } finally {
    module.addText = originalAddText;
  }
}

async function resumesAfterQueueFills(module, clipboard, png) {
  const originalAddImage = module.addImage;
  const persistenceStarted = deferred();
  const releasePersistence = deferred();
  module.addImage = async () => {
    persistenceStarted.resolve();
    await releasePersistence.promise;
    return false;
  };

  try {
    clipboard.set_content(clipboardType, 'image/png', png);
    await persistenceStarted.promise;
    for (let index = 0; index < 40; index++) clipboard.set_text(clipboardType, `overflow-${index}`);
    releasePersistence.resolve();

    const entries = await expectHistory(
      module,
      (history) => history[0]?.text === 'overflow-39',
      'latest selection to be recovered without another owner change',
    );
    const recovered = entries.slice(0, 32).map(({ text }) => text);
    const expected = ['overflow-39', ...Array.from({ length: 31 }, (_, i) => `overflow-${30 - i}`)];
    if (recovered.join() !== expected.join())
      throw new Error('The saturated queue displaced previously accepted selections');

    clipboard.set_text(clipboardType, 'after-overflow');
    await expectHistory(
      module,
      (history) => history[0]?.text === 'after-overflow',
      'capture to resume after the queue drains',
    );
    if (module._store.getHistory().some(({ text }) => text === 'overflow-38'))
      throw new Error('More than the latest selection was recovered from overflow');
  } finally {
    releasePersistence.resolve();
    module.addImage = originalAddImage;
  }
}

async function externalCopyWinsRestore(module, clipboard, png) {
  await module.addImage({
    mimeType: 'image/png',
    bytes: new GLib.Bytes(png),
    fingerprint: 'restore',
  });
  const entry = module._store.getHistory()[0];
  const originalLoad = Gio.File.prototype.load_bytes_async;
  const readStarted = deferred();
  const releaseRead = deferred();
  Gio.File.prototype.load_bytes_async = function (...args) {
    const loaded = originalLoad.apply(this, args);
    if (this.get_path() !== entry.filePath || args.length !== 1) return loaded;

    readStarted.resolve();
    return releaseRead.promise.then(() => loaded);
  };

  try {
    const restore = module._restoreImage(entry);
    await readStarted.promise;
    clipboard.set_text(clipboardType, 'external-copy-during-restore');
    releaseRead.resolve();
    await restore;
    const selectionText = await new Promise((resolve) =>
      clipboard.get_text(clipboardType, (_clipboard, text) => resolve(text)),
    );
    if (selectionText !== 'external-copy-during-restore')
      throw new Error('A completed image restore replaced a newer external copy');
  } finally {
    releaseRead.resolve();
    Gio.File.prototype.load_bytes_async = originalLoad;
  }
}

async function incognitoStopsPendingAndNewCopies(module, clipboard, png) {
  const store = module._store;
  const originalWrite = store._writeImage;
  const originalAddImage = module.addImage;
  const started = deferred();
  const release = deferred();
  const completed = deferred();
  let pendingCancellable;
  let temporaryPath;
  module.addImage = async function (...args) {
    try {
      return await originalAddImage.apply(this, args);
    } finally {
      completed.resolve();
    }
  };
  store._writeImage = async function (...args) {
    pendingCancellable = args[2];
    temporaryPath = args[0];
    await originalWrite.apply(this, args);
    started.resolve();
    await release.promise;
  };
  const before = store.getHistory().map(({ id }) => id);
  const preview = new Gio.Cancellable();
  module._previewRequests.set('incognito-test-preview', preview);
  try {
    clipboard.set_content(clipboardType, 'image/png', png);
    await started.promise;
    module._panel._incognitoButton.checked = true;
    if (!preview.is_cancelled()) throw new Error('Pending preview was not cancelled');
    const writeCancelled = pendingCancellable?.is_cancelled();
    clipboard.set_text(clipboardType, 'incognito-private-copy');
    release.resolve();
    await completed.promise;
    if (Gio.File.new_for_path(temporaryPath).query_exists(null))
      throw new Error('Cancelled image left a temporary file');
    if (
      store
        .getHistory()
        .map(({ id }) => id)
        .join() !== before.join()
    )
      throw new Error('Incognito changed existing history or saved a pending copy');
    const text = await new Promise((resolve) =>
      clipboard.get_text(clipboardType, (_clipboard, value) => resolve(value)),
    );
    if (text !== 'incognito-private-copy') throw new Error('Incognito changed the clipboard');
    module._panel._incognitoButton.checked = false;
    clipboard.set_text(clipboardType, 'incognito-resumed-copy');
    await expectHistory(
      module,
      (entries) => entries[0]?.text === 'incognito-resumed-copy',
      'resume',
    );
    if (store.getHistory().some((entry) => entry.text === 'incognito-private-copy'))
      throw new Error('Paused content was captured');
    module._panel._incognitoButton.checked = true;
    clipboard.set_text(clipboardType, 'incognito-secret-before-restart');
    module.disable();
    module.enable();
    if (module._panel._incognitoButton.checked)
      throw new Error('Incognito remained active after restarting the module');
    clipboard.set_text(clipboardType, 'after-incognito-restart');
    await expectHistory(
      module,
      (entries) => entries[0]?.text === 'after-incognito-restart',
      'capture after restart',
    );
    const leaked = module._store
      .getHistory()
      .some((entry) => entry.text === 'incognito-secret-before-restart');
    if (leaked || !writeCancelled)
      throw new Error(
        `Restart captured private selection: ${leaked}; write cancelled: ${writeCancelled}`,
      );
  } finally {
    release.resolve();
    store._writeImage = originalWrite;
    module.addImage = originalAddImage;
  }
}

async function incognitoTooltipShowsOnKeyboardFocus(module) {
  module.openPanel();
  const panel = module._panel;
  const icon = panel._incognitoButton.child.gicon;
  if (
    !(icon instanceof Gio.FileIcon) ||
    icon.file.get_basename() !== 'aurora-incognito-symbolic.svg'
  )
    throw new Error('Incognito control does not use the bundled symbolic icon');
  if (!icon.file.query_exists(null)) throw new Error('Incognito icon is missing from the package');
  if (!panel._incognitoButton.has_style_class_name('icon-button'))
    throw new Error('Pause control does not use the Shell button style');
  panel._incognitoButton.grab_key_focus();
  await waitForCondition({
    evaluate: () => panel._incognitoTooltip.visible,
    signals: [[panel._incognitoTooltip, 'notify::visible']],
    description: 'incognito tooltip to appear on keyboard focus',
  });
  module.closePanel();
}

async function incognitoSurvivesPersistenceRestart(module, clipboard) {
  const settings = module.context.settings.getRawSettings();
  const originalPersist = settings.get_boolean('clipboard-history-persist');
  module._panel._incognitoButton.checked = true;
  clipboard.set_text(clipboardType, 'incognito-secret-before-persistence-change');
  try {
    settings.set_boolean('clipboard-history-persist', !originalPersist);
    if (!module._panel._incognitoButton.checked)
      throw new Error('Persistence change disabled incognito');
    clipboard.set_text(clipboardType, 'incognito-secret-after-persistence-change');
    module._panel._incognitoButton.checked = false;
    clipboard.set_text(clipboardType, 'after-persistence-change');
    await expectHistory(
      module,
      (entries) => entries[0]?.text === 'after-persistence-change',
      'capture after persistence change',
    );
    if (module._store.getHistory().some((entry) => entry.text.startsWith('incognito-secret-')))
      throw new Error('Persistence change captured the private selection');
  } finally {
    settings.set_boolean('clipboard-history-persist', originalPersist);
  }
}

async function orphanedTemporaryFilesAreCleaned(module) {
  const directory = GLib.build_filenamev([
    GLib.get_user_runtime_dir(),
    `aurora-clipboard-orphans-${GLib.uuid_string_random()}`,
  ]);
  const media = GLib.build_filenamev([directory, 'media']);
  GLib.mkdir_with_parents(media, 0o700);
  const uuid = GLib.uuid_string_random();
  const names = [`1.png.${uuid}.tmp`, `1.png.${uuid}.thumb.png`, 'unrelated.tmp'];
  for (const name of names)
    GLib.file_set_contents(GLib.build_filenamev([media, name]), new Uint8Array([1]));
  const store = new module._store.constructor(`${directory}/history`, media);
  try {
    await store.load();
    if (
      names.slice(0, 2).some((name) => Gio.File.new_for_path(`${media}/${name}`).query_exists(null))
    )
      throw new Error('Orphaned capture files were not removed');
    if (!Gio.File.new_for_path(`${media}/unrelated.tmp`).query_exists(null))
      throw new Error('Cleanup removed an unrelated file');
  } finally {
    store.destroy();
    for (const name of names) {
      const file = Gio.File.new_for_path(`${media}/${name}`);
      if (file.query_exists(null)) file.delete(null);
    }
    Gio.File.new_for_path(media).delete(null);
    Gio.File.new_for_path(directory).delete(null);
  }
}

async function failedThumbnailLeavesNoTemporaryFile(module, _clipboard, png) {
  const store = module._store;
  const originalThumbnail = store._writeThumbnail;
  let thumbnail;
  store._writeThumbnail = async function (path) {
    thumbnail = path.replace(/\.[^./]+$/, '') + '.thumb.png';
    GLib.file_set_contents(thumbnail, new Uint8Array([1]));
    throw new Error('simulated thumbnail failure');
  };
  try {
    await module.addImage({
      mimeType: 'image/png',
      bytes: new GLib.Bytes(png),
      fingerprint: 'failure',
    });
    if (Gio.File.new_for_path(thumbnail).query_exists(null))
      throw new Error('Failed thumbnail left a temporary file');
  } finally {
    store._writeThumbnail = originalThumbnail;
    if (thumbnail && Gio.File.new_for_path(thumbnail).query_exists(null))
      Gio.File.new_for_path(thumbnail).delete(null);
  }
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  const module = getClipboardModule();
  for (let attempt = 0; attempt < 800 && !module._storageReady; attempt++)
    await waitForTiming(10, 'in progress clipboard storage load');
  if (!module._storageReady) throw new Error('Clipboard storage did not finish loading');
  const clipboard = St.Clipboard.get_default();
  const failures = [];
  const scenarios = [
    capturesBurstInOwnerOrder,
    retriesFailedImage,
    recopiesAfterClearingHistory,
    clearingPreservesPinnedAndClipboard,
    clearingCompactsPersistentHistory,
    emptyHistoryCompactionKeepsPersistenceWorking,
    compactionDoesNotDuplicateConcurrentCaptures,
    recoversFailedWrites,
    retriesFailedClearCompaction,
    reportsPermanentPersistenceFailure,
    retriesCaptureArrivingDuringFinalFailure,
    boundsRetriesWhenLateCaptureStillFails,
    coalescesContinuousCaptureDuringFailure,
    clearDialogConfirmsAndCancels,
    clearingHistoryDropsPendingCaptures,
    recopiesAfterRestoringAnotherEntry,
    resumesAfterQueueFills,
    externalCopyWinsRestore,
    incognitoStopsPendingAndNewCopies,
    incognitoTooltipShowsOnKeyboardFocus,
    incognitoSurvivesPersistenceRestart,
    orphanedTemporaryFilesAreCleaned,
    failedThumbnailLeavesNoTemporaryFile,
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const marker = `clipboard-capture-ready-${index}`;
    clipboard.set_text(clipboardType, marker);
    await expectHistory(
      module,
      (entries) => entries[0]?.text === marker,
      'clipboard capture readiness',
    );

    const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 8, 8);
    pixbuf.fill(0x3366ccff + index * 256);
    const [, png] = pixbuf.save_to_bufferv('png', [], []);
    try {
      await scenario(module, clipboard, png);
    } catch (error) {
      failures.push(`${scenario.name}: ${error.message}`);
    }
  }

  if (failures.length) throw new Error(failures.join('\n'));
}
