const HTTP_SCHEME_REGEX = /\bhttps?:\/\//gi;
const TRAILING_PUNCTUATION = /[.,;!?]+$/;
const QUERY_CONTINUATION = /^[?&#=]/;
const QUERY_KEY = /^[\p{L}\p{N}._~-]+=/u;
const QUERY_NAME = /^[\p{L}\p{N}._~-]+$/u;

type ExtractedUrl = {
  url: string;
  end: number;
};

function _isWhitespace(character: string): boolean {
  return /\s/u.test(character);
}

function _isHardBoundary(character: string): boolean {
  return (
    character === '<' ||
    character === '>' ||
    character === '"' ||
    character === "'" ||
    character === '`' ||
    character === '|' ||
    character === '\\' ||
    character === '^' ||
    character === '{' ||
    character === '}'
  );
}

function _readToken(text: string, start: number): string {
  let end = start;
  while (
    end < text.length &&
    !_isWhitespace(text.charAt(end)) &&
    !_isHardBoundary(text.charAt(end))
  )
    end += 1;
  return text.slice(start, end);
}

function _hasLineBreak(value: string): boolean {
  return value.includes('\n') || value.includes('\r');
}

function _continuesPercentEscape(url: string, token: string): boolean {
  if (url.endsWith('%')) return /^[0-9a-f]{2}/i.test(token);
  return /%[0-9a-f]$/i.test(url) && /^[0-9a-f]/i.test(token);
}

function _hasUriContinuationSyntax(token: string): boolean {
  return /[/#?&=_%~-]/.test(token);
}

function _endsAtLineBoundary(text: string, tokenStart: number, token: string): boolean {
  let cursor = tokenStart + token.length;
  while (cursor < text.length) {
    const character = text.charAt(cursor);
    if (character === '\n' || character === '\r') return true;
    if (!_isWhitespace(character)) return false;
    cursor += 1;
  }
  return true;
}

function _continuesLongNumber(url: string, token: string, endsAtLineBoundary: boolean): boolean {
  if (!endsAtLineBoundary) return false;

  const previousDigits = url.match(/\d+$/);
  const nextDigits = token.match(/^\d+/);
  if (!previousDigits || !nextDigits) return false;

  return previousDigits[0].length + nextDigits[0].length >= 9;
}

function _shouldJoin(
  url: string,
  whitespace: string,
  token: string,
  assignmentFollows: boolean,
  endsAtLineBoundary: boolean,
): boolean {
  if (!token) return false;
  if (/^https?:\/\//i.test(token)) return false;
  if (_continuesPercentEscape(url, token)) return true;
  if (QUERY_CONTINUATION.test(token)) return true;

  const lastCharacter = url.slice(-1);
  if (lastCharacter === '?' || lastCharacter === '&') {
    return QUERY_KEY.test(token) || (QUERY_NAME.test(token) && assignmentFollows);
  }
  if (lastCharacter === '=') {
    return (!_hasLineBreak(whitespace) || endsAtLineBoundary) && /^[^\s<>'"`]+$/.test(token);
  }

  if (!_hasLineBreak(whitespace)) return false;
  if (/[/#_~-]/.test(lastCharacter)) {
    return (
      /^[\p{L}\p{N}%]/u.test(token) && (_hasUriContinuationSyntax(token) || endsAtLineBoundary)
    );
  }
  return _continuesLongNumber(url, token, endsAtLineBoundary);
}

function _assignmentFollows(text: string, tokenStart: number, token: string): boolean {
  let cursor = tokenStart + token.length;
  while (cursor < text.length && _isWhitespace(text.charAt(cursor))) cursor += 1;
  return text.charAt(cursor) === '=';
}

function _readDelimitedUrl(text: string, start: number, closingIndex: number): ExtractedUrl {
  return {
    url: text.slice(start, closingIndex).replace(/\s+/gu, ''),
    end: closingIndex + 1,
  };
}

function _readBareUrl(text: string, start: number): ExtractedUrl {
  let url = '';
  let cursor = start;

  while (cursor < text.length) {
    const character = text.charAt(cursor);
    if (_isHardBoundary(character)) break;

    if (!_isWhitespace(character)) {
      url += character;
      cursor += 1;
      continue;
    }

    const whitespaceStart = cursor;
    while (cursor < text.length && _isWhitespace(text.charAt(cursor))) cursor += 1;
    const whitespace = text.slice(whitespaceStart, cursor);
    const token = _readToken(text, cursor);
    const assignmentFollows = _assignmentFollows(text, cursor, token);
    const endsAtLineBoundary = _endsAtLineBoundary(text, cursor, token);

    if (!_shouldJoin(url, whitespace, token, assignmentFollows, endsAtLineBoundary)) break;
  }

  return { url, end: cursor };
}

function _trimUnbalancedClosing(url: string, opening: string, closing: string): string {
  let trimmed = url;
  const openingCount = Array.from(trimmed).filter((character) => character === opening).length;
  let closingCount = Array.from(trimmed).filter((character) => character === closing).length;

  while (trimmed.endsWith(closing) && closingCount > openingCount) {
    trimmed = trimmed.slice(0, -1);
    closingCount -= 1;
  }
  return trimmed;
}

function _cleanUrl(url: string): string {
  let cleaned = url.replace(TRAILING_PUNCTUATION, '');
  cleaned = _trimUnbalancedClosing(cleaned, '(', ')');
  cleaned = _trimUnbalancedClosing(cleaned, '[', ']');
  cleaned = _trimUnbalancedClosing(cleaned, '{', '}');
  return cleaned;
}

function _isValidAuthority(authority: string): boolean {
  if (!authority || authority.includes('@')) return false;

  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    if (closingBracket < 2) return false;
    if (!/^[0-9a-f:.]+$/i.test(authority.slice(1, closingBracket))) return false;
    const suffix = authority.slice(closingBracket + 1);
    if (!suffix) return true;
    if (!/^:\d{1,5}$/.test(suffix)) return false;
    return Number(suffix.slice(1)) <= 65535;
  }

  const separator = authority.lastIndexOf(':');
  const hasPort = separator >= 0;
  const hostname = hasPort ? authority.slice(0, separator) : authority;
  const port = hasPort ? authority.slice(separator + 1) : '';
  if (hasPort && (!/^\d{1,5}$/.test(port) || Number(port) > 65535)) return false;
  if (!hostname || hostname.startsWith('.') || hostname.endsWith('.') || hostname.includes('..'))
    return false;

  return hostname.split('.').every((label) => {
    return (
      Boolean(label) && !label.startsWith('-') && !label.endsWith('-') && !/[\s/?#]/u.test(label)
    );
  });
}

function _isValidHttpUrl(url: string): boolean {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 4) return false;

  const authorityStart = schemeEnd + 3;
  const pathStart = url.slice(authorityStart).search(/[/?#]/);
  const authorityEnd = pathStart < 0 ? url.length : authorityStart + pathStart;
  return _isValidAuthority(url.slice(authorityStart, authorityEnd));
}

function _readUrl(text: string, start: number): ExtractedUrl {
  let previous = start - 1;
  while (previous >= 0 && _isWhitespace(text.charAt(previous))) previous -= 1;

  if (previous >= 0 && text.charAt(previous) === '<') {
    const closingIndex = text.indexOf('>', start);
    if (closingIndex >= 0) return _readDelimitedUrl(text, start, closingIndex);
  }

  return _readBareUrl(text, start);
}

export function extractHttpUrls(text: string): string[] {
  const urls: string[] = [];
  HTTP_SCHEME_REGEX.lastIndex = 0;

  let match = HTTP_SCHEME_REGEX.exec(text);
  while (match) {
    const extracted = _readUrl(text, match.index);
    const url = _cleanUrl(extracted.url);
    if (_isValidHttpUrl(url)) urls.push(url);

    HTTP_SCHEME_REGEX.lastIndex = Math.max(extracted.end, match.index + match[0].length);
    match = HTTP_SCHEME_REGEX.exec(text);
  }

  return urls;
}
