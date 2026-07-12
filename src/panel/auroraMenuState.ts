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

export function truncateMiddle(value: string, limit: number): string {
  if (value.length <= limit) return value;

  const edgeLength = Math.max(1, Math.floor((limit - 1) / 2));
  return `${value.slice(0, edgeLength)}…${value.slice(value.length - edgeLength)}`;
}
