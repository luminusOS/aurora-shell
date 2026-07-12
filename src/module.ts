import type { ExtensionContext } from './core/context.ts';

export type DisplayRole = 'desktop' | 'mobile' | 'unknown';

export type RuntimeCapability =
  | 'touch'
  | 'accelerometer'
  | 'light-sensor'
  | 'proximity-sensor'
  | 'cellular'
  | 'backlight';

export type ModuleRuntimePolicy = {
  roles?: DisplayRole[];
  requires?: RuntimeCapability[];
  scope?: 'session' | 'monitor';
};

export type ModuleOption = {
  key?: string;
  hourKey?: string;
  minuteKey?: string;
  title: string;
  subtitle: string;
  type: 'switch' | 'entry' | 'spin' | 'time' | 'shortcut' | 'icon-select' | 'command-list';
  min?: number;
  max?: number;
  choices?: ModuleOptionChoice[];
};

export type ModuleOptionChoice = {
  value: string;
  title: string;
  iconName?: string;
};

export type ModuleManifest = {
  key: string;
  settingsKey: string;
  section: string;
  title: string;
  subtitle: string;
  options?: ModuleOption[];
  internalSettings?: string[];
  runtime?: ModuleRuntimePolicy;
};

export type ModuleDefinition = {
  manifest: ModuleManifest;
  factory: (context: ExtensionContext) => Module;
};

export function moduleSupportsRuntime(
  manifest: ModuleManifest,
  roles: ReadonlySet<DisplayRole>,
  capabilities: ReadonlySet<RuntimeCapability>,
): boolean {
  const supportedRoles = manifest.runtime?.roles ?? ['desktop'];
  if (!supportedRoles.some((role) => roles.has(role))) return false;

  for (const capability of manifest.runtime?.requires ?? []) {
    if (!capabilities.has(capability)) return false;
  }

  return true;
}

export abstract class Module {
  constructor(protected context: ExtensionContext) {}
  abstract enable(): void;
  abstract disable(): void;
}
