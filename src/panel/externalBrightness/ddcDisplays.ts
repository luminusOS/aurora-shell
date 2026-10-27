/** One display reported by ddcutil-service's `Detect`/`ListDetected` (`a(iiisssqsu)`). */
export type DdcDisplay = {
  displayNumber: number;
  manufacturerId: string;
  modelName: string;
  serialNumber: string;
  productCode: number;
  edid: string;
  binarySerialNumber: number;
};

/** The EDID-derived identity of one Mutter monitor, with what the module needs from it. */
export type MonitorIdentity = {
  vendor: string;
  product: string;
  serial: string;
  displayName: string;
  connector: string;
  hasBacklight: boolean;
};

/**
 * How ddcutil-service selects a display: by EDID with display number -1, which survives
 * renumbering, or by display number with an empty EDID when several displays share one EDID.
 */
export type DisplaySelector = {
  displayNumber: number;
  edid: string;
};

export type ExternalDisplay = {
  key: string;
  display: DdcDisplay;
  selector: DisplaySelector;
  name: string | null;
  connector: string | null;
};

const SELECT_BY_EDID = -1;

/** One `Detect`/`ListDetected` entry, `(iiisssqsu)`, as unpacked from the typed D-Bus reply. */
export type DetectedDisplayTuple = [
  number,
  number,
  number,
  string,
  string,
  string,
  number,
  string,
  number,
];

/** Reads the detected displays, skipping any without an EDID to select them by. */
export function parseDetectedDisplays(entries: readonly DetectedDisplayTuple[]): DdcDisplay[] {
  const displays: DdcDisplay[] = [];
  for (const entry of entries) {
    const [
      displayNumber,
      ,
      ,
      manufacturerId,
      modelName,
      serialNumber,
      productCode,
      edid,
      binarySerialNumber,
    ] = entry;
    if (edid === '') continue;

    displays.push({
      displayNumber,
      manufacturerId,
      modelName,
      serialNumber,
      productCode,
      edid,
      binarySerialNumber,
    });
  }

  return displays;
}

/**
 * The monitor model a display belongs to, for sharing one calibration between its units. The EDID
 * cannot serve: it also holds each unit's serial number.
 */
export function displayModel(display: DdcDisplay): string {
  return [display.manufacturerId.trim(), display.productCode, display.modelName.trim()].join('\n');
}

function monitorIdentityKey(vendor: string, product: string, serial: string): string {
  return [vendor.trim(), product.trim(), serial.trim()].join('\n');
}

// Mutter derives the same identity from the EDID (meta-output.c): the product falls back to the
// product code as `0x%04x` and the serial to the binary serial number as `0x%08x` when the EDID has
// no descriptor string for them.
function ddcDisplayIdentityKey(display: DdcDisplay): string {
  const product = display.modelName.trim() || formatHex(display.productCode, 4);
  const serial = display.serialNumber.trim() || formatHex(display.binarySerialNumber, 8);

  return monitorIdentityKey(display.manufacturerId, product, serial);
}

/**
 * Describes the displays that should get a brightness slider.
 *
 * Each display is named after the Mutter monitor with the same EDID identity, which is the name
 * GNOME Settings shows, falling back to its EDID model name. Identical names get a ` (n)` suffix.
 * Displays whose monitor already has a Mutter backlight (laptop panels, HDR outputs) are skipped,
 * because GNOME's own brightness slider controls them.
 */
export function describeExternalDisplays(
  displays: readonly DdcDisplay[],
  monitors: readonly MonitorIdentity[],
): ExternalDisplay[] {
  const monitorsByIdentity = new Map<string, MonitorIdentity | null>();
  for (const monitor of monitors) {
    const identity = monitorIdentityKey(monitor.vendor, monitor.product, monitor.serial);
    monitorsByIdentity.set(identity, monitorsByIdentity.has(identity) ? null : monitor);
  }

  const edidCounts = new Map<string, number>();
  for (const { edid } of displays) edidCounts.set(edid, (edidCounts.get(edid) || 0) + 1);

  const described: ExternalDisplay[] = [];
  for (const display of displays) {
    const monitor = monitorsByIdentity.get(ddcDisplayIdentityKey(display));
    if (monitor && monitor.hasBacklight) continue;

    const sharedEdid = edidCounts.get(display.edid) !== 1;
    described.push({
      key: sharedEdid ? `${display.edid}#${display.displayNumber}` : display.edid,
      display,
      selector: sharedEdid
        ? { displayNumber: display.displayNumber, edid: '' }
        : { displayNumber: SELECT_BY_EDID, edid: display.edid },
      name: (monitor && monitor.displayName) || display.modelName.trim() || null,
      connector: monitor ? monitor.connector : null,
    });
  }

  return numberDuplicateNames(described);
}

function numberDuplicateNames(displays: ExternalDisplay[]): ExternalDisplay[] {
  const totals = new Map<string, number>();
  for (const { name } of displays) {
    if (name !== null) totals.set(name, (totals.get(name) || 0) + 1);
  }

  const seen = new Map<string, number>();
  return displays.map((display) => {
    if (display.name === null || totals.get(display.name) === 1) return display;

    const ordinal = (seen.get(display.name) || 0) + 1;
    seen.set(display.name, ordinal);

    return { ...display, name: `${display.name} (${ordinal})` };
  });
}

/** True when a `VcpValueChanged` signal refers to the display this selector addresses. */
export function selectorMatches(
  selector: DisplaySelector,
  displayNumber: number,
  edid: string,
): boolean {
  if (selector.edid !== '') return edid === selector.edid;

  return displayNumber === selector.displayNumber;
}

function formatHex(value: number, digits: number): string {
  return `0x${(value >>> 0).toString(16).padStart(digits, '0')}`;
}
