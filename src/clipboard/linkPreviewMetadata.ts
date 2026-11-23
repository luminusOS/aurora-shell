export type LinkPreviewMetadata = {
  title: string;
  description: string;
  imageCandidates: readonly string[];
};

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|#39);/gi, (entity) => {
    switch (entity.toLowerCase()) {
      case '&amp;':
        return '&';
      case '&quot;':
        return '"';
      default:
        return "'";
    }
  });
}

function cleanText(value: string): string {
  return decodeEntities(value)
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export function parsePreviewMetadata(html: string): LinkPreviewMetadata | null {
  let title = '';
  let fallbackTitle = '';
  let description = '';
  let ogImage = '';
  let twitterImage = '';
  let rawTag = '';
  const markup = /<!--[\s\S]*?(?:-->|$)|<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (let token = markup.exec(html); token; token = markup.exec(html)) {
    const [tag, tagName] = token;
    if (!tagName) continue;
    const name = tagName.toLowerCase();
    const closing = tag.startsWith('</');
    if (rawTag) {
      if (closing && name === rawTag) rawTag = '';
      continue;
    }
    if ((closing && name === 'head') || name === 'body') break;
    if (!closing && ['script', 'style', 'title', 'noscript'].includes(name)) {
      rawTag = name;
      if (name === 'title') {
        fallbackTitle = cleanText(
          html.slice(markup.lastIndex).match(/^([^<]*)<\/title>/i)?.[1] || '',
        );
      }
      continue;
    }
    if (!closing && !['html', 'head', 'meta', 'link', 'base'].includes(name)) break;
    if (closing || name !== 'meta' || tag.length > 2048) continue;

    const attrs = new Map<string, string>();
    for (const [, key, , value] of tag.matchAll(/\s+([\w:-]+)\s*=\s*(["'])(.*?)\2/gs))
      if (key && value !== undefined && !attrs.has(key.toLowerCase()))
        attrs.set(key.toLowerCase(), value);
    const property = (attrs.get('property') || attrs.get('name') || '').trim().toLowerCase();
    const content = attrs.get('content') || '';
    if (property === 'og:title') title = cleanText(content);
    if (property === 'og:description' || (property === 'description' && !description))
      description = cleanText(content);
    if (property === 'og:image' && !ogImage) ogImage = decodeEntities(content).trim();
    if (property === 'twitter:image' && !twitterImage)
      twitterImage = decodeEntities(content).trim();
  }
  title ||= fallbackTitle;
  const imageCandidates = [ogImage, twitterImage].filter(Boolean);
  return title || description || imageCandidates.length
    ? { title, description, imageCandidates }
    : null;
}
