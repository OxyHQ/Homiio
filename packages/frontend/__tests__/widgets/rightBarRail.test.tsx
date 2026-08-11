/**
 * `RightBar` renders the map's answer, and nothing of its own (#423).
 *
 * ## Why this exists beside the totality test
 *
 * `routeRailTotality.test.ts` proves the MAP is total and that the resolver
 * agrees with it. Neither fact reaches the screen on its own: the acceptance
 * criterion is about what an unmatched route RENDERS, and the component is the
 * only place that is observable. A map that says `null` and a component that
 * renders Home anyway would satisfy every assertion in that file.
 *
 * So this one renders `RightBar` at real pathnames and reads what
 * `WidgetManager` was handed — including the case where it must be handed
 * nothing at all, because "renders no rail" cannot be asserted by inspecting
 * props that were never passed.
 *
 * The rail's own visibility rules (>=990px, the Sindi panel) are forced ON, so a
 * failure here is about the ROUTE and never about a breakpoint.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { RightBar } from '@/components/RightBar';

// `mock`-prefixed because jest hoists `jest.mock` factories above the file and
// refuses any other out-of-scope reference from inside one.
const mockUsePathname = jest.fn<string, []>();

jest.mock('expo-router', () => ({
  usePathname: () => mockUsePathname(),
}));

// The rail is desktop-only; this file is not about the breakpoint.
jest.mock('@/hooks/useOptimizedMediaQuery', () => ({
  useIsRightBarVisible: () => true,
  useIsLargeDesktop: () => true,
}));

jest.mock('@/store/uiStore', () => ({
  useUIStore: (selector: (state: { sindiPanelOpen: boolean }) => unknown) =>
    selector({ sindiPanelOpen: false }),
}));

/**
 * A spy in place of the real widget set.
 *
 * The question here is which rail was REQUESTED, not what it looks like —
 * and mounting the real widgets would drag every data hook in the app into a
 * test about routing.
 */
const mockWidgetManager = jest.fn();
jest.mock('@/components/widgets', () => ({
  WidgetManager: (props: Record<string, unknown>) => {
    mockWidgetManager(props);
    return null;
  },
}));

/** The props `WidgetManager` was mounted with, or `null` if it never was. */
function railProps(): Record<string, unknown> | null {
  return mockWidgetManager.mock.calls.length > 0 ? mockWidgetManager.mock.calls[0][0] : null;
}

function renderAt(pathname: string): ReturnType<typeof render> {
  mockUsePathname.mockReturnValue(pathname);
  return render(<RightBar />);
}

beforeEach(() => {
  mockWidgetManager.mockClear();
  mockUsePathname.mockReset();
});

describe('a route with no rail renders nothing', () => {
  it('mounts no widget set at all on a page that only ever inherited Home', () => {
    // `/reviews` rendered Home's rail — recently viewed, featured properties,
    // donation, horizon, eco — beside a page about tenancy history. Not a
    // considered layout; the absence of one.
    const view = renderAt('/reviews');

    expect(railProps()).toBeNull();
    expect(view.toJSON()).toBeNull();
  });

  it('mounts nothing for a pathname that is not a route at all', () => {
    // The residual. Restoring the `'home'` default fails right here.
    const view = renderAt('/definitely-not-a-route');

    expect(railProps()).toBeNull();
    expect(view.toJSON()).toBeNull();
  });
});

describe('a route with a rail gets exactly that rail', () => {
  it('gives Home its own widget set', () => {
    // The POSITIVE control for both cases above: a component that rendered
    // `null` unconditionally would pass them and delete the rail from the app.
    renderAt('/');

    expect(railProps()).toMatchObject({ screenId: 'home' });
  });

  it('passes the property id from the segment that holds it', () => {
    renderAt('/properties/68a1f0c2b9/apply');

    expect(railProps()).toMatchObject({
      screenId: 'property-details',
      propertyId: '68a1f0c2b9',
    });
  });

  it('passes the city on the city listing route, and no property id', () => {
    renderAt('/properties/city/barcelona');

    expect(railProps()).toMatchObject({ screenId: 'properties', city: 'barcelona' });
    expect(railProps()?.propertyId).toBeUndefined();
  });

  it('never hands a non-id path segment over as a property id', () => {
    // `/properties/drafts` used to mount `PropertyBookingWidget` with
    // `propertyId="drafts"`, which fetched `GET /api/properties/drafts`. It has
    // no rail now, so there is nothing to hand anything to.
    const view = renderAt('/properties/drafts');

    expect(railProps()).toBeNull();
    expect(view.toJSON()).toBeNull();
  });
});
