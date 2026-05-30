/**
 * Web layout for the `(tabs)` group.
 *
 * On web Homiio's chrome is the persistent `SideBar` + `RightBar` shell wired
 * up in the root `app/_layout.tsx`; there is no native tab bar. So this layout
 * is a bare `<Slot/>` that simply renders the active tab route inline within
 * that shell — mirroring the inbox app's `(tabs)/_layout.web.tsx`. Keeping the
 * native `NativeTabs` layout (`_layout.tsx`) web-free also avoids pulling the
 * native tab host into the web bundle.
 */

import { Slot } from 'expo-router';

export default function TabsWebLayout() {
  return <Slot />;
}
