export type DockConfiguration = {
  alwaysShow: boolean;
  intellihide: boolean;
  showOnAllMonitors: boolean;
  maxIconSize: number;
  showTrash: boolean;
  showExternalStorage: boolean;
  motionEnabled: boolean;
  motionProfile: string;
  excludePip: boolean;
};

export type DockConfigurationChange = 'none' | 'icon-size' | 'motion' | 'pip' | 'rebuild';

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
  if (!value.alwaysShow || !value.intellihide) return { ...value };

  return changedKey === 'intellihide'
    ? { ...value, alwaysShow: false }
    : { ...value, intellihide: false };
}

export function classifyDockConfigurationChange(
  previous: DockConfiguration,
  next: DockConfiguration,
): DockConfigurationChange {
  const rebuildKeys: Array<keyof DockConfiguration> = [
    'alwaysShow',
    'intellihide',
    'showOnAllMonitors',
    'showTrash',
    'showExternalStorage',
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

  if (previous.excludePip !== next.excludePip) {
    return 'pip';
  }

  return 'none';
}
