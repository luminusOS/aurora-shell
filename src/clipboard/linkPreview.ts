import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Soup from '@girs/soup-3.0';

import { callAsync } from '~/core/callAsync.ts';

export type LinkPreview = { title: string; description: string };

const MAX_HTML_BYTES = 64 * 1024;
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

async function readHtml(input: Gio.InputStream, cancel: Gio.Cancellable) {
  const buffer = new Uint8Array(MAX_HTML_BYTES);
  let count = 0;
  while (count < buffer.length) {
    const size = Math.min(8192, buffer.length - count);
    const bytes = await callAsync(
      (callback) => input.read_bytes_async(size, GLib.PRIORITY_DEFAULT, cancel, callback),
      (result) => input.read_bytes_finish(result),
    );
    const chunk = bytes.get_data();
    if (!chunk?.length) break;
    buffer.set(chunk, count);
    count += chunk.length;
  }
  return new TextDecoder().decode(buffer.subarray(0, count));
}

function clean(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export function parsePreview(html: string): LinkPreview | null {
  const head = html.split(/<\/head\s*>/i, 1)[0] || '';
  let title = '';
  let description = '';
  for (const [tag] of head.matchAll(/<meta\b[^<>]{1,2048}>/gi)) {
    const attrs = new Map<string, string>();
    for (const [, key, , value] of tag.matchAll(/\s+([\w:-]+)\s*=\s*(["'])(.*?)\2/gs))
      if (key && value) attrs.set(key.toLowerCase(), clean(value));
    const name = attrs.get('property') || attrs.get('name');
    const content = attrs.get('content') || '';
    if (name === 'og:title') title = content;
    if (name === 'og:description' || (name === 'description' && !description))
      description = content;
  }
  title ||= clean(head.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1] || '');
  return title || description ? { title, description } : null;
}

export async function fetchPreview(
  text: string,
  cancel: Gio.Cancellable,
): Promise<LinkPreview | null> {
  if (text.length > 2048 || /[\s\\]/u.test(text)) return null;
  const uri = GLib.Uri.parse(text, GLib.UriFlags.ENCODED);
  const host = uri.get_host();
  if (
    uri.get_scheme() !== 'https' ||
    !host ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host) ||
    /\.(local|localhost|internal|lan|home|test|invalid|onion|arpa)$/i.test(host) ||
    uri.get_userinfo() !== null ||
    ![-1, 443].includes(uri.get_port())
  )
    return null;
  const endpoint = await resolveEndpoint(host, cancel);
  if (!endpoint || cancel.is_cancelled()) return null;
  // Pin the validated endpoint; a second DNS lookup must not change the destination.
  const session = new Soup.Session({
    remote_connectable: endpoint,
    timeout: 5,
  });
  session.proxy_resolver = null;
  session.remove_feature_by_type(Soup.ContentDecoder.$gtype);
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
    const input = await callAsync(
      (callback) => session.send_async(msg, GLib.PRIORITY_DEFAULT, cancel, callback),
      (result) => session.send_finish(result),
    );
    try {
      if (
        msg.status_code !== 200 ||
        !/^text\/html(?:;|$)/i.test(msg.response_headers.get_one('Content-Type') || '')
      )
        return null;
      const encoding = msg.response_headers.get_one('Content-Encoding');
      if (encoding && encoding.toLowerCase() !== 'identity') return null;
      return parsePreview(await readHtml(input, cancel));
    } finally {
      input.close(null);
    }
  } finally {
    session.abort();
  }
}
