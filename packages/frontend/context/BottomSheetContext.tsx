import React, { createContext, ReactNode, useRef, useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { SavedPropertiesProvider } from './SavedPropertiesContext';
import { ProfileProvider } from './ProfileContext';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

interface BottomSheetContextProps {
  openBottomSheet: (content: ReactNode) => void;
  closeBottomSheet: () => void;
  isOpen: boolean;
  bottomSheetRef: React.RefObject<BottomSheetModal | null>;
}

export const BottomSheetContext = createContext<BottomSheetContextProps>({
  openBottomSheet: () => { },
  closeBottomSheet: () => { },
  isOpen: false,
  bottomSheetRef: { current: null } as React.RefObject<BottomSheetModal | null>,
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
  const bottomSheetModalRef = useRef<BottomSheetModal>(null);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const openBottomSheet = useCallback((newContent: ReactNode) => {
    setContent(newContent);
    setIsOpen(true);
    setTimeout(() => {
      bottomSheetModalRef.current?.present();
    }, 100);
  }, []);

  const closeBottomSheet = useCallback(() => {
    bottomSheetModalRef.current?.dismiss();
  }, []);

  const handleDismiss = useCallback(() => {
    setContent(null);
    setIsOpen(false);
  }, []);

  return (
    <BottomSheetContext.Provider
      value={{
        openBottomSheet,
        closeBottomSheet,
        isOpen,
        bottomSheetRef: bottomSheetModalRef,
      }}
    >
      {children}
      <BottomSheetModal
        ref={bottomSheetModalRef}
        enableDynamicSizing
        enablePanDownToClose={true}
        enableDismissOnClose={true}
        android_keyboardInputMode="adjustResize"
        keyboardBehavior="extend"
        onDismiss={handleDismiss}
        style={styles.contentContainer}
        handleIndicatorStyle={{ backgroundColor: '#000', width: 40 }}
        backdropComponent={renderBackdrop}
        enableContentPanningGesture={true}
        enableHandlePanningGesture={true}
        index={0}
      >
        <BottomSheetView style={styles.contentView}>
          <BottomSheetContentWrapper>{content}</BottomSheetContentWrapper>
        </BottomSheetView>
      </BottomSheetModal>
    </BottomSheetContext.Provider>
  );
};

const styles = StyleSheet.create({
  contentContainer: {
    maxWidth: 500,
    margin: 'auto',
  },
  contentView: {
    flex: 1,
  },
});
