import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchTrash, queryDefaultHandler, TRASH_URI } from '../../src/dock/trashLauncher.ts';

test('trash URI matches the GVfs location used by Dash to Dock', () => {
  assert.equal(TRASH_URI, 'trash://');
});

test('launchTrash prefers the location-specific default handler', async () => {
  let fallbackCalled = false;

  const result = await launchTrash({
    launchDefaultHandler: async () => true,
    launchFallbackHandler: () => {
      fallbackCalled = true;
      return true;
    },
  });

  assert.equal(result, 'default-handler');
  assert.equal(fallbackCalled, false);
});

test('queryDefaultHandler uses the callback API and finishes its result', async () => {
  const cancellable = { cancelled: false };
  const asyncResult = { token: 42 };
  const handler = { id: 'org.gnome.Nautilus.desktop' };
  let receivedArgumentCount = 0;

  const file = {
    query_default_handler_async(
      priority: number,
      receivedCancellable: typeof cancellable,
      callback: (source: typeof file, result: typeof asyncResult) => void,
    ) {
      receivedArgumentCount = arguments.length;
      assert.equal(priority, 0);
      assert.equal(receivedCancellable, cancellable);
      callback(file, asyncResult);
    },
    query_default_handler_finish(result: typeof asyncResult) {
      assert.equal(result, asyncResult);
      return handler;
    },
  };

  assert.equal(await queryDefaultHandler(file, 0, cancellable), handler);
  assert.equal(receivedArgumentCount, 3);
});

test('launchTrash falls back when resolving the trash handler fails', async () => {
  const result = await launchTrash({
    launchDefaultHandler: async () => {
      throw new Error('GVfs handler unavailable');
    },
    launchFallbackHandler: () => true,
  });

  assert.equal(result, 'fallback-handler');
});

test('launchTrash reports failure when neither handler accepts the URI', async () => {
  await assert.rejects(
    launchTrash({
      launchDefaultHandler: async () => false,
      launchFallbackHandler: () => false,
    }),
    /default and fallback handlers refused/,
  );
});
