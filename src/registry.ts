import { definition as noOverview } from '~/patches/noOverview.ts';
import { definition as pipOnTop } from '~/patches/pipOnTop.ts';
import { definition as focusLaunchedWindows } from '~/patches/focusLaunchedWindows.ts';
import { definition as themeChanger } from '~/theme/themeChanger.ts';
import { definition as dock } from '~/dock/dock.ts';
import { definition as auroraMenu } from '~/panel/auroraMenu.ts';
import { definition as volumeMixer } from '~/panel/volumeMixer/volumeMixer.ts';
import { definition as lowBatteryPercentage } from '~/panel/lowBatteryPercentage.ts';
import { definition as lockKeyIndicators } from '~/panel/lockKeyIndicators.ts';
import { definition as xwaylandIndicator } from '~/patches/xwaylandIndicator.ts';
import { definition as privacy } from '~/privacy/privacy.ts';
import { definition as iconWeave } from '~/patches/iconWeave.ts';
import { definition as appSearchTooltip } from '~/patches/appSearchTooltip.ts';
import { definition as autoThemeSwitcher } from '~/theme/autoThemeSwitcher.ts';
import { definition as bluetoothMenu } from '~/panel/bluetoothMenu/bluetoothMenu.ts';
import { definition as weatherClock } from '~/panel/clock/weatherClock/weatherClock.ts';
import { definition as meetingClock } from '~/panel/clock/meetingClock/meetingClock.ts';
import { definition as trayIcons } from '~/desktop/trayIcons/trayIcons.ts';
import { definition as clipboardHistory } from '~/clipboard/clipboardHistory.ts';

import type { ModuleDefinition } from '~/module.ts';

export type { ModuleOption, ModuleMetadata, ModuleDefinition } from '~/module.ts';

export function getModuleRegistry(): ModuleDefinition[] {
  return [
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
    autoThemeSwitcher,
    bluetoothMenu,
    weatherClock,
    meetingClock,
    trayIcons,
    clipboardHistory,
  ];
}
