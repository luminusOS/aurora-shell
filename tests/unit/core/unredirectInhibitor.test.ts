import assert from 'node:assert/strict';
import test from 'node:test';

import { UnredirectInhibitor, type UnredirectController } from '~/core/unredirectInhibitor.ts';

class FakeUnredirectController implements UnredirectController {
  disableCalls = 0;
  enableCalls = 0;
  depth = 0;

  disable_unredirect(): void {
    this.disableCalls += 1;
    this.depth += 1;
  }

  enable_unredirect(): void {
    this.enableCalls += 1;
    this.depth -= 1;
  }
}

test('UnredirectInhibitor balances repeated mapped-state updates', () => {
  const controller = new FakeUnredirectController();
  const inhibitor = new UnredirectInhibitor(controller);

  inhibitor.setInhibited(true);
  inhibitor.setInhibited(true);
  assert.equal(inhibitor.inhibited, true);
  assert.equal(controller.disableCalls, 1);
  assert.equal(controller.depth, 1);

  inhibitor.setInhibited(false);
  inhibitor.setInhibited(false);
  assert.equal(inhibitor.inhibited, false);
  assert.equal(controller.enableCalls, 1);
  assert.equal(controller.depth, 0);
});

test('UnredirectInhibitor release is idempotent during actor destruction', () => {
  const controller = new FakeUnredirectController();
  const inhibitor = new UnredirectInhibitor(controller);

  inhibitor.setInhibited(true);
  inhibitor.release();
  inhibitor.release();

  assert.equal(controller.disableCalls, 1);
  assert.equal(controller.enableCalls, 1);
  assert.equal(controller.depth, 0);
});

test('independent mapped actors retain separate compositor references', () => {
  const controller = new FakeUnredirectController();
  const first = new UnredirectInhibitor(controller);
  const second = new UnredirectInhibitor(controller);

  first.setInhibited(true);
  second.setInhibited(true);
  assert.equal(controller.depth, 2);

  first.release();
  assert.equal(controller.depth, 1);

  second.release();
  assert.equal(controller.depth, 0);
  assert.equal(controller.disableCalls, 2);
  assert.equal(controller.enableCalls, 2);
});
