export type CustomMenuCommand = {
  label: string;
  command: string;
};

export function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function parseCustomCommand(raw: string): CustomMenuCommand | null {
  const value = raw.trim();
  if (!value) return null;

  const separator = value.indexOf('|');
  if (separator <= 0) return null;

  const label = value.slice(0, separator).trim();
  const command = value.slice(separator + 1).trim();
  if (!label || !command) return null;

  return { label, command };
}

export function serializeCustomCommand(command: CustomMenuCommand): string {
  return `${command.label.trim()} | ${command.command.trim()}`;
}

export function truncateMiddle(value: string, limit: number): string {
  if (value.length <= limit) return value;

  const edgeLength = Math.max(1, Math.floor((limit - 1) / 2));
  return `${value.slice(0, edgeLength)}…${value.slice(value.length - edgeLength)}`;
}

export type RecentMenuItem = { title: string; uri: string; modified: number; iconName: string };

export function parseRecentXbel(text: string, limit: number): RecentMenuItem[] {
  const items: RecentMenuItem[] = [];
  const seen = new Set<string>();
  const bookmarks =
    /<bookmark\b[^>]*href="([^"]+)"[^>]*modified="([^"]+)"[^>]*>([\s\S]*?)<\/bookmark>/g;
  let match: RegExpExecArray | null;
  while ((match = bookmarks.exec(text)) !== null) {
    const uri = decodeXml(match[1] || '');
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    const rawTitle = /<title>([\s\S]*?)<\/title>/.exec(match[3] || '')?.[1]?.trim();
    let fallback = uri;
    try {
      fallback = decodeURIComponent(uri);
    } catch {
      // Keep malformed URIs readable instead of dropping the whole recent list.
    }
    const title = rawTitle
      ? decodeXml(rawTitle)
      : fallback.startsWith('file://')
        ? fallback.slice(7).split('/').pop() || fallback
        : fallback;
    const modified = Math.floor(Date.parse(match[2] || '') / 1000);
    items.push({
      title,
      uri,
      modified: Number.isFinite(modified) ? modified : 0,
      iconName: uri.startsWith('file://') ? 'text-x-generic-symbolic' : 'emblem-web-symbolic',
    });
  }
  return items.sort((a, b) => b.modified - a.modified).slice(0, Math.max(0, limit));
}
