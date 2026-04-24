import type { ExtensionContext } from '~/core/context.ts';
import type { Module } from '~/module.ts';

export type ModuleOption = {
  key?: string;
  hourKey?: string;
  minuteKey?: string;
  title: string;
  subtitle: string;
  type: 'switch' | 'entry' | 'spin' | 'time';
  min?: number;
  max?: number;
};

export type ModuleMetadata = {
  key: string;
  settingsKey: string;
  title: string;
  subtitle: string;
  options?: ModuleOption[];
};

export type ModuleDefinition = ModuleMetadata & {
  factory: (context: ExtensionContext) => Module;
};
