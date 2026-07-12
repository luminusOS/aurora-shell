import type { DisplayRole, RuntimeCapability } from '~/module.ts';

export type DeviceClass = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'unknown';
export type InputMode = 'touch' | 'pointer' | 'keyboard' | 'mixed' | 'unknown';
export type DisplayOrientation = 'portrait' | 'landscape' | 'square' | 'unknown';

export type MonitorSnapshot = {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly orientation: DisplayOrientation;
  readonly isBuiltin: boolean;
  readonly role: DisplayRole;
};

export type MonitorInput = Omit<MonitorSnapshot, 'orientation' | 'role'>;

export type InputPresence = {
  readonly touch: boolean;
  readonly pointer: boolean;
  readonly keyboard: boolean;
};

export type DeviceSnapshot = {
  readonly deviceClass: DeviceClass;
  readonly inputMode: InputMode;
  readonly monitors: readonly MonitorSnapshot[];
  readonly capabilities: ReadonlySet<RuntimeCapability>;
};

export function classifyOrientation(width: number, height: number): DisplayOrientation {
  if (width <= 0 || height <= 0) return 'unknown';
  if (width === height) return 'square';
  return width < height ? 'portrait' : 'landscape';
}

export function classifyInputMode(input: InputPresence): InputMode {
  const present = [input.touch, input.pointer, input.keyboard].filter(Boolean).length;
  if (present === 0) return 'unknown';
  if (present > 1) return 'mixed';
  if (input.touch) return 'touch';
  if (input.pointer) return 'pointer';
  return 'keyboard';
}

export function classifyDevice(
  monitors: readonly MonitorInput[],
  input: InputPresence,
): DeviceClass {
  const builtin = monitors.find((monitor) => monitor.isBuiltin);
  if (!builtin) return monitors.length > 0 ? 'desktop' : 'unknown';
  if (!input.touch) return 'laptop';

  const longestEdge = Math.max(builtin.width, builtin.height);
  if (longestEdge <= 900) return 'phone';
  if (longestEdge <= 1400) return 'tablet';
  return 'laptop';
}

export function classifyMonitorRole(monitor: MonitorInput, deviceClass: DeviceClass): DisplayRole {
  if (!monitor.isBuiltin) return 'desktop';
  if (deviceClass === 'phone' || deviceClass === 'tablet') return 'mobile';
  if (deviceClass === 'laptop' || deviceClass === 'desktop') return 'desktop';
  return 'unknown';
}

export function createDeviceSnapshot(
  monitors: readonly MonitorInput[],
  input: InputPresence,
  capabilities: ReadonlySet<RuntimeCapability>,
): DeviceSnapshot {
  const deviceClass = classifyDevice(monitors, input);
  return {
    deviceClass,
    inputMode: classifyInputMode(input),
    monitors: monitors.map((monitor) => ({
      ...monitor,
      orientation: classifyOrientation(monitor.width, monitor.height),
      role: classifyMonitorRole(monitor, deviceClass),
    })),
    capabilities: new Set(capabilities),
  };
}

export function activeDisplayRoles(
  snapshot: DeviceSnapshot,
  desktopFallback = true,
): ReadonlySet<DisplayRole> {
  const roles = new Set(snapshot.monitors.map((monitor) => monitor.role));
  roles.delete('unknown');
  if (roles.size === 0) roles.add('unknown');
  if (desktopFallback && roles.has('mobile') && !roles.has('desktop')) roles.add('desktop');
  return roles;
}

export function sameDeviceSnapshot(a: DeviceSnapshot, b: DeviceSnapshot): boolean {
  if (a.deviceClass !== b.deviceClass || a.inputMode !== b.inputMode) return false;
  if (!sameSet(a.capabilities, b.capabilities) || a.monitors.length !== b.monitors.length)
    return false;

  return a.monitors.every((monitor, index) => {
    const other = b.monitors[index];
    return (
      other !== undefined &&
      monitor.index === other.index &&
      monitor.x === other.x &&
      monitor.y === other.y &&
      monitor.width === other.width &&
      monitor.height === other.height &&
      monitor.scale === other.scale &&
      monitor.orientation === other.orientation &&
      monitor.isBuiltin === other.isBuiltin &&
      monitor.role === other.role
    );
  });
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
