import { useMemo } from 'react';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAskAgent } from '@alia.onl/sdk/ask/eager';
import { AliaAvatarIcon } from '@alia.onl/sdk/avatar';
import { BottomBar } from '@oxy.so/bloom/bottom-bar';
import { Fab } from '@oxy.so/bloom/fab';
import { RiBookmarkLine } from '@oxy.so/bloom/icons/RiBookmarkLine';
import { RiHomeLine } from '@oxy.so/bloom/icons/RiHomeLine';
import { RiInbox2Line } from '@oxy.so/bloom/icons/RiInbox2Line';
import { RiUserLine } from '@oxy.so/bloom/icons/RiUserLine';

const DESTINATIONS = ['/saved', '/inbox', '/profile'] as const;

/** The section a pathname belongs to; everything else is home. */
function sectionOf(pathname: string): string {
  return DESTINATIONS.find((href) => pathname === href || pathname.startsWith(`${href}/`)) ?? '/';
}

/**
 * The phone navigation: Bloom's `BottomBar`, which `AppShell` pins, pads for
 * the home indicator and reserves space for while the sidebar is a drawer.
 * Ask Alia is its action, as compose is Mention's.
 */
export function HomiioBottomBar() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { ask } = useAskAgent();

  const items = useMemo(
    () => [
      { name: '/', label: t('sidebar.navigation.home'), icon: <RiHomeLine /> },
      { name: '/saved', label: t('sidebar.navigation.saved'), icon: <RiBookmarkLine /> },
      { name: '/inbox', label: t('sidebar.navigation.inbox'), icon: <RiInbox2Line /> },
      { name: '/profile', label: t('sidebar.navigation.profile'), icon: <RiUserLine /> },
    ],
    [t],
  );

  return (
    <BottomBar
      items={items}
      value={sectionOf(pathname)}
      onValueChange={(href) => router.navigate(href as Href)}
      action={
        <Fab
          icon={AliaAvatarIcon}
          accessibilityLabel={t('sidebar.navigation.askAlia')}
          onPress={() => ask('alia')}
        />
      }
    />
  );
}
