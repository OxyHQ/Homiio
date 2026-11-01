/**
 * `/sindi/shared/<token>` — an old share link, sent on to the conversation's one
 * public page, Alia's (`aliaSharedConversationUrl`, Alia `docs/agent-embedding.md`
 * §6). Homiio minted links to this address before Alia had that page; they live on
 * in chats and e-mails, so the address stays and answers with the move. A link
 * minted now is Alia's from the start (`hooks/useSindiChat.ts`).
 */

import { aliaSharedConversationUrl } from '@alia.onl/sdk/runtime';
import { Loading } from '@oxy.so/bloom/loading';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

export default function SharedConversationRedirect() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const target = token ? aliaSharedConversationUrl(token) : null;

  useEffect(() => {
    if (target === null) {
      router.replace('/');
      return;
    }
    if (Platform.OS === 'web') {
      // `replace`, so Back returns to where the link was opened rather than here.
      window.location.replace(target);
      return;
    }
    // The app opened a homiio.com link: the page is Alia's, in the browser.
    void Linking.openURL(target).finally(() => router.replace('/'));
  }, [target, router]);

  return (
    <>
      <Head>
        <meta name="robots" content="noindex, nofollow" />
        {target ? <link rel="canonical" href={target} /> : null}
      </Head>
      <View style={styles.center}>
        <Loading />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
