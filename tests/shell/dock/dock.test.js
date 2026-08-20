/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { Dash as ShellDash } from 'resource:///org/gnome/shell/ui/dash.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {
  ensureOverviewHidden,
  EXTENSION_UUID,
  getAuroraModule,
  getAuroraSettings,
  waitForExtension,
} from '../support/testUtils.js';
import { exerciseExternalWorkspace, exerciseMonitorScope } from './scenarios/monitors.js';

const DOCK_ACTOR_PREFIX = 'aurora-dock-container-';
const RUNNING_DOT_ALIGNMENT = {
  bottom: { x: Clutter.ActorAlign.CENTER, y: Clutter.ActorAlign.END },
  left: { x: Clutter.ActorAlign.START, y: Clutter.ActorAlign.CENTER },
  right: { x: Clutter.ActorAlign.END, y: Clutter.ActorAlign.CENTER },
};

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
  intellihide._queuedRefreshes?.clear();
  intellihide._settle?.clear();
}

function assertSeparatorOrientation(dash, position) {
  const separator = dash._fixedSeparator;
  if (!separator) return;

  const [, width] = separator.get_preferred_width(-1);
  const [, height] = separator.get_preferred_height(-1);
  if (position === 'bottom') {
    if (width > height) throw new Error('Bottom Dock separator is not vertical');
    return;
  }

  if (height > width) throw new Error(`${position} Dock separator is not horizontal`);
}

function assertBackgroundCoversDash(dash, position) {
  const background = dash._background;
  const container = dash._dashContainer;
  if (!background || !container) throw new Error(`${position} Dock is missing its background`);

  // The background must span the container along the icon axis, otherwise it
  // only wraps a single icon and the rest of the dock renders unpainted.
  const [mainSize, containerMain] =
    position === 'bottom'
      ? [background.width, container.width]
      : [background.height, container.height];

  if (mainSize < containerMain - 1)
    throw new Error(
      `${position} Dock background does not span the dash ` +
        `(background=${background.width}x${background.height}, ` +
        `container=${container.width}x${container.height})`,
    );
}

function assertBackgroundClearsScreenEdge(dash, position) {
  const background = dash._background;
  if (!background) throw new Error(`${position} Dock is missing its background`);

  // The dash actor reaches the screen edge; the visible pill is inset from it
  // by a margin on the background itself.
  const gap =
    position === 'left'
      ? background.x
      : position === 'right'
        ? dash.width - (background.x + background.width)
        : dash.height - (background.y + background.height);

  if (gap < 8)
    throw new Error(`${position} Dock background sits flush against the screen edge (gap=${gap})`);
}

function assertRunningDotsPointToEdge(dash, position) {
  const expected = RUNNING_DOT_ALIGNMENT[position];
  for (const child of dash._box.get_children()) {
    const dot = child.child?._delegate?._dot;
    if (!dot) continue;
    if (dot.x_align !== expected.x || dot.y_align !== expected.y)
      throw new Error(`${position} Dock running indicator points to the wrong edge`);
  }
}

// The session the tests run in has no favorite apps, so no dash item owns a
// running dot to measure. Probe the stylesheet with a throwaway widget parented
// to the dash instead, so the `#dash.dock-*` selectors still apply.
function assertRunningDotIsRound(dash, position) {
  // Parented to the dash itself, not to `_dashContainer`: the container lays
  // its children out along the icon axis, and a probe there would perturb the
  // dock geometry the later assertions depend on.
  const probe = new St.Widget({ style_class: 'app-grid-running-dot' });
  dash.add_child(probe);
  try {
    probe.ensure_style();
    const [, width] = probe.get_preferred_width(-1);
    const [, height] = probe.get_preferred_height(-1);
    if (width !== height)
      throw new Error(`${position} Dock running indicator is not round (${width}x${height})`);
  } finally {
    probe.destroy();
  }
}

// The dot must clear the icon texture, not be painted over it. The icon
// container leaves ~18px of slack below the texture but only ~6px beside it, so
// an offset that is right for one axis is wrong for the other.
async function assertRunningDotClearsIcon(dash, position) {
  const apps = Shell.AppSystem.get_default()
    .get_installed()
    .filter((app) => app.should_show())
    .slice(0, 1)
    .map((app) => app.get_id());
  if (apps.length === 0) throw new Error('No installed app available to probe the running dot');

  const saved = global.settings.get_strv('favorite-apps');
  global.settings.set_strv('favorite-apps', apps);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  try {
    for (const child of dash._box.get_children()) {
      const icon = child.child?._delegate;
      const texture = icon?.icon?.icon;
      if (!icon?._dot || !texture) continue;

      const dot = icon._dot;
      const container = icon._iconContainer;
      // The dot is hidden while the app is not running, so it has no allocation
      // to read; derive the free room from the container and texture boxes and
      // compare it against the dot's size plus its offset.
      const [containerX, containerY] = container.get_transformed_position();
      const [textureX, textureY] = texture.get_transformed_position();
      const slack =
        position === 'bottom'
          ? containerY + container.height - (textureY + texture.height)
          : position === 'left'
            ? textureX - containerX
            : containerX + container.width - (textureX + texture.width);
      const dotExtent = position === 'bottom' ? dot.height : dot.width;
      const offset =
        position === 'bottom'
          ? -dot.translation_y
          : position === 'left'
            ? dot.translation_x
            : -dot.translation_x;

      if (offset + dotExtent > slack)
        throw new Error(
          `${position} Dock running indicator overlaps the icon ` +
            `(offset=${offset}, dot=${dotExtent}, slack=${slack})`,
        );
    }
  } finally {
    global.settings.set_strv('favorite-apps', saved);
    await Scripting.waitLeisure();
    await Scripting.sleep(200);
  }
}

function assertSideLabelIsInside(dash, position) {
  const item = dash._showAppsIcon;
  dash._showSideLabel(item);
  const [itemX] = item.get_transformed_position();

  let labelIsInside;
  if (position === 'left') {
    labelIsInside = item.label.x > itemX + item.width;
  } else if (position === 'right') {
    labelIsInside = item.label.x + item.label.width < itemX;
  } else {
    throw new Error(`Side label assertion does not support ${position}`);
  }

  if (!item.label.visible || !labelIsInside)
    throw new Error(`${position} Dock label is not shown on the inner side`);
  item.hideLabel();
}

function assertVerticalDragPlaceholder(dash, position) {
  const originalGetAppFromSource = ShellDash.getAppFromSource;
  try {
    ShellDash.getAppFromSource = () => ({ is_window_backed: () => false });
    dash.handleDragOver({}, null, 0, dash._box.height * 0.75, 0);
    const placeholder = dash._dragPlaceholder;
    const hasExpectedSize =
      placeholder?.child.width === dash.iconSize / 2 && placeholder.child.height === dash.iconSize;
    if (!hasExpectedSize)
      throw new Error(`${position} Dock did not create a vertical drag placeholder`);
  } finally {
    dash._clearDragPlaceholder();
    ShellDash.getAppFromSource = originalGetAppFromSource;
  }
}

function edgeIsReachable(monitors, index, position) {
  const monitor = monitors[index];
  const left = monitor.x;
  const right = left + monitor.width;
  const top = monitor.y;
  const bottom = top + monitor.height;
  return !monitors.some((other, otherIndex) => {
    if (index === otherIndex) return false;
    const overlapsX = other.x < right && other.x + other.width > left;
    const overlapsY = other.y < bottom && other.y + other.height > top;
    if (position === 'left') return overlapsY && other.x + other.width === left;
    if (position === 'right') return overlapsY && other.x === right;
    return overlapsX && other.y === bottom;
  });
}

function findDescendant(actor, predicate) {
  if (predicate(actor)) return actor;
  if (!actor?.get_children) return null;

  for (const child of actor.get_children()) {
    const match = findDescendant(child, predicate);
    if (match) return match;
  }

  return null;
}

// Window-backed fallback apps (window:N) can be destroyed and recreated, so
// prefer the icon that owns the live window and use its app id as a fallback.
function findWindowPreviewTarget(dash, window, app) {
  const appId = app.get_id();
  const items = dash._applications.getChildren();
  const item =
    items.find((candidate) => candidate.child?._delegate?.app?.get_windows().includes(window)) ||
    items.find((candidate) => candidate.child?._delegate?.app?.get_id() === appId);
  const appIcon = item?.child?._delegate;
  if (!item || !appIcon) return null;
  if (appIcon.app.get_windows().length === 0) return null;
  return { item, appIcon };
}

// The WindowTracker can re-associate the test window with a different
// Shell.App once the helper's application id arrives, leaving the previously
// resolved app without any windows.
function resolveLivePreviewApp(window, currentApp) {
  const reassignedApp = Shell.WindowTracker.get_default().get_window_app(window);
  return reassignedApp?.get_windows().includes(window) ? reassignedApp : currentApp;
}

// A Dock rebuild can leave the icon absent for a few main-loop cycles, so the
// lookup polls until the item reappears.
async function waitForWindowPreviewTarget(dash, window, currentApp) {
  let app = resolveLivePreviewApp(window, currentApp);
  let target = findWindowPreviewTarget(dash, window, app);
  for (let attempt = 0; !target && attempt < 20; attempt++) {
    await Scripting.sleep(100);
    app = resolveLivePreviewApp(window, app);
    target = findWindowPreviewTarget(dash, window, app);
  }
  return { app, target };
}

async function exerciseWindowPreviews(settings, dock) {
  const previousWindows = new Set(global.get_window_actors().map((actor) => actor.meta_window));
  await Scripting.createTestWindow({ width: 760, height: 480, maximized: false });
  await Scripting.waitTestWindows();
  await Scripting.sleep(300);

  const window = global
    .get_window_actors()
    .map((actor) => actor.meta_window)
    .find((candidate) => !previousWindows.has(candidate));
  if (!window) throw new Error('Could not create a window-preview test window');

  try {
    let previewApp = Shell.WindowTracker.get_default().get_window_app(window);
    if (!previewApp) throw new Error('Could not resolve the window-preview test application');

    settings.set_boolean('dock-window-previews', true);
    await Scripting.waitLeisure();
    await Scripting.sleep(500);

    const dash = dock?.bindings?.[0]?.dash;
    if (!dash?._windowPreviews)
      throw new Error('Window-preview controller was not created when enabled');

    dash.show(false);
    dash.refresh();
    await Scripting.waitLeisure();
    await Scripting.sleep(300);

    // The Dock rebuilds its items when app states settle after the test window
    // appears, so every interaction re-resolves the current item and icon.
    let previewState = await waitForWindowPreviewTarget(dash, window, previewApp);
    previewApp = previewState.app;
    if (!previewState.target)
      throw new Error('Window-preview test application is absent from Dock');
    let { item, appIcon } = previewState.target;

    // Drive the real hover contract: a short hover cancels the pending show,
    // a sustained hover suppresses the tooltip and opens the popup after its delay.
    appIcon.set_hover(true);
    await Scripting.sleep(150);
    appIcon.set_hover(false);
    await Scripting.sleep(400);
    if (dash._windowPreviews._popup)
      throw new Error('Window-preview popup opened after its hover was cancelled');

    previewState = await waitForWindowPreviewTarget(dash, window, previewApp);
    previewApp = previewState.app;
    if (!previewState.target)
      throw new Error('Window-preview test application is absent from Dock');
    ({ item, appIcon } = previewState.target);
    appIcon.set_hover(true);
    if (!dash._windowPreviews.shouldSuppressTooltip(appIcon))
      throw new Error('Window-preview hover did not suppress the Dock tooltip');

    // Poll instead of a single fixed sleep: GLib dispatches ready sources of
    // equal priority newest-first, so under CI load a long sleep can resolve
    // before the show timer even though the timer expired first. A Dock item
    // rebuild also drops the pending show, in which case the hover is re-armed
    // against the freshly resolved icon. When no live icon is available, a
    // forced redisplay reconciles the Dock with the current running apps.
    let popup = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      await Scripting.sleep(100);
      if (dash._windowPreviews._popup?.isOpen) {
        popup = dash._windowPreviews._popup;
        break;
      }
      if (dash._windowPreviews._pendingSource) continue;

      previewApp = resolveLivePreviewApp(window, previewApp);
      const target = findWindowPreviewTarget(dash, window, previewApp);
      if (!target) {
        dash.refresh();
        continue;
      }

      ({ item, appIcon } = target);
      appIcon.set_hover(false);
      appIcon.set_hover(true);
    }
    if (!popup || !dash._isMenuOpen()) {
      const controller = dash._windowPreviews;
      const fresh = findWindowPreviewTarget(dash, window, previewApp);
      const windows = previewApp.get_windows();
      const windowAlive = global.get_window_actors().some((actor) => actor.meta_window === window);
      const currentApp = windowAlive
        ? Shell.WindowTracker.get_default().get_window_app(window)
        : null;
      const iconApp = fresh?.appIcon.app;
      const diagnostics = [
        `pending=${Boolean(controller._pendingSource)}`,
        `showTimerActive=${controller._showTimer?.active}`,
        `hover=${fresh ? fresh.appIcon.hover : 'n/a'}`,
        `appWindows=${windows.length}`,
        `relevantWindows=${windows.filter((w) => controller._options.isWindowRelevant(w)).length}`,
        `skipTaskbar=${windows.map((w) => w.is_skip_taskbar()).join(',')}`,
        `menuOpen=${Boolean(fresh?.appIcon._menu?.isOpen)}`,
        `windowAlive=${windowAlive}`,
        `compositorPrivate=${windowAlive ? Boolean(window.get_compositor_private()) : 'n/a'}`,
        `sameApp=${currentApp === previewApp}`,
        `iconSameAsPreview=${iconApp ? iconApp === previewApp : 'n/a'}`,
        `iconAppWindows=${iconApp ? iconApp.get_windows().length : 'n/a'}`,
        `iconApp=${iconApp?.get_id()}`,
        `windowApp=${currentApp?.get_id()}`,
        `testApp=${previewApp.get_id()}`,
        `sameDash=${dock.bindings[0]?.dash === dash}`,
        `dashBoxMissing=${!dash._dashBox}`,
        `dockChildren=${dash._applications.getChildren().length}`,
        `childApps=${dash._applications
          .getChildren()
          .map((child) => child.child?._delegate?.app?.get_id())
          .join('|')}`,
      ];
      throw new Error(
        `Window-preview popup did not open from the icon hover [${diagnostics.join(' ')}]`,
      );
    }
    if (global.stage.get_key_focus() !== popup.actor)
      throw new Error('Window-preview popup did not take the keyboard focus');
    popup.actor.set_hover(true);
    if (!item.has_style_class_name('aurora-window-preview-open'))
      throw new Error('Window-preview popup did not keep its Dock item highlighted');

    const preview = findDescendant(
      popup.actor,
      (actor) => actor.layout_manager instanceof Shell.WindowPreviewLayout,
    );
    if (!preview) throw new Error('Window-preview popup does not contain a live thumbnail');

    const thumbnail = findDescendant(
      popup.actor,
      (actor) =>
        actor.has_style_class_name && actor.has_style_class_name('aurora-window-preview-thumbnail'),
    );
    if (!thumbnail) throw new Error('Window-preview popup does not contain its thumbnail frame');
    const title = findDescendant(
      popup.actor,
      (actor) =>
        actor.has_style_class_name && actor.has_style_class_name('aurora-window-preview-title'),
    );
    if (!title || title.clutter_text.line_alignment !== Pango.Alignment.CENTER)
      throw new Error('Window-preview title is not centered');
    const [previewWidth, previewHeight] = preview.get_transformed_size();
    const [thumbnailWidth, thumbnailHeight] = thumbnail.get_transformed_size();
    if (
      Math.abs(previewWidth - thumbnailWidth) > 2 ||
      Math.abs(previewHeight - thumbnailHeight) > 2
    ) {
      throw new Error('Window-preview thumbnail does not follow the window aspect ratio');
    }

    const scroll = findDescendant(popup.actor, (actor) => actor instanceof St.ScrollView);
    if (!scroll) throw new Error('Window-preview popup does not contain its viewport');
    if (
      scroll.hscrollbar_policy !== St.PolicyType.AUTOMATIC ||
      scroll.vscrollbar_policy !== St.PolicyType.AUTOMATIC
    ) {
      throw new Error('Window-preview popup cannot scroll its overflow');
    }
    if (scroll.hscrollbar_visible || scroll.vscrollbar_visible)
      throw new Error('Window-preview popup exposed a scrollbar for content that fits');

    const minimize = findDescendant(
      popup.actor,
      (actor) => actor.child?.icon_name === 'window-minimize-symbolic',
    );
    if (minimize) throw new Error('Window-preview popup still exposes minimize action');

    const card = findDescendant(
      popup.actor,
      (actor) =>
        actor.has_style_class_name && actor.has_style_class_name('aurora-window-preview-card'),
    );
    if (!card || !card.reactive || !card.track_hover)
      throw new Error('Window-preview card does not track pointer hover');
    if (card.has_style_class_name('focused'))
      throw new Error('Window-preview card still exposes a focused-window border');
    card.set_hover(true);
    if (!card.has_style_pseudo_class('hover'))
      throw new Error('Window-preview card did not enter its hover state');
    card.set_hover(false);

    const close = findDescendant(
      popup.actor,
      (actor) =>
        actor.has_style_class_name && actor.has_style_class_name('aurora-window-preview-close'),
    );
    if (!close || !close.has_style_class_name('window-close'))
      throw new Error('Window-preview popup does not expose the native circular close action');

    const overlay = close.get_parent();
    const [overlayX, overlayY] = overlay.get_transformed_position();
    const [overlayWidth] = overlay.get_transformed_size();
    const [closeX, closeY] = close.get_transformed_position();
    const [closeWidth] = close.get_transformed_size();
    const closeRight = closeX + closeWidth;
    const overlayRight = overlayX + overlayWidth;
    const horizontalOffset = closeRight - overlayRight;
    const verticalOffset = overlayY - closeY;
    if (
      horizontalOffset < 6 ||
      verticalOffset < 6 ||
      Math.abs(horizontalOffset - verticalOffset) > 2
    ) {
      throw new Error('Window-preview close action is not consistently offset past the corner');
    }

    close.emit('clicked', Clutter.BUTTON_PRIMARY);
    await Scripting.sleep(500);
    if (item.has_style_class_name('aurora-window-preview-open'))
      throw new Error('Window-preview Dock highlight survived popup closure');
    if (global.get_window_actors().some((actor) => actor.meta_window === window))
      throw new Error('Window-preview close action did not close the window');

    dash._windowPreviews.close();
    if (dash._windowPreviews._popup)
      throw new Error('Window-preview actors were retained after popup close');

    appIcon.set_hover(false);
  } finally {
    if (global.get_window_actors().some((actor) => actor.meta_window === window))
      window.delete(global.get_current_time());
    settings.set_boolean('dock-window-previews', false);
    await Scripting.waitLeisure();
    await Scripting.sleep(300);
  }
}

async function exerciseDockPositions(settings, dock) {
  settings.set_boolean('dock-show-on-all-monitors', false);
  settings.set_boolean('dock-always-show', false);
  settings.set_boolean('dock-intellihide', true);

  // Extent of the icon axis per position, so a side dock cannot silently pick
  // up the bottom dock's edge offset as extra spacing between icons.
  const iconAxisExtents = {};

  for (const position of ['bottom', 'left', 'right']) {
    settings.set_string('dock-position', position);
    await Scripting.waitLeisure();
    await Scripting.sleep(350);

    const binding = dock.bindings.find(
      (candidate) => candidate.monitorIndex === Main.layoutManager.primaryIndex,
    );
    if (!binding || binding.dash._position !== position)
      throw new Error(`Dock position ${position} did not apply immediately`);

    const vertical = position !== 'bottom';
    const orientation = binding.dash._dashContainer.layout_manager.orientation;
    if ((orientation === Clutter.Orientation.VERTICAL) !== vertical)
      throw new Error(`Dock ${position} has the wrong container orientation`);

    binding.dash.show(false);
    const workArea = Main.layoutManager.getWorkAreaForMonitor(binding.monitorIndex);
    binding.dash.applyWorkArea(workArea);
    await Scripting.waitLeisure();
    const monitor = Main.layoutManager.monitors[binding.monitorIndex];
    const container = binding.container;
    const centerTolerance = 2;
    if (position === 'bottom') {
      const center = container.x + container.width / 2;
      if (Math.abs(center - (monitor.x + monitor.width / 2)) > centerTolerance)
        throw new Error('Bottom Dock is not centered horizontally');
    } else {
      const center = container.y + container.height / 2;
      if (Math.abs(center - (workArea.y + workArea.height / 2)) > centerTolerance)
        throw new Error(`${position} Dock is not centered vertically`);
    }

    const separator = binding.dash._fixedSeparator;
    const children = binding.dash._dashContainer.get_children();
    const showAppsIndex = children.indexOf(binding.dash._showAppsIcon);
    const separatorIndex = children.indexOf(separator);
    const firstFixedIndex = Math.min(
      ...binding.dash._fixedItems.icons.map((icon) => children.indexOf(icon)),
    );
    if (separator && !(separatorIndex < firstFixedIndex && firstFixedIndex < showAppsIndex))
      throw new Error(`${position} Dock did not keep fixed items before Show Apps`);

    assertSeparatorOrientation(binding.dash, position);
    assertBackgroundCoversDash(binding.dash, position);
    assertBackgroundClearsScreenEdge(binding.dash, position);
    assertRunningDotsPointToEdge(binding.dash, position);
    assertRunningDotIsRound(binding.dash, position);
    await assertRunningDotClearsIcon(binding.dash, position);

    iconAxisExtents[position] = vertical
      ? binding.dash._dashContainer.height
      : binding.dash._dashContainer.width;

    if (vertical) {
      assertSideLabelIsInside(binding.dash, position);
      assertVerticalDragPlaceholder(binding.dash, position);
    }

    if (!binding.intellihide)
      throw new Error(`${position} Dock did not preserve intellihide after changing sides`);

    binding.dash.hide(false);
    if (position === 'left' && binding.dash.translation_x >= 0)
      throw new Error('Left Dock did not hide toward the left edge');
    if (position === 'right' && binding.dash.translation_x <= 0)
      throw new Error('Right Dock did not hide toward the right edge');
    if (position === 'bottom' && binding.dash.translation_y <= 0)
      throw new Error('Bottom Dock did not hide toward the bottom edge');
    binding.dash.show(false);

    const hotArea = binding.hotArea;
    if (!hotArea) throw new Error(`${position} Dock has no reveal hot area`);
    if (vertical && (hotArea.width !== 1 || hotArea.height <= hotArea.width))
      throw new Error(`${position} Dock hot area is not vertical`);
    if (!vertical && (hotArea.height !== 1 || hotArea.width <= hotArea.height))
      throw new Error('Bottom Dock hot area is not horizontal');

    settings.set_boolean('dock-always-show', true);
    await Scripting.waitLeisure();
    await Scripting.sleep(350);
    const alwaysBinding = dock.bindings.find(
      (candidate) => candidate.monitorIndex === Main.layoutManager.primaryIndex,
    );
    const strut = alwaysBinding?.strutActor;
    if (!alwaysBinding || !strut) throw new Error(`${position} Dock did not create a strut`);
    if (
      vertical &&
      (strut.width !== alwaysBinding.container.width || strut.height !== monitor.height)
    )
      throw new Error(`${position} Dock did not reserve a vertical strut`);
    if (
      !vertical &&
      (strut.height !== alwaysBinding.container.height || strut.width !== monitor.width)
    )
      throw new Error('Bottom Dock did not reserve a horizontal strut');

    settings.set_boolean('dock-always-show', false);
    settings.set_boolean('dock-intellihide', true);
  }

  // The same icons occupy the same run length whatever edge they sit on.
  for (const position of ['left', 'right']) {
    const drift = Math.abs(iconAxisExtents[position] - iconAxisExtents.bottom);
    if (drift > 4)
      throw new Error(
        `${position} Dock spaces its icons differently from the bottom Dock ` +
          `(${position}=${iconAxisExtents[position]}, bottom=${iconAxisExtents.bottom})`,
      );
  }

  settings.set_boolean('dock-show-on-all-monitors', true);
  for (const position of ['left', 'right']) {
    settings.set_string('dock-position', position);
    await Scripting.waitLeisure();
    await Scripting.sleep(350);
    if (
      dock.bindings.some(
        (candidate) =>
          !edgeIsReachable(Main.layoutManager.monitors, candidate.monitorIndex, position),
      )
    )
      throw new Error(`${position} Dock was placed on an inaccessible monitor edge`);
  }

  settings.set_boolean('dock-show-on-all-monitors', false);
  settings.set_string('dock-position', 'bottom');
  settings.set_boolean('dock-intellihide', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(350);
}

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('dockPresent', 'Dock actor found in stage after enable');
  Scripting.defineScriptEvent(
    'dockPositionsValid',
    'Bottom, left, and right positions apply immediately with correct geometry',
  );
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
    'itemDragKeepsDockStable',
    'Favorite reordering holds the Dock visible and restores auto-hide after drop',
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
    'externalWorkspaceActorStable',
    'Intellihide keeps the dock actor stable on external monitors in workspace two',
  );
  Scripting.defineScriptEvent(
    'primaryMonitorOnly',
    'Primary-only Dock aggregates active-workspace apps from every monitor',
  );
  Scripting.defineScriptEvent(
    'allMonitorsEnabled',
    'Per-monitor Docks isolate active-workspace apps to their own monitor',
  );
  Scripting.defineScriptEvent(
    'alwaysAutoHideIndependent',
    'Always auto-hide remains hidden without relying on window overlap',
  );
  Scripting.defineScriptEvent(
    'dashContentDisposalSafe',
    'Dash content destruction cancels callbacks before actors are disposed',
  );
  Scripting.defineScriptEvent(
    'windowPreviewsValid',
    'Window previews create live thumbnails and an overlaid close action only while open',
  );
  Scripting.defineScriptEvent(
    'externalStorageDisabled',
    'External storage dock icons are absent when disabled',
  );
  Scripting.defineScriptEvent(
    'iconResizeCountsFixedIcons',
    'Automatic icon resize accounts for trash/storage icons outside _box',
  );
  Scripting.defineScriptEvent(
    'configuredIconSizeApplied',
    'Configured icon size updates every dock icon without rebuilding its binding',
  );
  Scripting.defineScriptEvent(
    'motionTextureSupersampled',
    'Dock motion keeps high-resolution icon textures in a normal-sized layout box',
  );
  Scripting.defineScriptEvent(
    'fixedIconMotionRegistered',
    'Trash and removable-storage icons are registered with dock motion',
  );
  Scripting.defineScriptEvent('dockRemoved', 'Dock actor removed from stage after disable');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  await ensureOverviewHidden();

  const settings = getAuroraSettings();
  const originalShowTrash = settings.get_boolean('dock-show-trash');
  const originalShowExternalStorage = settings.get_boolean('dock-show-external-storage');
  const originalAlwaysShow = settings.get_boolean('dock-always-show');
  const originalIntellihide = settings.get_boolean('dock-intellihide');
  const originalShowOnAllMonitors = settings.get_boolean('dock-show-on-all-monitors');
  const originalPosition = settings.get_string('dock-position');
  const originalIconSize = settings.get_user_value('dock-icon-size');
  const originalMotionEnabled = settings.get_boolean('dock-motion-enabled');
  const originalMotionProfile = settings.get_string('dock-motion-profile');
  const originalWindowPreviews = settings.get_boolean('dock-window-previews');
  settings.set_boolean('dock-show-trash', true);
  settings.set_boolean('dock-show-external-storage', false);
  settings.set_boolean('dock-always-show', false);
  settings.set_boolean('dock-intellihide', true);
  settings.set_boolean('dock-show-on-all-monitors', false);
  settings.set_string('dock-position', 'bottom');
  settings.set_int('dock-icon-size', 64);
  settings.set_boolean('dock-motion-enabled', true);
  settings.set_string('dock-motion-profile', 'balanced');
  settings.set_boolean('dock-window-previews', false);

  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const dockActor = findDockActor();
  if (!dockActor)
    throw new Error(
      `No actor starting with "${DOCK_ACTOR_PREFIX}" found in Main.layoutManager.uiGroup`,
    );

  Scripting.scriptEvent('dockPresent');

  if (!Main.panel.visible)
    throw new Error('Top panel is not visible; the dock module may have broken it');

  Scripting.scriptEvent('panelIntact');

  const dock = getAuroraModule('dock');

  await exerciseMonitorScope(settings, dock);
  await exerciseWindowPreviews(settings, dock);
  Scripting.scriptEvent('windowPreviewsValid');

  const dash = dock?.bindings?.[0]?.dash;
  const showAppsIcon = dash?._showAppsIcon;
  const dashChildren = dash?._dashContainer?.get_children ? dash._dashContainer.get_children() : [];
  const showAppsIndex = dashChildren.indexOf(showAppsIcon);
  const trashIcon = dash?._fixedItems?._trash;
  const trashIndex = dashChildren.indexOf(trashIcon);
  const fixedSeparatorIndex = dashChildren.indexOf(dash?._fixedSeparator);
  let trashUri;
  if (trashIcon && trashIcon._trashFile && trashIcon._trashFile.get_uri)
    trashUri = trashIcon._trashFile.get_uri();
  const nautilus = Shell.AppSystem.get_default().lookup_app('org.gnome.Nautilus.desktop');
  const hasNautilus = Boolean(nautilus?.get_app_info().get_executable());

  if (!hasNautilus) {
    if (trashUri === 'trash:///')
      throw new Error('Trash icon was created without Nautilus installed');

    Scripting.scriptEvent('trashIconValid');
    Scripting.scriptEvent('trashClickWired');
  } else {
    if (trashUri !== 'trash:///')
      throw new Error('Trash icon was not created while dock-show-trash is enabled');
    if (trashIcon._iconActor?.icon_name?.endsWith('-symbolic'))
      throw new Error(`Trash icon is still symbolic: ${trashIcon._iconActor.icon_name}`);
    if (
      trashIndex < 0 ||
      fixedSeparatorIndex < 0 ||
      !(fixedSeparatorIndex < trashIndex && trashIndex < showAppsIndex)
    )
      throw new Error(
        `Fixed separator and Trash must precede Show Apps ` +
          `(separator=${fixedSeparatorIndex}, trash=${trashIndex}, showApps=${showAppsIndex})`,
      );
    if (dash._box?.contains && dash._box.contains(trashIcon))
      throw new Error('Trash icon is inside the app list instead of being a fixed dock item');
    if (dash._fixedItems._trash !== trashIcon)
      throw new Error('Dash lost its fixed trash icon reference after GObject construction');

    Scripting.scriptEvent('trashIconValid');

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

  if (dash._fixedItems._storage.length)
    throw new Error(
      'External storage icons were created while dock-show-external-storage is disabled',
    );

  Scripting.scriptEvent('externalStorageDisabled');

  const bindingBeforeIconSizeChange = dock.bindings[0];
  const iconSizeMaxWidth = dash._maxWidth;
  const iconSizeMaxHeight = dash._maxHeight;
  dash.setMaxSize(10000, 1000);
  settings.set_int('dock-icon-size', 32);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  if (dock.bindings[0] !== bindingBeforeIconSizeChange)
    throw new Error('Changing dock-icon-size rebuilt the dock binding');
  if (dash.iconSize !== 32)
    throw new Error(`Configured dock icon size was not applied: ${dash.iconSize}`);

  const configuredIcons = [
    ...dash._box.get_children(),
    dash._showAppsIcon,
    ...dash._fixedItems.icons,
  ]
    .map((actor) => actor.child?._delegate?.icon)
    .filter(Boolean);
  if (configuredIcons.some((icon) => icon.iconSize !== 32))
    throw new Error('Configured dock icon size was not synchronized across every icon');

  settings.reset('dock-icon-size');
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
  if (dash.iconSize !== 64)
    throw new Error(`Resetting dock-icon-size did not restore the 64px default: ${dash.iconSize}`);

  dash.setMaxSize(iconSizeMaxWidth, iconSizeMaxHeight);
  dash._adjustIconSize();
  Scripting.scriptEvent('configuredIconSizeApplied');

  // the automatic icon resize must count the fixed dock icons (trash,
  // external storage) that live in _dashContainer outside _box. Constrain the
  // max width to exactly fit every icon at size 24: if the fixed icons were
  // not counted, _adjustIconSize would keep a larger size and the dock would
  // overflow its work area.
  //
  // The fixed-icon count here must not depend on how many apps happen to be
  // pinned or running in the test environment: with zero of those, the dash
  // holds only the Show Apps icon. As both the first and last child, it picks
  // up extra edge margin that a multi-icon dash never
  // sees, so the sizing budget below (derived from a single representative
  // icon) undershoots the real render. Synthesizing a few external-storage
  // icons (no hardware or Nautilus required) keeps the icon count, and this
  // check, consistent across every environment.
  const priorMaxWidth = dash._maxWidth;
  const priorMaxHeight = dash._maxHeight;
  const injectedStorageIcons = dash._fixedItems._storage.length === 0;
  try {
    if (injectedStorageIcons) {
      dash._fixedItems._syncStorage(
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

    const customFixedIcons = [dash._fixedItems._trash, ...dash._fixedItems._storage].filter(
      Boolean,
    );
    if (customFixedIcons.length === 0)
      throw new Error('Dock motion test could not create a fixed Trash or storage icon');
    for (const fixedIcon of customFixedIcons) {
      const baseIcon = fixedIcon.icon;
      const texture = baseIcon?._iconBin?.child;
      if (
        !texture ||
        texture.icon_size < baseIcon.iconSize * 2 ||
        texture.min_width !== baseIcon.iconSize ||
        texture.natural_height !== baseIcon.iconSize
      ) {
        throw new Error(
          `Fixed dock icon was not supersampled without changing layout: normal=${baseIcon?.iconSize} texture=${texture?.icon_size} actor=${texture?.min_width}x${texture?.natural_height}`,
        );
      }
    }
    Scripting.scriptEvent('motionTextureSupersampled');
    Scripting.scriptEvent('fixedIconMotionRegistered');

    const boxIconChildren = dash._box
      .get_children()
      .filter((actor) => actor.child?._delegate?.icon && !actor.animatingOut);
    const fixedIcons = [
      dash._showAppsIcon,
      dash._fixedItems._trash,
      ...dash._fixedItems._storage,
    ].filter(Boolean);
    const totalIcons = boxIconChildren.length + fixedIcons.length;

    const themeNode = dash.get_theme_node();
    const spacing = themeNode.get_length('spacing');
    const firstButton = (boxIconChildren[0] || fixedIcons[0]).child;
    const firstIcon = firstButton._delegate.icon;
    firstIcon.icon.ensure_style();
    const [, , iconNatWidth] = firstIcon.icon.get_preferred_size();
    const [, , buttonNatWidth] = firstButton.get_preferred_size();
    const iconPadding = buttonNatWidth - iconNatWidth;

    const probe = new Clutter.ActorBox({ x1: 0, y1: 0, x2: 1000, y2: 42 });
    const content = themeNode.get_content_box(probe);
    const horizontalChrome = 1000 - (content.x2 - content.x1);

    // Budget the width for every icon at size 31, just below the 32 step of
    // baseIconSizes. Counting all icons picks 24 and fits with dozens of px
    // to spare; leaving the fixed icons out of the count picks 32 and
    // overflows the budget by a full icon-step per icon.
    const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const targetIconSize = 31 * scaleFactor;
    const maxWidth = Math.ceil(
      totalIcons * (iconPadding + targetIconSize) + (totalIcons - 1) * spacing + horizontalChrome,
    );

    dash.setMaxSize(maxWidth, priorMaxHeight > 0 ? priorMaxHeight : 400);
    dash._adjustIconSize();
    const [, natWidth] = dash.get_preferred_width(-1);
    if (natWidth > maxWidth)
      throw new Error(
        `dash natural width ${natWidth} exceeds the ${maxWidth}px budget for ` +
          `${totalIcons} icons at iconSize=${dash.iconSize}; ` +
          'the fixed icons may not have been counted',
      );
  } finally {
    if (injectedStorageIcons) dash._fixedItems._syncStorage([]);
    dash.setMaxSize(priorMaxWidth, priorMaxHeight);
    dash._adjustIconSize();
  }

  Scripting.scriptEvent('iconResizeCountsFixedIcons');

  dash.hide(false);
  if (dock.bindings[0].container.reactive)
    throw new Error('Hidden dock container is still reactive and blocks window input');
  if (dash.mapped || dash._unredirectInhibitor?.inhibited) {
    throw new Error(
      `Hidden dock retained unredirect inhibition: mapped=${dash.mapped} inhibited=${dash._unredirectInhibitor?.inhibited}`,
    );
  }

  dash.show(false);
  if (!dock.bindings[0].container.reactive)
    throw new Error('Shown dock container did not restore input handling');
  if (!dash.mapped || !dash._unredirectInhibitor?.inhibited) {
    throw new Error(
      `Mapped dock did not inhibit unredirect: mapped=${dash.mapped} inhibited=${dash._unredirectInhibitor?.inhibited}`,
    );
  }

  Scripting.scriptEvent('hiddenDockInputReleased');

  await exerciseExternalWorkspace(dock);

  // repeated topology/intellihide updates must not restart the show
  // animation from the hidden pose and make the dock flash.
  dash.hide(false);
  let hiddenPoseCalls = 0;
  const originalApplyHiddenState = dash._visibility._applyHiddenState;
  dash._visibility._applyHiddenState = function (...args) {
    hiddenPoseCalls++;
    return originalApplyHiddenState.apply(this, args);
  };
  dash.show(true);
  dash.show(true);
  dash.show(true);

  // Poll for the settled pose instead of a fixed sleep: the 200ms show
  // animation only starts on the next frame, so under CI load a single
  // 300ms wait can sample the dock mid-animation.
  let settled = false;
  for (let attempt = 0; attempt < 20 && !settled; attempt++) {
    await Scripting.sleep(100);
    settled = dash.visible && dash.opacity === 255 && dash.translation_y === 0;
  }
  dash._visibility._applyHiddenState = originalApplyHiddenState;
  if (hiddenPoseCalls !== 1)
    throw new Error(`Repeated show requests restarted the animation ${hiddenPoseCalls} times`);
  if (!settled)
    throw new Error('Dock did not settle in its fully shown state after repeated show requests');

  Scripting.scriptEvent('repeatedShowStable');

  const originalItemDragHover = dash._visibility._hovered;
  try {
    dash._visibility._hovered = false;
    dash.blockAutoHide(false);
    dash.show(false);
    dash._onItemDragBegin();
    dash.hide(false);
    await Scripting.sleep(300);
    if (!dash.visible || dash.opacity !== 255 || dash.translation_y !== 0)
      throw new Error('Dock hid while a favorite icon drag was active');

    dash._onItemDragEnd();
    await Scripting.sleep(400);
    if (dash.visible) throw new Error('Dock did not restore auto-hide after the icon drop');

    dash.show(false);
    dash._onItemDragBegin();
    dash._onItemDragCancelled();
    await Scripting.sleep(400);
    if (dash.visible) throw new Error('Dock did not restore auto-hide after cancelling icon drag');
  } finally {
    if (dash._visibility._itemDragHold) dash._onItemDragCancelled();
    dash._visibility._hovered = originalItemDragHover;
    dash.blockAutoHide(true);
    dash.show(false);
  }
  Scripting.scriptEvent('itemDragKeepsDockStable');

  const binding = dock.bindings[0];

  // a direct intellihide BLOCKED transition from a visible dock must hand
  // off to hover autohide. This covers switching from a small window to a
  // fullscreen window via the dock: the dock must stay up while the pointer is
  // still over it and hide only after the pointer leaves.
  dash.show(false);
  const originalDashContainerHasHover = dash._visibility._hovered;
  try {
    dash._visibility._hovered = true;
    binding.hotAreaActive = false;
    clearIntellihideQueuedRefreshes(binding.intellihide);
    binding.intellihide._status = 1;
    binding.intellihide.emit('status-changed');
    await Scripting.sleep(350);
    if (!dash.visible)
      throw new Error('Intellihide BLOCKED hid the dock while the pointer stayed over it');

    dash._visibility._hovered = false;
    dash._visibility.updateAutoHide();
    await Scripting.sleep(450);
  } finally {
    dash._visibility._hovered = originalDashContainerHasHover;
  }
  if (dash.visible) throw new Error('Intellihide BLOCKED did not hide after the pointer left');

  Scripting.scriptEvent('blockedOverlapDefersHide');

  dash.show(false);
  dock.revealFromHotArea();
  if (!binding.hotAreaActive) throw new Error('Hot-area reveal did not become active');
  if (binding.hotArea?.reactive)
    throw new Error('Hot area remained reactive above the revealed dock');

  Scripting.scriptEvent('hotAreaYieldedInput');

  // after a hot-area reveal hands off to the dash's native hover autohide,
  // the dock must stay visible while the pointer is over it (hover), even when
  // a window is BLOCKING. Hover is tracked via the dock actor's crossing events
  // (reliable over client windows), so this is what keeps the dock up while the
  // user switches apps; it only hides once the pointer leaves (see I10).
  const originalHoldZoneDashContainerHasHover = dash._visibility._hovered;
  clearIntellihideQueuedRefreshes(binding.intellihide);
  binding.intellihide._status = 1; // BLOCKED
  try {
    dash._visibility._hovered = true; // pointer resting over the dock
    dock._clearHotAreaReveal(binding);
    binding.hotAreaActive = false;
    dock.revealFromHotArea();
    await Scripting.sleep(1700); // past the reveal grace → handoff to autohide
  } finally {
    dash._visibility._hovered = originalHoldZoneDashContainerHasHover;
  }
  if (!dash.visible) throw new Error('Native autohide hid the dock while the pointer was over it');
  if (!binding.hotAreaActive)
    throw new Error('Hot-area reveal ended while the pointer was over the dock');
  if (binding.autoHideRelease.active)
    throw new Error('Hot-area reveal grace timer was left running after handoff');

  Scripting.scriptEvent('hotAreaReleaseDeferred');

  dock._clearHotAreaReveal(binding);

  // if a small focused window makes intellihide CLEAR while a hot-area
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
  if (binding.hotAreaActive) throw new Error('Hot-area active CLEAR did not end the reveal state');
  if (binding.hotArea?.reactive)
    throw new Error('Hot-area active CLEAR left the hot area reactive over the dock');

  Scripting.scriptEvent('hotAreaActiveClearShowsDock');

  // when a hot-area reveal is active and intellihide reasserts BLOCKED
  // (e.g. switching between two fullscreen/maximized windows via the dock
  // icons), the dock must stay visible while the pointer is over it and hide
  // only once the pointer leaves the dock. Retraction is driven by the dash's
  // native hover autohide, which polls the dock actor's hover state and stays
  // reliable when the pointer moves onto a client window. This is the reported
  // maximized-switch bug, where a stage motion watch never saw the exit.
  const originalBlockedDashContainerHasHover = dash._visibility._hovered;
  try {
    binding.intellihide._status = 1; // BLOCKED
    dash._visibility._hovered = true; // pointer over the dock
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
    dash._visibility._hovered = false;
    dash._visibility.updateAutoHide();
    await Scripting.sleep(450);
  } finally {
    dash._visibility._hovered = originalBlockedDashContainerHasHover;
  }
  if (dash.visible)
    throw new Error('Hot-area active BLOCKED did not hide the dock after the pointer left');
  if (binding.hotAreaActive)
    throw new Error('Hot-area active BLOCKED kept the reveal active after the pointer left');

  Scripting.scriptEvent('hotAreaActiveBlockedHidesDock');

  dock._clearHotAreaEnable(binding);
  binding.hotAreaActive = false;
  binding.hotArea?.setEnabled(false);

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

  // A system transition must temporarily reject both ordinary edge activation
  // and contextual DND. Once the cooldown expires, a recognized external drag
  // may reveal the hidden dock, but only after the longer dwell.
  const hotAreaBounds = binding.hotArea._monitor;
  const edgeX = hotAreaBounds.x + Math.floor(hotAreaBounds.width / 2);
  const edgeY = hotAreaBounds.y + hotAreaBounds.height - 1;
  dock._beginActivationCooldown('shell-test');
  if (binding.hotArea.canStartContextualDragReveal(edgeX, edgeY))
    throw new Error('Hot area accepted contextual DND during the transition cooldown');

  await Scripting.sleep(750);
  if (!binding.hotArea.canStartContextualDragReveal(edgeX, edgeY))
    throw new Error('Hot area remained in transition cooldown after its deadline');

  dock._dragReveal._handleMotion({
    source: Main.xdndHandler,
    x: edgeX,
    y: edgeY,
  });
  await Scripting.sleep(400);
  if (binding.hotAreaActive || dash.visible)
    throw new Error('Contextual DND revealed the dock before the prolonged dwell elapsed');

  await Scripting.sleep(500);
  if (!binding.hotAreaActive || !dash.visible)
    throw new Error('Contextual DND did not reveal the dock after the prolonged dwell');

  dock._clearHotAreaReveal(binding);
  binding.hotAreaActive = false;
  binding.dash.blockAutoHide(false);
  binding.dash.hide(false);
  binding.hotArea.setEnabled(false);

  // switching focus between two fullscreen windows keeps intellihide at
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

  // the blocked-reasserted signal path wired in dock.ts must hand the
  // reveal to native hover autohide too: switching between fullscreen windows
  // via the dock icons keeps the dock up while the pointer is over it and hides
  // it once the pointer leaves. Same contract as I10, but driven by the signal.
  dock._clearHotAreaReveal(binding);
  const originalReassertHasHover = dash._visibility._hovered;
  try {
    binding.intellihide._status = 1; // BLOCKED
    dash._visibility._hovered = true; // pointer over the dock
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
    dash._visibility._hovered = false;
    dash._visibility.updateAutoHide();
    await Scripting.sleep(450);
  } finally {
    dash._visibility._hovered = originalReassertHasHover;
  }
  if (dash.visible) throw new Error('Focus reassert did not hide the dock after the pointer left');
  if (binding.hotAreaActive)
    throw new Error('Focus reassert left the hot-area reveal active after the pointer left');

  Scripting.scriptEvent('focusReassertHidesDock');

  dock._clearHotAreaEnable(binding);
  binding.hotAreaActive = false;
  binding.hotArea?.setEnabled(false);

  // transient window geometry during creation/move/restack makes
  // intellihide flap CLEAR<->BLOCKED many times in well under a second
  // (gnome-shell-logs: rects=[0,0 0x0] then the work-area rect then the real
  // small window, all within one second). Those flaps must coalesce into a
  // single settled status instead of toggling the dock. This covers both the
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

  await exerciseDockPositions(settings, dock);
  Scripting.scriptEvent('dockPositionsValid');

  // Always auto-hide must bypass intellihide completely: with no overlap
  // decision involved, it starts hidden and only appears through the hot area.
  settings.set_boolean('dock-intellihide', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);
  const alwaysAutoHideBinding = dock.bindings.find(
    (candidate) => candidate.monitorIndex === Main.layoutManager.primaryIndex,
  );
  if (!alwaysAutoHideBinding)
    throw new Error('Always auto-hide did not retain a binding on the primary monitor');
  if (alwaysAutoHideBinding.mode !== 'always-autohide' || alwaysAutoHideBinding.intellihide)
    throw new Error('Always auto-hide still depends on intellihide window state');
  if (alwaysAutoHideBinding.dash.visible)
    throw new Error('Always auto-hide Dock was visible before an edge reveal');

  const originalAlwaysAutoHideHover = alwaysAutoHideBinding.dash._visibility._hovered;
  alwaysAutoHideBinding.dash._visibility._hovered = false;
  try {
    if (!dock.revealMonitorFromHotArea(alwaysAutoHideBinding.monitorIndex))
      throw new Error('Always auto-hide Dock could not be revealed from its hot area');
    await Scripting.sleep(100);
    if (!alwaysAutoHideBinding.dash.visible)
      throw new Error('Always auto-hide Dock did not appear after an edge reveal');

    dock._clearHotAreaReveal(alwaysAutoHideBinding);
    dock._releaseHotAreaToAutoHide(alwaysAutoHideBinding);
    await Scripting.sleep(500);
    if (alwaysAutoHideBinding.dash.visible)
      throw new Error('Always auto-hide Dock stayed visible after the reveal ended');
  } finally {
    alwaysAutoHideBinding.dash._visibility._hovered = originalAlwaysAutoHideHover;
  }
  Scripting.scriptEvent('alwaysAutoHideIndependent');

  // The Shell may destroy the Dash content actor from C before the module's
  // explicit teardown runs. Pending autohide callbacks must stop immediately
  // instead of reading children from the disposed actor.
  const disposableBinding = dock.bindings.find(
    (candidate) => candidate.monitorIndex === Main.layoutManager.primaryIndex,
  );
  if (!disposableBinding)
    throw new Error('Could not find the current primary Dock for disposal coverage');

  const disposableDash = disposableBinding.dash;
  disposableDash._visibility.updateAutoHide();
  if (!disposableDash._visibility._autohideTimeout.active)
    throw new Error('Could not schedule the autohide callback for disposal coverage');

  const disposableBox = disposableDash._dashBox;
  if (!disposableBox) throw new Error('Current Dash content was already destroyed before coverage');

  disposableBox.destroy();
  await Scripting.sleep(200);

  if (disposableDash._dashBox) throw new Error('Dash retained its content actor after destruction');
  if (disposableDash._visibility._autohideTimeout.active)
    throw new Error('Dash content destruction retained its autohide callback');

  Scripting.scriptEvent('dashContentDisposalSafe');

  const originalValue = settings.get_boolean('module-dock');
  settings.set_boolean('module-dock', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  const actorAfterDisable = findDockActor();
  if (actorAfterDisable)
    throw new Error('Dock actor still present in stage after module was disabled');
  if (dash._unredirectInhibitor?.inhibited)
    throw new Error('Destroyed dock retained its unredirect inhibitor');

  Scripting.scriptEvent('dockRemoved');

  settings.set_boolean('dock-show-trash', originalShowTrash);
  settings.set_boolean('dock-show-external-storage', originalShowExternalStorage);
  settings.set_boolean('dock-always-show', originalAlwaysShow);
  settings.set_boolean('dock-intellihide', originalIntellihide);
  settings.set_boolean('dock-show-on-all-monitors', originalShowOnAllMonitors);
  settings.set_string('dock-position', originalPosition);
  if (originalIconSize === null) {
    settings.reset('dock-icon-size');
  } else {
    settings.set_value('dock-icon-size', originalIconSize);
  }
  settings.set_boolean('dock-motion-enabled', originalMotionEnabled);
  settings.set_string('dock-motion-profile', originalMotionProfile);
  settings.set_boolean('dock-window-previews', originalWindowPreviews);
  settings.set_boolean('module-dock', originalValue);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}

let _dockPresent = false;
let _dockPositionsValid = false;
let _panelIntact = false;
let _trashIconValid = false;
let _trashClickWired = false;
let _hiddenDockInputReleased = false;
let _hotAreaYieldedInput = false;
let _hotAreaReleaseDeferred = false;
let _hotAreaRearmedAfterHide = false;
let _repeatedShowStable = false;
let _itemDragKeepsDockStable = false;
let _blockedOverlapDefersHide = false;
let _hotAreaActiveBlockedHidesDock = false;
let _hotAreaActiveClearShowsDock = false;
let _dockRemoved = false;
let _externalStorageDisabled = false;
let _iconResizeCountsFixedIcons = false;
let _configuredIconSizeApplied = false;
let _motionTextureSupersampled = false;
let _fixedIconMotionRegistered = false;
let _externalWorkspaceActorStable = false;
let _primaryMonitorOnly = false;
let _allMonitorsEnabled = false;
let _alwaysAutoHideIndependent = false;
let _dashContentDisposalSafe = false;
let _windowPreviewsValid = false;

export function script_dockPresent() {
  _dockPresent = true;
}

export function script_dockPositionsValid() {
  _dockPositionsValid = true;
}

export function script_panelIntact() {
  _panelIntact = true;
}

export function script_trashIconValid() {
  _trashIconValid = true;
}

export function script_trashClickWired() {
  _trashClickWired = true;
}

export function script_hiddenDockInputReleased() {
  _hiddenDockInputReleased = true;
}

export function script_hotAreaYieldedInput() {
  _hotAreaYieldedInput = true;
}

export function script_hotAreaReleaseDeferred() {
  _hotAreaReleaseDeferred = true;
}

export function script_hotAreaRearmedAfterHide() {
  _hotAreaRearmedAfterHide = true;
}

export function script_repeatedShowStable() {
  _repeatedShowStable = true;
}

export function script_itemDragKeepsDockStable() {
  _itemDragKeepsDockStable = true;
}

export function script_blockedOverlapDefersHide() {
  _blockedOverlapDefersHide = true;
}

export function script_hotAreaActiveBlockedHidesDock() {
  _hotAreaActiveBlockedHidesDock = true;
}

export function script_hotAreaActiveClearShowsDock() {
  _hotAreaActiveClearShowsDock = true;
}

export function script_dockRemoved() {
  _dockRemoved = true;
}

export function script_externalStorageDisabled() {
  _externalStorageDisabled = true;
}

export function script_iconResizeCountsFixedIcons() {
  _iconResizeCountsFixedIcons = true;
}

export function script_configuredIconSizeApplied() {
  _configuredIconSizeApplied = true;
}

export function script_motionTextureSupersampled() {
  _motionTextureSupersampled = true;
}

export function script_fixedIconMotionRegistered() {
  _fixedIconMotionRegistered = true;
}

export function script_externalWorkspaceActorStable() {
  _externalWorkspaceActorStable = true;
}

export function script_primaryMonitorOnly() {
  _primaryMonitorOnly = true;
}

export function script_allMonitorsEnabled() {
  _allMonitorsEnabled = true;
}

export function script_alwaysAutoHideIndependent() {
  _alwaysAutoHideIndependent = true;
}

export function script_dashContentDisposalSafe() {
  _dashContentDisposalSafe = true;
}

export function script_windowPreviewsValid() {
  _windowPreviewsValid = true;
}

export function finish() {
  if (!_dockPresent)
    throw new Error('Dock actor was not found in the stage after extension enable');
  if (!_dockPositionsValid) throw new Error('Dock side placement behavior was not verified');
  if (!_panelIntact) throw new Error('Top panel was not visible while dock was active');
  if (!_trashIconValid) throw new Error('Trash icon or its position was invalid');
  if (!_trashClickWired) throw new Error('Trash click was not wired to the open action');
  if (!_hiddenDockInputReleased) throw new Error('Hidden dock did not release its input area');
  if (!_hotAreaYieldedInput) throw new Error('Hot area did not yield input after revealing dock');
  if (!_hotAreaReleaseDeferred)
    throw new Error('Hot-area release did not stay visible while pointer was inside the dock');
  if (!_hotAreaRearmedAfterHide)
    throw new Error('Hot area was not rearmed after the dock hide transition');
  if (!_repeatedShowStable) throw new Error('Repeated show requests restarted the dock animation');
  if (!_itemDragKeepsDockStable)
    throw new Error('Favorite icon dragging did not preserve and restore Dock visibility');
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
  if (!_configuredIconSizeApplied)
    throw new Error('Configured icon size was not applied without rebuilding the dock');
  if (!_motionTextureSupersampled)
    throw new Error('Dock motion icon textures were not verified at high resolution');
  if (!_fixedIconMotionRegistered)
    throw new Error('Trash and removable-storage icons were not registered with dock motion');
  if (!_externalWorkspaceActorStable)
    throw new Error('External-monitor Dock actor did not remain stable in workspace two');
  if (!_primaryMonitorOnly) throw new Error('Dock primary-monitor-only behavior was not verified');
  if (!_allMonitorsEnabled) throw new Error('Dock all-monitors opt-in behavior was not verified');
  if (!_alwaysAutoHideIndependent)
    throw new Error('Dock always auto-hide behavior was not verified');
  if (!_dashContentDisposalSafe)
    throw new Error('Dash content disposal did not cancel pending actor access');
  if (!_windowPreviewsValid)
    throw new Error('Window-preview thumbnail and close action were not verified');
  if (!_dockRemoved) throw new Error('Dock actor was not removed after module was disabled');
}
