import store from '@/store/store';
import { openBottomSheet, setBottomSheetContent } from '@/store/reducers/bottomSheetReducer';

type BottomSheetContentFactory = () => React.ReactNode;

let authBottomSheetFactory: BottomSheetContentFactory | null = null;

export const setAuthBottomSheetFactory = (factory: BottomSheetContentFactory) => {
  authBottomSheetFactory = factory;
};

export const showAuthBottomSheet = () => {
  if (authBottomSheetFactory) {
    store.dispatch(setBottomSheetContent(authBottomSheetFactory()));
    store.dispatch(openBottomSheet(true));
  } else {
    console.error('Auth bottom sheet factory not initialized');
  }
};
