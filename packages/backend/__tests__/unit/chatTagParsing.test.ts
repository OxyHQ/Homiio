/**
 * Reading the tags a chat message carries, without a backtracking regex.
 *
 * ## What this replaced, and why it was worth replacing
 *
 * `<FILE_DATA_URL>([\s\S]*?)<\/FILE_DATA_URL>` is the obvious spelling and it
 * is a polynomial ReDoS: a lazy quantifier makes the engine restart its inner
 * scan at every opening tag, so a message that is nothing but repeated opening
 * tags with no close is quadratic in its own length. CodeQL flagged three of
 * them on `routes/ai.ts`; the content is a user-supplied chat message on an
 * authenticated endpoint, so the cost is one request's own CPU — small, real,
 * and free to remove.
 *
 * `indexOf` does not backtrack at all.
 *
 * ## Why the timing case is a RATIO and not a threshold
 *
 * A wall-clock budget ("under 50 ms") is a test that fails on a loaded CI
 * runner and passes on a fast one, whichever implementation is underneath. What
 * distinguishes linear from quadratic is how the cost GROWS: doubling the input
 * should roughly double the work, not quadruple it. The assertion is deliberately
 * loose — a 4× allowance over a 4× input — because it only has to separate O(n)
 * from O(n²), and the regex this replaced was three orders of magnitude worse
 * than that at these sizes.
 */

import { extractLastPropertyIdsFromMessages } from '../../services/chatTags';

describe('reading a tagged payload', () => {
  it('finds a payload between its tags', () => {
    expect(
      extractLastPropertyIdsFromMessages([
        { role: 'assistant', content: 'Here you go <PROPERTIES_JSON>["a","b"]</PROPERTIES_JSON>' },
      ]),
    ).toEqual(['a', 'b']);
  });

  it('matches the tag case-insensitively, as the regex did', () => {
    expect(
      extractLastPropertyIdsFromMessages([
        { role: 'assistant', content: '<properties_json>["a"]</properties_json>' },
      ]),
    ).toEqual(['a']);
  });

  it('answers nothing for an unclosed tag rather than scanning for one', () => {
    expect(
      extractLastPropertyIdsFromMessages([
        { role: 'assistant', content: '<PROPERTIES_JSON>["a","b"' },
      ]),
    ).toEqual([]);
  });

  it('reads the LAST assistant message that carries one', () => {
    expect(
      extractLastPropertyIdsFromMessages([
        { role: 'assistant', content: '<PROPERTIES_JSON>["old"]</PROPERTIES_JSON>' },
        { role: 'user', content: 'more please' },
        { role: 'assistant', content: '<PROPERTIES_JSON>["new"]</PROPERTIES_JSON>' },
      ]),
    ).toEqual(['new']);
  });

  it('ignores a tag in a USER message', () => {
    // A person can type anything. Only the assistant's own block is read.
    expect(
      extractLastPropertyIdsFromMessages([
        { role: 'user', content: '<PROPERTIES_JSON>["injected"]</PROPERTIES_JSON>' },
      ]),
    ).toEqual([]);
  });

  it('survives a payload that is not JSON', () => {
    expect(
      extractLastPropertyIdsFromMessages([
        { role: 'assistant', content: '<PROPERTIES_JSON>not json</PROPERTIES_JSON>' },
      ]),
    ).toEqual([]);
  });
});

describe('the cost grows linearly with the input', () => {
  const adversarial = (repetitions: number): string =>
    `${'<PROPERTIES_JSON>a'.repeat(repetitions)}`;

  const timeOf = (content: string): number => {
    const started = process.hrtime.bigint();
    extractLastPropertyIdsFromMessages([{ role: 'assistant', content }]);
    return Number(process.hrtime.bigint() - started);
  };

  it('does not blow up on repeated opening tags with no close', () => {
    // Warm the JIT so the first call's compilation does not dominate the ratio.
    timeOf(adversarial(1_000));

    const small = Math.max(timeOf(adversarial(20_000)), 1);
    const large = timeOf(adversarial(80_000));

    // 4× the input. Linear predicts ~4×; quadratic predicts ~16×. The 4× slack
    // on top separates the two without pinning a machine-specific number.
    expect(large / small).toBeLessThan(16);
  });
});
