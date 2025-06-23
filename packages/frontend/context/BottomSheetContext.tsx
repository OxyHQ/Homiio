import React, { createContext, ReactNode, useRef, useCallback, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheetModal, BottomSheetView, BottomSheetBackdrop, BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '@/store/store';
import {
    openBottomSheet as openBottomSheetAction,
    setBottomSheetContent as setBottomSheetContentAction,
} from '@/store/reducers/bottomSheetReducer';

interface BottomSheetContextProps {
    openBottomSheet: (isOpen: boolean) => void;
    setBottomSheetContent: (content: ReactNode) => void;
    bottomSheetRef: React.RefObject<BottomSheetModal>;
}

export const BottomSheetContext = createContext<BottomSheetContextProps>({
    openBottomSheet: () => { },
    setBottomSheetContent: () => { },
    bottomSheetRef: { current: null },
});

export const BottomSheetProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const dispatch = useDispatch<AppDispatch>();
    const bottomSheetContent = useSelector((state: RootState) => state.bottomSheet.content);
    const isOpen = useSelector((state: RootState) => state.bottomSheet.isOpen);
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
        []
    );

    const openBottomSheet = (open: boolean) => {
        dispatch(openBottomSheetAction(open));
    };

    const setBottomSheetContent = (content: ReactNode) => {
        dispatch(setBottomSheetContentAction(content));
    };

    useEffect(() => {
        if (isOpen) {
            bottomSheetModalRef.current?.present();
        } else {
            bottomSheetModalRef.current?.dismiss();
        }
    }, [isOpen]);

    return (
        <BottomSheetContext.Provider value={{ openBottomSheet, setBottomSheetContent, bottomSheetRef: bottomSheetModalRef }}>
            {children}
            <BottomSheetModal
                ref={bottomSheetModalRef}
                enableDynamicSizing
                enablePanDownToClose={true}
                enableDismissOnClose={true}
                android_keyboardInputMode="adjustResize"
                keyboardBehavior="extend"
                style={styles.contentContainer}
                handleIndicatorStyle={{ backgroundColor: '#000', width: 40 }}
                backdropComponent={renderBackdrop}
                enableContentPanningGesture={true}
                enableHandlePanningGesture={true}
                index={0}
            >
                <BottomSheetView style={styles.contentView}>
                    {bottomSheetContent}
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
    }
});