import { getModuleCatalog } from '~/moduleCatalog.ts';
import { NoOverview } from '~/patches/noOverview.ts';
import { PipOnTop } from '~/patches/pipOnTop.ts';
import { FocusLaunchedWindows } from '~/patches/focusLaunchedWindows.ts';
import { ThemeChanger } from '~/theme/themeChanger.ts';
import { Dock } from '~/dock/dock.ts';
import { AuroraMenu } from '~/panel/auroraMenu.ts';
import { VolumeMixer } from '~/panel/volumeMixer/volumeMixer.ts';
import { LowBatteryPercentage } from '~/panel/lowBatteryPercentage.ts';
import { LockKeyIndicators } from '~/panel/lockKeyIndicators.ts';
import { XwaylandIndicator } from '~/patches/xwaylandIndicator.ts';
import { PrivacyModule } from '~/privacy/privacy.ts';
import { IconWeave } from '~/patches/iconWeave.ts';
import { AppSearchTooltip } from '~/patches/appSearchTooltip.ts';
import { VelaVpnQuickSettings } from '~/patches/velaVpnQuickSettings.ts';
import { AutoThemeSwitcher } from '~/theme/autoThemeSwitcher.ts';
import { BluetoothMenu } from '~/panel/bluetoothMenu/bluetoothMenu.ts';
import { WeatherClock } from '~/panel/clock/weatherClock/weatherClock.ts';
import { MeetingClock } from '~/panel/clock/meetingClock/meetingClock.ts';
import { TrayIcons } from '~/desktop/trayIcons/trayIcons.ts';
import { ClipboardHistory } from '~/clipboard/clipboardHistory.ts';

import type { ModuleDefinition, ModuleManifest } from '~/module.ts';

const factories = {
  'no-overview': (context) => new NoOverview(context),
  'pip-on-top': (context) => new PipOnTop(context),
  'focus-launched-windows': (context) => new FocusLaunchedWindows(context),
  'theme-changer': (context) => new ThemeChanger(context),
  dock: (context) => new Dock(context),
  'aurora-menu': (context) => new AuroraMenu(context),
  'volume-mixer': (context) => new VolumeMixer(context),
  'low-battery-percentage': (context) => new LowBatteryPercentage(context),
  'lock-key-indicators': (context) => new LockKeyIndicators(context),
  'xwayland-indicator': (context) => new XwaylandIndicator(context),
  privacy: (context) => new PrivacyModule(context),
  'icon-weave': (context) => new IconWeave(context),
  'app-search-tooltip': (context) => new AppSearchTooltip(context),
  'vela-vpn-quick-settings': (context) => new VelaVpnQuickSettings(context),
  'auto-theme-switcher': (context) => new AutoThemeSwitcher(context),
  'bluetooth-menu': (context) => new BluetoothMenu(context),
  'weather-clock': (context) => new WeatherClock(context),
  'meeting-clock': (context) => new MeetingClock(context),
  'tray-icons': (context) => new TrayIcons(context),
  'clipboard-history': (context) => new ClipboardHistory(context),
} satisfies Record<string, ModuleDefinition['factory']>;

export function getModuleRegistry(): ModuleDefinition[] {
  return getModuleCatalog().map((manifest) => ({
    manifest,
    factory: getFactory(manifest),
  }));
}

function getFactory(manifest: ModuleManifest): ModuleDefinition['factory'] {
  const factory = factories[manifest.key as keyof typeof factories];
  if (!factory) throw new Error(`No runtime factory registered for module ${manifest.key}`);
  return factory;
}

export function getRegisteredFactoryKeys(): readonly string[] {
  return Object.keys(factories);
}

export type { ModuleDefinition } from '~/module.ts';
