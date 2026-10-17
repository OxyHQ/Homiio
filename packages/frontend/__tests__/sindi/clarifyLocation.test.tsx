/**
 * A place Homiio could not commit to is SAID.
 *
 * "Muéstrame pisos en Hamburg" with two Hamburgs: refusing to choose is right
 * (ADR 0002 §12.2), refusing SILENTLY was the defect. Sindi asks the catalogue
 * (`resolvePlace`), which answers `ambiguous` or `not_found`, and Homiio's
 * renderer for that tool draws the sentence in the conversation — from the
 * tool's own answer, so it appears whatever the model writes.
 *
 * Pinned here:
 *
 *  1. **Nothing in the app moves for it.** There is no host tool for a
 *     clarification: a call to the retired `clarify_location` is rejected, so
 *     no navigation can follow an unresolved place (ADR 0002 decision 5 — a
 *     failed resolution never runs a location-less query).
 *  2. **The card renders a sentence a person can act on**, from the real
 *     `en.json`. Asserting against the shipped strings rather than a stub is
 *     deliberate: a missing key renders as `sindi.place.…`, which is the same
 *     silence wearing a different coat.
 */

import { render } from '@testing-library/react-native';

import { BloomThemeProvider } from '@oxy.so/bloom/theme';
import { parseSindiHostCall } from '@homiio/shared-types';

import en from '@/locales/en.json';
import { placeClarificationOf, SINDI_TOOL_RENDERERS } from '@/components/sindi/sindiToolRenderers';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

// The saved-homes list pulls the data layer with it; no clarification renders it.
jest.mock('@/components/sindi/SindiSavedHomes', () => ({ SindiSavedHomes: () => null }));

/** The real English strings, interpolated the way i18next would. */
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const value = key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          jest.requireActual('@/locales/en.json'),
        );
      if (typeof value !== 'string') return key;
      return value.replace(
        /{{(\w+)}}/g,
        (_match, name: string) => options?.[name] ?? `{{${name}}}`,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const resolvePlace = (city: string, output: unknown) =>
  render(
    <BloomThemeProvider>
      {SINDI_TOOL_RENDERERS['homiio:resolvePlace']?.({
        app: 'homiio',
        tool: 'resolvePlace',
        toolCallId: 'call_1',
        input: { city },
        output,
      })}
    </BloomThemeProvider>,
  );

describe('nothing in the app moves for a clarification', () => {
  it('has no host tool: the retired clarify_location is refused', () => {
    expect(
      parseSindiHostCall('clarify_location', { requested: 'Barcelona', reason: 'ambiguous' }),
    ).toBeNull();
  });
});

describe('the card says which place and why', () => {
  it('asks which one, naming it, for a homonym', () => {
    const { getByText } = resolvePlace('Barcelona', {
      status: 'ambiguous',
      candidates: [{ id: 'a' }, { id: 'b' }],
    });
    getByText(en.sindi.place.ambiguous.replace('{{place}}', 'Barcelona'));
  });

  it('says it has no such place, for a name that matched nothing', () => {
    const { getByText } = resolvePlace('Atlantis', { status: 'not_found' });
    getByText(en.sindi.place.notFound.replace('{{place}}', 'Atlantis'));
  });

  it('says nothing for a place that resolved — the search goes ahead', () => {
    expect(
      SINDI_TOOL_RENDERERS['homiio:resolvePlace']?.({
        app: 'homiio',
        tool: 'resolvePlace',
        toolCallId: 'call_1',
        input: { city: 'Hamburg' },
        output: { status: 'resolved', place: { id: 'city-hamburg' }, location: { kind: 'place' } },
      }),
    ).toBeNull();
  });
});

describe('what the renderer reads from the call', () => {
  it('quotes the name the person used, trimmed', () => {
    expect(
      placeClarificationOf({ input: { city: '  Hamburg ' }, output: { status: 'ambiguous' } }),
    ).toEqual({ requested: 'Hamburg', reason: 'ambiguous' });
  });

  it.each([
    ['no output', undefined],
    ['an output that is not an object', 'ambiguous'],
    ['a status it does not know', { status: 'rate_limited' }],
  ])('draws nothing for %s', (_label, output) => {
    expect(placeClarificationOf({ input: { city: 'Hamburg' }, output })).toBeNull();
  });

  it('draws nothing without a name to quote', () => {
    expect(placeClarificationOf({ input: {}, output: { status: 'not_found' } })).toBeNull();
    expect(
      placeClarificationOf({ input: { city: '   ' }, output: { status: 'not_found' } }),
    ).toBeNull();
  });
});
