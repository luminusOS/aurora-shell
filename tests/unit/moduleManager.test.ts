import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ExtensionContext } from '~/core/context.ts';
import type { DeviceChangeListener, DeviceService } from '~/device/device.ts';
import { createDeviceSnapshot, type DeviceSnapshot } from '~/device/runtime.ts';
import type { Module, ModuleDefinition, ModuleManifest } from '~/module.ts';
import { ModuleManager } from '~/moduleManager.ts';

class FakeSettings {
  values = new Map<string, boolean>();
  listeners = new Map<number, () => void>();
  nextId = 1;

  getBoolean(key: string): boolean {
    return this.values.get(key) || false;
  }

  connect(_signal: string, callback: () => void): number {
    const id = this.nextId++;
    this.listeners.set(id, callback);
    return id;
  }

  disconnect(id: number): void {
    this.listeners.delete(id);
  }

  set(key: string, value: boolean): void {
    this.values.set(key, value);
    for (const callback of this.listeners.values()) callback();
  }
}

class FakeDevice implements DeviceService {
  private listeners = new Set<DeviceChangeListener>();
  constructor(public current: DeviceSnapshot) {}
  hasCapability(capability: Parameters<DeviceService['hasCapability']>[0]): boolean {
    return this.current.capabilities.has(capability);
  }
  refresh(): DeviceSnapshot {
    return this.current;
  }
  subscribeChanged(listener: DeviceChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(snapshot: DeviceSnapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
  destroy(): void {
    this.listeners.clear();
  }
}

const desktop = createDeviceSnapshot(
  [{ index: 0, x: 0, y: 0, width: 1920, height: 1080, scale: 1, isBuiltin: false }],
  { touch: false, pointer: true, keyboard: true },
  new Set(),
);

function manifest(runtime?: ModuleManifest['runtime']): ModuleManifest {
  return {
    key: 'sample',
    settingsKey: 'module-sample',
    section: 'behavior',
    title: 'Sample',
    subtitle: 'Sample',
    runtime,
  };
}

function setup(definition: ModuleDefinition): {
  manager: ModuleManager;
  settings: FakeSettings;
  device: FakeDevice;
  errors: string[];
} {
  const settings = new FakeSettings();
  const device = new FakeDevice(desktop);
  const errors: string[] = [];
  const context = { settings, device } as unknown as ExtensionContext;
  const manager = new ModuleManager([definition], context, {
    debug: () => undefined,
    error: (message) => errors.push(message),
  });
  return { manager, settings, device, errors };
}

test('ModuleManager — follows settings and tears modules down', () => {
  let enables = 0;
  let disables = 0;
  const item: Module = { enable: () => enables++, disable: () => disables++ } as Module;
  const state = setup({ manifest: manifest(), factory: () => item });
  state.settings.values.set('module-sample', true);
  state.manager.start();
  assert.equal(enables, 1);
  state.settings.set('module-sample', false);
  assert.equal(disables, 1);
  state.manager.stop();
  assert.equal(state.settings.listeners.size, 0);
});

test('ModuleManager — discards and cleans a module whose enable fails', () => {
  let disables = 0;
  const item: Module = {
    enable: () => {
      throw new Error('boom');
    },
    disable: () => disables++,
  } as Module;
  const state = setup({ manifest: manifest(), factory: () => item });
  state.settings.values.set('module-sample', true);
  state.manager.start();
  assert.equal(state.manager.getModule('sample'), null);
  assert.equal(disables, 1);
  assert.equal(state.errors.length, 1);
  state.manager.stop();
});

test('ModuleManager — surfaces cleanup failures after a module fails to enable', () => {
  const item: Module = {
    enable: () => {
      throw new Error('enable failed');
    },
    disable: () => {
      throw new Error('cleanup failed');
    },
  } as Module;
  const state = setup({ manifest: manifest(), factory: () => item });
  state.settings.values.set('module-sample', true);

  assert.throws(() => state.manager.start(), /cleanup failed/);
  assert.equal(state.manager.getModule('sample'), null);
  assert.deepEqual(state.errors, ['Failed to enable module sample: Error: enable failed']);
});

test('ModuleManager — surfaces module disable failures', () => {
  const item: Module = {
    enable: () => undefined,
    disable: () => {
      throw new Error('disable failed');
    },
  } as Module;
  const state = setup({ manifest: manifest(), factory: () => item });
  state.settings.values.set('module-sample', true);
  state.manager.start();

  assert.throws(() => state.settings.set('module-sample', false), /disable failed/);
  assert.equal(state.manager.getModule('sample'), null);
});

test('ModuleManager — reconciles capability changes', () => {
  let enables = 0;
  let disables = 0;
  const state = setup({
    manifest: manifest({ requires: ['touch'] }),
    factory: () => ({ enable: () => enables++, disable: () => disables++ }) as Module,
  });
  state.settings.values.set('module-sample', true);
  state.manager.start();
  assert.equal(enables, 0);
  state.device.set({ ...desktop, capabilities: new Set(['touch']) });
  assert.equal(enables, 1);
  state.device.set(desktop);
  assert.equal(disables, 1);
  state.manager.stop();
});

test('ModuleManager — stop is idempotent and disables in reverse order', () => {
  const order: string[] = [];
  const definitions: ModuleDefinition[] = ['first', 'second'].map((key) => ({
    manifest: { ...manifest(), key, settingsKey: `module-${key}` },
    factory: () => ({ enable: () => undefined, disable: () => order.push(key) }) as Module,
  }));
  const settings = new FakeSettings();
  settings.values.set('module-first', true);
  settings.values.set('module-second', true);
  const context = { settings, device: new FakeDevice(desktop) } as unknown as ExtensionContext;
  const manager = new ModuleManager(definitions, context, {
    debug: () => undefined,
    error: () => undefined,
  });
  manager.start();
  manager.stop();
  manager.stop();
  assert.deepEqual(order, ['second', 'first']);
});
