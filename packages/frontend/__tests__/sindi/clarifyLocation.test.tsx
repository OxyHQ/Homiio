/**
 * A place Homiio could not commit to is SAID, on a screen that can be driven
 * and on one that cannot.
 *
 * The contract half of `clarify_location` is pinned in `actionContract.test.ts`
 * with the rest of the union. This file pins the two things a parser cannot
 * see, and both were the actual defect rather than a hypothetical one:
 *
 *  1. **The executor performs nothing for it**, in the host with the fewest
 *     reasons not to act. A turn naming an unresolvable place must not move the
 *     app — ADR 0002 decision 5, "a failed resolution never runs a
 *     location-less query" — so `execute` reports `inline` and the router is
 *     never called, from the docked panel, whose `actMode` is `beside` and
 *     which defers nothing. A `navigate` to Explore here would be §1.3(c), an
 *     unrestricted feed under a request for one place.
 *  2. **The card renders a sentence a person can act on**, from the real
 *     `en.json`. Asserting against the shipped strings rather than a stub is
 *     deliberate: the failure this whole change is about is a refusal nobody
 *     could see, and a missing translation key renders as `sindi.actions.…`,
 *     which is the same failure wearing a different coat.
 */

import React from 'react';
import { render, renderHook } from '@testing-library/react-native';

import { BloomThemeProvider } from '@oxy.so/bloom/theme';

import type { SindiActionEnvelope } from '@homiio/shared-types';
import { SINDI_ACTION_VERSION } from '@homiio/shared-types';

import en from '@/locales/en.json';
import { SindiActionCard } from '@/components/sindi/SindiActionCard';
import { useSindiActions } from '@/hooks/useSindiActions';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

// A docked panel, which is the host/layout pair with the FEWEST reasons not to
// act: `actMode` is `beside`, so nothing below is prevented by the capability
// check and nothing is deferred to `settleTurn`. Only the layout hook is
// replaced — `controlCapabilityOf` and `actModeOf` are the real ones, so this
// file cannot pass by mocking away the rules it is reasoning about.
jest.mock('@/components/sindi/sindiPanelLayout', () => ({
  ...jest.requireActual('@/components/sindi/sindiPanelLayout'),
  useSindiPanelLayout: () => ({ visible: true, docked: true, width: 420 }),
}));

// The saved-homes list is the `show_saved` branch's inline answer and pulls the
// data layer with it. No clarification renders it; stubbed so a failure here is
// never that module's.
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
      return value.replace(/{{(\w+)}}/g, (_match, name: string) => options?.[name] ?? `{{${name}}}`);
    },
    i18n: { language: 'en' },
  }),
}));

const clarification = (
  overrides: Partial<Extract<SindiActionEnvelope['action'], { kind: 'clarify_location' }>> = {},
): SindiActionEnvelope => ({
  version: SINDI_ACTION_VERSION,
  actionId: 'a1',
  turnId: 't1',
  contextRevision: 7,
  action: { kind: 'clarify_location', requested: 'Barcelona', reason: 'ambiguous', ...overrides },
});

/** Bloom typography reads its theme from context; there is no other reason. */
const card = (execution: React.ComponentProps<typeof SindiActionCard>['execution']) =>
  render(
    <BloomThemeProvider>
      <SindiActionCard execution={execution} onTake={jest.fn()} />
    </BloomThemeProvider>,
  );

beforeEach(() => {
  mockPush.mockClear();
});

describe('the executor performs nothing for a clarification', () => {
  it('answers inline and never navigates, even with a main pane to navigate', () => {
    const { result } = renderHook(() =>
      useSindiActions({
        host: 'panel',
        activeTurnId: 't1',
        contextRevision: 7,
        onExecuted: jest.fn(),
      }),
    );

    expect(result.current.execute(clarification())).toBe('inline');
    expect(mockPush).not.toHaveBeenCalled();
    // Nor is anything held back for the end of the turn: a sentence does not
    // take the chat's surface away, so there is nothing to wait for.
    result.current.settleTurn();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('tells the surface, so the sentence reaches the conversation', () => {
    const onExecuted = jest.fn();
    const { result } = renderHook(() =>
      useSindiActions({ host: 'panel', activeTurnId: 't1', contextRevision: 7, onExecuted }),
    );

    result.current.execute(clarification());

    expect(onExecuted).toHaveBeenCalledWith({ envelope: clarification(), outcome: 'inline' });
  });
});

describe('the card says which place and why', () => {
  it('asks which one, naming it, for a homonym', () => {
    const { getByText, queryByText } = card({ envelope: clarification(), outcome: 'inline' });

    getByText(en.sindi.actions.clarifyLocation.ambiguous.replace('{{place}}', 'Barcelona'));
    // Nothing to take: Homiio is not withholding a search it could run.
    expect(queryByText(en.sindi.actions.take)).toBeNull();
  });

  it('says it has no such place, for a name that matched nothing', () => {
    const { getByText } = card({
      envelope: clarification({ requested: 'Atlantis', reason: 'not_found' }),
      outcome: 'inline',
    });

    getByText(en.sindi.actions.clarifyLocation.notFound.replace('{{place}}', 'Atlantis'));
  });

  it('still says it when the person changed a filter mid-turn', () => {
    // `stale` renders "you changed the search yourself, so this was left alone"
    // for every other member, and for this one it would be a non-sequitur: the
    // place stayed unresolvable whatever they did to their filters.
    const { getByText, queryByText } = card({ envelope: clarification(), outcome: 'stale' });

    getByText(en.sindi.actions.clarifyLocation.ambiguous.replace('{{place}}', 'Barcelona'));
    expect(queryByText(en.sindi.actions.stale)).toBeNull();
  });
});
