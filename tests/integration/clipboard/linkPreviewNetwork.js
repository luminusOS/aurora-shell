/* global TextEncoder, print, printerr */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { fetchPreview } from '../../../dist/clipboard/linkPreview.js';

const page = 'https://x.com/jack/status/20';
const publicAddress = '8.8.8.8';
let addresses = {};
let html = '';
let imageStatus = 200;
let pageStatus = 200;
let cancelOnLookup = '';
let requests = [];
let lookups = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

Gio.Resolver.get_default = () => ({
  lookup_by_name_with_flags_async(host, flags, cancel, callback) {
    lookups.push({ host, flags, cancel });
    if (host === cancelOnLookup) cancel.cancel();
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      callback(null, host);
      return GLib.SOURCE_REMOVE;
    });
  },
  lookup_by_name_with_flags_finish(host) {
    return (addresses[host] || []).map((address) => Gio.InetAddress.new_from_string(address));
  },
});

GLib.file_test = () => true;
Soup.Message.new_from_uri = (_method, uri) => ({
  uri,
  request_headers: { replace() {} },
  response_headers: {
    get_one(name) {
      if (name !== 'Content-Type') return null;
      return uri.get_host() === 'x.com' ? 'text/html' : 'image/jpeg';
    },
    get_content_length: () => 0,
  },
  connect() {},
  add_flags(flags) {
    this.flags = flags;
  },
});

Soup.Session = class {
  constructor({ remote_connectable }) {
    this.endpoint = remote_connectable;
  }

  remove_feature_by_type() {}

  send_async(message, _priority, _cancel, callback) {
    const host = message.uri.get_host();
    requests.push({
      host,
      address: this.endpoint.get_address().to_string(),
      flags: message.flags,
    });
    message.status_code = host === 'x.com' ? pageStatus : imageStatus;
    const body = host === 'x.com' ? html : '';
    this.input = Gio.MemoryInputStream.new_from_bytes(
      GLib.Bytes.new(new TextEncoder().encode(body)),
    );
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      callback(null, null);
      return GLib.SOURCE_REMOVE;
    });
  }

  send_finish() {
    return this.input;
  }

  abort() {}
};

function reset(image) {
  addresses = {
    'x.com.': [publicAddress],
    'pbs.twimg.com.': ['1.1.1.1'],
  };
  html = `<head><meta property="og:title" content="Post"><meta property="og:image" content="${image}"></head>`;
  imageStatus = 200;
  pageStatus = 200;
  cancelOnLookup = '';
  requests = [];
  lookups = [];
}

async function run() {
  reset('https://pbs.twimg.com/media/photo.jpg');
  let result = await fetchPreview(page, new Gio.Cancellable());
  assert(result?.title === 'Post', 'page metadata must remain available');
  assert(
    lookups.map(({ host }) => host).join(',') === 'x.com.,pbs.twimg.com.',
    'resolve both hosts',
  );
  assert(requests.length === 2, 'request cross-origin image');
  assert(requests[1].address === '1.1.1.1', 'pin image request to its own DNS result');
  assert(
    requests.every(({ flags }) => flags & Soup.MessageFlags.NO_REDIRECT),
    'disable redirects',
  );

  for (const blocked of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1']) {
    reset('https://pbs.twimg.com/media/photo.jpg');
    addresses['pbs.twimg.com.'] = [publicAddress, blocked];
    result = await fetchPreview(page, new Gio.Cancellable());
    assert(result?.title === 'Post', `retain page when image resolves to ${blocked}`);
    assert(requests.length === 1, `reject mixed public/private DNS answers containing ${blocked}`);
  }

  for (const image of [
    'http://pbs.twimg.com/image.jpg',
    'https://user:secret@pbs.twimg.com/image.jpg',
    'https://pbs.twimg.com:8443/image.jpg',
    'https://127.0.0.1/image.jpg',
    'https://service.local/image.jpg',
  ]) {
    reset(image);
    await fetchPreview(page, new Gio.Cancellable());
    assert(requests.length === 1 && lookups.length === 1, `reject unsafe image URL ${image}`);
  }

  reset('https://pbs.twimg.com/media/photo.jpg');
  imageStatus = 302;
  result = await fetchPreview(page, new Gio.Cancellable());
  assert(result?.title === 'Post' && !result.thumbnail, 'reject image redirects');
  assert(requests.length === 2, 'do not follow image redirect');

  reset('https://pbs.twimg.com/media/photo.jpg');
  pageStatus = 302;
  result = await fetchPreview(page, new Gio.Cancellable());
  assert(result === null && requests.length === 1, 'reject page redirects');

  reset('https://pbs.twimg.com/media/photo.jpg');
  cancelOnLookup = 'pbs.twimg.com.';
  result = await fetchPreview(page, new Gio.Cancellable());
  assert(requests.length === 1 && !result?.thumbnail, 'cancel image before its request');

  reset('https://pbs.twimg.com/media/photo.jpg');
  addresses['x.com.'] = ['127.0.0.1'];
  result = await fetchPreview(page, new Gio.Cancellable());
  assert(result === null && requests.length === 0, 'reject a private page endpoint before sending');

  print('link preview network tests passed');
}

const loop = new GLib.MainLoop(null, false);
let failed = false;
run()
  .catch((error) => {
    failed = true;
    printerr(error.message);
    printerr(error.stack);
  })
  .finally(() => loop.quit());
loop.run();
if (failed) imports.system.exit(1);
