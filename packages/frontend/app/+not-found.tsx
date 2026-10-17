import { AppShellPanel } from '@oxy.so/bloom/app-shell';

import NotFoundScreen from '@/components/NotFoundScreen';

/** Outside the `(pages)` group (it catches every unmatched path), so it states its own panel. */
export default function NotFound() {
  return (
    <AppShellPanel>
      <NotFoundScreen />
    </AppShellPanel>
  );
}
