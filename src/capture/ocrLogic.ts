import type { Point } from '~/capture/annotationModel.ts';

export type OcrWord = {
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
  lineKey: string;
  text: string;
};

export type OcrResult = {
  words: OcrWord[];
  text: string;
};

export type OcrActionRect = { x: number; y: number; width: number; height: number };
export type OcrActionSize = { width: number; height: number };
export type WebSearchEngine = 'google' | 'duckduckgo' | 'bing';

const DEFAULT_WEB_SEARCH_ENGINE: WebSearchEngine = 'duckduckgo';
const WEB_SEARCH_URLS: Readonly<Record<WebSearchEngine, string>> = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
};

const LOCALE_TO_TESSERACT: Readonly<Record<string, string>> = {
  ar: 'ara',
  de: 'deu',
  en: 'eng',
  es: 'spa',
  fr: 'fra',
  hi: 'hin',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  nl: 'nld',
  pl: 'pol',
  pt: 'por',
  ru: 'rus',
  tr: 'tur',
  uk: 'ukr',
  zh: 'chi_sim',
};

export function parseLanguageOverride(value: string): string[] {
  return uniqueLanguageCodes(value.split(/[+,\s]+/));
}

export function chooseOcrLanguages(
  override: string,
  languageNames: readonly string[],
  installed: readonly string[],
): string[] {
  const available = new Set(installed);
  const requested = parseLanguageOverride(override);
  if (requested.length > 0) {
    const supported = requested.filter((language) => available.has(language));
    if (supported.length > 0) return supported;
  }

  const automatic: string[] = [];
  for (const name of languageNames) {
    const normalized = name.split('.')[0]!.split('@')[0]!.replace('-', '_').toLowerCase();
    const locale = normalized.split('_')[0]!;
    const mapped = LOCALE_TO_TESSERACT[locale];
    if (mapped && available.has(mapped)) automatic.push(mapped);
  }
  if (available.has('eng')) automatic.push('eng');

  const selected = uniqueLanguageCodes(automatic);
  if (selected.length > 0) return selected;
  return installed.length > 0 ? [installed[0]!] : [];
}

export function parseTesseractLanguages(output: string): string[] {
  return uniqueLanguageCodes(
    output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.toLowerCase().startsWith('list of available')),
  ).sort();
}

export function parseTesseractTsv(tsv: string, scale: number, origin: Point): OcrResult {
  if (!Number.isFinite(scale) || scale <= 0) return { words: [], text: '' };

  const words: OcrWord[] = [];
  for (const row of tsv.split('\n').slice(1)) {
    if (!row.trim()) continue;
    const columns = row.replace(/\r$/, '').split('\t');
    if (columns.length < 12) continue;

    const level = Number.parseInt(columns[0]!, 10);
    const left = Number.parseInt(columns[6]!, 10);
    const top = Number.parseInt(columns[7]!, 10);
    const width = Number.parseInt(columns[8]!, 10);
    const height = Number.parseInt(columns[9]!, 10);
    const confidence = Number.parseFloat(columns[10]!);
    const text = columns.slice(11).join('\t').trim();

    if (
      level !== 5 ||
      !text ||
      ![left, top, width, height, confidence].every(Number.isFinite) ||
      confidence < 0 ||
      width <= 0 ||
      height <= 0
    )
      continue;

    words.push({
      bounds: {
        x: origin.x + left / scale,
        y: origin.y + top / scale,
        width: width / scale,
        height: height / scale,
      },
      confidence,
      lineKey: columns.slice(1, 5).join(':'),
      text,
    });
  }

  const lines: string[] = [];
  let currentKey = '';
  for (const word of words) {
    if (word.lineKey !== currentKey) {
      lines.push(word.text);
      currentKey = word.lineKey;
    } else {
      lines[lines.length - 1] += ` ${word.text}`;
    }
  }
  return { words, text: lines.join('\n') };
}

export function normalizeWebSearchEngine(value: string): WebSearchEngine {
  return value === 'google' || value === 'duckduckgo' || value === 'bing'
    ? value
    : DEFAULT_WEB_SEARCH_ENGINE;
}

export function buildWebSearchUri(text: string, engine?: string): string {
  return `${WEB_SEARCH_URLS[normalizeWebSearchEngine(engine || '')]}${encodeURIComponent(text.trim())}`;
}

export function placeOcrActionBelow(
  selection: OcrActionRect,
  action: OcrActionSize,
  viewport: OcrActionSize,
  gap = 12,
  margin = 12,
): Point {
  const centerX = selection.x + selection.width / 2;
  const maxX = Math.max(margin, viewport.width - action.width - margin);
  const x = Math.max(margin, Math.min(maxX, Math.round(centerX - action.width / 2)));
  const belowY = Math.round(selection.y + selection.height + gap);
  const aboveY = Math.round(selection.y - action.height - gap);
  const y = belowY + action.height <= viewport.height - margin ? belowY : Math.max(margin, aboveY);
  return { x, y };
}

function uniqueLanguageCodes(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const code = value.trim();
    if (!/^[A-Za-z0-9_]+$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}
