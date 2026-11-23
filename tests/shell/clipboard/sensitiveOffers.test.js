import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { EXTENSION_UUID, waitForExtension, waitForTiming } from '../support/testUtils.js';
import { getClipboardModule } from './scenarios/panelEnvironment.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForOffer(offers, predicate, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const offer = offers.find(predicate);
    if (offer) return offer;
    await waitForTiming(25, description);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(offers)}`);
}

async function testMutterReplay(monitor) {
  const selection = global.display.get_selection();
  const clipboard = Meta.SelectionType.SELECTION_CLIPBOARD;
  const originalCapture = monitor._capture;
  const offers = [];
  monitor._capture = function (mimeTypes, read) {
    const offer = { mimeTypes, reads: 0 };
    offers.push(offer);
    return originalCapture.call(this, mimeTypes, (...args) => {
      offer.reads++;
      return read(...args);
    });
  };
  const owner = Meta.SelectionSourceMemory.new(
    'text/plain',
    new GLib.Bytes(new Uint8Array([115, 101, 99, 114, 101, 116])),
  );
  owner.get_mimetypes = () => ['text/plain', 'x-kde-passwordManagerHint'];

  try {
    selection.set_owner(clipboard, owner);
    const marked = await waitForOffer(
      offers,
      ({ mimeTypes }) => mimeTypes.includes('x-kde-passwordManagerHint'),
      'marked simulated offer',
    );
    await waitForTiming(500, 'delay for Mutter to save the original offer before owner exit');
    if (marked.reads !== 0) throw new Error('Aurora read the marked offer');
    selection.unset_owner(clipboard, owner);
    const replay = await waitForOffer(
      offers,
      ({ mimeTypes }) =>
        mimeTypes.includes('text/plain') && !mimeTypes.includes('x-kde-passwordManagerHint'),
      'unmarked Mutter replay',
    );
    if (!selection.get_mimetypes(clipboard).includes('text/plain'))
      throw new Error('Mutter replay did not retain text');
    if (replay.reads !== 1) throw new Error('Aurora did not read the unmarked replay');
  } finally {
    monitor._capture = originalCapture;
  }
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  const monitor = getClipboardModule()._monitor;
  let reads = 0;
  const read = async () => {
    reads++;
    return new GLib.Bytes(new Uint8Array([115, 97, 102, 101]));
  };

  for (const mimeTypes of [
    ['text/plain', 'x-kde-passwordManagerHint'],
    ['image/png', 'x-kde-passwordManagerHint'],
    ['x-kde-passwordManagerHint'],
  ]) {
    monitor._capture(mimeTypes, read);
  }
  await waitForTiming(100, 'negative observation window for sensitive offer reads');
  if (reads !== 0) throw new Error(`Read ${reads} marked offers`);

  monitor._capture(['text/plain'], read);
  if (reads !== 1) throw new Error('Ordinary text offer was not read');
  await waitForTiming(100, 'delay for ordinary capture to drain before saturation');

  const blocked = deferred();
  let ordinaryReads = 0;
  const pendingRead = () => {
    ordinaryReads++;
    return blocked.promise;
  };

  try {
    for (let index = 0; index < 33; index++) {
      monitor._capture(['text/plain'], pendingRead);
    }
    if (ordinaryReads !== 32) throw new Error(`Expected 32 active reads, got ${ordinaryReads}`);

    monitor._capture(['text/plain', 'x-kde-passwordManagerHint'], read);
    monitor._capture(['image/png', 'x-kde-passwordManagerHint'], read);
    if (reads !== 1) throw new Error('Marked offer started a read with a full queue');

    const selection = global.display.get_selection();
    const owner = Meta.SelectionSourceMemory.new(
      'text/plain',
      new GLib.Bytes(new Uint8Array([111, 119, 110, 101, 114])),
    );
    selection.set_owner(Meta.SelectionType.SELECTION_CLIPBOARD, owner);
    blocked.resolve(new GLib.Bytes(new Uint8Array([97])));
    await waitForTiming(300, 'negative observation window after saturated reads and owner change');

    if (reads !== 1) throw new Error('Marked offer started a deferred read');
    if (ordinaryReads !== 32) throw new Error('Stale deferred offer survived owner change');
  } finally {
    blocked.resolve(new GLib.Bytes(new Uint8Array([97])));
    monitor.discardPendingCaptures();
  }

  await testMutterReplay(monitor);
}
