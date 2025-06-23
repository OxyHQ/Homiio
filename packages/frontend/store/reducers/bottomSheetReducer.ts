import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import React from 'react';

interface BottomSheetState {
  isOpen: boolean;
  content: React.ReactNode | null;
}

const initialState: BottomSheetState = {
  isOpen: false,
  content: null,
};

const bottomSheetSlice = createSlice({
  name: 'bottomSheet',
  initialState,
  reducers: {
    openBottomSheet(state, action: PayloadAction<boolean>) {
      state.isOpen = action.payload;
    },
    setBottomSheetContent(state, action: PayloadAction<React.ReactNode | null>) {
      state.content = action.payload;
    },
  },
});

export const { openBottomSheet, setBottomSheetContent } = bottomSheetSlice.actions;

export default bottomSheetSlice.reducer;
