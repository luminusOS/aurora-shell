import '@girs/gjs';

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import Soup from '@girs/soup-3.0';

import { logger } from '~/core/logger.ts';

const LOG_PREFIX = 'ClipboardLink';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AuroraShell/1.0';
const REQUEST_TIMEOUT_S = 8;
const MAX_HTML_BYTES = 512 * 1024;

export type LinkMetadata = {
  title: string | null;
  description: string | null;
  imagePath: string | null;
};

const EMPTY: LinkMetadata = { title: null, description: null, imagePath: null };

// Session-scoped cache so reopening the panel never re-hits the network for a URL
// that was already resolved (or failed) during this Shell session.
const _cache = new Map<string, Promise<LinkMetadata>>();

/**
 * Fetches Open Graph / HTML metadata for a URL, downloading and caching the
 * preview image to disk. Network failures resolve to empty metadata rather than
 * rejecting, so callers can treat the result uniformly.
 */
export function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  let pending = _cache.get(url);
  if (!pending) {
    pending = _fetch(url);
    _cache.set(url, pending);
  }
  return pending;
}

async function _fetch(url: string): Promise<LinkMetadata> {
  let session: Soup.Session | null = null;
  try {
    const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);

    session = new Soup.Session({ user_agent: USER_AGENT });
    session.timeout = REQUEST_TIMEOUT_S;

    const message = Soup.Message.new_from_uri('GET', uri);
    message.request_headers.append(
      'Accept',
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    );

    const body = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
    if (!body) return EMPTY;

    const [contentType] = message.response_headers.get_content_type();
    if (!contentType || !contentType.includes('html')) return EMPTY;

    const data = body.get_data();
    if (!data || data.length === 0) return EMPTY;

    const slice = data.length > MAX_HTML_BYTES ? data.subarray(0, MAX_HTML_BYTES) : data;
    const html = new TextDecoder('utf-8').decode(slice);
    const meta = _parseMeta(html);

    let imagePath: string | null = null;
    if (meta.image) {
      const absolute = _resolveImageUrl(uri, meta.image);
      if (absolute) imagePath = await _downloadImage(session, absolute);
    }

    return { title: meta.title, description: meta.description, imagePath };
  } catch (e) {
    // Best-effort preview: unreachable hosts, DNS failures and timeouts are
    // routine (e.g. internal URLs). Log at debug so we don't spam CRITICAL +
    // stack traces; the card just renders without a preview.
    logger.debug('Failed to fetch link metadata', { prefix: LOG_PREFIX }, e as Error);
    return EMPTY;
  } finally {
    session?.abort();
  }
}

type RawMeta = { title: string | null; description: string | null; image: string | null };

function _parseMeta(html: string): RawMeta {
  const meta: Record<string, string> = {};
  const metaRegex = /<meta\s+(?:property|name)="([^"]*?)"\s+content="([^"]*?)"/gim;
  const reverseRegex = /<meta\s+content="([^"]*?)"\s+(?:property|name)="([^"]*?)"/gim;
  for (const match of html.matchAll(metaRegex)) meta[match[1]!.toLowerCase()] = match[2]!;
  for (const match of html.matchAll(reverseRegex)) meta[match[2]!.toLowerCase()] = match[1]!;

  let title = meta['og:title'] ?? meta['twitter:title'] ?? meta['title'] ?? null;
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>\s*([\s\S]*?)\s*<\/title>/i);
    title = titleMatch ? titleMatch[1]! : null;
  }

  const description =
    meta['og:description'] ?? meta['twitter:description'] ?? meta['description'] ?? null;

  const image =
    meta['og:image'] ??
    meta['og:image:url'] ??
    meta['og:image:secure_url'] ??
    meta['twitter:image'] ??
    meta['image'] ??
    null;

  return {
    title: title ? _decodeHtml(title).trim() || null : null,
    description: description ? _decodeHtml(description).trim() || null : null,
    image: image ? image.trim() || null : null,
  };
}

function _resolveImageUrl(base: GLib.Uri, image: string): string | null {
  try {
    return base.parse_relative(image, GLib.UriFlags.NONE).to_string();
  } catch {
    return image.startsWith('http://') || image.startsWith('https://') ? image : null;
  }
}

async function _downloadImage(session: Soup.Session, url: string): Promise<string | null> {
  try {
    const path = _cacheImagePath(url);
    if (!path) return null;

    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null)) return path;

    const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
    const message = Soup.Message.new_from_uri('GET', uri);
    message.request_headers.append(
      'Accept',
      'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
    );

    const body = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
    if (!body) return null;

    const [contentType] = message.response_headers.get_content_type();
    if (!contentType || !contentType.startsWith('image/')) return null;

    const data = body.get_data();
    if (!data || data.length === 0) return null;

    file.replace_contents(data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    return path;
  } catch (e) {
    // Same best-effort policy as _fetch: a failed image download just means no
    // thumbnail, not an error worth a CRITICAL log.
    logger.debug('Failed to cache link image', { prefix: LOG_PREFIX }, e as Error);
    return null;
  }
}

function _cacheImagePath(url: string): string | null {
  const checksum = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1);
  if (!checksum) return null;

  const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'aurora-shell', 'link-previews']);
  GLib.mkdir_with_parents(dir, 0o700);
  return GLib.build_filenamev([dir, checksum + '.img']);
}

const HTML_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
  nbsp: ' ',
};

function _decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? whole);
}
