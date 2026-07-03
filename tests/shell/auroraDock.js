/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Dock module integration test
 *
 * Verifies that:
 *  - The dock container actor is added to the stage after enable (I1)
 *  - The top panel remains visible with the dock active (I2)
 *  - The trash icon is non-symbolic and immediately precedes Show Apps (I3)
 *  - A hidden dock does not intercept input over windows underneath it (I5)
 *  - Disabling the module removes the dock actor without crash (I6)
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.shell-extension.zip \
 *     tests/shell/auroraDock.js
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {
  ensureOverviewHidden,
  EXTENSION_UUID,
  getAuroraSettings,
  waitForExtension,
} from './testUtils.js';

const DOCK_ACTOR_PREFIX = 'aurora-dock-container-';

function findDockActor() {
  const uiGroup = Main.layoutManager.uiGroup;
  const n = uiGroup.get_n_children();
  for (let i = 0; i < n; i++) {
    const child = uiGroup.get_child_at_index(i);
    if (child?.name?.startsWith(DOCK_ACTOR_PREFIX)) return child;
  }
  return null;
}

function clearIntellihideQueuedRefreshes(intellihide) {
  for (const id of intellihide._queuedRefreshIds ?? []) {
    GLib.source_remove(id);
  }
  intellihide._queuedRefreshIds?.clear?.();
  if (intellihide._settleId) {
    GLib.source_remove(intellihide._settleId);
    intellihide._settleId = 0;
  }
}

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('dockPresent', 'Dock actor found in stage after enable');
  Scripting.defineScriptEvent('panelIntact', 'Top panel still visible with dock active');
  Scripting.defineScriptEvent('trashIconValid', 'Trash icon availability and position are correct');
  Scripting.defineScriptEvent('trashClickWired', 'Trash launch behavior is valid');
  Scripting.defineScriptEvent('hiddenDockInputReleased', 'Hidden dock releases its input area');
  Scripting.defineScriptEvent(
    'hotAreaYieldedInput',
    'Hot area yields input while an external-monitor dock is revealed',
  );
  Scripting.defineScriptEvent(
    'hotAreaReleaseDeferred',
    'Hot area release stays visible while the pointer is over the dock',
  );
  Scripting.defineScriptEvent(
    'hotAreaRearmedAfterHide',
    'Hot area is rearmed only after the dock is fully hidden',
  );
  Scripting.defineScriptEvent(
    'repeatedShowStable',
    'Repeated show requests do not restart the dock animation',
  );
  Scripting.defineScriptEvent(
    'blockedOverlapDefersHide',
    'Intellihide BLOCKED keeps the dock while hovered and hides after leave',
  );
  Scripting.defineScriptEvent(
    'hotAreaActiveBlockedHidesDock',
    'A BLOCKED update closes a hot-area reveal even while the pointer is inside the dock',
  );
  Scripting.defineScriptEvent(
    'hotAreaActiveClearShowsDock',
    'A CLEAR update during a hot-area reveal pins the dock visible',
  );
  Scripting.defineScriptEvent(
    'focusReassertSignalEmitted',
    'Intellihide reasserts BLOCKED on a focus change while a window stays fullscreen',
  );
  Scripting.defineScriptEvent(
    'focusReassertHidesDock',
    'A focus reassert closes a hot-area reveal when switching between fullscreen windows',
  );
  Scripting.defineScriptEvent(
    'intellihideFlapDebounced',
    'Transient geometry flaps coalesce into a single settled status',
  );
  Scripting.defineScriptEvent(
    'externalStorageDisabled',
    'External storage dock icons are absent when disabled',
  );
  Scripting.defineScriptEvent(
    'iconResizeCountsFixedIcons',
    'Automatic icon resize accounts for trash/storage icons outside _box',
  );
  Scripting.defineScriptEvent('dockRemoved', 'Dock actor removed from stage after disable');
}

/** @returns {Promise<void>} */
export async function run() {
  await waitForExtension(EXTENSION_UUID);
  await ensureOverviewHidden();

  const settings = getAuroraSettings();
  const originalShowTrash = settings.get_boolean('dock-show-trash');
  const originalShowExternalStorage = settings.get_boolean('dock-show-external-storage');
  const originalAlwaysShow = settings.get_boolean('dock-always-show');
  settings.set_boolean('dock-show-trash', true);
  settings.set_boolean('dock-show-external-storage', false);
  settings.set_boolean('dock-always-show', false);

  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  // I1 — dock actor must exist in the stage
  const dockActor = findDockActor();
  if (!dockActor)
    throw new Error(
      `No actor starting with "${DOCK_ACTOR_PREFIX}" found in Main.layoutManager.uiGroup`,
    );

  Scripting.scriptEvent('dockPresent');

  // I2 — panel must still be visible
  if (!Main.panel.visible)
    throw new Error('Top panel is not visible — dock module may have broken it');

  Scripting.scriptEvent('panelIntact');

  // I3 — trash uses the regular icon and sits directly before Show Apps
  const extension = Main.extensionManager.lookup(EXTENSION_UUID);
  const dock = extension?.stateObj?._modules?.get('dock');
  const dash = dock?.bindings?.[0]?.dash;
  const showAppsIcon = dash?._showAppsIcon;
  const dashChildren = dash?._dashContainer?.get_children?.() ?? [];
  const showAppsIndex = dashChildren.indexOf(showAppsIcon);
  const trashIcon = showAppsIndex > 0 ? dashChildren[showAppsIndex - 1] : null;
  const trashIndex = dashChildren.indexOf(trashIcon);
  const nautilus = Shell.AppSystem.get_default().lookup_app('org.gnome.Nautilus.desktop');
  const hasNautilus = Boolean(nautilus?.get_app_info().get_executable());

  if (!hasNautilus) {
    if (trashIcon?._trashFile?.get_uri?.() === 'trash:///')
      throw new Error('Trash icon was created without Nautilus installed');

    Scripting.scriptEvent('trashIconValid');
    Scripting.scriptEvent('trashClickWired');
  } else {
    if (trashIcon?._trashFile?.get_uri?.() !== 'trash:///')
      throw new Error('Trash icon was not created while dock-show-trash is enabled');
    if (trashIcon._iconActor?.icon_name?.endsWith('-symbolic'))
      throw new Error(`Trash icon is still symbolic: ${trashIcon._iconActor.icon_name}`);
    if (trashIndex < 0 || showAppsIndex !== trashIndex + 1)
      throw new Error(
        `Trash icon must immediately precede Show Apps (trash=${trashIndex}, showApps=${showAppsIndex})`,
      );
    if (dash._box?.contains?.(trashIcon))
      throw new Error('Trash icon is inside the app list instead of being a fixed dock item');
    if (dash._trashIcon !== trashIcon)
      throw new Error('Dash lost its fixed trash icon reference after GObject construction');

    Scripting.scriptEvent('trashIconValid');

    // I4 — clicking the button must invoke the trash open action
    let openCalled = false;
    const originalOpenTrashAsync = trashIcon._openTrashAsync;
    trashIcon._openTrashAsync = () => {
      openCalled = true;
    };
    trashIcon.toggleButton.emit('clicked', 1);
    await Scripting.waitLeisure();
    trashIcon._openTrashAsync = originalOpenTrashAsync;
    if (!openCalled) throw new Error('Clicking the trash icon did not invoke its open action');

    Scripting.scriptEvent('trashClickWired');
  }

  if (dash._externalStorageIcons?.length)
    throw new Error('External storage icons were created while dock-show-external-storage is disabled');

  Scripting.scriptEvent('externalStorageDisabled');

  // I15 — the automatic icon resize must count the fixed dock icons (trash,
  // external storage) that live in _dashContainer outside _box. Constrain the
  // max width to exactly fit every icon at size 24: if the fixed icons were
  // not counted, _adjustIconSize would keep a larger size and the dock would
  // overflow its work area.
  //
  // The fixed-icon count here must not depend on how many apps happen to be
  // pinned or running in the test environment: with zero of those, the dash
  // holds only the Show Apps icon, which — being simultaneously the first
  // and last child — picks up extra edge margin that a multi-icon dash never
  // sees, so the sizing budget below (derived from a single representative
  // icon) undershoots the real render. Synthesizing a few external-storage
  // icons (no hardware or Nautilus required) keeps the icon count, and this
  // check, consistent across every environment.
  const priorMaxWidth = dash._maxWidth;
  const priorMaxHeight = dash._maxHeight;
  const injectedStorageIcons = dash._externalStorageIcons.length === 0;
  try {
    if (injectedStorageIcons) {
      dash._syncExternalStorageIcons(
        [1, 2, 3].map((n) => ({
          id: `aurora-test-fake-storage-${n}`,
          name: `Aurora Test Fake Storage ${n}`,
          kind: 'mount',
          sortKey: String(n),
          icon: Gio.ThemedIcon.new('drive-harddisk'),
          volume: null,
          mount: null,
        })),
      );
    }

    const boxIconChildren = dash._box
      .get_children()
      .filter((actor) => actor.child?._delegate?.icon && !actor.animatingOut);
    const fixedIcons = [
      dash._showAppsIcon,
      dash._trashIcon,
      ...(dash._externalStorageIcons ?? []),
    ].filter(Boolean);
    const totalIcons = boxIconChildren.length + fixedIcons.length;

    const themeNode = dash.get_theme_node();
    const spacing = themeNode.get_length('spacing');
    const firstButton = (boxIconChildren[0] ?? fixedIcons[0]).child;
    const firstIcon = firstButton._delegate.icon;
    firstIcon.icon.ensure_style();
    const [, , iconNatWidth] = firstIcon.icon.get_preferred_size();
    const [, , buttonNatWidth] = firstButton.get_preferred_size();
    const iconPadding = buttonNatWidth - iconNatWidth;

    const probe = new Clutter.ActorBox({ x1: 0, y1: 0, x2: 1000, y2: 42 });
    const content = themeNode.get_content_box(probe);
    const horizontalChrome = 1000 - (content.x2 - content.x1);

    // Budget the width for every icon at size 31 — just below the 32 step of
    // baseIconSizes. Counting all icons picks 24 and fits with dozens of px
    // to spare; leaving the fixed icons out of the count picks 32 and
    // overflows the budget by a full icon-step per icon.
    const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const targetIconSize = 31 * scaleFactor;
    const maxWidth = Math.ceil(
      totalIcons * (iconPadding + targetIconSize) +
        (totalIcons - 1) * spacing +
        horizontalChrome,
    );

    dash.setMaxSize(maxWidth, priorMaxHeight > 0 ? priorMaxHeight : 400);
    dash._adjustIconSize();
    const [, natWidth] = dash.get_preferred_width(-1);
    if (natWidth > maxWidth)
      throw new Error(
        `dash natural width ${natWidth} exceeds the ${maxWidth}px budget for ` +
          `${totalIcons} icons (iconSize=${dash.iconSize}) — fixed icons not counted`,
      );
  } finally {
    if (injectedStorageIcons) dash._syncExternalStorageIcons([]);
    dash.setMaxSize(priorMaxWidth, priorMaxHeight);
    dash._adjustIconSize();
  }

  Scripting.scriptEvent('iconResizeCountsFixedIcons');

  // I5 — a hidden autohide dock must release its whole container input area
  dash.hide(false);
  if (dock.bindings[0].container.reactive)
    throw new Error('Hidden dock container is still reactive and blocks window input');

  dash.show(false);
  if (!dock.bindings[0].container.reactive)
    throw new Error('Shown dock container did not restore input handling');

  Scripting.scriptEvent('hiddenDockInputReleased');

  // I6 — repeated topology/intellihide updates must not restart the show
  // animation from the hidden pose and make the dock flash.
  dash.hide(false);
  let hiddenPoseCalls = 0;
  const originalApplyHiddenState = dash._applyHiddenState;
  dash._applyHiddenState = function (...args) {
    hiddenPoseCalls++;
    return originalApplyHiddenState.apply(this, args);
  };
  dash.show(true);
  dash.show(true);
  dash.show(true);
  await Scripting.sleep(300);
  dash._applyHiddenState = originalApplyHiddenState;
  if (hiddenPoseCalls !== 1)
    throw new Error(`Repeated show requests restarted the animation ${hiddenPoseCalls} times`);
  if (!dash.visible || dash.opacity !== 255 || dash.translation_y !== 0)
    throw new Error('Dock did not settle in its fully shown state after repeated show requests');

  Scripting.scriptEvent('repeatedShowStable');

  const binding = dock.bindings[0];

  // I7 — a direct intellihide BLOCKED transition from a visible dock must hand
  // off to hover autohide. This covers switching from a small window to a
  // fullscreen window via the dock: the dock must stay up while the pointer is
  // still over it and hide only after the pointer leaves.
  dash.show(false);
  const originalDashContainerHasHover = dash._dashContainerHasHover;
  try {
    dash._dashContainerHasHover = () => true;
    binding.hotAreaActive = false;
    clearIntellihideQueuedRefreshes(binding.intellihide);
    binding.intellihide._status = 1;
    binding.intellihide.emit('status-changed');
    await Scripting.sleep(350);
    if (!dash.visible)
      throw new Error('Intellihide BLOCKED hid the dock while the pointer stayed over it');

    dash._dashContainerHasHover = () => false;
    await Scripting.sleep(450);
  } finally {
    dash._dashContainerHasHover = originalDashContainerHasHover;
  }
  if (dash.visible) throw new Error('Intellihide BLOCKED did not hide after the pointer left');

  Scripting.scriptEvent('blockedOverlapDefersHide');

  // I8 — the bottom-edge actor must stop stealing hover while the dock is revealed
  dash.show(false);
  dock.revealFromHotArea();
  if (!binding.hotAreaActive) throw new Error('Hot-area reveal did not become active');
  if (binding.hotArea?.reactive)
    throw new Error('Hot area remained reactive above the revealed dock');

  Scripting.scriptEvent('hotAreaYieldedInput');

  // I9 — after a hot-area reveal hands off to the dash's native hover autohide,
  // the dock must stay visible while the pointer is over it (hover), even when
  // a window is BLOCKING. Hover is tracked via the dock actor's crossing events
  // (reliable over client windows), so this is what keeps the dock up while the
  // user switches apps; it only hides once the pointer leaves (see I10).
  const originalHoldZoneDashContainerHasHover = dash._dashContainerHasHover;
  clearIntellihideQueuedRefreshes(binding.intellihide);
  binding.intellihide._status = 1; // BLOCKED
  try {
    dash._dashContainerHasHover = () => true; // pointer resting over the dock
    dock._clearHotAreaReveal(binding);
    binding.hotAreaActive = false;
    dock.revealFromHotArea();
    await Scripting.sleep(1700); // past the reveal grace → handoff to autohide
  } finally {
    dash._dashContainerHasHover = originalHoldZoneDashContainerHasHover;
  }
  if (!dash.visible)
    throw new Error('Native autohide hid the dock while the pointer was over it');
  if (!binding.hotAreaActive)
    throw new Error('Hot-area reveal ended while the pointer was over the dock');
  if (binding.autoHideReleaseId !== 0)
    throw new Error('Hot-area reveal grace timer was left running after handoff');

  Scripting.scriptEvent('hotAreaReleaseDeferred');

  dock._clearHotAreaReveal(binding);

  // I10 — if a small focused window makes intellihide CLEAR while a hot-area
  // reveal is still active, the dock must switch back to pinned-visible mode.
  // This matches the journal sequence where CLEAR was previously ignored and
  // the dock hid even though the active window no longer overlapped it.
  dash.hide(false);
  binding.hotAreaActive = true;
  binding.hotArea?.setEnabled(true);
  binding.intellihide._status = 0; // CLEAR
  binding.intellihide.emit('status-changed');
  await Scripting.sleep(350);
  if (!dash.visible) throw new Error('Hot-area active CLEAR did not show the dock');
  if (binding.hotAreaActive)
    throw new Error('Hot-area active CLEAR did not end the reveal state');
  if (binding.hotArea?.reactive)
    throw new Error('Hot-area active CLEAR left the hot area reactive over the dock');

  Scripting.scriptEvent('hotAreaActiveClearShowsDock');

  // I10 — when a hot-area reveal is active and intellihide reasserts BLOCKED
  // (e.g. switching between two fullscreen/maximized windows via the dock
  // icons), the dock must stay visible while the pointer is over it and hide
  // only once the pointer leaves the dock. Retraction is driven by the dash's
  // native hover autohide, which polls the dock actor's hover state — reliable
  // even when the pointer moves onto a client window. This is the reported
  // maximized-switch bug, where a stage motion watch never saw the exit.
  const originalBlockedDashContainerHasHover = dash._dashContainerHasHover;
  try {
    binding.intellihide._status = 1; // BLOCKED
    dash._dashContainerHasHover = () => true; // pointer over the dock
    binding.hotAreaActive = true;
    binding.dash.blockAutoHide(true);
    dash.show(false);
    dock._handleHotAreaActiveIntellihideChange(binding);
    await Scripting.sleep(350);
    // Pointer still over the dock: it must remain visible (hover keeps it).
    if (!dash.visible)
      throw new Error('Hot-area active BLOCKED hid the dock while pointer stayed over it');
    if (!binding.hotAreaActive)
      throw new Error('Hot-area active BLOCKED ended the reveal while pointer stayed over it');

    // Pointer leaves the dock: native hover autohide must now retract it.
    dash._dashContainerHasHover = () => false;
    await Scripting.sleep(450);
  } finally {
    dash._dashContainerHasHover = originalBlockedDashContainerHasHover;
  }
  if (dash.visible)
    throw new Error('Hot-area active BLOCKED did not hide the dock after the pointer left');
  if (binding.hotAreaActive)
    throw new Error('Hot-area active BLOCKED kept the reveal active after the pointer left');

  Scripting.scriptEvent('hotAreaActiveBlockedHidesDock');

  dock._clearHotAreaEnable(binding);
  binding.hotAreaActive = false;
  binding.hotArea?.setEnabled(false);

  // I10 — edge detection must return only after the hide transition completed
  binding.intellihide._status = 1;
  dash.hide(true);
  dock._enableHotAreaWhenDockHidden(binding);
  if (binding.hotArea?.reactive)
    throw new Error('Hot area reactivated before the dock hide animation completed');
  await Scripting.sleep(350);
  if (dash.visible) throw new Error('Dock did not finish its hide animation');
  if (!binding.hotArea?.reactive)
    throw new Error('Hot area was not restored after the dock became fully hidden');
  if (binding.hotAreaActive)
    throw new Error('Hot-area reveal remained active after the dock became fully hidden');

  Scripting.scriptEvent('hotAreaRearmedAfterHide');

  // I12 — switching focus between two fullscreen windows keeps intellihide at
  // BLOCKED with no enum transition, so `status-changed` never fires. Intellihide
  // must instead reassert BLOCKED on the focus change so the dock can react.
  const originalReassertMonitorFullscreen = global.display.get_monitor_in_fullscreen;
  const originalReassertIsCandidate = binding.intellihide._isCandidateWindow;
  let reasserted = false;
  const reassertId = binding.intellihide.connect('blocked-reasserted', () => {
    reasserted = true;
  });
  try {
    global.display.get_monitor_in_fullscreen = () => true;
    binding.intellihide._isCandidateWindow = () => false;
    binding.intellihide._targetBox = null;
    clearIntellihideQueuedRefreshes(binding.intellihide);
    binding.intellihide.refresh('focus-window');
  } finally {
    global.display.get_monitor_in_fullscreen = originalReassertMonitorFullscreen;
    binding.intellihide._isCandidateWindow = originalReassertIsCandidate;
    binding.intellihide.disconnect(reassertId);
  }
  if (!reasserted)
    throw new Error(
      'Intellihide did not reassert BLOCKED on a focus change while a window stays fullscreen',
    );

  Scripting.scriptEvent('focusReassertSignalEmitted');

  // I13 — the blocked-reasserted signal path wired in dock.ts must hand the
  // reveal to native hover autohide too: switching between fullscreen windows
  // via the dock icons keeps the dock up while the pointer is over it and hides
  // it once the pointer leaves. Same contract as I10, but driven by the signal.
  dock._clearHotAreaReveal(binding);
  const originalReassertHasHover = dash._dashContainerHasHover;
  try {
    binding.intellihide._status = 1; // BLOCKED
    dash._dashContainerHasHover = () => true; // pointer over the dock
    binding.hotAreaActive = true;
    binding.dash.blockAutoHide(true);
    dash.show(false);
    binding.intellihide.emit('blocked-reasserted');
    await Scripting.sleep(350);
    // Pointer still over the dock: reveal stays visible.
    if (!dash.visible)
      throw new Error('Focus reassert hid the dock while the pointer stayed over it');
    if (!binding.hotAreaActive)
      throw new Error('Focus reassert ended the reveal while the pointer stayed over it');

    // Pointer leaves the dock: native hover autohide must retract it.
    dash._dashContainerHasHover = () => false;
    await Scripting.sleep(450);
  } finally {
    dash._dashContainerHasHover = originalReassertHasHover;
  }
  if (dash.visible)
    throw new Error('Focus reassert did not hide the dock after the pointer left');
  if (binding.hotAreaActive)
    throw new Error('Focus reassert left the hot-area reveal active after the pointer left');

  Scripting.scriptEvent('focusReassertHidesDock');

  dock._clearHotAreaEnable(binding);
  binding.hotAreaActive = false;
  binding.hotArea?.setEnabled(false);

  // I14 — transient window geometry during creation/move/restack makes
  // intellihide flap CLEAR<->BLOCKED many times in well under a second
  // (gnome-shell-logs: rects=[0,0 0x0] then the work-area rect then the real
  // small window, all within one second). Those flaps must coalesce into a
  // single settled status instead of toggling the dock — this covers both the
  // "dock piscando / aparecendo por cima" flicker and the new-small-window
  // hides-the-dock bug.
  clearIntellihideQueuedRefreshes(binding.intellihide);
  binding.intellihide._status = 0; // CLEAR (shown)
  let flapChanges = 0;
  const flapId = binding.intellihide.connect('status-changed', () => {
    flapChanges++;
  });
  try {
    binding.intellihide._applyOverlap(true, 'flap', []);
    binding.intellihide._applyOverlap(false, 'flap', []);
    binding.intellihide._applyOverlap(true, 'flap', []); // settles on BLOCKED
    if (flapChanges !== 0)
      throw new Error(
        `Intellihide committed ${flapChanges} status changes mid-flap instead of debouncing`,
      );
    await Scripting.sleep(300);
  } finally {
    binding.intellihide.disconnect(flapId);
  }
  if (flapChanges !== 1)
    throw new Error(`Debounced flap should emit exactly one settled change, got ${flapChanges}`);
  if (binding.intellihide.status !== 1)
    throw new Error('Intellihide did not settle on the final BLOCKED status after flapping');

  // A forced refresh (overview/keyboard/resync) must still commit immediately.
  clearIntellihideQueuedRefreshes(binding.intellihide);
  binding.intellihide._status = 1; // BLOCKED
  let forcedChanges = 0;
  const forcedId = binding.intellihide.connect('status-changed', () => {
    forcedChanges++;
  });
  try {
    binding.intellihide._applyOverlap(false, 'overview-hidden', [], true);
  } finally {
    binding.intellihide.disconnect(forcedId);
  }
  if (forcedChanges !== 1 || binding.intellihide.status !== 0)
    throw new Error('Forced intellihide refresh did not commit the status immediately');

  clearIntellihideQueuedRefreshes(binding.intellihide);
  Scripting.scriptEvent('intellihideFlapDebounced');

  // I11 — disable dock, actor must be removed
  const originalValue = settings.get_boolean('module-dock');
  settings.set_boolean('module-dock', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  const actorAfterDisable = findDockActor();
  if (actorAfterDisable)
    throw new Error('Dock actor still present in stage after module was disabled');

  Scripting.scriptEvent('dockRemoved');

  // restore
  settings.set_boolean('dock-show-trash', originalShowTrash);
  settings.set_boolean('dock-show-external-storage', originalShowExternalStorage);
  settings.set_boolean('dock-always-show', originalAlwaysShow);
  settings.set_boolean('module-dock', originalValue);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}

let _dockPresent = false;
let _panelIntact = false;
let _trashIconValid = false;
let _trashClickWired = false;
let _hiddenDockInputReleased = false;
let _hotAreaYieldedInput = false;
let _hotAreaReleaseDeferred = false;
let _hotAreaRearmedAfterHide = false;
let _repeatedShowStable = false;
let _blockedOverlapDefersHide = false;
let _hotAreaActiveBlockedHidesDock = false;
let _hotAreaActiveClearShowsDock = false;
let _dockRemoved = false;
let _externalStorageDisabled = false;
let _iconResizeCountsFixedIcons = false;

/** @returns {void} */
export function script_dockPresent() {
  _dockPresent = true;
}

/** @returns {void} */
export function script_panelIntact() {
  _panelIntact = true;
}

/** @returns {void} */
export function script_trashIconValid() {
  _trashIconValid = true;
}

/** @returns {void} */
export function script_trashClickWired() {
  _trashClickWired = true;
}

/** @returns {void} */
export function script_hiddenDockInputReleased() {
  _hiddenDockInputReleased = true;
}

/** @returns {void} */
export function script_hotAreaYieldedInput() {
  _hotAreaYieldedInput = true;
}

/** @returns {void} */
export function script_hotAreaReleaseDeferred() {
  _hotAreaReleaseDeferred = true;
}

/** @returns {void} */
export function script_hotAreaRearmedAfterHide() {
  _hotAreaRearmedAfterHide = true;
}

/** @returns {void} */
export function script_repeatedShowStable() {
  _repeatedShowStable = true;
}

/** @returns {void} */
export function script_blockedOverlapDefersHide() {
  _blockedOverlapDefersHide = true;
}

/** @returns {void} */
export function script_hotAreaActiveBlockedHidesDock() {
  _hotAreaActiveBlockedHidesDock = true;
}

/** @returns {void} */
export function script_hotAreaActiveClearShowsDock() {
  _hotAreaActiveClearShowsDock = true;
}

/** @returns {void} */
export function script_dockRemoved() {
  _dockRemoved = true;
}

/** @returns {void} */
export function script_externalStorageDisabled() {
  _externalStorageDisabled = true;
}

/** @returns {void} */
export function script_iconResizeCountsFixedIcons() {
  _iconResizeCountsFixedIcons = true;
}

/** @returns {void} */
export function finish() {
  if (!_dockPresent)
    throw new Error('Dock actor was not found in the stage after extension enable');
  if (!_panelIntact) throw new Error('Top panel was not visible while dock was active');
  if (!_trashIconValid) throw new Error('Trash icon or its position was invalid');
  if (!_trashClickWired) throw new Error('Trash click was not wired to the open action');
  if (!_hiddenDockInputReleased) throw new Error('Hidden dock did not release its input area');
  if (!_hotAreaYieldedInput) throw new Error('Hot area did not yield input after revealing dock');
  if (!_hotAreaReleaseDeferred)
    throw new Error('Hot-area release did not stay visible while pointer was inside the dock');
  if (!_hotAreaRearmedAfterHide)
    throw new Error('Hot area was not rearmed after the dock hide transition');
  if (!_repeatedShowStable)
    throw new Error('Repeated show requests restarted the dock animation');
  if (!_blockedOverlapDefersHide)
    throw new Error('Intellihide BLOCKED did not defer hiding while hovered');
  if (!_hotAreaActiveBlockedHidesDock)
    throw new Error('Hot-area active BLOCKED update did not hide the dock');
  if (!_hotAreaActiveClearShowsDock)
    throw new Error('Hot-area active CLEAR update did not pin the dock visible');
  if (!_externalStorageDisabled)
    throw new Error('External storage icons were not verified disabled');
  if (!_iconResizeCountsFixedIcons)
    throw new Error('Automatic icon resize did not account for fixed dock icons');
  if (!_dockRemoved) throw new Error('Dock actor was not removed after module was disabled');
}
