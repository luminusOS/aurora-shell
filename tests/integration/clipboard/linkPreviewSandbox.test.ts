import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import {
  PREVIEW_IMAGE_EDGE,
  PREVIEW_IMAGE_PIXEL_BYTES,
} from '../../../src/clipboard/linkPreviewImageFormat.ts';
import { imageSandboxArgs } from '../../../src/clipboard/linkPreviewImageSandbox.ts';

const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const WIDE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAEAEAAAABCAIAAAA+gZcVAAAAJUlEQVR4nO3CMREAAAwDofdvurWRAY6uVFVVVVVVVVVVVVXV/Q9aA/Hhj2LTCgAAAABJRU5ErkJggg==';

function runDecoder(png: string) {
  const [executable, ...args] = imageSandboxArgs('image/png');
  assert.ok(executable);
  const decoded = spawnSync(executable, args, {
    input: Buffer.from(png, 'base64'),
    timeout: 3000,
    maxBuffer: 64 * 1024,
  });
  assert.ifError(decoded.error);
  return decoded;
}

test('the real sandbox emits fixed-size raw RGBA pixels', () => {
  const decoded = runDecoder(RED_PNG);
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  assert.equal(decoded.stdout.length, PREVIEW_IMAGE_PIXEL_BYTES);
  for (let offset = 0; offset < PREVIEW_IMAGE_EDGE ** 2 * 4; offset += 4) {
    assert.equal(decoded.stdout.readUInt32BE(offset), 0xff0000ff);
  }
});

test('the real sandbox rejects a valid 4097×1 PNG without emitting pixels', () => {
  const decoded = runDecoder(WIDE_PNG);
  assert.equal(decoded.status, 1, decoded.stderr.toString());
  assert.equal(decoded.stdout.length, 0);
});
