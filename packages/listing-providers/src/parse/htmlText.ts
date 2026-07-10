/**
 * HTML → plain-text for listing copy fields (description, contact names, …).
 * ONE chokepoint — providers pass through portal HTML; ingest strips it here.
 */

const LINE_BREAK_TAG =
  /<\s*br\s*\/?\s*>|<\s*\/\s*(?:p|div|li|h[1-6]|tr|blockquote|section|article)\s*>/gi;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named ?? match;
  });
}

/**
 * Strip HTML tags, decode entities, and collapse whitespace while preserving
 * readable paragraph breaks from `<br>` / block closers.
 */
export function stripHtmlToPlainText(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  let text = trimmed.replace(LINE_BREAK_TAG, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeHtmlEntities(text);

  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text || undefined;
}
