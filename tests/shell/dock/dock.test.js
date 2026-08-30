/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { Dash as ShellDash } from 'resource:///org/gnome/shell/ui/dash.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {
  ensureOverviewHidden,
  EXTENSION_UUID,
  getAuroraModule,
  getAuroraSettings,
  waitForActorState,
  waitForCondition,
  waitForTiming,
  waitForExtension,
} from '../support/testUtils.js';
import { exerciseExternalWorkspace, exerciseMonitorScope } from './scenarios/monitors.js';

const DOCK_ACTOR_PREFIX = 'aurora-dock-container-';
const APPLICATION_POPUP_WINDOW_TYPES = [
  Meta.WindowType.DROPDOWN_MENU,
  Meta.WindowType.POPUP_MENU,
  Meta.WindowType.COMBO,
];
const RUNNING_DOT_ALIGNMENT = {
  bottom: { x: Clutter.ActorAlign.CENTER, y: Clutter.ActorAlign.END },
  left: { x: Clutter.ActorAlign.START, y: Clutter.ActorAlign.CENTER },
  right: { x: Clutter.ActorAlign.END, y: Clutter.ActorAlign.CENTER },
};

function findDockActor() {
  for (const group of [Main.uiGroup, global.window_group]) {
    const n = group.get_n_children();
    for (let i = 0; i < n; i++) {
      const child = group.get_child_at_index(i);
      if (child?.name?.startsWith(DOCK_ACTOR_PREFIX)) return child;
    }
  }
  return null;
}

async function exerciseDockStacking(settings, dock) {
  const originalShowOnAllMonitors = settings.get_boolean('dock-show-on-all-monitors');
  const originalAlwaysShow = settings.get_boolean('dock-always-show');
  const originalIntellihide = settings.get_boolean('dock-intellihide');
  settings.set_boolean('dock-show-on-all-monitors', true);
  settings.set_boolean('dock-intellihide', false);
  settings.set_boolean('dock-always-show', true);
  await Scripting.waitLeisure();

  const bindings = dock?.bindings || [];
  if (
    !bindings.length ||
    bindings.some(
      (binding) =>
        !binding.strutActor ||
        binding.strutActor.get_parent() !== Main.uiGroup ||
        binding.container.get_parent() !== Main.uiGroup,
    )
  )
    throw new Error('Dock containers and struts are not tracked as Shell chrome');

  const normalActor = new St.Widget({ name: 'aurora-test-normal-window' });
  global.window_group.add_child(normalActor);

  try {
    for (const windowType of [
      Meta.WindowType.DROPDOWN_MENU,
      Meta.WindowType.POPUP_MENU,
      Meta.WindowType.COMBO,
    ]) {
      const popupActor = new St.Widget({ name: 'aurora-test-application-popup' });
      popupActor.meta_window = { get_window_type: () => windowType };
      global.window_group.add_child(popupActor);

      try {
        global.display.emit('restacked');
        const children = global.window_group.get_children();
        const normalIndex = children.indexOf(normalActor);
        const popupIndex = children.indexOf(popupActor);
        for (const binding of bindings) {
          const strutIndex = children.indexOf(binding.strutActor);
          const dockIndex = children.indexOf(binding.container);
          if (
            binding.strutActor.get_parent() !== global.window_group ||
            binding.container.get_parent() !== global.window_group ||
            !(normalIndex < strutIndex && strutIndex < dockIndex && dockIndex < popupIndex)
          )
            throw new Error(
              `Dock stacking is invalid for popup type ${windowType}: ` +
                `normal=${normalIndex} strut=${strutIndex} dock=${dockIndex} popup=${popupIndex}`,
            );
        }
      } finally {
        popupActor.destroy();
      }

      global.display.emit('restacked');
      const uiChildren = Main.uiGroup.get_children();
      const windowGroupIndex = uiChildren.indexOf(global.window_group);
      const topWindowGroupIndex = uiChildren.indexOf(global.top_window_group);
      for (const binding of bindings) {
        const strutIndex = uiChildren.indexOf(binding.strutActor);
        const dockIndex = uiChildren.indexOf(binding.container);
        if (
          binding.strutActor.get_parent() !== Main.uiGroup ||
          binding.container.get_parent() !== Main.uiGroup ||
          !(
            windowGroupIndex < strutIndex &&
            strutIndex < dockIndex &&
            dockIndex < topWindowGroupIndex
          )
        )
          throw new Error(`Dock did not restore its chrome layer after popup type ${windowType}`);
      }
    }

    await exerciseRealWaylandPopupStacking(bindings);
  } finally {
    normalActor.destroy();
    global.display.emit('restacked');
    settings.set_boolean('dock-show-on-all-monitors', originalShowOnAllMonitors);
    settings.set_boolean('dock-always-show', originalAlwaysShow);
    settings.set_boolean('dock-intellihide', originalIntellihide);
    await Scripting.waitLeisure();
  }
}

async function exerciseRealWaylandPopupStacking(bindings) {
  const previousWindows = new Set(global.get_window_actors().map((actor) => actor.meta_window));
  const testFile = Gio.File.new_for_uri(import.meta.url);
  const helperPath = testFile
    .get_parent()
    .get_child('fixtures')
    .get_child('waylandPopup.js')
    .get_path();
  const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
  launcher.setenv('GDK_BACKEND', 'wayland', true);
  const process = launcher.spawnv(['gjs', '-m', helperPath]);

  try {
    const popupActor = await waitForCondition({
      evaluate: () =>
        global
          .get_window_actors()
          .find(
            (actor) =>
              !previousWindows.has(actor.meta_window) &&
              APPLICATION_POPUP_WINDOW_TYPES.includes(actor.meta_window.get_window_type()),
          ),
      signals: [
        [global.display, 'window-created'],
        [global.display, 'restacked'],
      ],
      description: 'real Wayland application popup to be mapped',
    });
    if (
      popupActor.meta_window.get_client_type() !== Meta.WindowClientType.WAYLAND ||
      popupActor.get_parent() !== global.window_group
    )
      throw new Error('GTK popup did not map as a Wayland window inside window_group');

    const normalActor = global
      .get_window_actors()
      .find(
        (actor) =>
          !previousWindows.has(actor.meta_window) &&
          actor.meta_window.get_window_type() === Meta.WindowType.NORMAL,
      );
    if (!normalActor) throw new Error('Wayland popup helper did not map its normal parent window');

    await waitForCondition({
      evaluate: () => {
        const children = global.window_group.get_children();
        const normalIndex = children.indexOf(normalActor);
        const popupIndex = children.indexOf(popupActor);
        return bindings.every((binding) => {
          const strutIndex = children.indexOf(binding.strutActor);
          const dockIndex = children.indexOf(binding.container);
          return normalIndex < strutIndex && strutIndex < dockIndex && dockIndex < popupIndex;
        });
      },
      signals: [
        [global.display, 'restacked'],
        [global.stage, 'after-paint'],
      ],
      description: 'Dock to settle below the real Wayland popup',
    });
  } finally {
    process.force_exit();
    await new Promise((resolve) => {
      process.wait_async(null, (_source, result) => {
        process.wait_finish(result);
        resolve();
      });
    });
    await Scripting.waitLeisure();
  }
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

// A window:N app may be recreated. Prefer the icon that owns the live window.
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

// WindowTracker may replace the fallback Shell.App after the helper app id arrives.
function resolveLivePreviewApp(window, currentApp) {
  const reassignedApp = Shell.WindowTracker.get_default().get_window_app(window);
  return reassignedApp?.get_windows().includes(window) ? reassignedApp : currentApp;
}

// Re-resolve after app or tree changes because a rebuild may replace the icon.
async function waitForWindowPreviewTarget(dash, window, currentApp) {
  let app = resolveLivePreviewApp(window, currentApp);
  const target = await waitForCondition({
    evaluate: () => {
      app = resolveLivePreviewApp(window, app);
      return findWindowPreviewTarget(dash, window, app);
    },
    signals: [
      [Shell.AppSystem.get_default(), 'app-state-changed'],
      [Shell.WindowTracker.get_default(), 'tracked-windows-changed'],
      [dash._dashBox, 'child-added'],
      [dash._dashBox, 'child-removed'],
    ],
    description: 'Dock preview target to be rebuilt for the live Shell.App',
    timeoutMs: 5000,
  });
  return { app, target };
}

async function exerciseWindowPreviews(settings, dock) {
  const previousWindows = new Set(global.get_window_actors().map((actor) => actor.meta_window));
  await Scripting.createTestWindow({ width: 760, height: 480, maximized: false });
  await Scripting.waitTestWindows();
  const window = await waitForCondition({
    evaluate: () =>
      global
        .get_window_actors()
        .map((actor) => actor.meta_window)
        .find((candidate) => !previousWindows.has(candidate)),
    signals: [[global.display, 'window-created']],
    description: 'window-preview test window to be tracked',
  });

  try {
    let previewApp = Shell.WindowTracker.get_default().get_window_app(window);
    if (!previewApp) throw new Error('Could not resolve the window-preview test application');

    settings.set_boolean('dock-window-previews', true);
    await Scripting.waitLeisure();

    const dash = dock?.bindings?.[0]?.dash;
    if (!dash?._windowPreviews)
      throw new Error('Window-preview controller was not created when enabled');

    dash.show(false);
    dash.refresh();
    await Scripting.waitLeisure();

    // App tracking may rebuild this item between interactions.
    let previewState = await waitForWindowPreviewTarget(dash, window, previewApp);
    previewApp = previewState.app;
    if (!previewState.target)
      throw new Error('Window-preview test application is absent from Dock');
    let { item, appIcon } = previewState.target;

    appIcon.set_hover(true);
    await waitForTiming(
      150,
      'exercise a short hover below the 300 ms window-preview dwell threshold',
    );
    dash._windowPreviews._handleIconHover({ item, appIcon, app: previewApp });
    await waitForTiming(
      200,
      'prove a replaced window-preview show timeout cannot open during its old deadline',
    );
    if (dash._windowPreviews._popup)
      throw new Error('Window-preview popup opened from a replaced show timeout');
    appIcon.set_hover(false);
    await waitForTiming(
      400,
      'prove a cancelled window-preview hover stays closed beyond the 300 ms dwell threshold',
    );
    if (dash._windowPreviews._popup)
      throw new Error('Window-preview popup opened after its hover was cancelled');
    if (dash._windowPreviews._showTimeout.active)
      throw new Error('Window-preview show timeout survived hover cancellation');

    previewState = await waitForWindowPreviewTarget(dash, window, previewApp);
    previewApp = previewState.app;
    if (!previewState.target)
      throw new Error('Window-preview test application is absent from Dock');
    ({ item, appIcon } = previewState.target);
    appIcon.set_hover(true);
    if (!dash._windowPreviews.shouldSuppressTooltip(appIcon))
      throw new Error('Window-preview hover did not suppress the Dock tooltip');

    // A rebuild may cancel the hover timeout. Re-arm it against the current icon.
    await waitForCondition({
      evaluate: () => {
        const popupActor = findDescendant(
          Main.uiGroup,
          (actor) =>
            actor.has_style_class_name && actor.has_style_class_name('aurora-window-preview-popup'),
        );
        if (popupActor) return popupActor;

        previewApp = resolveLivePreviewApp(window, previewApp);
        const target = findWindowPreviewTarget(dash, window, previewApp);
        if (!target) return false;
        if (dash._windowPreviews._pendingSource?.appIcon === target.appIcon) return false;

        ({ item, appIcon } = target);
        appIcon.set_hover(false);
        appIcon.set_hover(true);
        return false;
      },
      signals: [
        [Main.uiGroup, 'child-added'],
        [dash._dashBox, 'child-added'],
        [dash._dashBox, 'child-removed'],
        [item, 'destroy'],
        [Shell.AppSystem.get_default(), 'app-state-changed'],
        [Shell.WindowTracker.get_default(), 'tracked-windows-changed'],
        [global.stage, 'after-paint'],
      ],
      description: 'window-preview popup actor to join the Shell UI tree',
      timeoutMs: 5000,
    });
    const popup = dash._windowPreviews._popup;
    await waitForCondition({
      evaluate: () => popup?.isOpen && popup.actor.mapped,
      signals: [
        [popup, 'open-state-changed'],
        [popup.actor, 'notify::mapped'],
      ],
      description: 'window-preview popup to finish opening',
    });
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
        `showTimerActive=${controller._showTimeout.active}`,
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
    const uiChildren = Main.uiGroup.get_children();
    if (
      popup.actor.get_parent() !== Main.uiGroup ||
      uiChildren.indexOf(popup.actor) <= uiChildren.indexOf(global.window_group)
    )
      throw new Error('Window-preview popup is not stacked above the Dock window group');
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
    const [cardX, cardY] = card.get_transformed_position();
    const [cardWidth, cardHeight] = card.get_transformed_size();
    const [overlayX, overlayY] = overlay.get_transformed_position();
    const [overlayWidth] = overlay.get_transformed_size();
    const [closeX, closeY] = close.get_transformed_position();
    const [closeWidth, closeHeight] = close.get_transformed_size();
    const closeRight = closeX + closeWidth;
    const closeBottom = closeY + closeHeight;
    const cardRight = cardX + cardWidth;
    const cardBottom = cardY + cardHeight;
    const overlayRight = overlayX + overlayWidth;
    const horizontalOffset = closeRight - overlayRight;
    const verticalOffset = overlayY - closeY;
    if (
      Math.abs(horizontalOffset - 8) > 1 ||
      Math.abs(verticalOffset - 8) > 1 ||
      Math.abs(horizontalOffset - verticalOffset) > 2
    ) {
      throw new Error('Window-preview close action is not consistently offset over the corner');
    }
    if (closeX < cardX || closeY < cardY || closeRight > cardRight || closeBottom > cardBottom)
      throw new Error('Window-preview close action extends beyond the card bounds');

    close.emit('clicked', Clutter.BUTTON_PRIMARY);
    await waitForCondition({
      evaluate: () =>
        !item.has_style_class_name('aurora-window-preview-open') &&
        !global.get_window_actors().some((actor) => actor.meta_window === window),
      signals: [
        [popup, 'open-state-changed'],
        [item, 'style-changed'],
        [window, 'unmanaged'],
      ],
      description: 'preview window and Dock highlight to close',
    });
    if (item.has_style_class_name('aurora-window-preview-open'))
      throw new Error('Window-preview Dock highlight survived popup closure');
    if (global.get_window_actors().some((actor) => actor.meta_window === window))
      throw new Error('Window-preview close action did not close the window');

    dash._windowPreviews.close();
    if (dash._windowPreviews._popup)
      throw new Error('Window-preview actors were retained after popup close');
    if (dash._windowPreviews._showTimeout.active || dash._windowPreviews._hideTimeout.active) {
      throw new Error('Window-preview timeout survived popup close');
    }

    appIcon.set_hover(false);
  } finally {
    if (global.get_window_actors().some((actor) => actor.meta_window === window))
      window.delete(global.get_current_time());
    settings.set_boolean('dock-window-previews', false);
    await Scripting.waitLeisure();
  }
}

async function exerciseDockPositions(settings, dock) {
  settings.set_boolean('dock-show-on-all-monitors', false);
  settings.set_boolean('dock-always-show', false);
  settings.set_boolean('dock-intellihide', true);

  // Show Apps is present at every position, unlike running and fixed items.
  // Its preferred size includes the per-item margins that affect icon spacing.
  const iconAxisExtents = {};

  for (const position of ['bottom', 'left', 'right']) {
    settings.set_string('dock-position', position);
    await Scripting.waitLeisure();

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
      ? binding.dash._showAppsIcon.get_preferred_height(-1)[1]
      : binding.dash._showAppsIcon.get_preferred_width(-1)[1];

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
    const alwaysBinding = dock.bindings.find(
      (candidate) => candidate.monitorIndex === Main.layoutManager.primaryIndex,
    );
    const strut = alwaysBinding?.strutActor;
    if (!alwaysBinding || !strut) throw new Error(`${position} Dock did not create a strut`);
    const stackedActors = Main.uiGroup.get_children();
    if (
      strut.get_parent() !== Main.uiGroup ||
      stackedActors.indexOf(strut) >= stackedActors.indexOf(alwaysBinding.container)
    )
      throw new Error(`${position} Dock strut is not stacked below its container`);
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
}

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('dockPresent', 'Dock actor found in stage after enable');
  Scripting.defineScriptEvent(
    'dockStackingValid',
    'Application popup windows remain above the Dock while normal windows stay below it',
  );
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

  await exerciseDockStacking(settings, dock);
  Scripting.scriptEvent('dockStackingValid');

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
  await waitForCondition({
    evaluate: () => dash.iconSize === 32,
    signals: [
      [settings, 'changed::dock-icon-size'],
      [dash, 'icon-size-changed'],
      [dash, 'notify::allocation'],
    ],
    description: 'configured Dock icon size to reach the rendered Dash',
  });

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
  await waitForCondition({
    evaluate: () => dash.iconSize === 64,
    signals: [
      [settings, 'changed::dock-icon-size'],
      [dash, 'icon-size-changed'],
      [dash, 'notify::allocation'],
    ],
    description: 'default Dock icon size to reach the rendered Dash',
  });
  if (dash.iconSize !== 64)
    throw new Error(`Resetting dock-icon-size did not restore the 64px default: ${dash.iconSize}`);

  dash.setMaxSize(iconSizeMaxWidth, iconSizeMaxHeight);
  dash._adjustIconSize();
  Scripting.scriptEvent('configuredIconSizeApplied');

  // Fixed icons live outside _box but still consume the sizing budget. Add fake
  // storage icons so the test does not depend on favorites, hardware, or Nautilus.
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

    // Size 31 sits below the 32px step. Omitting fixed icons would select 32px
    // and overflow this budget.
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

  // Repeated show requests must not restart the animation from its hidden pose.
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

  await waitForActorState(
    dash,
    (actor) => actor.visible && actor.opacity === 255 && actor.translation_y === 0,
    {
      properties: ['visible', 'opacity', 'translation-y'],
      description: 'Dock show animation to reach its final pose',
    },
  );
  dash._visibility._applyHiddenState = originalApplyHiddenState;
  if (hiddenPoseCalls !== 1)
    throw new Error(`Repeated show requests restarted the animation ${hiddenPoseCalls} times`);
  Scripting.scriptEvent('repeatedShowStable');

  const originalItemDragHover = dash._visibility._hovered;
  try {
    dash._visibility._hovered = false;
    dash.blockAutoHide(false);
    dash.show(false);
    dash._onItemDragBegin();
    dash.hide(false);
    await waitForActorState(dash, (actor) => actor.visible && actor.opacity === 255, {
      properties: ['visible', 'opacity'],
      description: 'Dock to remain fully visible during an icon drag',
    });
    if (!dash.visible || dash.opacity !== 255 || dash.translation_y !== 0)
      throw new Error('Dock hid while a favorite icon drag was active');

    dash._onItemDragEnd();
    await waitForActorState(dash, (actor) => !actor.visible, {
      properties: ['visible', 'opacity'],
      description: 'Dock to restore autohide after the icon drop',
    });
    if (dash.visible) throw new Error('Dock did not restore auto-hide after the icon drop');

    dash.show(false);
    dash._onItemDragBegin();
    dash._onItemDragCancelled();
    await waitForActorState(dash, (actor) => !actor.visible, {
      properties: ['visible', 'opacity'],
      description: 'Dock to restore autohide after cancelling the icon drag',
    });
    if (dash.visible) throw new Error('Dock did not restore auto-hide after cancelling icon drag');
  } finally {
    if (dash._visibility._itemDragHold) dash._onItemDragCancelled();
    dash._visibility._hovered = originalItemDragHover;
    dash.blockAutoHide(true);
    dash.show(false);
  }
  Scripting.scriptEvent('itemDragKeepsDockStable');

  const binding = dock.bindings[0];

  // Switching from a small window to fullscreen hands BLOCKED to hover autohide.
  dash.show(false);
  const originalDashContainerHasHover = dash._visibility._hovered;
  try {
    dash._visibility._hovered = true;
    binding.hotAreaActive = false;
    clearIntellihideQueuedRefreshes(binding.intellihide);
    binding.intellihide._status = 1;
    binding.intellihide.emit('status-changed');
    await waitForActorState(dash, (actor) => actor.visible, {
      properties: ['visible', 'opacity'],
      description: 'Dock to remain visible for BLOCKED intellihide while hovered',
    });
    if (!dash.visible)
      throw new Error('Intellihide BLOCKED hid the dock while the pointer stayed over it');

    dash._visibility._hovered = false;
    dash._visibility.updateAutoHide();
    await waitForActorState(dash, (actor) => !actor.visible, {
      properties: ['visible', 'opacity'],
      description: 'BLOCKED Dock to hide after hover ends',
    });
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

  // Native crossing events, not stage motion, keep the revealed Dock visible
  // while the pointer crosses onto a client window.
  const originalHoldZoneDashContainerHasHover = dash._visibility._hovered;
  clearIntellihideQueuedRefreshes(binding.intellihide);
  binding.intellihide._status = 1; // BLOCKED
  try {
    dash._visibility._hovered = true; // pointer resting over the dock
    dock._clearHotAreaReveal(binding);
    binding.hotAreaActive = false;
    dock.revealFromHotArea();
    await waitForTiming(
      1700,
      'cross the hot-area reveal grace period before asserting autohide handoff',
    ); // past the reveal grace → handoff to autohide
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

  // CLEAR during a hot-area reveal returns the Dock to pinned-visible mode.
  dash.hide(false);
  binding.hotAreaActive = true;
  binding.hotArea?.setEnabled(true);
  binding.intellihide._status = 0; // CLEAR
  binding.intellihide.emit('status-changed');
  await waitForCondition({
    evaluate: () => dash.visible && !binding.hotAreaActive && !binding.hotArea?.reactive,
    signals: [
      [dash, 'notify::visible'],
      [dash, 'transitions-completed'],
      ...(binding.hotArea ? [[binding.hotArea, 'notify::reactive']] : []),
    ],
    description: 'CLEAR intellihide to show Dock and end the hot-area reveal',
  });
  if (!dash.visible) throw new Error('Hot-area active CLEAR did not show the dock');
  if (binding.hotAreaActive) throw new Error('Hot-area active CLEAR did not end the reveal state');
  if (binding.hotArea?.reactive)
    throw new Error('Hot-area active CLEAR left the hot area reactive over the dock');

  Scripting.scriptEvent('hotAreaActiveClearShowsDock');

  // Reasserting BLOCKED reproduces the maximized-window switch where stage
  // motion missed the pointer leaving the Dock.
  const originalBlockedDashContainerHasHover = dash._visibility._hovered;
  try {
    binding.intellihide._status = 1; // BLOCKED
    dash._visibility._hovered = true; // pointer over the dock
    binding.hotAreaActive = true;
    binding.dash.blockAutoHide(true);
    dash.show(false);
    dock._handleHotAreaActiveIntellihideChange(binding);
    await waitForActorState(dash, (actor) => actor.visible, {
      properties: ['visible', 'opacity'],
      description: 'BLOCKED hot-area Dock to remain visible while hovered',
    });
    await waitForTiming(
      450,
      'hold hover beyond the Dock autohide handoff deadline before asserting it remains visible',
    );
    if (!dash.visible)
      throw new Error('Hot-area active BLOCKED hid the dock while pointer stayed over it');
    if (!binding.hotAreaActive)
      throw new Error('Hot-area active BLOCKED ended the reveal while pointer stayed over it');

    dash._visibility._hovered = false;
    dash._visibility.updateAutoHide();
    await waitForActorState(dash, (actor) => !actor.visible, {
      properties: ['visible', 'opacity'],
      description: 'BLOCKED hot-area Dock to retract after hover ends',
    });
    await waitForCondition({
      evaluate: () => !binding.hotAreaActive && binding.hotArea?.reactive,
      signals: [
        [dash, 'transitions-completed'],
        ...(binding.hotArea ? [[binding.hotArea, 'notify::reactive']] : []),
      ],
      description: 'hot area to rearm after the BLOCKED Dock retracts',
    });
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
  await waitForCondition({
    evaluate: () => !dash.visible && binding.hotArea?.reactive && !binding.hotAreaActive,
    signals: [
      [dash, 'notify::visible'],
      [dash, 'transitions-completed'],
      ...(binding.hotArea ? [[binding.hotArea, 'notify::reactive']] : []),
    ],
    description: 'hot area to rearm after the Dock hide animation',
  });
  if (dash.visible) throw new Error('Dock did not finish its hide animation');
  if (!binding.hotArea?.reactive)
    throw new Error('Hot area was not restored after the dock became fully hidden');
  if (binding.hotAreaActive)
    throw new Error('Hot-area reveal remained active after the dock became fully hidden');

  Scripting.scriptEvent('hotAreaRearmedAfterHide');

  // System transitions block edge activation and contextual DND until cooldown.
  const hotAreaBounds = binding.hotArea._monitor;
  const edgeX = hotAreaBounds.x + Math.floor(hotAreaBounds.width / 2);
  const edgeY = hotAreaBounds.y + hotAreaBounds.height - 1;
  dock._beginActivationCooldown('shell-test');
  if (binding.hotArea.canStartContextualDragReveal(edgeX, edgeY))
    throw new Error('Hot area accepted contextual DND during the transition cooldown');

  await waitForTiming(
    750,
    'cross the system-transition cooldown before contextual drag activation is retried',
  );
  if (!binding.hotArea.canStartContextualDragReveal(edgeX, edgeY))
    throw new Error('Hot area remained in transition cooldown after its deadline');

  dock._dragReveal._handleMotion({
    source: Main.xdndHandler,
    x: edgeX,
    y: edgeY,
  });
  await waitForTiming(
    400,
    'remain below the prolonged contextual-drag dwell threshold for a negative assertion',
  );
  if (binding.hotAreaActive || dash.visible)
    throw new Error('Contextual DND revealed the dock before the prolonged dwell elapsed');

  await waitForTiming(
    500,
    'cross the prolonged contextual-drag dwell threshold before expecting reveal',
  );
  if (!binding.hotAreaActive || !dash.visible)
    throw new Error('Contextual DND did not reveal the dock after the prolonged dwell');

  dock._clearHotAreaReveal(binding);
  binding.hotAreaActive = false;
  binding.dash.blockAutoHide(false);
  binding.dash.hide(false);
  binding.hotArea.setEnabled(false);

  // Focus can change while the enum stays BLOCKED, so status-changed will not fire.
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

  // blocked-reasserted uses the same native autohide handoff as status-changed.
  dock._clearHotAreaReveal(binding);
  const originalReassertHasHover = dash._visibility._hovered;
  try {
    binding.intellihide._status = 1; // BLOCKED
    dash._visibility._hovered = true; // pointer over the dock
    binding.hotAreaActive = true;
    binding.dash.blockAutoHide(true);
    dash.show(false);
    binding.intellihide.emit('blocked-reasserted');
    await waitForActorState(dash, (actor) => actor.visible, {
      properties: ['visible', 'opacity'],
      description: 'focus reasserted Dock to remain visible while hovered',
    });
    await waitForTiming(
      450,
      'hold hover beyond the focus-reasserted autohide handoff deadline before asserting visibility',
    );
    if (!dash.visible)
      throw new Error('Focus reassert hid the dock while the pointer stayed over it');
    if (!binding.hotAreaActive)
      throw new Error('Focus reassert ended the reveal while the pointer stayed over it');

    dash._visibility._hovered = false;
    dash._visibility.updateAutoHide();
    await waitForActorState(dash, (actor) => !actor.visible, {
      properties: ['visible', 'opacity'],
      description: 'focus reasserted Dock to retract after hover ends',
    });
    await waitForCondition({
      evaluate: () => !binding.hotAreaActive && binding.hotArea?.reactive,
      signals: [
        [dash, 'transitions-completed'],
        ...(binding.hotArea ? [[binding.hotArea, 'notify::reactive']] : []),
      ],
      description: 'hot area to rearm after the focus-reasserted Dock retracts',
    });
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

  // Window creation briefly reports 0x0, work-area, then final geometry. These
  // CLEAR/BLOCKED flaps must coalesce into one status change.
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
    await waitForTiming(
      300,
      'cross the intellihide status debounce window before asserting the committed state',
    );
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
    await waitForActorState(alwaysAutoHideBinding.dash, (actor) => actor.visible, {
      properties: ['visible', 'opacity'],
      description: 'always-autohide Dock to appear after edge reveal',
    });
    if (!alwaysAutoHideBinding.dash.visible)
      throw new Error('Always auto-hide Dock did not appear after an edge reveal');

    dock._clearHotAreaReveal(alwaysAutoHideBinding);
    dock._releaseHotAreaToAutoHide(alwaysAutoHideBinding);
    await waitForActorState(alwaysAutoHideBinding.dash, (actor) => !actor.visible, {
      properties: ['visible', 'opacity'],
      description: 'always-autohide Dock to retract after edge reveal ends',
    });
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
  await Scripting.waitLeisure();

  if (disposableDash._dashBox) throw new Error('Dash retained its content actor after destruction');
  if (disposableDash._visibility._autohideTimeout.active)
    throw new Error('Dash content destruction retained its autohide callback');

  Scripting.scriptEvent('dashContentDisposalSafe');

  const originalValue = settings.get_boolean('module-dock');
  settings.set_boolean('module-dock', false);
  await Scripting.waitLeisure();

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
}

let _dockPresent = false;
let _dockStackingValid = false;
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

export function script_dockStackingValid() {
  _dockStackingValid = true;
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
  if (!_dockStackingValid)
    throw new Error('Application popup stacking relative to the Dock was not verified');
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
