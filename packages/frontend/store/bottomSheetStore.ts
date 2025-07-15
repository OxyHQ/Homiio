import { create } from 'zustand';
import React from 'react';

interface BottomSheetState {
  isVisible: boolean;
  content: React.ReactNode | null;
  snapPoints: string[];
  index: number;
  onClose?: () => void;
}

interface BottomSheetActions {
  openBottomSheet: (content: React.ReactNode, snapPoints?: string[], onClose?: () => void) => void;
  closeBottomSheet: () => void;
  setBottomSheetContent: (content: React.ReactNode) => void;
  setSnapPoints: (snapPoints: string[]) => void;
  setIndex: (index: number) => void;
}

export const useBottomSheetStore = create<BottomSheetState & BottomSheetActions>((set) => ({
  // Initial state
  isVisible: false,
  content: null,
  snapPoints: ['25%', '50%', '90%'],
  index: 1,

  // Actions
  openBottomSheet: (content, snapPoints = ['25%', '50%', '90%'], onClose) => 
    set({ isVisible: true, content, snapPoints, index: 1, onClose }),
  
  closeBottomSheet: () => 
    set({ isVisible: false, content: null, onClose: undefined }),
  
  setBottomSheetContent: (content) => 
    set({ content }),
  
  setSnapPoints: (snapPoints) => 
    set({ snapPoints }),
  
  setIndex: (index) => 
    set({ index }),
})); 