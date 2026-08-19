import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDockConfigurationChange,
  DockConfigurationController,
  normalizeDockConfiguration,
  type DockConfiguration,
} from '~/dock/dockConfiguration.ts';

const base: DockConfiguration = {
  position: 'bottom',
  alwaysShow: false,
  intellihide: false,
  showOnAllMonitors: false,
  maxIconSize: 64,
  showTrash: true,
  showExternalStorage: true,
  motionEnabled: true,
  motionProfile: 'subtle',
};

test('dock configuration keeps always-show and intellihide mutually exclusive', () => {
  const both = { ...base, alwaysShow: true, intellihide: true };
  assert.equal(normalizeDockConfiguration(both, 'alwaysShow').intellihide, false);
  assert.equal(normalizeDockConfiguration(both, 'intellihide').alwaysShow, false);
});

test('dock configuration controller publishes typed snapshots and transition scope', () => {
  const controller = new DockConfigurationController(base);
  const transition = controller.transition({ ...base, motionProfile: 'balanced' }, 'motionProfile');
  assert.equal(transition.change, 'motion');
  assert.equal(transition.snapshot.motionProfile, 'balanced');
  assert.notEqual(transition.snapshot, controller.snapshot);
});

test('dock configuration distinguishes rebuild, icon-size and motion updates', () => {
  assert.equal(classifyDockConfigurationChange(base, { ...base, position: 'left' }), 'rebuild');
  assert.equal(classifyDockConfigurationChange(base, { ...base, showTrash: false }), 'rebuild');
  assert.equal(classifyDockConfigurationChange(base, { ...base, maxIconSize: 32 }), 'icon-size');
  assert.equal(classifyDockConfigurationChange(base, { ...base, motionEnabled: false }), 'motion');
  assert.equal(classifyDockConfigurationChange(base, { ...base }), 'none');
});

test('dock configuration normalizes unsupported positions to bottom', () => {
  const invalid = { ...base, position: 'top' as DockConfiguration['position'] };
  assert.equal(normalizeDockConfiguration(invalid).position, 'bottom');
});
