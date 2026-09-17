/**
 * Where the Sindi panel goes, and that the frame actually mounts it.
 *
 * The panel existed for months with no mount anywhere: the sidebar row flipped
 * `uiStore.sindiPanelOpen`, the right rail stepped aside for it, and nothing
 * appeared. Every reader agreed on a panel nobody rendered. So this file pins
 * both halves — the tier decision the layout, `RightBar` and the panel share,
 * and the layout's two mounts of it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react-native';

import { stripComments } from '@homiio/shared-types/testing/stripComments';
import { useSindiPanelLayout } from '@/components/sindi/sindiPanelLayout';

let mockWidth = 1440;
let mockOpen = true;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 900, scale: 1, fontScale: 1 }),
}));

jest.mock('@/store/uiStore', () => ({
  useUIStore: (selector: (state: { sindiPanelOpen: boolean; sidebarCollapsed: boolean }) => unknown) =>
    selector({ sindiPanelOpen: mockOpen, sidebarCollapsed: false }),
}));

function layoutAt(width: number, open = true) {
  mockWidth = width;
  mockOpen = open;
  return renderHook(() => useSindiPanelLayout()).result.current;
}

describe('useSindiPanelLayout', () => {
  it('has no panel on a phone, open or not', () => {
    expect(layoutAt(499)).toMatchObject({ visible: false, docked: false });
  });

  it('is an overlay between 500 and lg', () => {
    expect(layoutAt(800)).toMatchObject({ visible: true, docked: false });
  });

  it('docks as the aside from lg', () => {
    expect(layoutAt(1024)).toMatchObject({ visible: true, docked: true });
  });

  it('is nothing while closed', () => {
    expect(layoutAt(1440, false)).toMatchObject({ visible: false, docked: false });
  });

  it('never squeezes the page column below 380 when docked', () => {
    // 1024 - (12 + 16 + 260) rail - (16 + 12) aside inset - 380 page = 328.
    expect(layoutAt(1024).width).toBe(328);
    expect(layoutAt(1300).width).toBe(380);
    expect(layoutAt(1440).width).toBe(420);
  });
});

describe('the frame mounts the panel', () => {
  const layout = stripComments(
    readFileSync(join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8'),
  );

  it('as the aside while docked', () => {
    expect(layout).toMatch(/<SindiPanel placement="aside" \/>/);
  });

  it('as the shell overlay below lg', () => {
    expect(layout).toMatch(/overlay=\{<SindiPanel placement="overlay" \/>\}/);
  });
});
