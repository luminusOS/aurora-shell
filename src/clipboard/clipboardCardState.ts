export type ClipboardCardKind = 'image' | 'link' | 'code' | 'text';
export type ParsedClipboardUrl = { host: string; path: string };

export function isWebsiteDomain(host: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host);
}

export function parseClipboardUrl(text: string): ParsedClipboardUrl | null {
  const trimmed = text.trim();
  if (trimmed.length > 2048 || /[\s\\]/u.test(trimmed)) return null;
  const match = /^https?:\/\/([^/:?#]+)(:\d+)?(\/[^?#]*)?(?:[?#].*)?$/i.exec(trimmed);
  if (!match?.[1] || !isWebsiteDomain(match[1])) return null;
  return { host: match[1] + (match[2] || ''), path: match[3] || '' };
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
