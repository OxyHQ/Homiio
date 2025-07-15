import { generateAPIUrl } from '@/utils/generateAPIUrl';
import { useChat } from '@ai-sdk/react';
import { fetch as expoFetch } from 'expo/fetch';
import { View, TextInput, Text, SafeAreaView, TouchableOpacity, StyleSheet } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { sindiApi } from '@/utils/api';
import { useSindiChatStore } from '@/store/sindiChatStore';

const IconComponent = Ionicons as any;

export default function SindiMain() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();
  const { t } = useTranslation();

  const { addMessage } = useSindiChatStore();

  const isAuthenticated = !!oxyServices && !!activeSessionId;

  const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };
    if (oxyServices && activeSessionId) {
      try {
        const tokenData = await oxyServices.getTokenBySession(activeSessionId);
        if (tokenData) {
          headers['Authorization'] = `Bearer ${tokenData.accessToken}`;
        }
      } catch (error) {
        console.error('Failed to get authentication token:', error);
      }
    }
    const { body, ...otherOptions } = options;
    const fetchOptions = {
      ...otherOptions,
      headers,
      ...(body !== null && { body }),
    };
    return expoFetch(url, fetchOptions as any);
  };

  const { messages, handleInputChange, input, handleSubmit, isLoading } = useChat({
    fetch: authenticatedFetch as unknown as typeof globalThis.fetch,
    api: generateAPIUrl('/api/ai/stream'),
    onError: (error: any) => console.error(error, 'ERROR'),
    enabled: isAuthenticated,
  } as any);

  const startConversation = async () => {
    if (!input.trim()) return;
    const now = new Date().toISOString();
    addMessage({ role: 'user', content: input, timestamp: now });
    await handleSubmit();
    if (oxyServices && activeSessionId) {
      try {
        const res = await sindiApi.getSindiChatHistory(oxyServices, activeSessionId);
        const conv = res.conversations && res.conversations[0];
        if (conv && (conv._id || conv.id)) {
          router.replace(`/sindi/${conv._id || conv.id}`);
        }
      } catch (err) {
        console.error('Failed to fetch conversation id:', err);
      }
    }
  };

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.authText}>{t('sindi.auth.required')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.textInput}
          placeholder={t('sindi.chat.placeholder')}
          placeholderTextColor="rgba(0,0,0,0.4)"
          value={input}
          onChangeText={(text) => handleInputChange({ target: { value: text } } as any)}
          onSubmitEditing={startConversation}
          multiline
        />
        <TouchableOpacity style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]} onPress={startConversation} disabled={!input.trim() || isLoading}>
          <IconComponent name={isLoading ? 'hourglass' : 'send'} size={20} color={input.trim() ? 'white' : 'rgba(255,255,255,0.4)'} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#f8f9fa',
  },
  authText: {
    textAlign: 'center',
    color: colors.COLOR_BLACK,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 8,
    color: colors.COLOR_BLACK,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
});
