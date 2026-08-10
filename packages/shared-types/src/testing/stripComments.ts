/**
 * Blank the comments out of a JavaScript/TypeScript source file, so a repo gate
 * can scan CODE without matching the prose that describes it.
 *
 * ## Why this exists, and why it is not two regexes
 *
 * Two gates in this repository scan comment-stripped source — the currency and
 * locale gate (`packages/frontend/__tests__/noHardcodedCurrency.test.ts`, #357)
 * and the Mongo reintroduction gate
 * (`packages/backend/__tests__/unit/mongoUnreachable.test.ts`). Both stripped
 * comments with the same pair of regexes, and both were wrong in the direction
 * that reports a CLEAN tree:
 *
 *  1. **`line.indexOf('//')` truncates a line at a URL's scheme separator.** The
 *     `//` in `'https://example.test'` is not a comment, so everything from it
 *     to the end of the line was thrown away — including, on a real line of
 *     `packages/backend/config.ts`, the whole of a template literal.
 *  2. **A block-comment OPENER mentioned inside a `//` comment was treated as a
 *     real opener**, and the non-greedy block-comment regex then blanked
 *     everything up to the next terminator. The measured instance is
 *     `packages/backend/config.ts:383`, whose line comment mentions the route
 *     glob for the local image store; the `/` and `*` at the end of that glob
 *     open a block that the regex closes 108 lines later, taking 109 lines of
 *     real configuration with it.
 *
 * Both faults DELETE code before the gate ever sees it, so a violation sitting
 * in the blanked region passes silently. For the Mongo gate that is the whole
 * point of the file: a reintroduced `mongoose` import inside such a region would
 * not fail the build.
 *
 * ## What this does instead
 *
 * One pass, tracking the states a comment can hide inside: string literals
 * (single, double, and template literals with nested interpolation), regular
 * expression literals, and comments themselves.
 *
 * It **blanks rather than deletes** — every comment character becomes a space
 * and every newline is kept, so the output has the same length and the same line
 * numbering as the input. Both gates report `file:line`, and a stripper that
 * shifts lines makes every location it reports wrong.
 *
 * ## Known limits, stated rather than papered over
 *
 * Deciding whether `/` opens a regular expression or is a division sign needs a
 * parser; this uses the standard heuristic of looking at the preceding
 * significant token. A `/` following `)` is read as division, so `if (x) /re/`
 * would be misread — a shape that does not appear in this repository. Dropping
 * regex tracking altogether was measured against the tree and does lose code
 * (7 files, 10 lines), which is why the heuristic is here rather than omitted.
 *
 * Measured on 2026-08-10 at bf3ef48b, the two regexes this replaces hid 1,047
 * lines of real code across 128 of the 952 files the currency gate scans, and
 * 227 lines across 21 of the 254 the Mongo gate scans.
 *
 * JSX text is not JavaScript, and a `//` inside it is not a comment. This
 * treats it as code, which is the safe direction: it can only leave text in for
 * a gate to match, never take code out.
 */

/** Characters after which a `/` starts a regular expression rather than dividing. */
const REGEX_CAN_FOLLOW = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^',
]);

/** Keywords after which a `/` starts a regular expression. */
const REGEX_CAN_FOLLOW_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await',
]);

/**
 * Where we are in the nesting of template literals.
 *
 * A template can contain an interpolation, which can contain another template.
 * The interpolation frame counts braces so that an object literal inside it
 * (`${ { a: 1 } }`) does not read as the end of the interpolation.
 */
type Frame = { readonly kind: 'template' } | { kind: 'interpolation'; depth: number };

const IDENTIFIER = /[A-Za-z0-9_$]/;
const WHITESPACE = /\s/;

/**
 * Replace every comment in `source` with spaces, preserving length, newlines and
 * therefore line numbers. Code, string literals and regex literals are returned
 * untouched.
 */
export function stripComments(source: string): string {
  const out = source.split('');
  const stack: Frame[] = [];
  let index = 0;
  let lastSignificant: string | undefined;
  let lastWord = '';

  const blank = (from: number, to: number): void => {
    for (let at = from; at < to && at < out.length; at += 1) {
      if (out[at] !== '\n') out[at] = ' ';
    }
  };

  const inTemplate = (): boolean => stack.length > 0 && stack[stack.length - 1].kind === 'template';

  /** Consume a quoted string, honouring escapes; a newline ends it (unterminated). */
  const readQuoted = (quote: string): void => {
    index += 1;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') { index += 2; continue; }
      if (char === '\n' || char === quote) { index += 1; return; }
      index += 1;
    }
  };

  /** Consume a regex literal; an unescaped `/` inside `[...]` does not close it. */
  const readRegex = (): void => {
    index += 1;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') { index += 2; continue; }
      if (char === '\n') { index += 1; return; }
      if (char === '[') {
        index += 1;
        while (index < source.length && source[index] !== ']' && source[index] !== '\n') {
          index += source[index] === '\\' ? 2 : 1;
        }
        index += 1;
        continue;
      }
      if (char === '/') { index += 1; return; }
      index += 1;
    }
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (inTemplate()) {
      if (char === '\\') { index += 2; continue; }
      if (char === '$' && next === '{') {
        stack.push({ kind: 'interpolation', depth: 0 });
        index += 2;
        lastSignificant = '{';
        lastWord = '';
        continue;
      }
      if (char === '`') { stack.pop(); index += 1; lastSignificant = '`'; lastWord = ''; continue; }
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      const newline = source.indexOf('\n', index);
      const stop = newline === -1 ? source.length : newline;
      blank(index, stop);
      index = stop;
      continue;
    }

    if (char === '/' && next === '*') {
      const close = source.indexOf('*/', index + 2);
      const stop = close === -1 ? source.length : close + 2;
      blank(index, stop);
      index = stop;
      continue;
    }

    if (char === "'" || char === '"') {
      readQuoted(char);
      lastSignificant = char;
      lastWord = '';
      continue;
    }

    if (char === '`') {
      stack.push({ kind: 'template' });
      index += 1;
      continue;
    }

    if (char === '/') {
      const opensRegex =
        lastSignificant === undefined ||
        REGEX_CAN_FOLLOW.has(lastSignificant) ||
        REGEX_CAN_FOLLOW_KEYWORD.has(lastWord);
      if (opensRegex) { readRegex(); lastSignificant = '/'; lastWord = ''; continue; }
    }

    const frame = stack[stack.length - 1];
    if (frame !== undefined && frame.kind === 'interpolation') {
      if (char === '{') frame.depth += 1;
      else if (char === '}') {
        if (frame.depth === 0) { stack.pop(); index += 1; lastSignificant = '}'; lastWord = ''; continue; }
        frame.depth -= 1;
      }
    }

    if (WHITESPACE.test(char)) {
      if (char === '\n') lastWord = '';
      index += 1;
      continue;
    }

    if (IDENTIFIER.test(char)) {
      let end = index;
      while (end < source.length && IDENTIFIER.test(source[end])) end += 1;
      lastWord = source.slice(index, end);
      lastSignificant = source[end - 1];
      index = end;
      continue;
    }

    lastSignificant = char;
    lastWord = '';
    index += 1;
  }

  return out.join('');
}
