import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { textureToLogical } from '../../../../src/desktop/wiggleCursor/cursorGeometry.ts';

describe('textureToLogical', () => {
  it('keeps the texture size on a 1x monitor', () => {
    assert.equal(textureToLogical(1, 1), 1);
  });

  it('shrinks a compositor cursor, rasterised at the monitor scale, to its logical size', () => {
    assert.equal(textureToLogical(1, 2), 0.5);
    assert.equal(textureToLogical(1, 3), 1 / 3);
  });

  it('handles fractional monitor scales', () => {
    assert.ok(Math.abs(textureToLogical(1, 1.5) - 2 / 3) < 1e-9);
  });

  it('trusts a cursor that reports its own factor, whatever the monitor scale', () => {
    assert.equal(textureToLogical(0.5, 2), 0.5);
    assert.equal(textureToLogical(2, 1), 2);
  });
});
