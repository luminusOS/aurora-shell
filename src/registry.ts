import { definition as noOverview } from '~/modules/noOverview/noOverview.ts';
import { definition as pipOnTop } from '~/modules/pipOnTop/pipOnTop.ts';
import { definition as themeChanger } from '~/modules/themeChanger/themeChanger.ts';
import { definition as dock } from '~/modules/dock/dock.ts';
import { definition as volumeMixer } from '~/modules/volumeMixer/volumeMixer.ts';
import { definition as xwaylandIndicator } from '~/modules/xwaylandIndicator/xwaylandIndicator.ts';
import { definition as privacy } from '~/modules/privacy/privacy.ts';
import { definition as iconWeave } from '~/modules/iconWeave/iconWeave.ts';
import { definition as appSearchTooltip } from '~/modules/appSearchTooltip/appSearchTooltip.ts';
import { definition as autoThemeSwitcher } from '~/modules/autoThemeSwitcher/autoThemeSwitcher.ts';
import { definition as bluetoothMenu } from '~/modules/bluetoothMenu/bluetoothMenu.ts';

import type { ModuleDefinition } from '~/moduleDefinition.ts';

export type { ModuleOption, ModuleMetadata, ModuleDefinition } from '~/moduleDefinition.ts';

export function getModuleRegistry(): ModuleDefinition[] {
  return [
    noOverview,
    pipOnTop,
    themeChanger,
    dock,
    volumeMixer,
    xwaylandIndicator,
    privacy,
    iconWeave,
    appSearchTooltip,
    autoThemeSwitcher,
    bluetoothMenu,
  ];
}
