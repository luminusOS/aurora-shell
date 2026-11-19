import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Soup from '@girs/soup-3.0';

export type LinkPreview = { title: string; description: string };

function publicAddress(address: Gio.InetAddress): boolean {
  const octets = address.to_string().split('.').map(Number);
  if (octets.length !== 4) return false;
  const [a, b] = octets;
  return (
    !!a &&
    a < 224 &&
    ![10, 127].includes(a) &&
    !(a === 100 && b! >= 64 && b! <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b! >= 16 && b! <= 31) &&
    !(a === 192 && [0, 2, 88, 168].includes(b!)) &&
    !(a === 198 && [18, 19, 51].includes(b!)) &&
    !(a === 203 && b === 0)
  );
}

function clean(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
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
  const uri = GLib.Uri.parse(text, GLib.UriFlags.ENCODED);
  const host = uri.get_host();
  if (
    uri.get_scheme() !== 'https' ||
    !host ||
    !/^[\w.-]+\.[a-z]{2,}$/i.test(host) ||
    /\.(local|localhost|internal|lan|home|test|invalid)$/i.test(host) ||
    uri.get_userinfo() !== null ||
    ![-1, 443].includes(uri.get_port())
  )
    return null;
  const addresses = await new Promise<Gio.InetAddress[]>((resolve, reject) => {
    const resolver = Gio.Resolver.get_default();
    resolver.lookup_by_name_async(host, cancel, (_, result) => {
      try {
        resolve(resolver.lookup_by_name_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
  const ip = addresses.find(publicAddress);
  if (!ip || cancel.is_cancelled()) return null;
  // Pin the validated endpoint; a second DNS lookup must not change the destination.
  const session = new Soup.Session({
    remote_connectable: Gio.InetSocketAddress.new(ip, 443),
    timeout: 5,
  });
  session.proxy_resolver = null;
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
    const input = await new Promise<Gio.InputStream>((resolve, reject) => {
      session.send_async(msg, GLib.PRIORITY_DEFAULT, cancel, (_, result) => {
        try {
          resolve(session.send_finish(result));
        } catch (error) {
          reject(error);
        }
      });
    });
    try {
      if (
        msg.status_code !== 200 ||
        !/^text\/html(?:;|$)/i.test(msg.response_headers.get_one('Content-Type') || '')
      )
        return null;
      const buffer = new Uint8Array(64 * 1024);
      let count = 0;
      while (count < buffer.length) {
        const bytes = await new Promise<GLib.Bytes>((resolve, reject) => {
          input.read_bytes_async(
            Math.min(8192, buffer.length - count),
            GLib.PRIORITY_DEFAULT,
            cancel,
            (_, result) => {
              try {
                resolve(input.read_bytes_finish(result));
              } catch (error) {
                reject(error);
              }
            },
          );
        });
        const chunk = bytes.get_data();
        if (!chunk?.length) break;
        buffer.set(chunk, count);
        count += chunk.length;
      }
      return parsePreview(new TextDecoder().decode(buffer.subarray(0, count)));
    } finally {
      input.close(null);
    }
  } finally {
    session.abort();
  }
}
