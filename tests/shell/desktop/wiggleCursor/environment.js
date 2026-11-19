import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { waitForCondition, waitForTiming } from '../../support/testUtils.js';
import {
  MAGNIFICATION,
  expectNoEnlargement,
  shake,
  waitForEnlarged,
  whileShaking,
} from './support.js';

export async function exerciseEnvironment(actor, pointer, tracker) {
  const interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
  const accessibility = new Gio.Settings({ schema_id: 'org.gnome.desktop.a11y.applications' });
  const originalAnimations = interfaceSettings.get_boolean('enable-animations');
  const originalMagnifier = accessibility.get_boolean('screen-magnifier-enabled');
  try {
    interfaceSettings.set_boolean('enable-animations', false);
    await waitForCondition({
      evaluate: () => !St.Settings.get().enable_animations,
      signals: [[St.Settings.get(), 'notify::enable-animations']],
      description: 'reduced-animation preference to reach Shell',
    });
    const seenScales = [];
    const scaleId = actor.connect('notify::scale-x', () => seenScales.push(actor.scale_x));
    try {
      await shake(pointer);
      await waitForEnlarged(actor);
    } finally {
      actor.disconnect(scaleId);
    }
    if (seenScales.some((scale) => scale > 1 && scale < MAGNIFICATION))
      throw new Error('Reduced animation did not enlarge immediately');

    // The module hears the preference first, so by the time this listener runs it must have yielded.
    let visibleWhenMagnifierStarted = null;
    const magnifierId = St.Settings.get().connect('notify::magnifier-active', () => {
      if (St.Settings.get().magnifier_active) visibleWhenMagnifierStarted = actor.visible;
    });
    try {
      await whileShaking(pointer, async () => {
        await waitForEnlarged(actor);
        accessibility.set_boolean('screen-magnifier-enabled', true);
        await waitForCondition({
          evaluate: () => St.Settings.get().magnifier_active,
          signals: [[St.Settings.get(), 'notify::magnifier-active']],
          description: 'accessibility magnification to start',
        });
      });
    } finally {
      St.Settings.get().disconnect(magnifierId);
    }
    if (visibleWhenMagnifierStarted !== false)
      throw new Error('Enlargement did not yield as soon as accessibility magnification started');

    await expectNoEnlargement(
      actor,
      () => shake(pointer),
      'Wiggle Cursor competed with accessibility magnification',
    );
    accessibility.set_boolean('screen-magnifier-enabled', false);
    await waitForCondition({
      evaluate: () => !St.Settings.get().magnifier_active,
      signals: [[St.Settings.get(), 'notify::magnifier-active']],
      description: 'accessibility magnification to stop',
    });

    tracker.inhibit_cursor_visibility();
    try {
      await expectNoEnlargement(
        actor,
        () => shake(pointer),
        'An already-hidden cursor was enlarged',
      );
    } finally {
      tracker.uninhibit_cursor_visibility();
    }

    await whileShaking(pointer, async () => {
      await waitForEnlarged(actor);
      tracker.inhibit_cursor_visibility();
      try {
        Main.layoutManager.emit('monitors-changed');
        if (actor.visible || tracker.get_pointer_visible())
          throw new Error("Monitor reset released another owner's visibility inhibitor");
      } finally {
        tracker.uninhibit_cursor_visibility();
      }
    });

    // Any pointer motion on the lock screen counts as activity and unlocks this isolated session
    // within a few milliseconds, so a shake cannot be observed there. What can be checked is that
    // locking with an enlarged cursor gives the real pointer back.
    let lockRequested = false;
    try {
      await whileShaking(pointer, async () => {
        await waitForEnlarged(actor);
        lockRequested = true;
        Main.screenShield.activate(false);
        await waitForCondition({
          evaluate: () =>
            Main.sessionMode.currentMode === 'unlock-dialog' && tracker.get_pointer_visible(),
          signals: [
            [Main.sessionMode, 'updated'],
            [tracker, 'visibility-changed'],
          ],
          description: 'enlarged cursor to give the pointer back on session lock',
        });
      });
    } finally {
      if (lockRequested) Main.screenShield._continueDeactivate(false);
    }
    await waitForCondition({
      evaluate: () => !Main.screenShield.active && Main.sessionMode.currentMode !== 'unlock-dialog',
      signals: [
        [Main.sessionMode, 'updated'],
        [Main.screenShield, 'active-changed'],
      ],
      description: 'isolated test session to unlock',
    });

    await waitForTiming(
      2000,
      'Negative check: expired hold callbacks must not change cursor visibility',
    );
    if (!tracker.get_pointer_visible())
      throw new Error('Cursor ownership survived environmental resets');
  } finally {
    interfaceSettings.set_boolean('enable-animations', originalAnimations);
    accessibility.set_boolean('screen-magnifier-enabled', originalMagnifier);
  }
}
