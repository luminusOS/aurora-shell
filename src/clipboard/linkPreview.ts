import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Soup from '@girs/soup-3.0';

import { callAsync } from '~/core/callAsync.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { createManagedTimeout } from '~/core/mainLoop.ts';
import { isWebsiteDomain } from './clipboardCardState.ts';
import { PREVIEW_IMAGE_MAX_BYTES, previewImageType } from './linkPreviewImageFormat.ts';
import { parsePreviewMetadata } from './linkPreviewMetadata.ts';
import {
  decodePreviewThumbnail,
  hasImageSandboxExecutables,
  readPreviewBytes,
} from './linkPreviewThumbnail.ts';

export type LinkPreview = { title: string; description: string; thumbnail?: GLib.Bytes };

const MAX_HTML_BYTES = 64 * 1024;
const PAGE_TIMEOUT_MS = 5000;
const IMAGE_TIMEOUT_MS = 3000;
const RESERVED_NETWORKS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
].map((network) => Gio.InetAddressMask.new_from_string(network));

async function resolveEndpoint(host: string, cancel: Gio.Cancellable) {
  const resolver = Gio.Resolver.get_default();
  const addresses = await callAsync(
    (callback) =>
      resolver.lookup_by_name_with_flags_async(
        host + '.',
        Gio.ResolverNameLookupFlags.IPV4_ONLY,
        cancel,
        callback,
      ),
    (result) => resolver.lookup_by_name_with_flags_finish(result),
  );
  if (!addresses[0]) return null;
  for (const address of addresses) {
    if (
      address.get_family() !== Gio.SocketFamily.IPV4 ||
      RESERVED_NETWORKS.some((network) => network.matches(address))
    )
      return null;
  }
  return Gio.InetSocketAddress.new(addresses[0], 443);
}

function previewHost(uri: GLib.Uri): string | null {
  const host = uri.get_host();
  const eligible =
    uri.get_scheme() === 'https' &&
    !!host &&
    isWebsiteDomain(host) &&
    !/\.(local|localhost|internal|lan|home|test|invalid|onion|arpa)$/i.test(host) &&
    uri.get_userinfo() === null &&
    [-1, 443].includes(uri.get_port());
  return eligible ? host : null;
}

function isPreviewUrlText(text: string): boolean {
  return text.length <= 2048 && !/[\s\\<>\p{Cc}\p{Cf}]/u.test(text);
}

function previewImage(page: GLib.Uri, candidates: readonly string[]): GLib.Uri | null {
  for (const text of candidates) {
    if (!isPreviewUrlText(text)) continue;
    try {
      const image = page.parse_relative(text, GLib.UriFlags.ENCODED);
      const imageHost = previewHost(image);
      if (!imageHost) continue;
      const imagePath = image.get_path() || '/';
      const imageQuery = image.get_query();
      if (
        imageHost.toLowerCase() === page.get_host()?.toLowerCase() &&
        imagePath === (page.get_path() || '/') &&
        imageQuery === page.get_query()
      )
        continue;
      return GLib.Uri.build(
        GLib.UriFlags.ENCODED,
        'https',
        null,
        imageHost,
        443,
        imagePath,
        imageQuery,
        null,
      );
    } catch {
      continue;
    }
  }
  return null;
}

async function withDeadline<T>(
  cancel: Gio.Cancellable,
  timeoutMs: number,
  run: (stageCancel: Gio.Cancellable) => Promise<T>,
): Promise<T> {
  const stageCancel = new Gio.Cancellable();
  const cancelHandler = cancel.connect(() => stageCancel.cancel());
  const scope = new LifecycleScope();
  createManagedTimeout(scope).schedule(timeoutMs, () => stageCancel.cancel());
  try {
    return await run(stageCancel);
  } finally {
    scope.dispose();
    cancel.disconnect(cancelHandler);
  }
}

async function requestPreview<T>(
  uri: GLib.Uri,
  endpoint: Gio.InetSocketAddress,
  accept: string,
  cancel: Gio.Cancellable,
  read: (input: Gio.InputStream, headers: Soup.MessageHeaders) => Promise<T>,
): Promise<T | null> {
  const host = previewHost(uri);
  if (!host || cancel.is_cancelled()) return null;
  // Pin the validated endpoint; a second DNS lookup must not change the destination.
  const session = new Soup.Session({
    remote_connectable: endpoint,
    timeout: 5,
  });
  session.proxy_resolver = null;
  session.remove_feature_by_type(Soup.ContentDecoder.$gtype);
  let input: Gio.InputStream | null = null;
  try {
    const msg = Soup.Message.new_from_uri('GET', uri);
    msg.connect('network-event', (_message, event, stream) => {
      if (
        event === Gio.SocketClientEvent.TLS_HANDSHAKING &&
        stream instanceof Gio.TlsClientConnection
      )
        stream.server_identity = Gio.NetworkAddress.new(host, 443);
    });
    msg.add_flags(Soup.MessageFlags.NO_REDIRECT);
    msg.request_headers.replace('Accept', accept);
    msg.request_headers.replace('Accept-Encoding', 'identity');
    input = await callAsync(
      (callback) => session.send_async(msg, GLib.PRIORITY_DEFAULT, cancel, callback),
      (result) => session.send_finish(result),
    );

    const encoding = msg.response_headers.get_one('Content-Encoding');
    if (msg.status_code !== 200 || (encoding && encoding.toLowerCase() !== 'identity')) return null;
    return await read(input, msg.response_headers);
  } finally {
    session.abort();
    if (input) {
      const stream = input;
      await callAsync(
        (callback) => stream.close_async(GLib.PRIORITY_DEFAULT, null, callback),
        (result) => stream.close_finish(result),
      );
    }
  }
}

export async function fetchPreview(
  text: string,
  cancel: Gio.Cancellable,
): Promise<LinkPreview | null> {
  if (!isPreviewUrlText(text)) return null;
  const page = GLib.Uri.parse(text, GLib.UriFlags.ENCODED);
  const host = previewHost(page);
  if (!host) return null;
  const fetched = await withDeadline(cancel, PAGE_TIMEOUT_MS, async (stageCancel) => {
    const endpoint = await resolveEndpoint(host, stageCancel);
    if (!endpoint) return null;
    const metadata = await requestPreview(
      page,
      endpoint,
      'text/html',
      stageCancel,
      async (input, headers) => {
        if (!/^text\/html(?:\s*;|$)/i.test(headers.get_one('Content-Type') || '')) return null;
        const html = await readPreviewBytes(input, MAX_HTML_BYTES, stageCancel);
        return parsePreviewMetadata(new TextDecoder().decode(html));
      },
    );
    return metadata;
  });
  if (!fetched || cancel.is_cancelled()) return null;

  const metadata = fetched;
  const preview: LinkPreview = { title: metadata.title, description: metadata.description };
  const image = previewImage(page, metadata.imageCandidates);
  if (image && hasImageSandboxExecutables()) {
    try {
      const thumbnail = await withDeadline(cancel, IMAGE_TIMEOUT_MS, async (stageCancel) => {
        const imageHost = previewHost(image);
        if (!imageHost) return null;
        const imageEndpoint = await resolveEndpoint(imageHost, stageCancel);
        if (!imageEndpoint) return null;
        const downloaded = await requestPreview(
          image,
          imageEndpoint,
          'image/png,image/jpeg,image/webp',
          stageCancel,
          async (input, headers) => {
            const type = previewImageType(headers.get_one('Content-Type') || '');
            if (!type || headers.get_content_length() > PREVIEW_IMAGE_MAX_BYTES) return null;
            const bytes = await readPreviewBytes(input, PREVIEW_IMAGE_MAX_BYTES + 1, stageCancel);
            return bytes.length <= PREVIEW_IMAGE_MAX_BYTES ? { type, bytes } : null;
          },
        );
        if (!downloaded) return null;
        return decodePreviewThumbnail(downloaded.bytes, downloaded.type, stageCancel);
      });
      if (thumbnail) preview.thumbnail = thumbnail;
    } catch {
      // Sandboxing, unsupported formats, and image I/O failures leave the text preview usable.
    }
  }
  if (cancel.is_cancelled()) return null;
  return preview.title || preview.description || preview.thumbnail ? preview : null;
}
