import { definition as noOverview } from '~/modules/noOverview.ts';
import { definition as pipOnTop } from '~/modules/pipOnTop.ts';
import { definition as themeChanger } from '~/modules/themeChanger.ts';
import { definition as dock } from '~/modules/dock/dock.ts';
import { definition as volumeMixer } from '~/modules/volumeMixer/volumeMixer.ts';
import { definition as xwaylandIndicator } from '~/modules/xwaylandIndicator.ts';
import { definition as privacy } from '~/modules/privacy/index.ts';
import { definition as iconWeave } from '~/modules/iconWeave.ts';
import { definition as appSearchTooltip } from '~/modules/appSearchTooltip.ts';
import { definition as autoThemeSwitcher } from '~/modules/autoThemeSwitcher.ts';
import { definition as workspaceThumbnails } from '~/modules/workspaceThumbnails/index.ts';
import { definition as bluetoothMenu } from '~/modules/bluetoothMenu/index.ts';
import { definition as gdmSync } from '~/modules/gdmSync.ts';

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
    workspaceThumbnails,
    bluetoothMenu,
    gdmSync,
  ];
}
