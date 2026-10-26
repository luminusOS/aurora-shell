import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeExternalDisplays,
  displayModel,
  parseDetectedDisplays,
  selectorMatches,
  type DdcDisplay,
  type MonitorIdentity,
} from '~/panel/externalBrightness/ddcDisplays.ts';

function ddcDisplay(overrides: Partial<DdcDisplay> = {}): DdcDisplay {
  return {
    displayNumber: 1,
    manufacturerId: 'DEL',
    modelName: 'DELL U2720Q',
    serialNumber: 'ABC123',
    productCode: 0xa0f2,
    edid: 'AP///////wA',
    binarySerialNumber: 0x4c415a42,
    ...overrides,
  };
}

function monitor(overrides: Partial<MonitorIdentity> = {}): MonitorIdentity {
  return {
    vendor: 'DEL',
    product: 'DELL U2720Q',
    serial: 'ABC123',
    displayName: 'Dell 27"',
    connector: 'DP-1',
    hasBacklight: false,
    ...overrides,
  };
}

test('parseDetectedDisplays reads the documented detection tuple', () => {
  const displays = parseDetectedDisplays([
    [2, 3, 0, 'DEL', 'DELL U2720Q', 'ABC123', 0xa0f2, 'AP///////wA', 0x4c415a42],
  ]);

  assert.deepEqual(displays, [ddcDisplay({ displayNumber: 2 })]);
});

test('parseDetectedDisplays skips entries without an EDID', () => {
  const displays = parseDetectedDisplays([[1, 0, 0, 'DEL', 'Model', 'Serial', 1, '', 0]]);

  assert.deepEqual(displays, []);
});

test('describeExternalDisplays names a display after the monitor with the same EDID strings', () => {
  const [described] = describeExternalDisplays(
    [ddcDisplay({ modelName: 'DELL U2720Q\n', serialNumber: ' ABC123 ' })],
    [monitor()],
  );

  assert.equal(described!.name, 'Dell 27"');
  assert.equal(described!.connector, 'DP-1');
  assert.deepEqual(described!.selector, { displayNumber: -1, edid: 'AP///////wA' });
  assert.equal(described!.key, 'AP///////wA');
});

test('describeExternalDisplays matches Mutter hex fallbacks when EDID strings are missing', () => {
  const [described] = describeExternalDisplays(
    [
      ddcDisplay({
        modelName: '',
        serialNumber: '',
        productCode: 0x1a,
        binarySerialNumber: 0xbeef,
      }),
    ],
    [monitor({ product: '0x001a', serial: '0x0000beef', displayName: 'Unknown Display' })],
  );

  assert.equal(described!.name, 'Unknown Display');
});

test('describeExternalDisplays falls back to the EDID model name, then to no name', () => {
  const described = describeExternalDisplays(
    [
      ddcDisplay({ serialNumber: 'OTHER', edid: 'a' }),
      ddcDisplay({ modelName: ' ', serialNumber: 'X', edid: 'b' }),
    ],
    [monitor()],
  );

  assert.deepEqual(
    described.map(({ name, connector }) => [name, connector]),
    [
      ['DELL U2720Q', null],
      [null, null],
    ],
  );
});

test('describeExternalDisplays skips displays that GNOME already controls through a backlight', () => {
  const described = describeExternalDisplays([ddcDisplay()], [monitor({ hasBacklight: true })]);

  assert.deepEqual(described, []);
});

test('describeExternalDisplays numbers displays that would share a name', () => {
  const described = describeExternalDisplays(
    [
      ddcDisplay({ displayNumber: 1, serialNumber: 'A', edid: 'a' }),
      ddcDisplay({ displayNumber: 2, serialNumber: 'B', edid: 'b' }),
      ddcDisplay({ displayNumber: 3, manufacturerId: 'LEN', modelName: 'P27', edid: 'c' }),
    ],
    [monitor({ serial: 'A' }), monitor({ serial: 'B', connector: 'DP-2' })],
  );

  assert.deepEqual(
    described.map(({ name }) => name),
    ['Dell 27" (1)', 'Dell 27" (2)', 'P27'],
  );
});

test('describeExternalDisplays addresses displays that share an EDID by display number', () => {
  const described = describeExternalDisplays(
    [
      ddcDisplay({ displayNumber: 1, edid: 'same' }),
      ddcDisplay({ displayNumber: 2, edid: 'same' }),
    ],
    [],
  );

  assert.deepEqual(
    described.map(({ key, selector }) => [key, selector]),
    [
      ['same#1', { displayNumber: 1, edid: '' }],
      ['same#2', { displayNumber: 2, edid: '' }],
    ],
  );
});

test('selectorMatches compares EDIDs, or display numbers for shared EDIDs', () => {
  assert.equal(selectorMatches({ displayNumber: -1, edid: 'a' }, 7, 'a'), true);
  assert.equal(selectorMatches({ displayNumber: -1, edid: 'a' }, 1, 'b'), false);
  assert.equal(selectorMatches({ displayNumber: 2, edid: '' }, 2, 'same'), true);
  assert.equal(selectorMatches({ displayNumber: 2, edid: '' }, 3, 'same'), false);
});

test('ambiguous Mutter identities neither target an OSD nor filter by backlight', () => {
  const display = ddcDisplay({
    manufacturerId: 'SGT',
    modelName: 'REALTEK',
    serialNumber: 'demoset-1',
  });
  const identity = { vendor: 'SGT', product: 'REALTEK', serial: 'demoset-1' };
  for (const monitors of [
    [
      monitor({ ...identity, connector: 'DP-1' }),
      monitor({ ...identity, connector: 'HDMI-1', hasBacklight: true }),
    ],
    [
      monitor({ ...identity, connector: 'HDMI-1', hasBacklight: true }),
      monitor({ ...identity, connector: 'DP-1' }),
    ],
  ]) {
    const described = describeExternalDisplays([display], monitors);
    assert.equal(described.length, 1);
    assert.equal(described[0]!.connector, null);
    assert.equal(described[0]!.name, 'REALTEK');
  }
});

test('units of one monitor model share a model even though their EDIDs differ', () => {
  const first = ddcDisplay({ edid: 'EDID-A', serialNumber: 'A1', binarySerialNumber: 1 });
  const second = ddcDisplay({ edid: 'EDID-B', serialNumber: 'B2', binarySerialNumber: 2 });

  assert.equal(displayModel(first), displayModel(second));
  assert.notEqual(displayModel(first), displayModel(ddcDisplay({ productCode: 0xa0f3 })));
  assert.equal(displayModel(ddcDisplay({ modelName: 'DELL U2720Q\n' })), displayModel(first));
});
