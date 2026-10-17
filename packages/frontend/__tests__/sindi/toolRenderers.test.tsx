/**
 * Homiio's renderers for its own catalogue tools, inside Alia's thread.
 *
 * They replace the `<PROPERTIES_JSON>` block the model used to be told to type:
 * the homes now come from the tool's structured output, keyed by the tool's
 * canonical name (`oxy_homiio__searchListings` → `homiio:searchListings`), so a
 * card can only show a home the catalogue actually returned. Pinned here: which
 * tools are drawn, what each one draws, and that a malformed output draws
 * nothing rather than throwing inside somebody's conversation.
 */

import { render } from '@testing-library/react-native';
import type { AliaToolResult } from '@alia.onl/sdk';
import { BloomThemeProvider } from '@oxy.so/bloom/theme';

import {
  listingOfOutput,
  listingsOfOutput,
  SINDI_LISTING_PREVIEW_MAX,
  SINDI_TOOL_RENDERERS,
} from '@/components/sindi/sindiToolRenderers';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

// The card itself is the app's; what is pinned is WHICH homes reach it.
jest.mock('@/components/PropertyCard', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    PropertyCard: ({ property }: { property: { id: string } }) => (
      <Text testID="property-card">{property.id}</Text>
    ),
  };
});

jest.mock('@/components/sindi/SindiSavedHomes', () => {
  const { Text } = jest.requireActual('react-native');
  return { SindiSavedHomes: () => <Text testID="saved-homes">saved</Text> };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { language: 'en' },
  }),
}));

const result = (tool: string, output: unknown): AliaToolResult => ({
  app: 'homiio',
  tool,
  toolCallId: 'call_1',
  input: {},
  output,
});

const draw = (tool: string, output: unknown) => {
  const renderer = SINDI_TOOL_RENDERERS[`homiio:${tool}`];
  if (!renderer) throw new Error(`no renderer for ${tool}`);
  return render(<BloomThemeProvider>{renderer(result(tool, output))}</BloomThemeProvider>);
};

const homes = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `home-${index}`, title: `Home ${index}` }));

describe('which tools Homiio draws', () => {
  it('draws exactly the listing reads, the saved homes and the place resolution', () => {
    expect(Object.keys(SINDI_TOOL_RENDERERS).sort()).toEqual([
      'homiio:findNearbyListings',
      'homiio:getListing',
      'homiio:listSavedHomes',
      'homiio:resolvePlace',
      'homiio:searchListings',
    ]);
  });

  it("is keyed `<app>:<tool>` with the catalogue's own tool names", () => {
    // The SDK derives the key from `oxy_homiio__<tool>` only; a host tool's
    // name (`host_homiio__…`) never reaches a renderer.
    for (const key of Object.keys(SINDI_TOOL_RENDERERS)) {
      expect(key).toMatch(/^homiio:[a-z][A-Za-z]+$/);
    }
  });
});

describe('a search draws the homes it returned', () => {
  it.each(['searchListings', 'findNearbyListings'])('%s draws one card per home', (tool) => {
    const { getAllByTestId } = draw(tool, { data: homes(2), total: 2 });
    expect(getAllByTestId('property-card').map((card) => card.props.children)).toEqual([
      'home-0',
      'home-1',
    ]);
  });

  it('shows a few and says how many more matched, rather than hiding them', () => {
    const { getAllByTestId, getByText } = draw('searchListings', { data: homes(6), total: 40 });
    expect(getAllByTestId('property-card')).toHaveLength(SINDI_LISTING_PREVIEW_MAX);
    getByText(`sindi.saved.more:${40 - SINDI_LISTING_PREVIEW_MAX}`);
  });

  it.each([
    ['an empty page', { data: [], total: 0 }],
    ['an error body', { error: 'boom' }],
    ['no output', undefined],
  ])('draws nothing for %s', (_label, output) => {
    expect(draw('searchListings', output).queryAllByTestId('property-card')).toHaveLength(0);
  });

  it('skips an entry with no id rather than drawing a card nobody can open', () => {
    expect(listingsOfOutput({ data: [{ title: 'no id' }, { id: 'home-1' }] }).listings).toEqual([
      { id: 'home-1' },
    ]);
  });
});

describe('one listing', () => {
  it('draws getListing as one card', () => {
    const { getAllByTestId } = draw('getListing', { data: { id: 'home-9' } });
    expect(getAllByTestId('property-card')).toHaveLength(1);
  });

  it('draws nothing for a listing that was not found', () => {
    expect(listingOfOutput({ data: null })).toBeNull();
    expect(
      SINDI_TOOL_RENDERERS['homiio:getListing']?.(result('getListing', { data: null })),
    ).toBeNull();
  });
});

it('draws the saved homes from the person’s own session', () => {
  draw('listSavedHomes', { data: homes(1) }).getByTestId('saved-homes');
});
