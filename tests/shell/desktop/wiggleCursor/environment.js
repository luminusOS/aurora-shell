import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { waitForCondition, waitForTiming } from '../../support/testUtils.js';
import { shake, waitForEnlarged } from './support.js';

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
    await shake(pointer);
    await waitForEnlarged(actor);
    if (actor.get_transition('scale-x'))
      throw new Error('Reduced animation did not enlarge immediately');

    accessibility.set_boolean('screen-magnifier-enabled', true);
    await waitForCondition({
      evaluate: () => St.Settings.get().magnifier_active && !actor.visible,
      signals: [
        [St.Settings.get(), 'notify::magnifier-active'],
        [actor, 'notify::visible'],
      ],
      description: 'enlargement to yield to accessibility magnification',
    });
    await shake(pointer);
    if (actor.visible) throw new Error('Wiggle Cursor competed with accessibility magnification');
    accessibility.set_boolean('screen-magnifier-enabled', false);
    await waitForCondition({
      evaluate: () => !St.Settings.get().magnifier_active,
      signals: [[St.Settings.get(), 'notify::magnifier-active']],
      description: 'accessibility magnification to stop',
    });

    tracker.inhibit_cursor_visibility();
    try {
      await shake(pointer);
      if (actor.visible) throw new Error('An already-hidden cursor was enlarged');
    } finally {
      tracker.uninhibit_cursor_visibility();
    }

    await shake(pointer);
    await waitForEnlarged(actor);
    tracker.inhibit_cursor_visibility();
    try {
      Main.layoutManager.emit('monitors-changed');
      if (actor.visible || tracker.get_pointer_visible())
        throw new Error("Monitor reset released another owner's visibility inhibitor");
    } finally {
      tracker.uninhibit_cursor_visibility();
    }

    await shake(pointer);
    await waitForEnlarged(actor);
    Main.screenShield.activate(false);
    await waitForCondition({
      evaluate: () => Main.sessionMode.currentMode === 'unlock-dialog' && !actor.visible,
      signals: [
        [Main.sessionMode, 'updated'],
        [actor, 'notify::visible'],
      ],
      description: 'enlarged cursor to restore on session lock',
    });
    try {
      await shake(pointer);
      if (actor.visible) throw new Error('Cursor enlarged on the lock screen');
    } finally {
      Main.screenShield._continueDeactivate(false);
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
    if (actor.visible || !tracker.get_pointer_visible())
      throw new Error('Cursor ownership survived environmental resets');
  } finally {
    interfaceSettings.set_boolean('enable-animations', originalAnimations);
    accessibility.set_boolean('screen-magnifier-enabled', originalMagnifier);
  }
}
