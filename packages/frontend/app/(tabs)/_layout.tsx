/**
 * Native bottom tabs for Homiio (mobile, native platforms).
 *
 * Renders the tab bar with expo-router's `NativeTabs`, so the bar is drawn by
 * the platform itself — `UITabBar` on iOS, `BottomNavigationView` on Android —
 * rather than as a JS view. This matches the rest of the Oxy ecosystem (see the
 * inbox app) and gives the true native look, feel, blur, and motion.
 *
 * Theming pulls from Homiio's Bloom-backed `useColors()` so the bar tracks the
 * active preset (Bloom `blue` in light mode). The selected tint is Bloom's
 * `primary` blue; the bar surface is `background`; on Android the selection
 * indicator and touch ripple use `primarySubtle` (Bloom's soft brand tint).
 *
 * The five triggers are Explore, Saved, Sindi, Inbox, Profile (in that order),
 * with labels from the shared `sidebar.navigation.*` i18n namespace. Each maps
 * to a route file inside this `(tabs)` group — `name` matches the route (`index`
 * for the Explore/home route, `inbox`/`saved`/`sindi`/`profile` for the folders).
 *
 * `NativeTabs` registers a screen ONLY for routes with a declared trigger
 * (expo-router builds the native navigator with `useOnlyUserDefinedScreens`), so
 * the search experience lives OUTSIDE this group at `app/search/` and stays
 * reachable at `/search` (e.g. from `SearchSummaryBar`) without a bottom-bar tab.
 *
 * Web has its own layout (`_layout.web.tsx`, a bare `<Slot/>`) because the web
 * shell uses the persistent sidebar + right rail, not a native tab bar.
 */

import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';

import { useColors } from '@/hooks/useThemeColor';
import { useKeyboardVisibility } from '@/hooks/useKeyboardVisibility';

export default function TabsLayout() {
  const colors = useColors();
  const { t } = useTranslation();
  // Hide the native bar while the OS keyboard is up so it never floats above
  // the keyboard. `useKeyboardVisibility` is a no-op on web (this layout only
  // runs on native), and the bar simply re-shows on dismiss.
  const keyboardVisible = useKeyboardVisibility();

  return (
    <NativeTabs
      hidden={keyboardVisible}
      iconColor={{
        default: colors.icon,
        selected: colors.primary,
      }}
      labelStyle={{
        default: { color: colors.icon },
        selected: { color: colors.primary },
      }}
      tintColor={colors.primary}
      backgroundColor={colors.background}
      indicatorColor={colors.primarySubtle}
      rippleColor={colors.primarySubtle}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'safari', selected: 'safari.fill' }}
          md="explore"
        />
        <NativeTabs.Trigger.Label>
          {t('sidebar.navigation.home')}
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bookmark', selected: 'bookmark.fill' }}
          md="bookmark"
        />
        <NativeTabs.Trigger.Label>
          {t('sidebar.navigation.saved')}
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="sindi">
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
        <NativeTabs.Trigger.Label>
          {t('sidebar.navigation.sindi')}
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'tray', selected: 'tray.fill' }}
          md="inbox"
        />
        <NativeTabs.Trigger.Label>
          {t('sidebar.navigation.inbox')}
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person', selected: 'person.fill' }}
          md="person"
        />
        <NativeTabs.Trigger.Label>
          {t('sidebar.navigation.profile')}
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
