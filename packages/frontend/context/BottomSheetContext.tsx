import React, { createContext, ReactNode, useRef, useCallback, useState, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import BottomSheet, { type BottomSheetRef } from '@oxyhq/bloom/bottom-sheet';
import { SavedPropertiesProvider } from './SavedPropertiesContext';
import { ProfileProvider } from './ProfileContext';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

interface BottomSheetContextProps {
  openBottomSheet: (content: ReactNode, options?: { hideHandle?: boolean }) => void;
  closeBottomSheet: () => void;
  isOpen: boolean;
  bottomSheetRef: React.RefObject<BottomSheetRef | null>;
}

export const BottomSheetContext = createContext<BottomSheetContextProps>({
  openBottomSheet: () => { },
  closeBottomSheet: () => { },
  isOpen: false,
  bottomSheetRef: { current: null },
});

// Wrapper component that provides all necessary contexts to bottom sheet content
const BottomSheetContentWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <ProfileProvider>
      <SavedPropertiesProvider>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </SavedPropertiesProvider>
    </ProfileProvider>
  );
};

export const BottomSheetProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [content, setContent] = useState<ReactNode>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [hideHandle, setHideHandle] = useState(false);
  const bottomSheetRef = useRef<BottomSheetRef | null>(null);

  const openBottomSheet = useCallback((newContent: ReactNode, options?: { hideHandle?: boolean }) => {
    setContent(newContent);
    setHideHandle(!!options?.hideHandle);
    setIsOpen(true);
    bottomSheetRef.current?.present();
  }, []);

  const closeBottomSheet = useCallback(() => {
    bottomSheetRef.current?.dismiss();
  }, []);

  const handleDismiss = useCallback(() => {
    setContent(null);
    setIsOpen(false);
    setHideHandle(false);
  }, []);

  const contextValue = useMemo(
    () => ({
      openBottomSheet,
      closeBottomSheet,
      isOpen,
      bottomSheetRef,
    }),
    [openBottomSheet, closeBottomSheet, isOpen],
  );

  return (
    <BottomSheetContext.Provider value={contextValue}>
      {children}
      <BottomSheet
        ref={bottomSheetRef}
        enablePanDownToClose
        onDismiss={handleDismiss}
        showHandle={!hideHandle}
        style={styles.contentContainer}
        scrollable={false}
      >
        <View style={styles.contentView}>
          <BottomSheetContentWrapper>{content}</BottomSheetContentWrapper>
        </View>
      </BottomSheet>
    </BottomSheetContext.Provider>
  );
};

const styles = StyleSheet.create({
  contentContainer: {
    maxWidth: 500,
    marginHorizontal: 'auto',
  },
  contentView: {
    flex: 1,
  },
});
