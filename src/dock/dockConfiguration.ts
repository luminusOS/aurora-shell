export const DOCK_POSITIONS = ['bottom', 'left', 'right'] as const;
export type DockPosition = (typeof DOCK_POSITIONS)[number];

export type DockConfiguration = {
  position: DockPosition;
  alwaysShow: boolean;
  intellihide: boolean;
  showOnAllMonitors: boolean;
  maxIconSize: number;
  showTrash: boolean;
  showExternalStorage: boolean;
  windowPreviews: boolean;
  motionEnabled: boolean;
  motionProfile: string;
};

export type DockConfigurationChange = 'none' | 'icon-size' | 'motion' | 'rebuild';

export class DockConfigurationController {
  private _snapshot: DockConfiguration;

  constructor(initial: DockConfiguration) {
    this._snapshot = normalizeDockConfiguration(initial);
  }

  get snapshot(): DockConfiguration {
    return { ...this._snapshot };
  }

  transition(
    next: DockConfiguration,
    changedKey?: keyof DockConfiguration,
  ): { snapshot: DockConfiguration; change: DockConfigurationChange } {
    const normalized = normalizeDockConfiguration(next, changedKey);
    const change = classifyDockConfigurationChange(this._snapshot, normalized);

    this._snapshot = normalized;

    return { snapshot: this.snapshot, change };
  }
}

export function normalizeDockConfiguration(
  value: DockConfiguration,
  changedKey?: keyof DockConfiguration,
): DockConfiguration {
  const position = DOCK_POSITIONS.includes(value.position) ? value.position : 'bottom';
  if (!value.alwaysShow || !value.intellihide) return { ...value, position };

  return changedKey === 'intellihide'
    ? { ...value, position, alwaysShow: false }
    : { ...value, position, intellihide: false };
}

export function classifyDockConfigurationChange(
  previous: DockConfiguration,
  next: DockConfiguration,
): DockConfigurationChange {
  const rebuildKeys: Array<keyof DockConfiguration> = [
    'position',
    'alwaysShow',
    'intellihide',
    'showOnAllMonitors',
    'showTrash',
    'showExternalStorage',
    'windowPreviews',
  ];

  if (rebuildKeys.some((key) => previous[key] !== next[key])) {
    return 'rebuild';
  }

  if (previous.maxIconSize !== next.maxIconSize) {
    return 'icon-size';
  }

  if (
    previous.motionEnabled !== next.motionEnabled ||
    previous.motionProfile !== next.motionProfile
  ) {
    return 'motion';
  }

  return 'none';
}
