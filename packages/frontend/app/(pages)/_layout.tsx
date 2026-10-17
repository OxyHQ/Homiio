/**
 * Every page except explore is ONE reading panel.
 *
 * The root layout's `AppShell` (`panels`) owns the frame — the gutter on all
 * four sides, framed from `lg` and full-bleed below it, the aside, the bars —
 * and this group says what its routes are made of: a single `AppShellPanel`.
 * `/explore` lives outside the group because it is made of two (results and a
 * map) and renders its own `AppShellPanels`. A route group adds no URL segment,
 * so every path is unchanged.
 */
import { AppShellPanel } from '@oxy.so/bloom/app-shell';
import { Slot } from 'expo-router';

export default function PagesLayout() {
  return (
    <AppShellPanel>
      <Slot />
    </AppShellPanel>
  );
}
