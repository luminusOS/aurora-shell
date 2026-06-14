import type { ExtensionContext } from './core/context.ts';

export type RuntimeTarget = 'desktop' | 'mobile' | 'shared';

export type RuntimeCapability =
  | 'touch'
  | 'accelerometer'
  | 'light-sensor'
  | 'proximity-sensor'
  | 'cellular'
  | 'backlight'
  | 'hardware-alert-slider';

export type ModuleRuntimePolicy = {
  targets?: RuntimeTarget[];
  requires?: RuntimeCapability[];
};

export type ModuleOption = {
  key?: string;
  hourKey?: string;
  minuteKey?: string;
  title: string;
  subtitle: string;
  type: 'switch' | 'entry' | 'spin' | 'time' | 'shortcut';
  min?: number;
  max?: number;
};

export type ModuleMetadata = {
  key: string;
  settingsKey: string;
  section: string;
  title: string;
  subtitle: string;
  options?: ModuleOption[];
  runtime?: ModuleRuntimePolicy;
};

export type ModuleDefinition = ModuleMetadata & {
  factory: (context: ExtensionContext) => Module;
};

export function moduleSupportsRuntime(
  definition: ModuleDefinition,
  target: RuntimeTarget,
  capabilities: ReadonlySet<RuntimeCapability>,
): boolean {
  const targets = definition.runtime?.targets ?? ['desktop'];
  if (!targets.includes('shared') && !targets.includes(target)) return false;

  for (const capability of definition.runtime?.requires ?? []) {
    if (!capabilities.has(capability)) return false;
  }

  return true;
}

export abstract class Module {
  constructor(protected context: ExtensionContext) {}
  abstract enable(): void;
  abstract disable(): void;
}
