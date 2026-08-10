/**
 * The shared comment stripper, and the two regressions that produced it.
 *
 * Two repo gates scan comment-stripped source — the currency and locale gate in
 * this directory (#357) and the backend's Mongo reintroduction gate. Both used
 * the same pair of regexes, and both were wrong in the direction that reports a
 * CLEAN tree. The cases below pin each fault against the exact naive code that
 * had it, so a future "simplification" back to two regexes fails loudly instead
 * of quietly reopening a blind spot.
 *
 * These live in the FRONTEND suite for the same reason the currency gate does:
 * this CI job needs no database, and `shared-types` has no runner of its own.
 */
import { stripComments } from '@homiio/shared-types/testing/stripComments';

/**
 * The stripper `packages/backend/__tests__/unit/mongoUnreachable.test.ts`
 * carried, verbatim. Reproduced so the regression is pinned against the real
 * thing rather than a paraphrase of it.
 */
function naiveMongoStripper(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The stripper `packages/frontend/__tests__/noHardcodedCurrency.test.ts`
 * carried, verbatim.
 */
function naiveCurrencyStripper(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => match.replace(/[^\n]/gu, ''))
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//');
      return index === -1 ? line : line.slice(0, index);
    })
    .join('\n');
}

/** Non-empty, trimmed lines — what a gate actually matches against. */
function codeLines(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

describe('stripComments', () => {
  describe('REGRESSION: a URL is not a comment', () => {
    // Verbatim from `packages/backend/config.ts` — the line that sent the
    // currency gate's stripper off a cliff. Everything from `//` onward was
    // discarded, taking the whole template literal with it.
    const line = "  publicUrl: process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || '4130'}`,";

    it('keeps the whole line', () => {
      expect(stripComments(line)).toBe(line);
    });

    it('is the fault the naive stripper had', () => {
      // Pin the OLD behaviour too. If someone reverts the implementation, the
      // case above fails; if someone deletes this one, the reason the case
      // above exists stops being visible.
      expect(naiveCurrencyStripper(line)).toBe('  publicUrl: process.env.PUBLIC_API_URL || `http:');
      expect(naiveCurrencyStripper(line)).not.toContain('localhost');
    });

    it('survives a URL in every quoting style', () => {
      for (const source of [
        "const a = 'https://example.test/x';",
        'const b = "https://example.test/x";',
        'const c = `https://example.test/x`;',
      ]) {
        expect(stripComments(source)).toBe(source);
      }
    });
  });

  describe('REGRESSION: a block opener inside a line comment does not open a block', () => {
    // Verbatim from `packages/backend/config.ts:383`. The route glob for the
    // local image store ends in `/` `*`, which the naive regex read as a block
    // comment opener; it then closed at the next `*/` 108 lines later and
    // blanked 109 lines of real configuration.
    const source = [
      '  // self-hosted local image store served at `/api/images/file/*` when object',
      '  // storage (S3) is not configured.',
      "  publicUrl: process.env.PUBLIC_API_URL || 'https://api.homiio.com',",
      '  rateLimit: {',
      '    windowMs: 15 * 60 * 1000,',
      '  },',
      '  /* a genuine block comment, which is where the naive regex closed */',
      '  logLevel: process.env.LOG_LEVEL,',
    ].join('\n');

    it('keeps every line of real code', () => {
      expect(codeLines(stripComments(source))).toEqual([
        "publicUrl: process.env.PUBLIC_API_URL || 'https://api.homiio.com',",
        'rateLimit: {',
        'windowMs: 15 * 60 * 1000,',
        '},',
        'logLevel: process.env.LOG_LEVEL,',
      ]);
    });

    it('is the fault the naive stripper had — it ate the code between', () => {
      const naive = naiveMongoStripper(source);
      expect(naive).not.toContain('publicUrl');
      expect(naive).not.toContain('windowMs');
      expect(naive).not.toContain('rateLimit');
      // And what it left behind is only the code AFTER the bogus block closed.
      expect(codeLines(naive)).toEqual(['logLevel: process.env.LOG_LEVEL,']);
    });

    it('still removes a genuine block comment', () => {
      const stripped = stripComments(source);
      expect(stripped).not.toContain('a genuine block comment');
      expect(stripped).not.toContain('self-hosted local image store');
    });
  });

  describe('comment markers inside string literals', () => {
    it('a block opener inside a string does not open a block', () => {
      // A later, genuine `*/` is what gives the bogus opener something to close
      // against — the same shape as the config.ts instance above. Without one
      // the naive regex matches nothing, so a fixture lacking it would pass
      // under the broken stripper too and prove nothing.
      const source = [
        "const marker = '/*';",
        'const real = 1;',
        '/** a later doc comment */',
        'const after = 2;',
      ].join('\n');

      expect(codeLines(stripComments(source))).toEqual([
        "const marker = '/*';",
        'const real = 1;',
        'const after = 2;',
      ]);

      // The naive stripper paired the string's `/*` with that doc comment's
      // `*/` and swallowed the real code sitting between them.
      const naive = naiveMongoStripper(source);
      expect(naive).not.toContain('const real = 1;');
      // What it leaves is the half of the opening line before the string's
      // `/*`, then nothing until the doc comment's `*/`.
      expect(codeLines(naive)).toEqual(["const marker = '", 'const after = 2;']);
    });

    it('a block closer inside a string does not close one', () => {
      const source = ['const kept = 1;', 'const marker = "*/";'].join('\n');
      expect(stripComments(source)).toBe(source);
    });

    it('a double slash inside a string is not a comment', () => {
      for (const source of ['const s = "a//b";', "const s = 'a//b';", 'const s = `a//b`;']) {
        expect(stripComments(source)).toBe(source);
      }
    });

    it('an escaped quote does not end the string early', () => {
      const source = "const s = 'it\\'s // not a comment';";
      expect(stripComments(source)).toBe(source);
    });

    it('a comment marker inside a template interpolation IS a comment', () => {
      const source = 'const t = `${value /* real */}`;';
      const stripped = stripComments(source);
      expect(stripped).not.toContain('real');
      expect(stripped).toContain('${value');
    });

    it('an object literal inside an interpolation does not end it', () => {
      const source = 'const t = `${fn({ a: 1 })} // still a string`;';
      expect(stripComments(source)).toBe(source);
    });
  });

  describe('regex literals', () => {
    it('keeps a regex containing escaped slashes', () => {
      const source = ['const r = /https?:\\/\\//;', 'const kept = 1;'].join('\n');
      expect(stripComments(source)).toBe(source);
    });

    it('keeps a regex whose character class holds a slash and a star', () => {
      const source = ['const r = /[/*]/;', 'const kept = 1;'].join('\n');
      expect(stripComments(source)).toBe(source);
    });

    it('still treats division as division', () => {
      const source = 'const q = total / count; // per item';
      const stripped = stripComments(source);
      expect(stripped).not.toContain('per item');
      expect(stripped).toContain('const q = total / count;');
    });
  });

  describe('blanking, not deleting', () => {
    // Both gates report `file:line`. A stripper that deletes shifts every line
    // after the comment, so every location it reports is wrong.
    const source = ['/**', ' * A header.', ' */', 'const first = 1;', 'const second = 2; // trailing'].join('\n');

    it('preserves the length of the file exactly', () => {
      expect(stripComments(source)).toHaveLength(source.length);
    });

    it('preserves the line count and the line each statement sits on', () => {
      const lines = stripComments(source).split('\n');
      expect(lines).toHaveLength(source.split('\n').length);
      expect(lines[3]).toBe('const first = 1;');
      expect(lines[4].trimEnd()).toBe('const second = 2;');
    });

    it('is the fault the mongo stripper had — it collapsed the header away', () => {
      const naive = naiveMongoStripper(source);
      expect(naive.split('\n').length).toBeLessThan(source.split('\n').length);
    });

    it('replaces comment characters with spaces rather than removing them', () => {
      const stripped = stripComments('const a = 1; // note');
      expect(stripped).toMatch(/^const a = 1; +$/u);
    });
  });

  describe('the things a stripper must still do', () => {
    it('removes a line comment on its own line', () => {
      expect(codeLines(stripComments(['// gone', 'const kept = 1;'].join('\n')))).toEqual(['const kept = 1;']);
    });

    it('removes a trailing line comment', () => {
      expect(codeLines(stripComments('const kept = 1; // gone'))).toEqual(['const kept = 1;']);
    });

    it('removes a multi-line block comment', () => {
      const source = ['/*', ' gone', '*/', 'const kept = 1;'].join('\n');
      expect(codeLines(stripComments(source))).toEqual(['const kept = 1;']);
    });

    it('removes an unterminated block comment to the end of the file', () => {
      const stripped = stripComments(['const kept = 1;', '/* runs off the end', 'not code'].join('\n'));
      expect(codeLines(stripped)).toEqual(['const kept = 1;']);
    });

    it('leaves a file with no comments untouched', () => {
      const source = ["import { a } from 'b';", 'export const c = a + 1;'].join('\n');
      expect(stripComments(source)).toBe(source);
    });
  });
});
