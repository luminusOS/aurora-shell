import { gettext as _ } from 'gettext';

import { manifest as noOverview } from '~/patches/noOverview.manifest.ts';
import { manifest as pipOnTop } from '~/patches/pipOnTop.manifest.ts';
import { manifest as focusLaunchedWindows } from '~/patches/focusLaunchedWindows.manifest.ts';
import { manifest as themeChanger } from '~/theme/themeChanger.manifest.ts';
import { manifest as dock } from '~/dock/dock.manifest.ts';
import { manifest as auroraMenu } from '~/panel/auroraMenu.manifest.ts';
import { manifest as volumeMixer } from '~/panel/volumeMixer/volumeMixer.manifest.ts';
import { manifest as lowBatteryPercentage } from '~/panel/lowBatteryPercentage.manifest.ts';
import { manifest as lockKeyIndicators } from '~/panel/lockKeyIndicators.manifest.ts';
import { manifest as xwaylandIndicator } from '~/patches/xwaylandIndicator.manifest.ts';
import { manifest as privacy } from '~/privacy/privacy.manifest.ts';
import { manifest as iconWeave } from '~/patches/iconWeave.manifest.ts';
import { manifest as appSearchTooltip } from '~/patches/appSearchTooltip.manifest.ts';
import { manifest as velaVpnQuickSettings } from '~/patches/velaVpnQuickSettings.manifest.ts';
import { manifest as autoThemeSwitcher } from '~/theme/autoThemeSwitcher.manifest.ts';
import { manifest as bluetoothMenu } from '~/panel/bluetoothMenu/bluetoothMenu.manifest.ts';
import { manifest as weatherClock } from '~/panel/clock/weatherClock/weatherClock.manifest.ts';
import { manifest as meetingClock } from '~/panel/clock/meetingClock/meetingClock.manifest.ts';
import { manifest as trayIcons } from '~/desktop/trayIcons/trayIcons.manifest.ts';
import { manifest as clipboardHistory } from '~/clipboard/clipboardHistory.manifest.ts';

import type { ModuleManifest } from '~/module.ts';

export type ModuleSection = { id: string; title: string };

export function getSections(): ModuleSection[] {
  return [
    { id: 'dock-panel', title: _('Dock &amp; Panel') },
    { id: 'appearance', title: _('Appearance') },
    { id: 'behavior', title: _('Behavior') },
    { id: 'privacy-clipboard', title: _('Privacy &amp; Clipboard') },
  ];
}

const MODULE_CATALOG: readonly ModuleManifest[] = [
  noOverview,
  pipOnTop,
  focusLaunchedWindows,
  themeChanger,
  dock,
  auroraMenu,
  volumeMixer,
  lowBatteryPercentage,
  lockKeyIndicators,
  xwaylandIndicator,
  privacy,
  iconWeave,
  appSearchTooltip,
  velaVpnQuickSettings,
  autoThemeSwitcher,
  bluetoothMenu,
  weatherClock,
  meetingClock,
  trayIcons,
  clipboardHistory,
];

export function getModuleCatalog(): readonly ModuleManifest[] {
  return MODULE_CATALOG;
}

export type { ModuleManifest, ModuleOption, ModuleOptionChoice } from '~/module.ts';
