/**
 * Sweeps for a NUMBER that must not reach a response, built so they cannot
 * match by accident.
 *
 * A response body is full of random digit runs: uuid v7 ids, 32-hex
 * pseudonyms, `oxy-<uuid>` account ids. A bare `serialized.includes('1337')`
 * matches one of those on some runs and not others, and a privacy test that
 * fails with no leak is a test people learn to re-run. That happened:
 * `reviewPublicationPrivacy.test.ts` failed on PR #626's CI because an id
 * happened to contain the rent (measured afterwards: 4 of 4,000 runs of its
 * fixture), and `900` sits inside about 0.7% of uuid v7s.
 *
 * Two sweeps, and a leak check should use both:
 *
 *  - {@link leafPathsEqualTo} walks the PARSED body and names every leaf whose
 *    value IS the number, under any key at any depth. It cannot be fooled by an
 *    id, because an id is a string that is not the number.
 *  - {@link containsNumberToken} searches the SERIALIZED body for the number as
 *    a token of its own, so a copy inside a formatted string (`"€1337/month"`,
 *    `"rent 1337.29"`) is still found. A digit run inside an id is not a token:
 *    every character an id can put next to it — a letter, a digit, `-`, `_` —
 *    is a boundary that rules the match out.
 *
 * What the token sweep deliberately does NOT see: a digit run preceded by `-` or
 * `.` (`-1337`, `0.1337`), and a number re-spelled with grouping (`1,337`). The
 * first is what a uuid segment looks like; the second is a locale's choice.
 * Neither is a reason to fall back to a substring search.
 */

/** Characters that, next to the digits, mean they are part of a longer token. */
const BEFORE = '0-9A-Za-z_.\\-';
const AFTER = '0-9A-Za-z_';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `value` occurs in `serialized` as a number of its own rather than as
 * part of an id. A trailing `.` is NOT a boundary, so the integer part of a
 * leaked decimal (`1337` in `1337.29`) still matches.
 */
export function containsNumberToken(serialized: string, value: number): boolean {
  const pattern = new RegExp(`(?<![${BEFORE}])${escapeRegExp(String(value))}(?![${AFTER}])`);
  return pattern.test(serialized);
}

/**
 * The path of every leaf in `body` that is `value` — as a number, or as a
 * string that is exactly its decimal spelling.
 */
export function leafPathsEqualTo(body: unknown, value: number): string[] {
  const found: string[] = [];
  const spelled = String(value);
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      for (const [index, entry] of node.entries()) walk(entry, `${path}[${index}]`);
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, entry] of Object.entries(node as Record<string, unknown>)) {
        walk(entry, `${path}.${key}`);
      }
      return;
    }
    if (node === value || node === spelled) found.push(path);
  };
  walk(body, '$');
  return found;
}
