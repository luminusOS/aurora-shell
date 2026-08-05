import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enforcePipWindow,
  isPipTitle,
  restorePipWindow,
  type PipWindowState,
} from '~/patches/pipWindowPolicy.ts';

class FakeWindow implements PipWindowState {
  constructor(
    private above = false,
    private sticky = false,
  ) {}

  isAbove(): boolean {
    return this.above;
  }

  isOnAllWorkspaces(): boolean {
    return this.sticky;
  }

  makeAbove(): void {
    this.above = true;
  }

  makeSticky(): void {
    this.sticky = true;
  }

  unmakeAbove(): void {
    this.above = false;
  }

  unmakeSticky(): void {
    this.sticky = false;
  }
}

test('recognizes supported PiP titles without matching unrelated windows', () => {
  assert.equal(isPipTitle('Picture-in-Picture'), true);
  assert.equal(isPipTitle('Picture in picture'), true);
  assert.equal(isPipTitle('Video title - PiP'), true);
  assert.equal(isPipTitle('Video title - Picture-in-Picture'), true);
  assert.equal(isPipTitle('Video title — Picture in picture'), true);
  assert.equal(isPipTitle('  PICTURE-IN-PICTURE  '), true);

  assert.equal(isPipTitle(null), false);
  assert.equal(isPipTitle('Picture editor'), false);
  assert.equal(isPipTitle('PiP settings'), false);
  assert.equal(isPipTitle('Video title - PiP controls'), false);
});

test('enforces above and sticky state and restores Aurora-owned changes', () => {
  const window = new FakeWindow();
  const ownership = enforcePipWindow(window, null);

  assert.equal(window.isAbove(), true);
  assert.equal(window.isOnAllWorkspaces(), true);
  assert.deepEqual(ownership, { madeAbove: true, madeSticky: true });

  restorePipWindow(window, ownership);
  assert.equal(window.isAbove(), false);
  assert.equal(window.isOnAllWorkspaces(), false);
});

test('preserves states that existed before Aurora managed the window', () => {
  const window = new FakeWindow(true, true);
  const ownership = enforcePipWindow(window, null);

  assert.deepEqual(ownership, { madeAbove: false, madeSticky: false });

  restorePipWindow(window, ownership);
  assert.equal(window.isAbove(), true);
  assert.equal(window.isOnAllWorkspaces(), true);
});

test('reapplies a managed state without changing its original ownership', () => {
  const window = new FakeWindow();
  const ownership = enforcePipWindow(window, null);
  window.unmakeAbove();
  window.unmakeSticky();

  const nextOwnership = enforcePipWindow(window, ownership);

  assert.equal(nextOwnership, ownership);
  assert.equal(window.isAbove(), true);
  assert.equal(window.isOnAllWorkspaces(), true);
});
