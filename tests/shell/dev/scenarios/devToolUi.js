import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { waitForCondition } from '../../support/testUtils.js';

function findDescendant(actor, predicate) {
  if (predicate(actor)) return actor;
  if (!actor?.get_children) return null;
  for (const child of actor.get_children()) {
    const match = findDescendant(child, predicate);
    if (match) return match;
  }
  return null;
}

function findAncestor(actor, predicate) {
  let current = actor;
  while (current) {
    if (predicate(current)) return current;
    current = current.get_parent();
  }
  return null;
}

export async function exerciseDevToolUi(panelButton, settings) {
  panelButton.menu.open();
  await waitForCondition({
    evaluate: () => panelButton.menu.isOpen,
    signals: [[panelButton.menu, 'open-state-changed']],
    description: 'DevTool card to open',
  });

  await Scripting.waitLeisure();

  const cardPanel = findDescendant(
    panelButton.menu.box,
    (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-panel'),
  );
  const headerBox = findDescendant(
    panelButton.menu.box,
    (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-header'),
  );
  const scrollView = findDescendant(
    panelButton.menu.box,
    (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-scroll'),
  );
  if (!cardPanel || !headerBox || !scrollView)
    throw new Error('DevTool card structure incomplete (panel/header/scroll)');
  if (cardPanel.get_children()[0] !== headerBox)
    throw new Error('Header is not the first child of the DevTool panel');
  const monitor = Main.layoutManager.findMonitorForActor(panelButton);
  const monitorIndex = monitor ? monitor.index : Main.layoutManager.primaryIndex;
  const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
  const [cardX, cardY] = cardPanel.get_transformed_position();
  const [cardWidth, cardHeight] = cardPanel.get_transformed_size();
  if (
    cardX < workArea.x ||
    cardX + cardWidth > workArea.x + workArea.width ||
    cardY < workArea.y ||
    cardY + cardHeight > workArea.y + workArea.height
  )
    throw new Error(
      `DevTool card ${cardX},${cardY} ${cardWidth}x${cardHeight} exceeds ` +
        `work area ${workArea.x},${workArea.y} ${workArea.width}x${workArea.height}`,
    );
  const [, headerY] = headerBox.get_transformed_position();
  const [, scrollY] = scrollView.get_transformed_position();
  if (!(headerY < scrollY))
    throw new Error(`Header (${headerY}) must be above the scroll view (${scrollY})`);

  const scrollViewport = findDescendant(scrollView, (actor) => actor instanceof St.Viewport);
  const pageContent = scrollViewport ? scrollViewport.get_children()[0] : null;
  if (!pageContent) throw new Error('DevTool scroll viewport has no page content');
  if (pageContent.width > scrollViewport.width)
    throw new Error(
      `Page content (${pageContent.width}px) overflows the ` +
        `${scrollViewport.width}px scroll viewport`,
    );

  const moduleSwitch = findDescendant(
    panelButton.menu.box,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-switch-button'),
  );
  if (!moduleSwitch) throw new Error('Module switch not found');
  const initialSwitchState = moduleSwitch.child.state;
  moduleSwitch.emit('clicked', 1);
  if (moduleSwitch.child.state === initialSwitchState)
    throw new Error('Module switch did not toggle');
  moduleSwitch.emit('clicked', 1);
  const devToolsButton = findDescendant(
    panelButton.menu.box,
    (actor) => actor.accessible_name === 'Dev Tools',
  );
  if (!devToolsButton) throw new Error('Dev Tools view switcher button not found');
  const switcherIcon = findDescendant(devToolsButton, (actor) => actor instanceof St.Icon);
  if (!switcherIcon || switcherIcon.icon_size !== 14)
    throw new Error('Dev Tools view switcher button is missing its 14px icon');
  devToolsButton.emit('clicked', 1);
  await Scripting.waitLeisure();
  const activeDevToolsButton = findDescendant(
    panelButton.menu.box,
    (actor) => actor.accessible_name === 'Dev Tools',
  );
  if (!activeDevToolsButton?.checked)
    throw new Error('Dev Tools view switcher button did not activate');
  const devSectionRow = findDescendant(
    panelButton.menu.box,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-list-button'),
  );
  if (!devSectionRow) throw new Error('Dev Tools section row not found');
  const [devRowWidth, devRowHeight] = devSectionRow.get_transformed_size();
  if (!(devRowWidth > 0) || !(devRowHeight > 0))
    throw new Error(`Dev Tools section rows are not visible (${devRowWidth}x${devRowHeight})`);
  devSectionRow.emit('clicked', 1);
  const sectionPanel = findDescendant(
    panelButton.menu.box,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-module-panel'),
  );
  if (!sectionPanel) throw new Error('Dev Tool section panel did not render');
  const lookingGlassButton = findDescendant(
    sectionPanel,
    (actor) => actor.accessible_name === 'Looking Glass',
  );
  if (!lookingGlassButton) throw new Error('Looking Glass action not found');
  lookingGlassButton.emit('clicked', 1);
  if (panelButton.menu.isOpen) throw new Error('DevTool stayed open behind Looking Glass');
  if (!Main.lookingGlass?.isOpen) throw new Error('Looking Glass did not open');
  Main.lookingGlass.close();
  panelButton.menu.open();
  const modulesTab = findDescendant(
    panelButton.menu.box,
    (actor) => actor.accessible_name === 'Modules',
  );
  if (!modulesTab?.checked)
    throw new Error('DevTool did not reset to the Modules root when reopened');
  const resetSearchEntry = findDescendant(
    panelButton.menu.box,
    (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-search'),
  );
  if (!resetSearchEntry || resetSearchEntry.get_text() !== '')
    throw new Error('DevTool did not clear the search when reopened');

  const backAtRoot = findDescendant(
    panelButton.menu.box,
    (actor) => actor.name === 'aurora-devtool-focus-back',
  );
  if (!backAtRoot || backAtRoot.visible)
    throw new Error('Back button should exist but stay hidden at the Modules root');

  const moduleOpen = findDescendant(
    panelButton.menu.box,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-module-open'),
  );
  if (!moduleOpen) throw new Error('Module row open button not found');
  moduleOpen.emit('clicked', 1);
  const hero = findDescendant(
    panelButton.menu.box,
    (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-hero'),
  );
  if (!hero) throw new Error('Module page did not open (hero block missing)');
  if (
    findDescendant(
      hero,
      (actor) =>
        actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-hero-icon'),
    )
  )
    throw new Error('Module detail heading should not show a decorative side icon');
  const backButton = findDescendant(
    panelButton.menu.box,
    (actor) => actor.name === 'aurora-devtool-focus-back',
  );
  if (!backButton?.visible) throw new Error('Back button not visible on a subpage');
  const backLabel = findDescendant(backButton, (actor) => actor.text === 'Back');
  if (backLabel) throw new Error('Back button should use only the symbolic icon');
  const backIcon = findDescendant(
    backButton,
    (actor) => actor instanceof St.Icon && actor.icon_name === 'go-previous-symbolic',
  );
  if (!backIcon) throw new Error('Back button has no symbolic navigation icon');
  backButton.emit('clicked', 1);
  const backAfterReturn = findDescendant(
    panelButton.menu.box,
    (actor) => actor.name === 'aurora-devtool-focus-back',
  );
  if (backAfterReturn?.visible) throw new Error('Back button did not return to the Modules root');
  const moduleRowAfterReturn = findDescendant(
    panelButton.menu.box,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-module-row'),
  );
  if (!moduleRowAfterReturn) throw new Error('Module list not shown after returning to the root');

  const dockOpen = findDescendant(
    panelButton.menu.box,
    (actor) => actor.accessible_name === 'Dock',
  );
  if (!dockOpen) throw new Error('Dock module row not found');
  const dockRow = findAncestor(
    dockOpen,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-module-row'),
  );
  const dockIcon = dockRow
    ? findDescendant(
        dockRow,
        (actor) =>
          actor instanceof St.Icon && actor.gicon?.to_string().includes('view-app-grid-symbolic'),
      )
    : null;
  if (!dockIcon) throw new Error('Dock module does not use the app-grid icon');
  dockOpen.emit('clicked', 1);

  const maxIconLabel = findDescendant(
    panelButton.menu.box,
    (actor) => actor.text === 'Maximum Icon Size',
  );
  const maxIconRow = maxIconLabel
    ? findAncestor(
        maxIconLabel,
        (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-row'),
      )
    : null;
  const maxIconControl = maxIconRow
    ? findDescendant(
        maxIconRow,
        (actor) =>
          actor.has_style_class_name &&
          actor.has_style_class_name('aurora-devtool-stepper-control'),
      )
    : null;
  if (!maxIconRow || !maxIconControl) throw new Error('Maximum Icon Size stepper not found');
  const [rowX] = maxIconRow.get_transformed_position();
  const [rowWidth] = maxIconRow.get_transformed_size();
  const [controlX] = maxIconControl.get_transformed_position();
  const [controlWidth] = maxIconControl.get_transformed_size();
  if (controlX + controlWidth > rowX + rowWidth)
    throw new Error(
      `Maximum Icon Size control ends at ${controlX + controlWidth}px, ` +
        `outside its row at ${rowX + rowWidth}px`,
    );
  const resetIcon = findDescendant(
    maxIconControl,
    (actor) => actor instanceof St.Icon && actor.icon_name === 'edit-undo-symbolic',
  );
  if (!resetIcon) throw new Error('Maximum Icon Size reset action is not symbolic');
  resetIcon.get_parent().emit('clicked', 1);
  await Scripting.waitLeisure();

  const developerSubtitle = findDescendant(
    panelButton.menu.box,
    (actor) => actor.text === 'Simulate runtime states and trigger module actions',
  );
  if (!developerSubtitle) throw new Error('Dock Developer section is missing');
  if (!developerSubtitle.clutter_text.line_wrap)
    throw new Error('Dock Developer subtitle does not wrap');
  if (developerSubtitle.clutter_text.ellipsize !== Pango.EllipsizeMode.NONE)
    throw new Error('Dock Developer subtitle is clipped with an ellipsis');

  const subtleChoice = findDescendant(
    panelButton.menu.box,
    (actor) => actor.accessible_name === 'Effect Intensity: Subtle',
  );
  const balancedChoice = findDescendant(
    panelButton.menu.box,
    (actor) => actor.accessible_name === 'Effect Intensity: Balanced',
  );
  const segmentedControl = balancedChoice
    ? findAncestor(
        balancedChoice,
        (actor) =>
          actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-segmented'),
      )
    : null;
  if (!subtleChoice || !balancedChoice || !segmentedControl)
    throw new Error('Effect Intensity segmented choices not found');
  const [effectControlX, effectControlY] = segmentedControl.get_transformed_position();
  const [effectControlWidth, effectControlHeight] = segmentedControl.get_transformed_size();
  for (const choice of segmentedControl.get_children()) {
    const [choiceX, choiceY] = choice.get_transformed_position();
    const [choiceWidth, choiceHeight] = choice.get_transformed_size();
    if (
      choiceX < effectControlX ||
      choiceX + choiceWidth > effectControlX + effectControlWidth ||
      choiceY < effectControlY ||
      choiceY + choiceHeight > effectControlY + effectControlHeight
    )
      throw new Error('Effect Intensity choice overflows segmented control');
  }
  balancedChoice.emit('clicked', 1);
  if (settings.get_string('dock-motion-profile') !== 'balanced')
    throw new Error('Effect Intensity selection did not update its setting');
  if (!balancedChoice.checked || subtleChoice.checked)
    throw new Error('Effect Intensity segmented state did not update');

  const dockBack = findDescendant(
    panelButton.menu.box,
    (actor) => actor.name === 'aurora-devtool-focus-back',
  );
  dockBack.emit('clicked', 1);

  const auroraMenuOpen = findDescendant(
    panelButton.menu.box,
    (actor) => actor.accessible_name === 'Aurora Menu',
  );
  if (!auroraMenuOpen) throw new Error('Aurora Menu module row not found');
  const auroraMenuRow = findAncestor(
    auroraMenuOpen,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-module-row'),
  );
  const auroraModuleIcon = auroraMenuRow
    ? findDescendant(
        auroraMenuRow,
        (actor) =>
          actor instanceof St.Icon &&
          actor.gicon?.to_string().includes('aurora-shell-menu-symbolic.svg'),
      )
    : null;
  if (!auroraModuleIcon) throw new Error('Aurora Menu module does not use its custom icon');
  auroraMenuOpen.emit('clicked', 1);
  await Scripting.waitLeisure();

  const softwareCommandLabel = findDescendant(
    panelButton.menu.box,
    (actor) => actor.text === 'Software Command',
  );
  const softwareCommandRow = softwareCommandLabel
    ? findAncestor(
        softwareCommandLabel,
        (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-row'),
      )
    : null;
  const softwareCommandEntry = softwareCommandRow
    ? findDescendant(softwareCommandRow, (actor) => actor instanceof St.Entry)
    : null;
  if (!softwareCommandEntry) throw new Error('Software Command input not found');
  const entryTheme = softwareCommandEntry.get_theme_node();
  if (
    entryTheme.get_background_color().alpha === 0 ||
    entryTheme.get_border_width(St.Side.TOP) === 0
  )
    throw new Error('Software Command input has no visible field surface');

  const auroraMenuScroll = findDescendant(
    panelButton.menu.box,
    (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-scroll'),
  );
  if (!auroraMenuScroll) throw new Error('Aurora Menu settings scroll view not found');
  auroraMenuScroll.vadjustment.value =
    auroraMenuScroll.vadjustment.upper - auroraMenuScroll.vadjustment.page_size;
  const scrollBeforeRebuild = auroraMenuScroll.vadjustment.value;
  if (!(scrollBeforeRebuild > 0))
    throw new Error('Aurora Menu settings page did not become scrollable');
  const auroraMenuModuleSwitch = findDescendant(
    panelButton.menu.box,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-switch-button'),
  );
  if (!auroraMenuModuleSwitch) throw new Error('Aurora Menu module switch not found');
  auroraMenuModuleSwitch.emit('clicked', 1);
  await Scripting.waitLeisure();
  const rebuiltAuroraMenuScroll = findDescendant(
    panelButton.menu.box,
    (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-scroll'),
  );
  if (
    !rebuiltAuroraMenuScroll ||
    rebuiltAuroraMenuScroll.vadjustment.value < scrollBeforeRebuild - 1
  )
    throw new Error('Toggling a module lost the Module Settings scroll position');
  const rebuiltAuroraMenuSwitch = findDescendant(
    panelButton.menu.box,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-switch-button'),
  );
  if (!rebuiltAuroraMenuSwitch) throw new Error('Rebuilt Aurora Menu module switch not found');
  rebuiltAuroraMenuSwitch.emit('clicked', 1);
  await Scripting.waitLeisure();

  const iconSelector = findDescendant(panelButton.menu.box, (actor) =>
    actor.accessible_name?.startsWith('Menu Icon:'),
  );
  if (!iconSelector) throw new Error('Aurora Menu icon selector not found');
  iconSelector.emit('clicked', 1);
  await Scripting.waitLeisure();
  for (const [label, filename] of [
    ['Menu Icon: Aurora Shell', 'aurora-shell-menu-symbolic.svg'],
    ['Menu Icon: Luminus OS', 'luminus-os-symbolic.svg'],
  ]) {
    const choice = findDescendant(panelButton.menu.box, (actor) => actor.accessible_name === label);
    const loadedIcon = choice
      ? findDescendant(
          choice,
          (actor) => actor instanceof St.Icon && actor.gicon?.to_string().includes(filename),
        )
      : null;
    if (!loadedIcon) throw new Error(`${label} does not load its bundled icon`);
  }

  const customCommands = findDescendant(
    panelButton.menu.box,
    (actor) => actor.accessible_name === 'Custom Menu Commands',
  );
  const customCommandsSubtitle = customCommands
    ? findDescendant(
        customCommands,
        (actor) => actor.text === 'Add shortcuts that run commands from Aurora Menu',
      )
    : null;
  if (!customCommands || !customCommandsSubtitle)
    throw new Error('Custom Menu Commands navigation row not found');
  customCommandsSubtitle.text =
    'Add shortcuts that run commands from Aurora Menu and remain inside this settings row ' +
    'even when localization produces a substantially longer description';
  await Scripting.waitLeisure();
  if (
    !customCommandsSubtitle.clutter_text.line_wrap ||
    customCommandsSubtitle.clutter_text.ellipsize !== Pango.EllipsizeMode.NONE
  )
    throw new Error('Custom Menu Commands subtitle is not configured to wrap');
  const [commandsX, commandsY] = customCommands.get_transformed_position();
  const [commandsWidth, commandsHeight] = customCommands.get_transformed_size();
  const [commandsSubtitleX, commandsSubtitleY] = customCommandsSubtitle.get_transformed_position();
  const [commandsSubtitleWidth, commandsSubtitleHeight] =
    customCommandsSubtitle.get_transformed_size();
  if (
    commandsSubtitleX < commandsX ||
    commandsSubtitleX + commandsSubtitleWidth > commandsX + commandsWidth ||
    commandsSubtitleY < commandsY ||
    commandsSubtitleY + commandsSubtitleHeight > commandsY + commandsHeight
  )
    throw new Error('Custom Menu Commands text extends outside its row');

  const auroraMenuBack = findDescendant(
    panelButton.menu.box,
    (actor) => actor.name === 'aurora-devtool-focus-back',
  );
  auroraMenuBack.emit('clicked', 1);

  const searchEntry = findDescendant(
    panelButton.menu.box,
    (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-search'),
  );
  if (!searchEntry) throw new Error('Search entry not found');
  if (searchEntry.hint_text !== 'Search modules')
    throw new Error(`Unexpected search hint: ${searchEntry.hint_text}`);
  searchEntry.clutter_text.set_text('zzz-no-such-module');
  const statusPage = findDescendant(
    panelButton.menu.box,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-status-page'),
  );
  if (!statusPage) throw new Error('Empty-search status page not shown');
  if (!findDescendant(statusPage, (actor) => actor.text === 'No Results Found'))
    throw new Error('Empty-search status page title not found');
  searchEntry.clutter_text.set_text('');
  const restoredRow = findDescendant(
    panelButton.menu.box,
    (actor) =>
      actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-module-row'),
  );
  if (!restoredRow) throw new Error('Module list was not restored after clearing the search');

  const removedCardMenu = findDescendant(
    panelButton.menu.box,
    (actor) =>
      actor.accessible_name === 'Menu' ||
      (actor.has_style_class_name && actor.has_style_class_name('aurora-devtool-card-menu')),
  );
  if (removedCardMenu) throw new Error('Removed DevTool action menu is still present');
  panelButton.menu.close();
}
