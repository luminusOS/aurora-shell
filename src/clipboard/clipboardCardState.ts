export type ClipboardCardKind = 'image' | 'link' | 'code' | 'text';
export type ParsedClipboardUrl = { host: string; path: string };

export function parseClipboardUrl(text: string): ParsedClipboardUrl | null {
  const trimmed = text.trim();
  if (trimmed.includes('\n') || trimmed.includes(' ') || trimmed.length > 2048) return null;
  if (!/^https?:\/\//.test(trimmed)) return null;

  const withoutScheme = trimmed.replace(/^https?:\/\//, '');
  const slashIndex = withoutScheme.indexOf('/');
  const host = slashIndex === -1 ? withoutScheme : withoutScheme.slice(0, slashIndex);
  const rawPath = slashIndex === -1 ? '' : withoutScheme.slice(slashIndex);
  if (!host || !host.includes('.')) return null;

  const [path = ''] = rawPath.split('?');
  return { host, path };
}

export function isClipboardCode(text: string): boolean {
  const lines = text.split('\n');
  if (lines.length < 2) return false;

  let score = 0;
  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\s{2,}/.test(line)) {
      score++;
    }
    if (/[{};]\s*$/.test(line)) {
      score++;
    }
    if (/\\$/.test(trimmed)) {
      score++;
    }
    if (/^\s*(\/\/|#|\/\*|\*)/.test(line)) {
      score++;
    }
    if (/^(curl|wget|git|npm|yarn|pnpm|just|docker|kubectl|ssh|sudo)\b/.test(trimmed)) {
      score += 2;
    }
    if (/^-[A-Za-z]/.test(trimmed)) {
      score++;
    }
    if (/^(https?:\/\/|\/[\w.-]+|\w+=)/.test(trimmed)) {
      score++;
    }
    if (
      /^\s*(function|class|def|import|export|const|let|var|return|if|else|for|while|try|catch|async|await|public|private|protected)\b/.test(
        line,
      )
    )
      score += 2;
  }
  return score >= 3;
}

export function classifyClipboardCard(kind: string, text: string): ClipboardCardKind {
  if (kind === 'image') return 'image';
  if (parseClipboardUrl(text)) return 'link';

  return isClipboardCode(text) ? 'code' : 'text';
}

export function truncateClipboardText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
