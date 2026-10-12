/**
 * The leak sweeps the privacy suites rely on (`__tests__/helpers/leakSweep.ts`)
 * — both halves, because a sweep that never matches passes every privacy test
 * it is used in, and one that matches ids fails them at random.
 */

import { containsNumberToken, leafPathsEqualTo } from '../helpers/leakSweep';

describe('containsNumberToken', () => {
  it.each([
    ['a JSON number', '{"price":1337}', 1337],
    ['a JSON number in an array', '[1250,1337]', 1337],
    ['a number spelled as a string', '{"price":"1337"}', 1337],
    ['a currency-formatted rent', '{"text":"€1337/month"}', 1337],
    ['a rent with a unit after it', '{"text":"1337 EUR"}', 1337],
    ['the whole part of a decimal', '{"price":1337.29}', 1337],
    ['an exact decimal', '{"price":1337.29}', 1337.29],
    ['a decimal inside prose', '{"note":"paid 1337.29 in May"}', 1337.29],
    ['an amount in an HTML cell', '<td>€900.00</td>', 900],
  ])('finds %s', (_what, text, value) => {
    expect(containsNumberToken(text, value)).toBe(true);
  });

  it.each([
    // The collisions measured in this repository's own fixtures.
    ['a uuid whose tail holds the digits', '{"id":"01a12f8e-0900-7b0f-af10-a511337aff94"}', 1337],
    ['a legacy hex id ending in the digits', '{"cityId":"6accafa07c84139ab9171337"}', 1337],
    ['a uuid segment that IS the digits', '{"id":"0199d2c4-1337-7abc-8def-0123456789ab"}', 1337],
    ['a uuid segment holding a short amount', '{"id":"0199d2c4-a900-7abc-8def-0123456789ab"}', 900],
    ['an account id built on a uuid', '{"oxyUserId":"oxy-48000c4a-1337-7abc-8def-0123"}', 48000],
    ['a longer number', '{"n":21337}', 1337],
    ['a decimal fraction', '{"lat":41.1337}', 1337],
    ['a longer decimal', '{"price":1337.291}', 1337.29],
  ])('ignores %s', (_what, text, value) => {
    expect(containsNumberToken(text, value)).toBe(false);
  });
});

describe('leafPathsEqualTo', () => {
  it('names every leaf that is the value, under any key at any depth', () => {
    const body = {
      data: [{ price: 1337.29 }, { nested: { rent: '1337.29' } }],
      other: 1337.29,
    };
    expect(leafPathsEqualTo(body, 1337.29)).toEqual([
      '$.data[0].price',
      '$.data[1].nested.rent',
      '$.other',
    ]);
  });

  it('does not treat an id that contains the digits as the value', () => {
    expect(
      leafPathsEqualTo({ id: '6accafa07c84139ab9171337', count: 13370, band: 1250 }, 1337),
    ).toEqual([]);
  });
});
