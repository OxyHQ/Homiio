import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

type LayoutScrollContextValue = {
    scrollY: SharedValue<number>;
};

const LayoutScrollContext = createContext<LayoutScrollContextValue | null>(null);

export const LayoutScrollProvider = LayoutScrollContext.Provider;

export function useLayoutScroll(): LayoutScrollContextValue | null {
    return useContext(LayoutScrollContext);
}

export default LayoutScrollContext;
